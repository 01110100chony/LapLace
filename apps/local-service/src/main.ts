import { createInterface } from "node:readline";
import { once } from "node:events";
import {
  isRecord,
  isRequestId,
  maxIpcBytes,
  parseRequest,
  protocolVersion,
  type Response,
} from "@laplace/contracts";
import { GitError, inspectRepository } from "./git.ts";
import { openCatalog } from "./catalog.ts";

const input = createInterface({ input: process.stdin, crlfDelay: Infinity });
const exit = new AbortController();
input.once("close", () => exit.abort());
const dataDir = process.argv[2] ?? "";
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
    if (!process.stdout.write(`${JSON.stringify(response)}\n`))
      await once(process.stdout, "drain");
  }
}

void serve()
  .finally(() => catalog?.close())
  .catch(() => {
    process.exitCode = 1;
    input.close();
    process.stdin.destroy();
  });
