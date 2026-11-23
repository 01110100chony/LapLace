import { once } from "node:events";
import { isAbsolute } from "node:path";
import { createInterface } from "node:readline";
import { openCatalog } from "./catalog.ts";
import {
  createMcpGatewayService,
  type McpGatewayContext,
} from "./mcp-gateway.ts";
import { createSessionGrantService } from "./session-grant-store.ts";

function readArg(flag: string, args: string[]): string | undefined {
  const index = args.indexOf(flag);
  if (index === -1) return undefined;
  return args[index + 1];
}

function parseCli(argv: string[]): {
  dataDir: string;
  context: McpGatewayContext;
} | null {
  const dataDir = argv[2];
  if (!dataDir || !isAbsolute(dataDir)) return null;
  const rest = argv.slice(3);
  const grantId = readArg("--grant", rest);
  const sessionId = readArg("--session", rest);
  const projectId = readArg("--project", rest);
  const bindingId = readArg("--binding", rest);
  const worktreeId = readArg("--worktree", rest);
  const destinationId = readArg("--destination", rest);
  const manifestDigest = readArg("--manifest", rest);
  const policyVersion = readArg("--policy", rest);

  if (
    !grantId ||
    !sessionId ||
    !projectId ||
    !bindingId ||
    !worktreeId ||
    !destinationId ||
    !manifestDigest ||
    !policyVersion
  ) {
    return null;
  }

  return {
    dataDir,
    context: {
      grantId,
      sessionId,
      scope: { projectId, bindingId, worktreeId },
      destinationId,
      manifestDigest,
      policyVersion,
    },
  };
}

async function run() {
  const parsed = parseCli(process.argv);
  if (!parsed) {
    console.error("[laplace:mcp] invalid_arguments");
    process.exitCode = 1;
    return;
  }

  const catalog = openCatalog(parsed.dataDir);
  const withCatalog = <T>(op: (store: typeof catalog) => T): T => op(catalog);
  const grants = createSessionGrantService({ withCatalog });
  const gateway = createMcpGatewayService({ withCatalog, grants });

  const lines = createInterface({ input: process.stdin, crlfDelay: Infinity });
  try {
    for await (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      let message: unknown;
      try {
        message = JSON.parse(trimmed);
      } catch {
        const parseError = JSON.stringify({
          jsonrpc: "2.0",
          id: null,
          error: { code: -32700, message: "parse_error" },
        });
        if (!process.stdout.write(`${parseError}\n`)) {
          await once(process.stdout, "drain");
        }
        continue;
      }

      const reply = gateway.handleMcpMessage(message, parsed.context);
      if (reply !== null) {
        const packet = `${JSON.stringify(reply)}\n`;
        if (!process.stdout.write(packet)) {
          await once(process.stdout, "drain");
        }
      }
    }
  } finally {
    lines.close();
    catalog.close();
  }
}

void run().catch((error: unknown) => {
  console.error(
    `[laplace:mcp] fatal ${error instanceof Error ? error.message : "unknown"}`,
  );
  process.exitCode = 1;
});
