import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { createInterface } from "node:readline";
import { test } from "node:test";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import {
  mcpSearchPageSize,
  sessionGrantMinTtlMs,
  type CompilerPreferenceInput,
  type ContextPackageItem,
  type IdentityScope,
} from "@laplace/contracts";
import { fixture, git } from "./fixtures/ipc-harness.ts";

const mcpStdioEntry = fileURLToPath(
  new URL("../src/mcp-stdio.ts", import.meta.url),
);

function spawnMcpClient(
  dataDir: string,
  params: {
    scope: IdentityScope;
    grantId: string;
    sessionId: string;
    destinationId: string;
    manifestDigest: string;
    policyVersion: string;
  },
) {
  const child = spawn(
    process.execPath,
    [
      mcpStdioEntry,
      dataDir,
      "--grant",
      params.grantId,
      "--session",
      params.sessionId,
      "--project",
      params.scope.projectId,
      "--binding",
      params.scope.bindingId,
      "--worktree",
      params.scope.worktreeId,
      "--destination",
      params.destinationId,
      "--manifest",
      params.manifestDigest,
      "--policy",
      params.policyVersion,
    ],
    {
      windowsHide: true,
      stdio: ["pipe", "pipe", "pipe"],
    },
  );
  const closed = once(child, "close");
  const lines = createInterface({ input: child.stdout })[
    Symbol.asyncIterator
  ]();
  const rawResponses: string[] = [];
  let nextId = 0;

  return {
    rawResponses,
    async rpc(method: string, rpcParams?: unknown) {
      const id = ++nextId;
      child.stdin.write(
        `${JSON.stringify({ jsonrpc: "2.0", id, method, params: rpcParams })}\n`,
      );
      const next = await lines.next();
      if (next.done || typeof next.value !== "string") {
        throw new Error("MCP stdout closed unexpectedly");
      }
      rawResponses.push(next.value);
      return JSON.parse(next.value) as {
        jsonrpc: string;
        id: number | null;
        result?: Record<string, unknown>;
        error?: { code: number; message: string };
      };
    },
    notify(method: string) {
      child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", method })}\n`);
    },
    async close() {
      if (child.exitCode === null) {
        child.stdin.end();
        await closed;
      }
      await lines.return?.();
    },
    async kill() {
      if (child.exitCode === null) {
        child.kill();
        await closed;
      }
    },
  };
}

test(
  "F2-M02: equivalência MCP stdio/ContextPackage, paginação, handoff com reavaliação e matriz de revogação/vazamento",
  { timeout: 60_000 },
  async (t) => {
    const env = await fixture(t);
    const repoA = await env.repository("Grants-A");
    const repoB = await env.repository("Grants-B");

    await mkdir(join(repoA, "src"), { recursive: true });
    await mkdir(join(repoA, "dist"), { recursive: true });
    await mkdir(join(repoB, "src"), { recursive: true });
    git(repoA, "config", "core.autocrlf", "false");
    git(repoB, "config", "core.autocrlf", "false");

    await writeFile(
      join(repoA, "src", "policy.ts"),
      "laplace_item policy canonical source\n",
    );
    await writeFile(
      join(repoA, "dist", "secret-build.txt"),
      "CANARY_OMITTED_M02_SECRET\n",
    );
    await writeFile(join(repoB, "src", "other.ts"), "Projeto B\n");
    git(repoA, "add", "src/policy.ts");
    git(repoA, "commit", "-qm", "base A");
    git(repoB, "add", "src/other.ts");
    git(repoB, "commit", "-qm", "base B");

    const client = env.start(env.dataDir);
    const projA = await client.request("workspace.addLocal", { path: repoA });
    const projB = await client.request("workspace.addLocal", { path: repoB });
    const idA = await client.request("project.identity", {
      projectId: projA.id,
    });
    const idB = await client.request("project.identity", {
      projectId: projB.id,
    });

    const snapshotA = await client.request("context.capture", {
      projectId: projA.id,
      paths: ["src/policy.ts", "dist/secret-build.txt"],
    });
    const includedEntry = snapshotA.entries.find(
      (entry) => entry.path === "src/policy.ts",
    );
    assert.ok(includedEntry?.outcome === "included");

    const localOnlyCanary = "CANARY_M02_LOCAL_ONLY";
    const dbOnlyCanary = "CANARY_M02_DB_ONLY";
    const crossCanary = "CANARY_M02_CROSS_SCOPE";
    const privCanary = "CANARY_M02_PRIVATE_META";

    await client.request("decision.record", {
      ...idA.scope,
      requestId: "req-m02-canon",
      assertionId: null,
      expectedRevision: 0,
      content: "laplace_item invariante canonico obrigatorio de sessao",
      author: "Autor M02",
      reason: "Base verificada",
      humanConfirmed: true,
      promoteCanonical: true,
      evidence: {
        contextId: snapshotA.contextId,
        path: "src/policy.ts",
        sha256: includedEntry.sha256,
        chunk: 0,
      },
    });
    await client.request("decision.record", {
      ...idA.scope,
      requestId: "req-m02-local",
      assertionId: null,
      expectedRevision: 0,
      content: localOnlyCanary,
      author: "Autor M02",
      reason: "Privado local",
      humanConfirmed: true,
      promoteCanonical: false,
      evidence: {
        contextId: snapshotA.contextId,
        path: "src/policy.ts",
        sha256: includedEntry.sha256,
        chunk: 0,
      },
    });

    const manyPrefs: CompilerPreferenceInput[] = Array.from(
      { length: 12 },
      (_, index) => ({
        key: `pref-${String(index + 1).padStart(2, "0")}`,
        title: `Preferencia ${index + 1}`,
        content: `laplace_item preferencia numero ${index + 1}`,
      }),
    );

    const compiled = await client.request("compiler.compile", {
      ...idA.scope,
      objective: "Buscar itens autorizados paginados via MCP e pacote",
      destinationId: "codex_mock",
      budgetBytes: 16_384,
      contextId: snapshotA.contextId,
      selection: [
        {
          path: "src/policy.ts",
          sha256: includedEntry.sha256,
          chunk: null,
        },
      ],
      projectPreferences: manyPrefs,
      extraCandidates: [
        {
          candidateId: "m02-db-only",
          kind: "context_source",
          tier: "project_preference",
          mandatory: false,
          visibility: "db_only",
          version: "1",
          title: "DB only",
          text: dbOnlyCanary,
        },
        {
          candidateId: "m02-cross",
          kind: "context_source",
          tier: "project_preference",
          mandatory: false,
          visibility: "captured_eligible",
          version: "1",
          title: "Cross scope",
          text: crossCanary,
          scope: idB.scope,
        },
        {
          candidateId: "m02-priv",
          kind: "project_preference",
          tier: "project_preference",
          mandatory: false,
          visibility: "captured_eligible",
          version: "1",
          title: "Com metadado privado",
          text: "laplace_item metadado privado filtrado",
          privateMetadata: { secret: privCanary },
        },
      ],
    });
    assert.equal(compiled.publicManifest.status, "ready");
    assert.ok(compiled.publicManifest.items.length >= 14);

    // Grant requires humanConfirmed === true.
    await assert.rejects(
      client.request("compiler.grantIssue", {
        ...idA.scope,
        sessionId: "sess-unconfirmed",
        manifestDigest: compiled.manifestDigest,
        policyVersion: compiled.publicManifest.policyVersion,
        destinationId: "codex_mock",
        allowedOperations: ["summary", "search", "read", "package", "handoff"],
        humanConfirmed: false,
      }),
      { message: "codex_authorization_required" },
    );

    const grant = await client.request("compiler.grantIssue", {
      ...idA.scope,
      sessionId: "sess-m02-live",
      manifestDigest: compiled.manifestDigest,
      policyVersion: compiled.publicManifest.policyVersion,
      destinationId: "codex_mock",
      allowedOperations: ["summary", "search", "read", "package", "handoff"],
      humanConfirmed: true,
    });

    const mcp = spawnMcpClient(env.dataDir, {
      scope: idA.scope,
      grantId: grant.grantId,
      sessionId: grant.sessionId,
      destinationId: grant.destinationId,
      manifestDigest: grant.manifestDigest,
      policyVersion: grant.policyVersion,
    });
    t.after(() => mcp.kill());

    const init = await mcp.rpc("initialize", {
      protocolVersion: "2024-11-05",
    });
    assert.equal(
      (init.result?.serverInfo as { name?: string })?.name,
      "laplace-mcp-gateway",
    );
    mcp.notify("notifications/initialized");
    assert.deepEqual((await mcp.rpc("ping")).result, {});

    const toolsList = await mcp.rpc("tools/list");
    const listedNames = (
      toolsList.result?.tools as { name: string }[] | undefined
    )?.map((tool) => tool.name);
    assert.deepEqual(listedNames, [
      "laplace_context_summary",
      "laplace_context_search",
      "laplace_context_read",
    ]);

    const summaryReply = await mcp.rpc("tools/call", {
      name: "laplace_context_summary",
      arguments: {},
    });
    const summaryText = (summaryReply.result?.content as { text: string }[])[0]!
      .text;
    const summaryPayload = JSON.parse(summaryText) as {
      manifestDigest: string;
      items: { opaqueRef: string }[];
    };
    assert.equal(summaryPayload.manifestDigest, compiled.manifestDigest);

    // Search pagination (page 1 -> cursor 10 -> null).
    const searchPage1 = await mcp.rpc("tools/call", {
      name: "laplace_context_search",
      arguments: { query: "laplace_item", cursor: 0, limit: mcpSearchPageSize },
    });
    const page1Data = JSON.parse(
      (searchPage1.result?.content as { text: string }[])[0]!.text,
    ) as {
      total: number;
      nextCursor: number | null;
      items: { opaqueRef: string }[];
    };
    assert.equal(page1Data.items.length, mcpSearchPageSize);
    assert.equal(page1Data.nextCursor, mcpSearchPageSize);

    const searchPage2 = await mcp.rpc("tools/call", {
      name: "laplace_context_search",
      arguments: {
        query: "laplace_item",
        cursor: mcpSearchPageSize,
        limit: mcpSearchPageSize,
      },
    });
    const page2Data = JSON.parse(
      (searchPage2.result?.content as { text: string }[])[0]!.text,
    ) as {
      total: number;
      nextCursor: number | null;
      items: { opaqueRef: string }[];
    };
    assert.ok(page2Data.items.length >= 4);
    assert.equal(page2Data.nextCursor, null);

    // Read every authorized item via MCP and verify parity with ContextPackage.
    const mcpReadItems: ContextPackageItem[] = [];
    for (const item of compiled.publicManifest.items) {
      const readReply = await mcp.rpc("tools/call", {
        name: "laplace_context_read",
        arguments: { opaqueRef: item.opaqueRef },
      });
      const parsedItem = JSON.parse(
        (readReply.result?.content as { text: string }[])[0]!.text,
      ) as ContextPackageItem;
      mcpReadItems.push(parsedItem);
    }

    const exported = await client.request("compiler.packageExport", {
      ...idA.scope,
      grantId: grant.grantId,
      sessionId: grant.sessionId,
      manifestDigest: grant.manifestDigest,
      policyVersion: grant.policyVersion,
      destinationId: grant.destinationId,
      includeHandoff: true,
    });
    assert.deepEqual(mcpReadItems, exported.contextPackage.items);
    assert.equal(exported.handoff?.requiresReevaluation, true);

    // Negative: path traversal, disk path, unknown ref and zero canary leakage on open MCP channel.
    const traversal = await mcp.rpc("tools/call", {
      name: "laplace_context_read",
      arguments: { opaqueRef: "../secret.ts" },
    });
    assert.equal(traversal.error?.message, "grant_invalid");

    const rawPath = await mcp.rpc("tools/call", {
      name: "laplace_context_read",
      arguments: { opaqueRef: "src/policy.ts" },
    });
    assert.equal(rawPath.error?.message, "grant_invalid");

    const unknownRef = await mcp.rpc("tools/call", {
      name: "laplace_context_read",
      arguments: { opaqueRef: "ref-0000000000000000" },
    });
    assert.equal(unknownRef.error?.message, "context_source_unavailable");

    const allLeakedSurface =
      mcp.rawResponses.join("\n") + JSON.stringify(exported);
    for (const canary of [
      localOnlyCanary,
      dbOnlyCanary,
      crossCanary,
      privCanary,
      "CANARY_OMITTED_M02_SECRET",
      "secret-build.txt",
      repoA,
    ]) {
      assert.ok(
        !allLeakedSurface.includes(canary),
        `Vazamento em MCP/ContextPackage: ${canary}`,
      );
    }

    // Mid-flight revocation: revoke while MCP stdio child is still running, then deny immediately.
    const revokedGrant = await client.request("compiler.grantRevoke", {
      ...idA.scope,
      grantId: grant.grantId,
      reason: "Revogacao em voo durante sessao MCP",
    });
    assert.equal(revokedGrant.status, "revoked");

    const readAfterRevoke = await mcp.rpc("tools/call", {
      name: "laplace_context_read",
      arguments: { opaqueRef: compiled.publicManifest.items[0]!.opaqueRef },
    });
    assert.equal(readAfterRevoke.error?.message, "grant_revoked");

    const listAfterRevoke = await mcp.rpc("tools/list");
    assert.equal(listAfterRevoke.error?.message, "grant_revoked");
    await mcp.close();

    // Sidecar calls after revocation also fail with grant_revoked.
    await assert.rejects(
      client.request("compiler.mcpCall", {
        ...idA.scope,
        grantId: grant.grantId,
        sessionId: grant.sessionId,
        manifestDigest: grant.manifestDigest,
        policyVersion: grant.policyVersion,
        destinationId: grant.destinationId,
        method: "summary",
      }),
      { message: "grant_revoked" },
    );
    await assert.rejects(
      client.request("compiler.packageExport", {
        ...idA.scope,
        grantId: grant.grantId,
        sessionId: grant.sessionId,
        manifestDigest: grant.manifestDigest,
        policyVersion: grant.policyVersion,
        destinationId: grant.destinationId,
        includeHandoff: false,
      }),
      { message: "grant_revoked" },
    );

    // Search/read-only grant without "summary" must still list permitted tools cleanly.
    const searchOnlyGrant = await client.request("compiler.grantIssue", {
      ...idA.scope,
      sessionId: "sess-search-only",
      manifestDigest: compiled.manifestDigest,
      policyVersion: compiled.publicManifest.policyVersion,
      destinationId: "codex_mock",
      allowedOperations: ["search", "read"],
      humanConfirmed: true,
    });
    const mcpSearchOnly = spawnMcpClient(env.dataDir, {
      scope: idA.scope,
      grantId: searchOnlyGrant.grantId,
      sessionId: searchOnlyGrant.sessionId,
      destinationId: searchOnlyGrant.destinationId,
      manifestDigest: searchOnlyGrant.manifestDigest,
      policyVersion: searchOnlyGrant.policyVersion,
    });
    t.after(() => mcpSearchOnly.kill());
    await mcpSearchOnly.rpc("initialize", { protocolVersion: "2024-11-05" });
    mcpSearchOnly.notify("notifications/initialized");
    const restrictedTools = await mcpSearchOnly.rpc("tools/list");
    assert.deepEqual(
      (restrictedTools.result?.tools as { name: string }[] | undefined)?.map(
        (tool) => tool.name,
      ),
      ["laplace_context_search", "laplace_context_read"],
    );
    await mcpSearchOnly.close();

    // Cross-scope and destination tampering must reject without leaking payloads.
    await assert.rejects(
      client.request("compiler.mcpCall", {
        ...idB.scope,
        grantId: searchOnlyGrant.grantId,
        sessionId: searchOnlyGrant.sessionId,
        manifestDigest: searchOnlyGrant.manifestDigest,
        policyVersion: searchOnlyGrant.policyVersion,
        destinationId: searchOnlyGrant.destinationId,
        method: "search",
        query: "laplace_item",
      }),
      { message: "grant_invalid" },
    );
    await assert.rejects(
      client.request("compiler.mcpCall", {
        ...idA.scope,
        grantId: searchOnlyGrant.grantId,
        sessionId: searchOnlyGrant.sessionId,
        manifestDigest: searchOnlyGrant.manifestDigest,
        policyVersion: searchOnlyGrant.policyVersion,
        destinationId: "codex_cli_workspace",
        method: "search",
        query: "laplace_item",
      }),
      { message: "destination_denied" },
    );
    await assert.rejects(
      client.request("compiler.mcpCall", {
        ...idA.scope,
        grantId: searchOnlyGrant.grantId,
        sessionId: searchOnlyGrant.sessionId,
        manifestDigest: searchOnlyGrant.manifestDigest,
        policyVersion: searchOnlyGrant.policyVersion,
        destinationId: "rogue_destination",
        method: "search",
        query: "laplace_item",
      }),
      { message: "destination_unknown" },
    );

    // Grant expiry at ttlMs = 1000ms.
    const shortGrant = await client.request("compiler.grantIssue", {
      ...idA.scope,
      sessionId: "sess-short-ttl",
      manifestDigest: compiled.manifestDigest,
      policyVersion: compiled.publicManifest.policyVersion,
      destinationId: "codex_mock",
      allowedOperations: ["summary", "package"],
      ttlMs: sessionGrantMinTtlMs,
      humanConfirmed: true,
    });
    await client.request("compiler.mcpCall", {
      ...idA.scope,
      grantId: shortGrant.grantId,
      sessionId: shortGrant.sessionId,
      manifestDigest: shortGrant.manifestDigest,
      policyVersion: shortGrant.policyVersion,
      destinationId: shortGrant.destinationId,
      method: "summary",
    });
    await delay(1_150);
    await assert.rejects(
      client.request("compiler.mcpCall", {
        ...idA.scope,
        grantId: shortGrant.grantId,
        sessionId: shortGrant.sessionId,
        manifestDigest: shortGrant.manifestDigest,
        policyVersion: shortGrant.policyVersion,
        destinationId: shortGrant.destinationId,
        method: "summary",
      }),
      { message: "grant_expired" },
    );
    await assert.rejects(
      client.request("compiler.packageExport", {
        ...idA.scope,
        grantId: shortGrant.grantId,
        sessionId: shortGrant.sessionId,
        manifestDigest: shortGrant.manifestDigest,
        policyVersion: shortGrant.policyVersion,
        destinationId: shortGrant.destinationId,
        includeHandoff: false,
      }),
      { message: "grant_expired" },
    );

    // Handoff reevaluation checks: confirmation, integrity, scope, destination, and non-auto-grant.
    await assert.rejects(
      client.request("compiler.handoffImport", {
        ...idA.scope,
        destinationId: "codex_mock",
        humanConfirmed: false,
        contextPackage: exported.contextPackage,
        handoff: exported.handoff ?? undefined,
      }),
      { message: "codex_authorization_required" },
    );
    await assert.rejects(
      client.request("compiler.handoffImport", {
        ...idA.scope,
        destinationId: "codex_mock",
        humanConfirmed: true,
        contextPackage: {
          ...exported.contextPackage,
          items: exported.contextPackage.items.map((item, idx) =>
            idx === 0 ? { ...item, text: `${item.text} TAMPERED` } : item,
          ),
        },
      }),
      { message: "handoff_invalid" },
    );
    await assert.rejects(
      client.request("compiler.handoffImport", {
        ...idB.scope,
        destinationId: "codex_mock",
        humanConfirmed: true,
        contextPackage: exported.contextPackage,
        handoff: exported.handoff ?? undefined,
      }),
      { message: "handoff_invalid" },
    );
    await assert.rejects(
      client.request("compiler.handoffImport", {
        ...idA.scope,
        destinationId: "rogue_handoff_dest",
        humanConfirmed: true,
        contextPackage: exported.contextPackage,
      }),
      { message: "destination_unknown" },
    );

    const grantsBeforeHandoff = (
      await client.request("compiler.grantList", { ...idA.scope })
    ).items.length;
    const evaluated = await client.request("compiler.handoffImport", {
      ...idA.scope,
      destinationId: "codex_mock",
      humanConfirmed: true,
      contextPackage: exported.contextPackage,
      handoff: exported.handoff ?? undefined,
    });
    assert.equal(evaluated.evaluation, "accepted_requires_grant");
    assert.equal(evaluated.requiresNewGrant, true);
    assert.equal(
      (await client.request("compiler.grantList", { ...idA.scope })).items
        .length,
      grantsBeforeHandoff,
    );

    await client.close();
  },
);
