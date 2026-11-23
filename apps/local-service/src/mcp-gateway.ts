import {
  isOpaqueRef,
  mcpSearchPageSize,
  type ErrorCode,
  type IdentityScope,
  type McpMethodName,
  type McpToolResponse,
  type ObservedMcpToolName,
} from "@laplace/contracts";
import type { openCatalog } from "./catalog.ts";
import { sha256 } from "./context.ts";
import { GitError } from "./git.ts";
import type { createSessionGrantService } from "./session-grant-store.ts";

type CatalogStore = ReturnType<typeof openCatalog>;
type WithCatalog = <T>(operation: (store: CatalogStore) => T) => T;
type GrantService = ReturnType<typeof createSessionGrantService>;

export type McpGatewayContext = {
  scope: IdentityScope;
  grantId: string;
  sessionId: string;
  destinationId: string;
  manifestDigest: string;
  policyVersion: string;
};

export const mcpToolDefinitions = [
  {
    name: "laplace_context_summary",
    description:
      "Return the approved F2 public context manifest summary and opaque references (never disk paths or private metadata).",
    inputSchema: {
      type: "object",
      properties: {},
      additionalProperties: false,
    },
  },
  {
    name: "laplace_context_search",
    description:
      "Search strictly inside authorized items of the approved manifest, paginated by cursor.",
    inputSchema: {
      type: "object",
      properties: {
        query: { type: "string" },
        cursor: { type: "integer", minimum: 0 },
        limit: { type: "integer", minimum: 1, maximum: mcpSearchPageSize },
      },
      required: ["query"],
      additionalProperties: false,
    },
  },
  {
    name: "laplace_context_read",
    description:
      "Read a single authorized context item by its opaqueRef (never by filesystem path or SQL query).",
    inputSchema: {
      type: "object",
      properties: {
        opaqueRef: { type: "string", pattern: "^ref-[a-f0-9]{16}$" },
      },
      required: ["opaqueRef"],
      additionalProperties: false,
    },
  },
] as const;

const methodToTool: Record<McpMethodName, ObservedMcpToolName> = {
  summary: "laplace_context_summary",
  search: "laplace_context_search",
  read: "laplace_context_read",
};

const toolToMethod: Record<string, McpMethodName | undefined> = {
  laplace_context_summary: "summary",
  laplace_context_search: "search",
  laplace_context_read: "read",
};

function buildSnippet(text: string, queryTerms: string[]): string {
  const lower = text.toLowerCase();
  let matchIndex = -1;
  for (const term of queryTerms) {
    const idx = lower.indexOf(term);
    if (idx !== -1 && (matchIndex === -1 || idx < matchIndex)) {
      matchIndex = idx;
    }
  }
  const start = matchIndex > 60 ? matchIndex - 60 : 0;
  const end = Math.min(text.length, start + 240);
  const prefix = start > 0 ? "…" : "";
  const suffix = end < text.length ? "…" : "";
  return `${prefix}${text.slice(start, end)}${suffix}`;
}

export function createMcpGatewayService(deps: {
  withCatalog: WithCatalog;
  grants: GrantService;
  now?: () => string;
}) {
  const now = deps.now ?? (() => new Date().toISOString());

  function logAttempt(params: {
    context: McpGatewayContext;
    tool: ObservedMcpToolName;
    opaqueRef: string | null;
    query: string | null;
    cursor: number | null;
    outcome: "allowed" | "denied";
    errorCode: ErrorCode | null;
  }) {
    try {
      deps.withCatalog((store) => {
        store.f2.appendMcpLog({
          scope: params.context.scope,
          grantId: params.context.grantId,
          sessionId: params.context.sessionId,
          entry: {
            tool: params.tool,
            opaqueRef: params.opaqueRef,
            query: params.query,
            cursor: params.cursor,
            outcome: params.outcome,
            errorCode: params.errorCode,
            at: now(),
          },
        });
      });
    } catch {
      // Invalid or missing foreign-key scope cannot hold a log row; never leak or mask the primary denial.
    }
  }

  function callTool(
    context: McpGatewayContext,
    method: McpMethodName,
    args: {
      query?: string;
      cursor?: number;
      limit?: number;
      opaqueRef?: string;
    },
  ): McpToolResponse {
    const tool = methodToTool[method];
    const safeRef =
      args.opaqueRef !== undefined && isOpaqueRef(args.opaqueRef)
        ? args.opaqueRef
        : null;
    const safeQuery =
      typeof args.query === "string" && args.query.trim().length > 0
        ? args.query.trim().slice(0, 128)
        : null;
    const safeCursor =
      typeof args.cursor === "number" &&
      Number.isSafeInteger(args.cursor) &&
      args.cursor >= 0
        ? args.cursor
        : null;

    let validated;
    try {
      validated = deps.grants.validate({
        scope: context.scope,
        grantId: context.grantId,
        sessionId: context.sessionId,
        destinationId: context.destinationId,
        manifestDigest: context.manifestDigest,
        policyVersion: context.policyVersion,
        requiredOperation: method,
      });
    } catch (error) {
      const code = error instanceof GitError ? error.code : "grant_invalid";
      logAttempt({
        context,
        tool,
        opaqueRef: safeRef,
        query: safeQuery,
        cursor: safeCursor,
        outcome: "denied",
        errorCode: code,
      });
      throw error;
    }

    const { publicManifest, authorizedPayloads } = validated.manifestRecord;

    if (method === "summary") {
      logAttempt({
        context,
        tool,
        opaqueRef: null,
        query: null,
        cursor: null,
        outcome: "allowed",
        errorCode: null,
      });
      return {
        scope: context.scope,
        grantId: context.grantId,
        sessionId: context.sessionId,
        method,
        manifestDigest: publicManifest.manifestDigest,
        policyVersion: publicManifest.policyVersion,
        destinationId: publicManifest.destinationId,
        payload: {
          manifestDigest: publicManifest.manifestDigest,
          policyVersion: publicManifest.policyVersion,
          strategyVersion: publicManifest.strategyVersion,
          destinationId: publicManifest.destinationId,
          objective: publicManifest.objective,
          status: publicManifest.status,
          recommendationSuspended: publicManifest.recommendationSuspended,
          budget: publicManifest.budget,
          conflicts: publicManifest.conflicts,
          omissions: publicManifest.omissions,
          items: publicManifest.items,
        },
      };
    }

    if (method === "search") {
      if (!safeQuery) {
        logAttempt({
          context,
          tool,
          opaqueRef: null,
          query: null,
          cursor: safeCursor,
          outcome: "denied",
          errorCode: "invalid_request",
        });
        throw new GitError("invalid_request");
      }
      const cursor = safeCursor ?? 0;
      const limit = Math.max(
        1,
        Math.min(mcpSearchPageSize, args.limit ?? mcpSearchPageSize),
      );
      const terms = safeQuery
        .toLowerCase()
        .split(/\s+/)
        .filter((term) => term.length > 0);
      const matches: {
        opaqueRef: string;
        tier: string;
        version: string;
        contentDigest: string;
        snippet: string;
        bytes: number;
      }[] = [];

      for (const item of publicManifest.items) {
        const payload = authorizedPayloads[item.opaqueRef];
        if (!payload) continue;
        const haystack = `${payload.text}\n${item.rationale}`.toLowerCase();
        if (
          terms.length === 0 ||
          terms.some((term) => haystack.includes(term))
        ) {
          matches.push({
            opaqueRef: item.opaqueRef,
            tier: item.tier,
            version: item.version,
            contentDigest: item.contentDigest,
            snippet: buildSnippet(payload.text, terms),
            bytes: item.bytes,
          });
        }
      }

      const page = matches.slice(cursor, cursor + limit);
      const nextCursor =
        cursor + page.length < matches.length ? cursor + page.length : null;

      logAttempt({
        context,
        tool,
        opaqueRef: null,
        query: safeQuery,
        cursor,
        outcome: "allowed",
        errorCode: null,
      });

      return {
        scope: context.scope,
        grantId: context.grantId,
        sessionId: context.sessionId,
        method,
        manifestDigest: publicManifest.manifestDigest,
        policyVersion: publicManifest.policyVersion,
        destinationId: publicManifest.destinationId,
        payload: {
          total: matches.length,
          cursor,
          nextCursor,
          items: page,
        },
      };
    }

    // method === "read"
    if (!args.opaqueRef || !isOpaqueRef(args.opaqueRef)) {
      logAttempt({
        context,
        tool,
        opaqueRef: null,
        query: null,
        cursor: null,
        outcome: "denied",
        errorCode: "grant_invalid",
      });
      throw new GitError("grant_invalid");
    }

    const publicItem = publicManifest.items.find(
      (item) => item.opaqueRef === args.opaqueRef,
    );
    const authorized = authorizedPayloads[args.opaqueRef];
    if (
      !publicItem ||
      !authorized ||
      sha256(authorized.text) !== publicItem.contentDigest ||
      authorized.contentDigest !== publicItem.contentDigest
    ) {
      logAttempt({
        context,
        tool,
        opaqueRef: safeRef,
        query: null,
        cursor: null,
        outcome: "denied",
        errorCode: "context_source_unavailable",
      });
      throw new GitError("context_source_unavailable");
    }

    logAttempt({
      context,
      tool,
      opaqueRef: publicItem.opaqueRef,
      query: null,
      cursor: null,
      outcome: "allowed",
      errorCode: null,
    });

    return {
      scope: context.scope,
      grantId: context.grantId,
      sessionId: context.sessionId,
      method,
      manifestDigest: publicManifest.manifestDigest,
      policyVersion: publicManifest.policyVersion,
      destinationId: publicManifest.destinationId,
      payload: {
        opaqueRef: publicItem.opaqueRef,
        version: publicItem.version,
        tier: publicItem.tier,
        mandatory: publicItem.mandatory,
        contentDigest: publicItem.contentDigest,
        bytes: publicItem.bytes,
        anchor: publicItem.anchor,
        text: authorized.text,
      },
    };
  }

  function handleMcpMessage(
    message: unknown,
    context: McpGatewayContext,
  ): Record<string, unknown> | null {
    if (
      typeof message !== "object" ||
      message === null ||
      Array.isArray(message)
    ) {
      return {
        jsonrpc: "2.0",
        id: null,
        error: { code: -32600, message: "invalid_request" },
      };
    }
    const req = message as Record<string, unknown>;
    const id = req.id === undefined ? null : (req.id as string | number | null);
    const method = req.method;

    if (typeof method !== "string") {
      return {
        jsonrpc: "2.0",
        id,
        error: { code: -32600, message: "invalid_request" },
      };
    }

    if (method === "notifications/initialized") {
      return null;
    }

    if (method === "initialize") {
      return {
        jsonrpc: "2.0",
        id,
        result: {
          protocolVersion: "2024-11-05",
          capabilities: { tools: {} },
          serverInfo: { name: "laplace-mcp-gateway", version: "0.1.0" },
        },
      };
    }

    if (method === "ping") {
      return { jsonrpc: "2.0", id, result: {} };
    }

    if (method === "tools/list") {
      try {
        // Revalidate active grant even before listing tools.
        const { grant } = deps.grants.validate({
          scope: context.scope,
          grantId: context.grantId,
          sessionId: context.sessionId,
          destinationId: context.destinationId,
          manifestDigest: context.manifestDigest,
          policyVersion: context.policyVersion,
        });
        const tools = mcpToolDefinitions.filter((tool) => {
          const op = toolToMethod[tool.name];
          return op !== undefined && grant.allowedOperations.includes(op);
        });
        if (tools.length === 0) {
          throw new GitError("grant_invalid");
        }
        return { jsonrpc: "2.0", id, result: { tools } };
      } catch (error) {
        const code = error instanceof GitError ? error.code : "grant_invalid";
        return {
          jsonrpc: "2.0",
          id,
          error: { code: -32001, message: code },
        };
      }
    }

    if (method === "tools/call") {
      const params =
        typeof req.params === "object" &&
        req.params !== null &&
        !Array.isArray(req.params)
          ? (req.params as Record<string, unknown>)
          : {};
      const name = typeof params.name === "string" ? params.name : "";
      const mapped = toolToMethod[name];
      if (!mapped) {
        return {
          jsonrpc: "2.0",
          id,
          error: { code: -32601, message: "invalid_request" },
        };
      }
      const rawArgs =
        typeof params.arguments === "object" &&
        params.arguments !== null &&
        !Array.isArray(params.arguments)
          ? (params.arguments as Record<string, unknown>)
          : {};
      try {
        const result = callTool(context, mapped, {
          query: typeof rawArgs.query === "string" ? rawArgs.query : undefined,
          cursor:
            typeof rawArgs.cursor === "number" ? rawArgs.cursor : undefined,
          limit: typeof rawArgs.limit === "number" ? rawArgs.limit : undefined,
          opaqueRef:
            typeof rawArgs.opaqueRef === "string"
              ? rawArgs.opaqueRef
              : undefined,
        });
        return {
          jsonrpc: "2.0",
          id,
          result: {
            content: [{ type: "text", text: JSON.stringify(result.payload) }],
            isError: false,
          },
        };
      } catch (error) {
        const code = error instanceof GitError ? error.code : "grant_invalid";
        return {
          jsonrpc: "2.0",
          id,
          error: { code: -32001, message: code },
        };
      }
    }

    return {
      jsonrpc: "2.0",
      id,
      error: { code: -32601, message: "method_not_found" },
    };
  }

  return {
    callTool,
    handleMcpMessage,
  };
}
