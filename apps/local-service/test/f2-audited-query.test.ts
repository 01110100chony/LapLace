import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { test } from "node:test";
import { fixture, git } from "./fixtures/ipc-harness.ts";

test(
  "F2-M03: compara canais MCP stdio e ContextPackage em modo Mock, persiste revisão humana e bloqueia modos não autorizados",
  { timeout: 60_000 },
  async (t) => {
    const env = await fixture(t);
    const repoA = await env.repository("Audit-A");
    await mkdir(join(repoA, "src"), { recursive: true });
    git(repoA, "config", "core.autocrlf", "false");
    await writeFile(
      join(repoA, "src", "module.ts"),
      "export const regraAuditoria = 'retomada-auditada';\n",
    );
    git(repoA, "add", "src/module.ts");
    git(repoA, "commit", "-qm", "base");

    const mock = env.start(env.dataDir, "completed");
    const projA = await mock.request("workspace.addLocal", { path: repoA });
    const idA = await mock.request("project.identity", {
      projectId: projA.id,
    });
    const snapshot = await mock.request("context.capture", {
      projectId: projA.id,
      paths: ["src/module.ts"],
    });
    const entry = snapshot.entries.find(
      (item) => item.path === "src/module.ts",
    );
    assert.ok(entry?.outcome === "included");

    await mock.request("decision.record", {
      ...idA.scope,
      requestId: "req-m03-canon",
      assertionId: null,
      expectedRevision: 0,
      content: "regraAuditoria exige rastreabilidade e citacao verificada.",
      author: "Autor M03",
      reason: "Requisito auditavel F2",
      humanConfirmed: true,
      promoteCanonical: true,
      evidence: {
        contextId: snapshot.contextId,
        path: "src/module.ts",
        sha256: entry.sha256,
        chunk: 0,
      },
    });

    const compiled = await mock.request("compiler.compile", {
      ...idA.scope,
      objective: "Qual e a regraAuditoria vigente no projeto?",
      destinationId: "codex_mock",
      budgetBytes: 8192,
      contextId: snapshot.contextId,
      selection: [
        {
          path: "src/module.ts",
          sha256: entry.sha256,
          chunk: null,
        },
      ],
    });
    assert.equal(compiled.publicManifest.status, "ready");
    assert.equal(compiled.publicManifest.items.length, 2);

    const grant = await mock.request("compiler.grantIssue", {
      ...idA.scope,
      sessionId: "sess-m03-compare",
      manifestDigest: compiled.manifestDigest,
      policyVersion: compiled.publicManifest.policyVersion,
      destinationId: "codex_mock",
      allowedOperations: [
        "summary",
        "search",
        "read",
        "package",
        "handoff",
        "query",
      ],
      humanConfirmed: true,
    });

    const mcpRun = await mock.request("compiler.queryRun", {
      ...idA.scope,
      grantId: grant.grantId,
      sessionId: grant.sessionId,
      manifestDigest: grant.manifestDigest,
      policyVersion: grant.policyVersion,
      destinationId: grant.destinationId,
      channel: "mcp_stdio",
    });
    assert.equal(mcpRun.state, "completed");
    assert.equal(mcpRun.mode, "mock_development");
    assert.equal(mcpRun.observability, "mcp_observed");
    assert.equal(mcpRun.mcpAdherence, "observed");
    assert.ok(
      mcpRun.observedReads.some(
        (read) =>
          read.tool === "laplace_context_summary" && read.outcome === "allowed",
      ),
    );
    assert.ok(
      mcpRun.observedReads.some(
        (read) =>
          read.tool === "laplace_context_search" && read.outcome === "allowed",
      ),
    );
    assert.ok(
      mcpRun.observedReads.some(
        (read) =>
          read.tool === "laplace_context_read" && read.outcome === "allowed",
      ),
    );
    assert.equal(mcpRun.citations.declared.length, 2);
    assert.ok(mcpRun.citations.declared.every((c) => c.verified));
    assert.equal(mcpRun.citations.unknown.length, 0);

    const pkgRun = await mock.request("compiler.queryRun", {
      ...idA.scope,
      grantId: grant.grantId,
      sessionId: grant.sessionId,
      manifestDigest: grant.manifestDigest,
      policyVersion: grant.policyVersion,
      destinationId: grant.destinationId,
      channel: "context_package",
    });
    assert.equal(pkgRun.state, "completed");
    assert.equal(pkgRun.mode, "mock_development");
    assert.equal(pkgRun.observability, "package_static");
    assert.equal(pkgRun.mcpAdherence, "not_applicable");
    assert.equal(pkgRun.observedReads.length, 0);
    assert.deepEqual(pkgRun.delivered.opaqueRefs, mcpRun.delivered.opaqueRefs);
    assert.equal(
      pkgRun.citations.declared.length,
      mcpRun.citations.declared.length,
    );
    assert.ok(pkgRun.citations.declared.every((c) => c.verified));

    // Human review persistence requires humanConfirmed === true.
    await assert.rejects(
      mock.request("compiler.auditReview", {
        ...idA.scope,
        auditId: mcpRun.auditId,
        status: "approved",
        reviewer: "Autor M03",
        note: "Sem confirmacao explicita.",
        humanConfirmed: false,
      }),
      { message: "codex_authorization_required" },
    );
    const reviewed = await mock.request("compiler.auditReview", {
      ...idA.scope,
      auditId: mcpRun.auditId,
      status: "approved",
      reviewer: "Autor M03",
      note: "Canais equivalentes verificados.",
      humanConfirmed: true,
    });
    assert.equal(reviewed.review.status, "approved");
    assert.equal(reviewed.review.reviewer, "Autor M03");
    assert.equal(reviewed.review.note, "Canais equivalentes verificados.");
    assert.ok(reviewed.review.reviewedAt !== null);

    await mock.close();

    // Restart offline sidecar (no mock flag) and verify history + mode guards.
    const offline = env.start(env.dataDir);
    const listed = await offline.request("compiler.auditList", {
      ...idA.scope,
      manifestDigest: compiled.manifestDigest,
    });
    assert.equal(listed.items.length, 2);
    const persistedMcp = listed.items.find(
      (item) => item.auditId === mcpRun.auditId,
    );
    assert.ok(persistedMcp);
    assert.equal(persistedMcp.review.status, "approved");
    assert.equal(
      persistedMcp.observedReads.length,
      mcpRun.observedReads.length,
    );
    assert.equal(persistedMcp.citations.declared.length, 2);

    // Offline/default sidecar cannot spoof mock_development or execute verified_isolated.
    await assert.rejects(
      offline.request("compiler.queryRun", {
        ...idA.scope,
        grantId: grant.grantId,
        sessionId: grant.sessionId,
        manifestDigest: grant.manifestDigest,
        policyVersion: grant.policyVersion,
        destinationId: "codex_mock",
        channel: "mcp_stdio",
        mode: "mock_development",
      }),
      { message: "codex_unavailable" },
    );

    await assert.rejects(
      offline.request("compiler.queryRun", {
        ...idA.scope,
        grantId: grant.grantId,
        sessionId: grant.sessionId,
        manifestDigest: grant.manifestDigest,
        policyVersion: grant.policyVersion,
        destinationId: "codex_mock",
        channel: "mcp_stdio",
        mode: "verified_isolated",
      }),
      { message: "codex_unavailable" },
    );

    // Unconfined workspace dev requires explicit unconfinedConfirmed both on grant and query.
    const wsCompiled = await offline.request("compiler.compile", {
      ...idA.scope,
      objective: "Validar guarda Workspace Dev",
      destinationId: "codex_cli_workspace",
      budgetBytes: 4096,
    });
    await assert.rejects(
      offline.request("compiler.grantIssue", {
        ...idA.scope,
        sessionId: "sess-ws-unconfirmed",
        manifestDigest: wsCompiled.manifestDigest,
        policyVersion: wsCompiled.publicManifest.policyVersion,
        destinationId: "codex_cli_workspace",
        allowedOperations: ["summary", "query"],
        humanConfirmed: true,
      }),
      { message: "codex_authorization_required" },
    );
    const wsGrant = await offline.request("compiler.grantIssue", {
      ...idA.scope,
      sessionId: "sess-ws-confirmed",
      manifestDigest: wsCompiled.manifestDigest,
      policyVersion: wsCompiled.publicManifest.policyVersion,
      destinationId: "codex_cli_workspace",
      allowedOperations: ["summary", "query"],
      humanConfirmed: true,
      unconfinedConfirmed: true,
    });
    await assert.rejects(
      offline.request("compiler.queryRun", {
        ...idA.scope,
        grantId: wsGrant.grantId,
        sessionId: wsGrant.sessionId,
        manifestDigest: wsGrant.manifestDigest,
        policyVersion: wsGrant.policyVersion,
        destinationId: "codex_cli_workspace",
        channel: "mcp_stdio",
        mode: "unconfined_workspace_development",
      }),
      { message: "codex_authorization_required" },
    );

    const allAudits = await offline.request("compiler.auditList", {
      ...idA.scope,
    });
    assert.equal(
      allAudits.items.filter((item) => item.state === "denied").length,
      3,
    );

    await offline.close();
  },
);
