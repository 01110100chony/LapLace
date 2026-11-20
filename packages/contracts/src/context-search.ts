import { isProjectId, isRecord } from "./index.ts";
import {
  isContextPath,
  isContextSummary,
  isContextDate,
  type ContextSummary,
} from "./context.ts";

export const maxContextQueryBytes = 256;
export const maxContextQueryTerms = 12;
export const maxContextSnippetBytes = 1024;
export const contextSearchPageSize = 20;
export const maxContextSearchOffset = 180;

export type ContextSearchScope =
  | { scope: "snapshot"; contextId: string }
  | { scope: "latest" | "history"; contextId: null };

export type ContextSearchInput = ContextSearchScope & {
  query: string;
  offset: number;
};

export type ContextSourceRef = {
  contextId: string;
  path: string;
  sha256: string;
  chunk: number;
};

type Excerpt = ContextSourceRef & {
  firstLine: number;
  lastLine: number;
  splitLine: boolean;
  text: string;
};

export type ContextSourcePreview = Excerpt & { projectId: string };
export type ContextSearchHit = Excerpt & {
  snapshot: ContextSummary;
  origin: "latest" | "historical";
};
export type ContextIndexStatus = {
  projectId: string;
  contextId: string;
  eligible: boolean;
  indexedAt: string | null;
  files: number;
  chunks: number;
};
export type ContextSearchPage = ContextSearchScope & {
  projectId: string;
  snapshot: ContextSummary | null;
  eligible: number;
  indexed: number;
  items: ContextSearchHit[];
  nextOffset: number | null;
};

export type ContextSearchRequests = { projectId: string } & (
  | { operation: "context.indexStatus"; contextId: string | null }
  | { operation: "context.index"; contextId: string; force: boolean }
  | ({ operation: "context.search" } & ContextSearchInput)
  | ({ operation: "context.sourcePreview" } & ContextSourceRef)
);
export type ContextSearchResults = {
  "context.indexStatus": ContextIndexStatus;
  "context.index": ContextIndexStatus;
  "context.search": ContextSearchPage;
  "context.sourcePreview": ContextSourcePreview;
};

const utf8 = new TextEncoder();
const count = (value: unknown): value is number =>
  typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
const isOffset = (value: unknown): value is number =>
  count(value) &&
  value <= maxContextSearchOffset &&
  value % contextSearchPageSize === 0;

export function isContextSearchQuery(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.trim().length > 0 &&
    value.length <= maxContextQueryBytes &&
    utf8.encode(value).length <= maxContextQueryBytes &&
    !/[\p{Cc}\p{Cs}]/u.test(value)
  );
}

function readScope({
  scope,
  contextId,
}: Record<string, unknown>): ContextSearchScope | undefined {
  if (scope === "snapshot" && isProjectId(contextId))
    return { scope, contextId };
  if ((scope === "latest" || scope === "history") && contextId === null)
    return { scope, contextId };
}

function readRef({
  contextId,
  path,
  sha256,
  chunk,
}: Record<string, unknown>): ContextSourceRef | undefined {
  if (
    isProjectId(contextId) &&
    isContextPath(path) &&
    isProjectId(sha256) &&
    count(chunk)
  )
    return { contextId, path, sha256, chunk };
}

export function parseContextSearchRequest(
  value: Record<string, unknown>,
  projectId: string,
): ContextSearchRequests | undefined {
  const { operation, contextId, force, query, offset } = value;
  switch (operation) {
    case "context.indexStatus":
      if (contextId === null || isProjectId(contextId))
        return { operation, projectId, contextId };
      break;
    case "context.index":
      if (isProjectId(contextId) && typeof force === "boolean")
        return { operation, projectId, contextId, force };
      break;
    case "context.search": {
      const scope = readScope(value);
      if (scope && isContextSearchQuery(query) && isOffset(offset))
        return { operation, projectId, ...scope, query, offset };
      break;
    }
    case "context.sourcePreview": {
      const ref = readRef(value);
      if (ref) return { operation, projectId, ...ref };
    }
  }
}

function isExcerpt(value: Record<string, unknown>): boolean {
  const { firstLine, lastLine, splitLine, text } = value;
  return (
    !!readRef(value) &&
    count(firstLine) &&
    firstLine > 0 &&
    count(lastLine) &&
    lastLine >= firstLine &&
    typeof splitLine === "boolean" &&
    typeof text === "string" &&
    text.length <= maxContextSnippetBytes &&
    utf8.encode(text).length <= maxContextSnippetBytes
  );
}

export function isContextSearchResult(
  operation: keyof ContextSearchResults,
  value: Record<string, unknown>,
): boolean {
  switch (operation) {
    case "context.index":
    case "context.indexStatus": {
      const { contextId, eligible, indexedAt, files, chunks } = value;
      return (
        isProjectId(contextId) &&
        typeof eligible === "boolean" &&
        count(files) &&
        count(chunks) &&
        (indexedAt === null
          ? operation === "context.indexStatus" && files === 0 && chunks === 0
          : isContextDate(indexedAt) &&
            eligible &&
            files > 0 &&
            chunks >= files)
      );
    }
    case "context.sourcePreview":
      return isExcerpt(value);
    case "context.search": {
      const scope = readScope(value);
      const { projectId, snapshot, eligible, indexed, items, nextOffset } =
        value;
      if (
        !scope ||
        !count(eligible) ||
        !count(indexed) ||
        indexed > eligible ||
        !Array.isArray(items) ||
        items.length > contextSearchPageSize ||
        !(
          nextOffset === null ||
          (isOffset(nextOffset) &&
            nextOffset > 0 &&
            items.length === contextSearchPageSize)
        )
      )
        return false;
      if (scope.scope === "history") {
        if (snapshot !== null) return false;
      } else if (
        !isContextSummary(snapshot) ||
        snapshot.projectId !== projectId ||
        eligible !== 1 ||
        indexed !== 1 ||
        (scope.scope === "snapshot" && snapshot.contextId !== scope.contextId)
      ) {
        return false;
      }
      return items.every(
        (item: unknown) =>
          isRecord(item) &&
          isExcerpt(item) &&
          isContextSummary(item.snapshot) &&
          item.snapshot.projectId === projectId &&
          item.snapshot.contextId === item.contextId &&
          (snapshot === null ||
            (isContextSummary(snapshot) &&
              snapshot.contextId === item.contextId)) &&
          (item.origin === "latest" ||
            (item.origin === "historical" && scope.scope !== "latest")),
      );
    }
  }
}
