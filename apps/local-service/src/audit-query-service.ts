import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { once } from "node:events";
import { realpath } from "node:fs/promises";
import { tmpdir } from "node:os";
import { createInterface } from "node:readline";
import {
  detectCodex,
  runWorkspaceCodex,
  type CodexRunEvent,
} from "@laplace/agents";
import {
  type AuditedCitation,
  type AuditedQueryRecord,
  type AuditedQueryRunInput,
  type AuditReviewInput,
  type CodexMode,
  type CompiledPublicManifest,
  type IdentityScope,
  type ObservedMcpRead,
} from "@laplace/contracts";
import { resolveDestinationPolicy } from "@laplace/core";
import type { openCatalog } from "./catalog.ts";
import type { createContextPackageService } from "./context-package.ts";
import { GitError } from "./git.ts";
import type { createSessionGrantService } from "./session-grant-store.ts";
import { withTemporaryWorkspace } from "./temporary-workspace.ts";

type CatalogStore = ReturnType<typeof openCatalog>;
type WithCatalog = <T>(operation: (store: CatalogStore) => T) => T;
type GrantService = ReturnType<typeof createSessionGrantService>;
type PackageService = ReturnType<typeof createContextPackageService>;

function extractCitations(
  responseText: string | null,
  manifest: CompiledPublicManifest,
): { declared: AuditedCitation[]; unknown: string[] } {
  if (!responseText) return { declared: [], unknown: [] };
  const matches = Array.from(
    responseText.matchAll(/\[(ref-[a-f0-9]{16}|source-\d+)\]/g),
    ([, id]) => id!,
  );
  const uniqueIds = [...new Set(matches)];
  const declared: AuditedCitation[] = [];
  const unknown: string[] = [];

  for (const id of uniqueIds) {
    const item = manifest.items.find((entry) => entry.opaqueRef === id);
    if (item) {
      declared.push({
        opaqueRef: id,
        verified: true,
        version: item.version,
        contentDigest: item.contentDigest,
      });
    } else {
      unknown.push(id);
    }
  }
  return { declared, unknown };
}

function buildMockAnswer(
  objective: string,
  channel: "mcp_stdio" | "context_package",
  items: { opaqueRef: string; text: string }[],
): string {
  if (items.length === 0) {
    return `Sem fontes autorizadas para responder ao objetivo "${objective}" via ${channel}.`;
  }
  const lines = items.map((item) => {
    const excerpt = item.text.replace(/\s+/g, " ").trim().slice(0, 120);
    return `- [${item.opaqueRef}] ${excerpt}`;
  });
  return `Consulta simulada (${channel}) para "${objective}":\n${lines.join("\n")}`;
}

async function runMcpStdioSession(params: {
  mcpEntry: string;
  dataDir: string;
  scope: IdentityScope;
  grantId: string;
  sessionId: string;
  destinationId: string;
  manifestDigest: string;
  policyVersion: string;
  objective: string;
  allowSearch: boolean;
  allowRead: boolean;
  itemsToRead: string[];
}): Promise<{ opaqueRef: string; text: string }[]> {
  const cleanEnv = { ...process.env };
  delete cleanEnv.NODE_OPTIONS;
  delete cleanEnv.NODE_V8_COVERAGE;

  const child = spawn(
    process.execPath,
    [
      params.mcpEntry,
      params.dataDir,
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
      env: cleanEnv,
      stdio: ["pipe", "pipe", "pipe"],
    },
  );

  const lines = createInterface({ input: child.stdout })[
    Symbol.asyncIterator
  ]();
  const closed = once(child, "close");
  let seq = 0;

  async function rpc(method: string, rpcParams?: object) {
    const id = ++seq;
    child.stdin.write(
      `${JSON.stringify({ jsonrpc: "2.0", id, method, params: rpcParams })}\n`,
    );
    const next = await lines.next();
    if (next.done || typeof next.value !== "string") {
      throw new GitError("codex_execution_unavailable");
    }
    const parsed = JSON.parse(next.value) as {
      id: number;
      result?: { content?: { type: string; text: string }[] };
      error?: { code: number; message: string };
    };
    if (parsed.error) {
      throw new GitError(
        (parsed.error.message as GitError["code"]) || "grant_invalid",
      );
    }
    return parsed.result;
  }

  try {
    await rpc("initialize", { protocolVersion: "2024-11-05" });
    child.stdin.write(
      `${JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" })}\n`,
    );
    await rpc("tools/list");
    await rpc("tools/call", {
      name: "laplace_context_summary",
      arguments: {},
    });

    if (params.allowSearch && params.itemsToRead.length > 0) {
      const term =
        params.objective.match(/[\p{L}\p{N}]{2,}/u)?.[0] ?? "contexto";
      await rpc("tools/call", {
        name: "laplace_context_search",
        arguments: { query: term, cursor: 0 },
      });
    }

    const readItems: { opaqueRef: string; text: string }[] = [];
    if (params.allowRead) {
      for (const opaqueRef of params.itemsToRead) {
        const res = await rpc("tools/call", {
          name: "laplace_context_read",
          arguments: { opaqueRef },
        });
        const rawText = res?.content?.[0]?.text ?? "{}";
        const payload = JSON.parse(rawText) as {
          opaqueRef: string;
          text: string;
        };
        readItems.push({
          opaqueRef: payload.opaqueRef,
          text: payload.text,
        });
      }
    }

    child.stdin.end();
    await closed;
    return readItems;
  } finally {
    if (child.exitCode === null) child.kill();
    lines.return?.().catch(() => {});
  }
}

export function createAuditQueryService(deps: {
  withCatalog: WithCatalog;
  grants: GrantService;
  packages: PackageService;
  dataDir: string;
  mcpEntry: string;
  currentMode: CodexMode;
  workspaceHelper?: string;
  now?: () => string;
}) {
  const now = deps.now ?? (() => new Date().toISOString());

  return {
    async runQuery(input: AuditedQueryRunInput): Promise<AuditedQueryRecord> {
      const scope: IdentityScope = {
        projectId: input.projectId,
        bindingId: input.bindingId,
        worktreeId: input.worktreeId,
      };
      const startedAt = now();
      const startedPerf = performance.now();

      // Always verify scope exists before touching anything else.
      const manifestFallback = deps.withCatalog((store) => {
        store.identity.resolveScope(scope);
        return store.f2.getCompiledManifest(scope, input.manifestDigest);
      });

      const effectiveMode: CodexMode = input.mode ?? deps.currentMode;

      const recordDenied = (failureCode: GitError["code"]): never => {
        const finishedAt = now();
        if (manifestFallback) {
          const deniedRecord: AuditedQueryRecord = {
            auditId: randomUUID(),
            scope,
            grantId: input.grantId,
            sessionId: input.sessionId,
            manifestDigest: input.manifestDigest,
            policyVersion: input.policyVersion,
            destinationId: input.destinationId,
            channel: input.channel,
            mode: effectiveMode,
            objective: manifestFallback.publicManifest.objective,
            state: "denied",
            failureCode,
            delivered: {
              digest: input.manifestDigest,
              bytes: 0,
              opaqueRefs: [],
            },
            observability:
              input.channel === "mcp_stdio" ? "mcp_observed" : "package_static",
            observedReads: [],
            mcpAdherence:
              input.channel === "mcp_stdio" ? "not_used" : "not_applicable",
            responseText: null,
            citations: { declared: [], unknown: [] },
            durationMs: Math.max(
              0,
              Math.round(performance.now() - startedPerf),
            ),
            usage: null,
            startedAt,
            finishedAt,
            review: {
              status: "pending",
              reviewer: null,
              note: null,
              reviewedAt: null,
            },
          };
          try {
            deps.withCatalog((store) => store.f2.insertAudit(deniedRecord));
          } catch {
            // Preserve primary denial if audit storage fails.
          }
        }
        throw new GitError(failureCode);
      };

      const destination = resolveDestinationPolicy(input.destinationId);
      if (!destination.known) return recordDenied("destination_unknown");
      if (!destination.deliveryAllowed)
        return recordDenied("destination_denied");

      let validated;
      try {
        validated = deps.grants.validate({
          scope,
          grantId: input.grantId,
          sessionId: input.sessionId,
          destinationId: input.destinationId,
          manifestDigest: input.manifestDigest,
          policyVersion: input.policyVersion,
          requiredOperation: "query",
        });
      } catch (error) {
        return recordDenied(
          error instanceof GitError ? error.code : "grant_invalid",
        );
      }

      const { grant, manifestRecord } = validated;
      const { publicManifest } = manifestRecord;

      // verified_isolated remains strictly blocked until F4-M02 LPAC proof.
      if (effectiveMode === "verified_isolated") {
        return recordDenied("codex_unavailable");
      }
      if (destination.executionMode !== effectiveMode) {
        return recordDenied("destination_denied");
      }
      if (effectiveMode === "unconfined_workspace_development") {
        if (input.unconfinedConfirmed !== true) {
          return recordDenied("codex_authorization_required");
        }
        if (
          deps.currentMode !== "unconfined_workspace_development" ||
          !deps.workspaceHelper
        ) {
          return recordDenied("codex_unavailable");
        }
      }
      if (
        effectiveMode === "mock_development" &&
        deps.currentMode !== "mock_development"
      ) {
        return recordDenied("codex_unavailable");
      }

      const requiredChannelOp =
        input.channel === "mcp_stdio" ? "summary" : "package";
      if (!grant.allowedOperations.includes(requiredChannelOp)) {
        return recordDenied("grant_invalid");
      }

      let deliveredDigest = publicManifest.manifestDigest;
      let deliveredBytes = 0;
      let deliveredRefs: string[] = [];
      let observedReads: ObservedMcpRead[] = [];
      let mcpAdherence: AuditedQueryRecord["mcpAdherence"] =
        input.channel === "mcp_stdio" ? "not_used" : "not_applicable";
      let responseText: string | null;
      let usage: AuditedQueryRecord["usage"] = null;
      let state: AuditedQueryRecord["state"] = "completed";
      let failureCode: string | null = null;

      if (effectiveMode === "mock_development") {
        if (input.channel === "mcp_stdio") {
          const beforeSeq = deps.withCatalog((store) =>
            store.f2.getMaxMcpSequence(grant.grantId),
          );
          const readItems = await runMcpStdioSession({
            mcpEntry: deps.mcpEntry,
            dataDir: deps.dataDir,
            scope,
            grantId: grant.grantId,
            sessionId: grant.sessionId,
            destinationId: grant.destinationId,
            manifestDigest: grant.manifestDigest,
            policyVersion: grant.policyVersion,
            objective: publicManifest.objective,
            allowSearch: grant.allowedOperations.includes("search"),
            allowRead: grant.allowedOperations.includes("read"),
            itemsToRead: publicManifest.items.map((item) => item.opaqueRef),
          });
          observedReads = deps.withCatalog((store) =>
            store.f2.listMcpLog(scope, grant.grantId, beforeSeq),
          );
          mcpAdherence = observedReads.some((r) => r.outcome === "allowed")
            ? "observed"
            : "not_used";
          deliveredRefs = readItems.map((item) => item.opaqueRef);
          deliveredBytes = readItems.reduce(
            (sum, item) => sum + Buffer.byteLength(item.text, "utf8"),
            0,
          );
          responseText = buildMockAnswer(
            publicManifest.objective,
            "mcp_stdio",
            readItems,
          );
          usage = {
            input: Math.max(12, Math.ceil(deliveredBytes / 4)),
            cachedInput: 0,
            output: Math.max(8, Math.ceil(responseText.length / 4)),
          };
        } else {
          const bundle = deps.packages.exportPackage({
            ...scope,
            grantId: grant.grantId,
            sessionId: grant.sessionId,
            manifestDigest: grant.manifestDigest,
            policyVersion: grant.policyVersion,
            destinationId: grant.destinationId,
            includeHandoff: false,
          });
          deliveredDigest = bundle.contextPackage.packageDigest;
          deliveredRefs = bundle.contextPackage.items.map(
            (item) => item.opaqueRef,
          );
          deliveredBytes = bundle.contextPackage.items.reduce(
            (sum, item) => sum + item.bytes,
            0,
          );
          responseText = buildMockAnswer(
            publicManifest.objective,
            "context_package",
            bundle.contextPackage.items.map((item) => ({
              opaqueRef: item.opaqueRef,
              text: item.text,
            })),
          );
          usage = {
            input: Math.max(12, Math.ceil(deliveredBytes / 4)),
            cachedInput: 0,
            output: Math.max(8, Math.ceil(responseText.length / 4)),
          };
        }
      } else {
        // unconfined_workspace_development (real CLI execution with workspace helper)
        const probeCwd = await realpath(tmpdir());
        const { installation, availability } = await detectCodex(probeCwd, {
          workspace: true,
        });
        if (!installation || availability.state !== "confinement_unverified") {
          return recordDenied("codex_unavailable");
        }

        const protectedRoots = deps.withCatalog((store) => [
          ...store.list().projects.map((p) => p.root),
          deps.dataDir,
        ]);

        const beforeSeq =
          input.channel === "mcp_stdio"
            ? deps.withCatalog((store) =>
                store.f2.getMaxMcpSequence(grant.grantId),
              )
            : 0;

        let promptPayload: string;
        if (input.channel === "mcp_stdio") {
          promptPayload = JSON.stringify({
            objective: publicManifest.objective,
            instruction:
              "Use the configured laplace MCP server (laplace_context_summary, laplace_context_search, laplace_context_read) to read authorized sources and cite opaque references like [ref-...].",
            manifestDigest: publicManifest.manifestDigest,
          });
        } else {
          const bundle = deps.packages.exportPackage({
            ...scope,
            grantId: grant.grantId,
            sessionId: grant.sessionId,
            manifestDigest: grant.manifestDigest,
            policyVersion: grant.policyVersion,
            destinationId: grant.destinationId,
            includeHandoff: false,
          });
          deliveredDigest = bundle.contextPackage.packageDigest;
          deliveredRefs = bundle.contextPackage.items.map(
            (item) => item.opaqueRef,
          );
          deliveredBytes = bundle.contextPackage.items.reduce(
            (sum, item) => sum + item.bytes,
            0,
          );
          promptPayload = JSON.stringify({
            objective: publicManifest.objective,
            contextPackage: bundle.contextPackage,
          });
        }

        const prompt = Buffer.from(
          "Answer the objective strictly using the supplied Laplace context. " +
            "Cite each referenced item in brackets using its opaqueRef, e.g. [ref-0123456789abcdef].\n\n" +
            promptPayload,
        );

        const events: CodexRunEvent[] = [];
        const controller = new AbortController();
        const terminal = await withTemporaryWorkspace(
          "codex",
          protectedRoots,
          async (workspaceRoot) =>
            runWorkspaceCodex({
              installation,
              helper: deps.workspaceHelper!,
              cwd: workspaceRoot,
              workspace: workspaceRoot,
              prompt,
              signal: controller.signal,
              emit: (event) => events.push(event),
              ...(input.channel === "mcp_stdio"
                ? {
                    mcpGateway: {
                      command: process.execPath,
                      args: [
                        deps.mcpEntry,
                        deps.dataDir,
                        "--grant",
                        grant.grantId,
                        "--session",
                        grant.sessionId,
                        "--project",
                        scope.projectId,
                        "--binding",
                        scope.bindingId,
                        "--worktree",
                        scope.worktreeId,
                        "--destination",
                        grant.destinationId,
                        "--manifest",
                        grant.manifestDigest,
                        "--policy",
                        grant.policyVersion,
                      ],
                    },
                  }
                : {}),
            }),
        );

        if (input.channel === "mcp_stdio") {
          observedReads = deps.withCatalog((store) =>
            store.f2.listMcpLog(scope, grant.grantId, beforeSeq),
          );
          mcpAdherence = observedReads.some((r) => r.outcome === "allowed")
            ? "observed"
            : "not_used";
          deliveredRefs = [
            ...new Set(
              observedReads
                .filter((r) => r.outcome === "allowed" && r.opaqueRef !== null)
                .map((r) => r.opaqueRef!),
            ),
          ];
          deliveredBytes = deliveredRefs.reduce((sum, ref) => {
            const item = publicManifest.items.find(
              (entry) => entry.opaqueRef === ref,
            );
            return sum + (item?.bytes ?? 0);
          }, 0);
        }

        const messages = events
          .filter(
            (event): event is Extract<CodexRunEvent, { type: "message" }> =>
              event.type === "message",
          )
          .map((event) => event.text);
        responseText = messages.length > 0 ? messages.join("\n") : null;
        const lastUsage = [...events]
          .reverse()
          .find(
            (event): event is Extract<CodexRunEvent, { type: "usage" }> =>
              event.type === "usage",
          );
        if (lastUsage) {
          usage = {
            input: lastUsage.input,
            cachedInput: lastUsage.cachedInput,
            output: lastUsage.output,
          };
        }
        state =
          terminal.state === "completed"
            ? "completed"
            : terminal.state === "timeout"
              ? "timeout"
              : terminal.state === "cancelled"
                ? "cancelled"
                : "failed";
        failureCode = terminal.failure;
      }

      const finishedAt = now();
      const durationMs = Math.max(
        0,
        Math.round(performance.now() - startedPerf),
      );
      const citations = extractCitations(responseText, publicManifest);

      const record: AuditedQueryRecord = {
        auditId: randomUUID(),
        scope,
        grantId: grant.grantId,
        sessionId: grant.sessionId,
        manifestDigest: grant.manifestDigest,
        policyVersion: grant.policyVersion,
        destinationId: grant.destinationId,
        channel: input.channel,
        mode: effectiveMode,
        objective: publicManifest.objective,
        state,
        failureCode,
        delivered: {
          digest: deliveredDigest,
          bytes: deliveredBytes,
          opaqueRefs: deliveredRefs,
        },
        observability:
          input.channel === "mcp_stdio" ? "mcp_observed" : "package_static",
        observedReads,
        mcpAdherence,
        responseText,
        citations,
        durationMs,
        usage,
        startedAt,
        finishedAt,
        review: {
          status: "pending",
          reviewer: null,
          note: null,
          reviewedAt: null,
        },
      };

      return deps.withCatalog((store) => store.f2.insertAudit(record));
    },

    listAudits(
      scope: IdentityScope,
      manifestDigest?: string,
    ): AuditedQueryRecord[] {
      return deps.withCatalog((store) =>
        store.f2.listAudits(scope, manifestDigest ?? null),
      );
    },

    reviewAudit(input: AuditReviewInput): AuditedQueryRecord {
      if (!input.humanConfirmed) {
        throw new GitError("codex_authorization_required");
      }
      const scope: IdentityScope = {
        projectId: input.projectId,
        bindingId: input.bindingId,
        worktreeId: input.worktreeId,
      };
      return deps.withCatalog((store) =>
        store.f2.reviewAudit(scope, input.auditId, {
          status: input.status,
          reviewer: input.reviewer.trim(),
          note: input.note.trim(),
          reviewedAt: now(),
        }),
      );
    },
  };
}
