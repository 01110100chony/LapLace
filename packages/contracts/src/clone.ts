import { isContextDate, isContextPath } from "./context.ts";
import {
  cloneFailures,
  isProject,
  isRecord,
  isRequestId,
  type Project,
} from "./index.ts";

export function parseGitHubRepository(value: unknown) {
  if (typeof value !== "string" || value.length > 180) return;
  const match =
    /^https:\/\/github\.com\/([a-z0-9][a-z0-9-]{0,38})\/([a-z0-9_.-]{1,104})\/?$/i.exec(
      value.trim(),
    );
  if (!match) return;
  const owner = match[1]!;
  const name = match[2]!.replace(/\.git$/i, "");
  if (
    !isContextPath(name) ||
    name.length > 100 ||
    name.toLowerCase() === ".git" ||
    name.toLowerCase().startsWith(".laplace-clone-")
  )
    return;
  return { url: `https://github.com/${owner}/${name}.git`, name };
}

export type CloneFailure = (typeof cloneFailures)[number];
export type ClonePhase =
  "connecting" | "receiving" | "resolving" | "checking_out" | "registering";
export type CloneState =
  "cloning" | "cancelling" | "completed" | "failed" | "cancelled";
export type ClonePlan = { grantId: string; url: string; destination: string };
export type CloneJob = {
  cloneId: string;
  url: string;
  destination: string;
  startedAt: string;
  state: CloneState;
  phase: ClonePhase;
  percent: number | null;
  project: Project | null;
  failure: CloneFailure | null;
  leftover: string | null;
};
export type CloneRequests =
  | { operation: "clone.prepare"; url: string; parent: string }
  | { operation: "clone.start"; grantId: string }
  | { operation: "clone.status"; cloneId: string }
  | { operation: "clone.cancel"; cloneId: string };
export type CloneResults = {
  "clone.prepare": ClonePlan;
  "clone.start": CloneJob;
  "clone.status": CloneJob;
  "clone.cancel": CloneJob;
};

function isPath(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    value.length <= 32_767 &&
    !value.includes("\0")
  );
}

export function parseCloneRequest(
  value: Record<string, unknown>,
): CloneRequests | undefined {
  const { operation, parent, grantId, cloneId } = value;
  if (operation === "clone.prepare") {
    const repository = parseGitHubRepository(value.url);
    if (repository && isPath(parent))
      return { operation, url: repository.url, parent };
  }
  if (operation === "clone.start" && isRequestId(grantId))
    return { operation, grantId };
  if (operation === "clone.status" && isRequestId(cloneId))
    return { operation, cloneId };
  if (operation === "clone.cancel" && isRequestId(cloneId))
    return { operation, cloneId };
}

export function isCloneResult(
  operation: keyof CloneResults,
  value: unknown,
): boolean {
  if (
    !isRecord(value) ||
    !isPath(value.destination) ||
    parseGitHubRepository(value.url)?.url !== value.url ||
    typeof value.url !== "string"
  )
    return false;
  if (operation === "clone.prepare") return isRequestId(value.grantId);
  if (
    !isRequestId(value.cloneId) ||
    !isContextDate(value.startedAt) ||
    ![
      "connecting",
      "receiving",
      "resolving",
      "checking_out",
      "registering",
    ].some((phase) => phase === value.phase) ||
    (value.percent !== null &&
      (typeof value.percent !== "number" ||
        !Number.isSafeInteger(value.percent) ||
        value.percent < 0 ||
        value.percent > 100))
  )
    return false;
  if (value.state === "completed")
    return (
      isProject(value.project) &&
      value.project.root === value.destination &&
      value.failure === null &&
      value.leftover === null
    );
  if (value.project !== null) return false;
  if (value.state === "failed")
    return (
      cloneFailures.some((failure) => failure === value.failure) &&
      (value.leftover === null || isPath(value.leftover))
    );
  return (
    (value.state === "cloning" ||
      value.state === "cancelling" ||
      value.state === "cancelled") &&
    value.failure === null &&
    value.leftover === null
  );
}
