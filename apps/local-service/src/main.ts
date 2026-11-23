import { createInterface } from "node:readline";
import { once } from "node:events";
import { existsSync } from "node:fs";
import { dirname, isAbsolute, join } from "node:path";
import { codexMockScenarios } from "@laplace/agents/mock";
import {
  isRecord,
  isContextPath,
  isRequestId,
  maxIpcBytes,
  parseRequest,
  protocolVersion,
  type Response,
} from "@laplace/contracts";
import { GitError, inspectRepository } from "./git.ts";
import { openCatalog } from "./catalog.ts";
import { browseContext, captureContext } from "./context.ts";
import { GitHubClones, runGitHubClone } from "./github-clone.ts";
import { CodexQueries, prepareCodex, type CodexDevelopment } from "./codex.ts";
import { TaskSupervisor } from "./task-supervisor.ts";
import { captureWorkingTree, listWorkingTree } from "./working-tree.ts";
import { createResumeService } from "./resume-service.ts";
import { createContextCompilerService } from "./context-compiler-service.ts";
import { createSessionGrantService } from "./session-grant-store.ts";
import { createMcpGatewayService } from "./mcp-gateway.ts";
import { createContextPackageService } from "./context-package.ts";
import { createAuditQueryService } from "./audit-query-service.ts";

// Defined when the sidecar is bundled. The source entry point and the
// distribution bundle ignore all development arguments.
declare const __LAPLACE_DEVELOPMENT__: boolean;

function developmentFromHost([mode, value]: string[]):
  CodexDevelopment | undefined {
  if (mode === "--codex-mock") {
    const scenario = codexMockScenarios.find((scenario) => scenario === value);
    if (scenario) return { mode: "mock_development", scenario };
  }
  if (mode === "--codex-workspace" && value && isAbsolute(value))
    return { mode: "unconfined_workspace_development", helper: value };
}

const input = createInterface({ input: process.stdin, crlfDelay: Infinity });
const exit = new AbortController();
const development =
  typeof __LAPLACE_DEVELOPMENT__ !== "undefined" && __LAPLACE_DEVELOPMENT__
    ? developmentFromHost(
        process.argv.slice(isAbsolute(process.argv[3] ?? "") ? 4 : 3),
      )
    : undefined;
const codex = new CodexQueries({ development });
const cloneHelper = process.argv[3];
const clones = new GitHubClones(
  cloneHelper && isAbsolute(cloneHelper)
    ? runGitHubClone(cloneHelper)
    : undefined,
);
const supervisor = new TaskSupervisor(
  development?.mode === "mock_development" ? development.scenario : undefined,
);
input.once("close", () => {
  exit.abort();
  void codex.close();
  void supervisor.close();
  void clones.close();
});
const dataDir = process.argv[2] ?? "";
const contextExclusions = (process.env.LAPLACE_CONTEXT_EXCLUDES ?? "")
  .split(";")
  .filter(isContextPath);
let catalog: ReturnType<typeof openCatalog> | undefined;
let selectionGeneration = 0;

class CatalogError extends Error {}

function withCatalog<T>(
  operation: (store: ReturnType<typeof openCatalog>) => T,
): T {
  try {
    catalog ??= openCatalog(dataDir);
    return operation(catalog);
  } catch (error) {
    if (error instanceof GitError) throw error;
    throw new CatalogError();
  }
}

function contextOptions(projectId: string) {
  const protectedRoots = withCatalog((store) => store.list().projects)
    .filter((entry) => entry.id !== projectId)
    .map((entry) => entry.root);
  protectedRoots.push(dataDir);
  return { signal: exit.signal, protectedRoots, exclusions: contextExclusions };
}

const resumeService = createResumeService({
  withCatalog,
  contextOptions,
  getSelectionGeneration: () => selectionGeneration,
});

const entryDir = dirname(process.argv[1] ?? process.cwd());
const bundledMcpGateway = join(entryDir, "mcp-gateway.cjs");
const mcpEntry = existsSync(bundledMcpGateway)
  ? bundledMcpGateway
  : join(entryDir, "mcp-stdio.ts");

const compilerService = createContextCompilerService({ withCatalog });
const grantService = createSessionGrantService({ withCatalog });
const mcpGatewayService = createMcpGatewayService({
  withCatalog,
  grants: grantService,
});
const packageService = createContextPackageService({
  withCatalog,
  grants: grantService,
});
const auditQueryService = createAuditQueryService({
  withCatalog,
  grants: grantService,
  packages: packageService,
  dataDir,
  mcpEntry,
  currentMode: codex.mode,
  workspaceHelper:
    development?.mode === "unconfined_workspace_development"
      ? development.helper
      : undefined,
});

async function respond(line: string): Promise<Response> {
  let value: unknown;
  if (Buffer.byteLength(line) <= maxIpcBytes) {
    try {
      value = JSON.parse(line);
    } catch {
      // The invalid request response below also covers syntax errors.
    }
  }
  const id = isRecord(value) && isRequestId(value.id) ? value.id : "invalid";
  const envelope = { id, version: protocolVersion } as const;
  const request = parseRequest(value);
  if (!request)
    return { ...envelope, ok: false, error: { code: "invalid_request" } };

  try {
    if (request.operation === "health") {
      withCatalog(() => undefined);
      return {
        ...envelope,
        operation: "health",
        ok: true,
        data: { version: "0.1.0", nodeVersion: process.versions.node },
      };
    }
    if (request.operation === "workspace.list") {
      const data = withCatalog((store) => store.list());
      return { ...envelope, operation: request.operation, ok: true, data };
    }
    if (request.operation === "workspace.addLocal") {
      selectionGeneration++;
      const inspection = await inspectRepository(request.path, {
        signal: exit.signal,
      });
      const data = withCatalog((store) => store.add(inspection));
      return { ...envelope, operation: request.operation, ok: true, data };
    }
    if (request.operation === "project.select") {
      selectionGeneration++;
      const data = withCatalog((store) => store.select(request.projectId));
      return { ...envelope, operation: request.operation, ok: true, data };
    }
    if (request.operation === "clone.prepare") {
      if (exit.signal.aborted) throw new GitError("clone_unavailable");
      const data = await clones.prepare(request.url, request.parent);
      return { ...envelope, operation: request.operation, ok: true, data };
    }
    if (request.operation === "clone.start") {
      if (exit.signal.aborted) throw new GitError("clone_unavailable");
      withCatalog(() => undefined);
      const data = clones.start(request.grantId, (inspection) => {
        selectionGeneration++;
        return withCatalog((store) => store.add(inspection));
      });
      return { ...envelope, operation: request.operation, ok: true, data };
    }
    if (
      request.operation === "clone.status" ||
      request.operation === "clone.cancel"
    ) {
      const data =
        request.operation === "clone.status"
          ? clones.status(request.cloneId)
          : clones.cancel(request.cloneId);
      return { ...envelope, operation: request.operation, ok: true, data };
    }
    if (request.operation === "decision.evidenceResolve") {
      const scope = {
        projectId: request.projectId,
        bindingId: request.bindingId,
        worktreeId: request.worktreeId,
      };
      const data = withCatalog((store) =>
        store.evidence.resolve(scope, {
          contextId: request.contextId,
          path: request.path,
          sha256: request.sha256,
          chunk: request.chunk,
        }),
      );
      return { ...envelope, operation: request.operation, ok: true, data };
    }
    if (request.operation === "decision.record") {
      const data = withCatalog((store) => store.decisions.record(request));
      return { ...envelope, operation: request.operation, ok: true, data };
    }
    if (request.operation === "decision.list") {
      const scope = {
        projectId: request.projectId,
        bindingId: request.bindingId,
        worktreeId: request.worktreeId,
      };
      const data = withCatalog((store) => store.decisions.list(scope));
      return { ...envelope, operation: request.operation, ok: true, data };
    }
    if (request.operation === "decision.get") {
      const scope = {
        projectId: request.projectId,
        bindingId: request.bindingId,
        worktreeId: request.worktreeId,
      };
      const data = withCatalog((store) =>
        store.decisions.get(scope, request.assertionId),
      );
      return { ...envelope, operation: request.operation, ok: true, data };
    }
    if (request.operation === "decision.purge") {
      const data = withCatalog((store) => store.decisions.purge(request));
      return { ...envelope, operation: request.operation, ok: true, data };
    }
    if (request.operation === "decision.comparePresent") {
      const scope = {
        projectId: request.projectId,
        bindingId: request.bindingId,
        worktreeId: request.worktreeId,
      };
      const data = await resumeService.comparePresent(scope, {
        contextId: request.contextId,
        path: request.path,
        sha256: request.sha256,
        chunk: request.chunk,
      });
      return { ...envelope, operation: request.operation, ok: true, data };
    }
    if (request.operation === "project.resume") {
      const scope = {
        projectId: request.projectId,
        bindingId: request.bindingId,
        worktreeId: request.worktreeId,
      };
      const data = await resumeService.resume(
        scope,
        request.correlationId,
        exit.signal,
      );
      return { ...envelope, operation: request.operation, ok: true, data };
    }
    if (request.operation === "compiler.compile") {
      const data = compilerService.compile(request);
      return { ...envelope, operation: request.operation, ok: true, data };
    }
    if (request.operation === "compiler.grantIssue") {
      const data = grantService.issue(request);
      return { ...envelope, operation: request.operation, ok: true, data };
    }
    if (request.operation === "compiler.grantList") {
      const data = {
        scope: {
          projectId: request.projectId,
          bindingId: request.bindingId,
          worktreeId: request.worktreeId,
        },
        items: grantService.list(
          {
            projectId: request.projectId,
            bindingId: request.bindingId,
            worktreeId: request.worktreeId,
          },
          request.manifestDigest,
        ),
      };
      return { ...envelope, operation: request.operation, ok: true, data };
    }
    if (request.operation === "compiler.grantRevoke") {
      const data = grantService.revoke(request);
      return { ...envelope, operation: request.operation, ok: true, data };
    }
    if (request.operation === "compiler.packageExport") {
      const data = packageService.exportPackage(request);
      return { ...envelope, operation: request.operation, ok: true, data };
    }
    if (request.operation === "compiler.handoffImport") {
      const data = packageService.importHandoff(request);
      return { ...envelope, operation: request.operation, ok: true, data };
    }
    if (request.operation === "compiler.mcpCall") {
      const data = mcpGatewayService.callTool(
        {
          scope: {
            projectId: request.projectId,
            bindingId: request.bindingId,
            worktreeId: request.worktreeId,
          },
          grantId: request.grantId,
          sessionId: request.sessionId,
          destinationId: request.destinationId,
          manifestDigest: request.manifestDigest,
          policyVersion: request.policyVersion,
        },
        request.method,
        {
          query: request.query,
          cursor: request.cursor,
          limit: request.limit,
          opaqueRef: request.opaqueRef,
        },
      );
      return { ...envelope, operation: request.operation, ok: true, data };
    }
    if (request.operation === "compiler.queryRun") {
      if (exit.signal.aborted) {
        throw new GitError("codex_execution_unavailable");
      }
      const data = await auditQueryService.runQuery(request);
      return { ...envelope, operation: request.operation, ok: true, data };
    }
    if (request.operation === "compiler.auditList") {
      const scope = {
        projectId: request.projectId,
        bindingId: request.bindingId,
        worktreeId: request.worktreeId,
      };
      const data = {
        scope,
        items: auditQueryService.listAudits(scope, request.manifestDigest),
      };
      return { ...envelope, operation: request.operation, ok: true, data };
    }
    if (request.operation === "compiler.auditReview") {
      const data = auditQueryService.reviewAudit(request);
      return { ...envelope, operation: request.operation, ok: true, data };
    }
    const project = withCatalog((store) => store.lookup(request.projectId));
    switch (request.operation) {
      case "working.list": {
        const data = await listWorkingTree(project, contextOptions(project.id));
        return { ...envelope, operation: request.operation, ok: true, data };
      }
      case "working.latest": {
        const data = withCatalog(({ working }) => working.latest(project.id));
        return { ...envelope, operation: request.operation, ok: true, data };
      }
      case "working.capture": {
        const capture = await captureWorkingTree(
          project,
          request.paths,
          contextOptions(project.id),
        );
        const data = withCatalog(({ working }) => working.save(capture));
        return { ...envelope, operation: request.operation, ok: true, data };
      }
      case "working.compare": {
        const data = withCatalog(({ working }) =>
          working.compare(request, request.path, request.layer),
        );
        return { ...envelope, operation: request.operation, ok: true, data };
      }
      case "task.list": {
        const data = withCatalog(({ tasks }) =>
          tasks.list(project.id, request.before),
        );
        return { ...envelope, operation: request.operation, ok: true, data };
      }
      case "task.create": {
        const data = withCatalog(({ tasks }) => tasks.create(request));
        return { ...envelope, operation: request.operation, ok: true, data };
      }
      case "task.update": {
        const data = withCatalog(({ tasks }) => tasks.update(request));
        return { ...envelope, operation: request.operation, ok: true, data };
      }
      case "execution.latest": {
        const data = withCatalog(({ executions }) =>
          supervisor.latest(request, executions),
        );
        return { ...envelope, operation: request.operation, ok: true, data };
      }
      case "task.start": {
        if (exit.signal.aborted) throw new GitError("task_runner_unavailable");
        const data = withCatalog((store) =>
          supervisor.start(request, store.executions, [
            dataDir,
            ...store.list().projects.map(({ root }) => root),
          ]),
        );
        return { ...envelope, operation: request.operation, ok: true, data };
      }
      case "execution.events": {
        const data = withCatalog(({ executions }) =>
          executions.events(request, request.afterSeq),
        );
        return { ...envelope, operation: request.operation, ok: true, data };
      }
      case "execution.cancel": {
        const data = withCatalog(({ executions }) =>
          supervisor.cancel(request, executions),
        );
        return { ...envelope, operation: request.operation, ok: true, data };
      }
      case "execution.result": {
        const data = withCatalog(({ executions }) =>
          executions.result(request),
        );
        return { ...envelope, operation: request.operation, ok: true, data };
      }
      case "execution.change": {
        const data = withCatalog(({ executions }) =>
          executions.change(request, request.path),
        );
        return { ...envelope, operation: request.operation, ok: true, data };
      }
      case "result.reviewStatus": {
        const data = withCatalog(({ executions }) =>
          executions.reviewStatus(request),
        );
        return { ...envelope, operation: request.operation, ok: true, data };
      }
      case "result.review": {
        const data = withCatalog(({ executions }) =>
          executions.review(request),
        );
        return { ...envelope, operation: request.operation, ok: true, data };
      }
      case "codex.status": {
        const data = await codex.status(project.id);
        return { ...envelope, operation: request.operation, ok: true, data };
      }
      case "codex.prepare": {
        const material = withCatalog((store) =>
          prepareCodex(store, request, dataDir, codex.mode),
        );
        return {
          ...envelope,
          operation: request.operation,
          ok: true,
          data: codex.prepare(material),
        };
      }
      case "codex.approval": {
        const data = codex.approval(request);
        return { ...envelope, operation: request.operation, ok: true, data };
      }
      case "codex.start": {
        if (exit.signal.aborted)
          throw new GitError("codex_execution_unavailable");
        const history = withCatalog((store) => store.codexHistory);
        const data = await codex.start(request, history);
        return { ...envelope, operation: request.operation, ok: true, data };
      }
      case "codex.events": {
        const data = withCatalog(({ codexHistory }) =>
          codex.events(request, codexHistory),
        );
        return { ...envelope, operation: request.operation, ok: true, data };
      }
      case "codex.cancel": {
        const data = codex.cancel(request);
        return { ...envelope, operation: request.operation, ok: true, data };
      }
      case "codex.history": {
        const data = withCatalog(({ codexHistory, context }) => {
          context.get(project.id, request.contextId);
          return codexHistory.list(request, request.before);
        });
        return { ...envelope, operation: request.operation, ok: true, data };
      }
      case "codex.citation": {
        const data = withCatalog(({ codexHistory }) =>
          codex.citation(request, codexHistory),
        );
        return { ...envelope, operation: request.operation, ok: true, data };
      }
      case "context.indexStatus": {
        const data = withCatalog((store) =>
          store.contextSearch.status(project.id, request.contextId),
        );
        return { ...envelope, operation: request.operation, ok: true, data };
      }
      case "context.index": {
        const data = withCatalog((store) =>
          store.contextSearch.index(
            project.id,
            request.contextId,
            request.force,
          ),
        );
        return { ...envelope, operation: request.operation, ok: true, data };
      }
      case "context.search": {
        const data = withCatalog((store) =>
          store.contextSearch.search(project.id, request),
        );
        return { ...envelope, operation: request.operation, ok: true, data };
      }
      case "context.sourcePreview": {
        const { contextId, path, sha256, chunk } = request;
        const data = withCatalog(
          (store) =>
            store.contextSearch.readExcerpt(project.id, {
              contextId,
              path,
              sha256,
              chunk,
            }).preview,
        );
        return { ...envelope, operation: request.operation, ok: true, data };
      }
      case "context.list": {
        const data = withCatalog((store) =>
          store.context.list(project.id, request.before),
        );
        return { ...envelope, operation: request.operation, ok: true, data };
      }
      case "context.get": {
        const data = withCatalog((store) =>
          store.context.get(project.id, request.contextId),
        );
        return { ...envelope, operation: request.operation, ok: true, data };
      }
      case "context.browse":
      case "context.capture":
      case "context.validate": {
        const options = contextOptions(project.id);
        if (request.operation === "context.browse") {
          const data = await browseContext(
            project,
            request.folder,
            request.prefix,
            options,
          );
          return { ...envelope, operation: request.operation, ok: true, data };
        }
        if (request.operation === "context.capture") {
          const capture = await captureContext(project, request.paths, options);
          const data = withCatalog((store) => store.context.save(capture));
          return { ...envelope, operation: request.operation, ok: true, data };
        }
        const saved = withCatalog((store) =>
          store.context.get(project.id, request.contextId),
        );
        const current =
          saved.status === "invalidated"
            ? saved
            : (
                await captureContext(
                  project,
                  saved.entries.map((entry) => entry.path),
                  options,
                )
              ).snapshot;
        const state =
          current.status === "invalidated"
            ? "inconclusive"
            : current.digest === saved.digest
              ? "matches"
              : "differs";
        return {
          ...envelope,
          operation: request.operation,
          ok: true,
          data: {
            projectId: project.id,
            contextId: saved.contextId,
            state,
            checkedAt: new Date().toISOString(),
          },
        };
      }
    }
    if (request.operation === "project.relocate") {
      selectionGeneration++;
      if (!project.identity) throw new GitError("project_identity_unknown");
      const inspection = await inspectRepository(request.path, {
        signal: exit.signal,
      });
      const data = withCatalog((store) => store.record(project, inspection));
      return { ...envelope, operation: request.operation, ok: true, data };
    }
    if (request.operation === "project.identity") {
      const targetPath = request.path ?? project.root;
      const probe = await inspectRepository(targetPath, {
        signal: exit.signal,
        ...(request.path === undefined ? { expectedRoot: project.root } : {}),
      })
        .then((inspection) => ({ available: true as const, inspection }))
        .catch((error: unknown) => {
          if (error instanceof GitError) {
            return { available: false as const };
          }
          throw error;
        });
      const data = withCatalog((store) =>
        store.identity.resolve(project.id, probe, request.path !== undefined),
      );
      return { ...envelope, operation: request.operation, ok: true, data };
    }
    const inspection = await inspectRepository(project.root, {
      signal: exit.signal,
      expectedRoot: project.root,
      expectedIdentity: project.identity ?? undefined,
    }).catch((error: unknown) => {
      if (
        error instanceof GitError &&
        (error.code === "invalid_folder" || error.code === "not_repository")
      ) {
        throw new GitError("project_unavailable");
      }
      throw error;
    });
    const data = withCatalog((store) => store.record(project, inspection));
    return { ...envelope, operation: "project.inspect", ok: true, data };
  } catch (error) {
    const code =
      error instanceof GitError
        ? error.code
        : error instanceof CatalogError
          ? "catalog_unavailable"
          : "git_failed";
    return { ...envelope, ok: false, error: { code } };
  }
}

async function serve() {
  for await (const line of input) {
    const started = performance.now();
    const response = await respond(line);
    const outcome = response.ok ? response.operation : response.error.code;
    console.error(
      `[laplace:service] ${response.id} ${outcome} ${Math.round(performance.now() - started)}ms`,
    );
    let packet = `${JSON.stringify(response)}\n`;
    if (Buffer.byteLength(packet) > maxIpcBytes) {
      packet = `${JSON.stringify({ id: response.id, version: protocolVersion, ok: false, error: { code: "context_limit" } })}\n`;
    }
    if (!process.stdout.write(packet)) await once(process.stdout, "drain");
  }
}

void serve()
  .finally(async () => {
    await Promise.all([codex.close(), supervisor.close(), clones.close()]);
    catalog?.close();
  })
  .catch(() => {
    process.exitCode = 1;
    input.close();
    process.stdin.destroy();
  });
