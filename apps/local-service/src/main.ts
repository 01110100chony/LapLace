import { createInterface } from "node:readline";
import { once } from "node:events";
import { isAbsolute } from "node:path";
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
import { CodexQueries, prepareCodex, type CodexDevelopment } from "./codex.ts";

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
const codex = new CodexQueries({
  development:
    typeof __LAPLACE_DEVELOPMENT__ !== "undefined" && __LAPLACE_DEVELOPMENT__
      ? developmentFromHost(process.argv.slice(3))
      : undefined,
});
input.once("close", () => {
  exit.abort();
  codex.close();
});
const dataDir = process.argv[2] ?? "";
const contextExclusions = (process.env.LAPLACE_CONTEXT_EXCLUDES ?? "")
  .split(";")
  .filter(isContextPath);
let catalog: ReturnType<typeof openCatalog> | undefined;

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
      const inspection = await inspectRepository(request.path, {
        signal: exit.signal,
      });
      const data = withCatalog((store) => store.add(inspection));
      return { ...envelope, operation: request.operation, ok: true, data };
    }
    if (request.operation === "project.select") {
      const data = withCatalog((store) => store.select(request.projectId));
      return { ...envelope, operation: request.operation, ok: true, data };
    }
    const project = withCatalog((store) => store.lookup(request.projectId));
    switch (request.operation) {
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
        const data = await codex.start(request);
        return { ...envelope, operation: request.operation, ok: true, data };
      }
      case "codex.events": {
        const data = codex.events(request);
        return { ...envelope, operation: request.operation, ok: true, data };
      }
      case "codex.cancel": {
        const data = codex.cancel(request);
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
        const protectedRoots = withCatalog((store) => store.list().projects)
          .filter((entry) => entry.id !== project.id)
          .map((entry) => entry.root);
        protectedRoots.push(dataDir);
        const options = {
          signal: exit.signal,
          protectedRoots,
          exclusions: contextExclusions,
        };
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
      if (!project.identity) throw new GitError("project_identity_unknown");
      const inspection = await inspectRepository(request.path, {
        signal: exit.signal,
      });
      const data = withCatalog((store) => store.record(project, inspection));
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
  .finally(() => catalog?.close())
  .catch(() => {
    process.exitCode = 1;
    input.close();
    process.stdin.destroy();
  });
