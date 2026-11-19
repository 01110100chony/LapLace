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

const input = createInterface({ input: process.stdin, crlfDelay: Infinity });
const exit = new AbortController();
input.once("close", () => exit.abort());

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
      return {
        ...envelope,
        operation: "health",
        ok: true,
        data: { version: "0.1.0", nodeVersion: process.versions.node },
      };
    }
    const data = await inspectRepository(request.path, { signal: exit.signal });
    return { ...envelope, operation: request.operation, ok: true, data };
  } catch (error) {
    const code = error instanceof GitError ? error.code : "git_failed";
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

void serve().catch(() => {
  process.exitCode = 1;
  input.close();
  process.stdin.destroy();
});
