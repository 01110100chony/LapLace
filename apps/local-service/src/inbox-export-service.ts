import { randomUUID } from "node:crypto";
import {
  defaultInboxTtlMs,
  type ClaimDetailResult,
  type ClaimRevision,
  type ExportAuditRecord,
  type ExportExceptionGrantInput,
  type ExportExceptionRecord,
  type ExportExecuteInput,
  type ExportPreviewInput,
  type ExportPreviewResult,
  type IdentityScope,
  type InboxListResult,
  type InboxProposalRecord,
  type InboxReviewInput,
  type InboxReviewResult,
  type InboxSubmitInput,
} from "@laplace/contracts";
import {
  evaluateExportGovernance,
  resolveDestinationPolicy,
} from "@laplace/core";
import type { openCatalog } from "./catalog.ts";
import { sha256 } from "./context.ts";
import { GitError } from "./git.ts";

type CatalogStore = ReturnType<typeof openCatalog>;
type WithCatalog = <T>(operation: (store: CatalogStore) => T) => T;

function normalizeContent(content: string): string {
  return content.trim().replace(/\s+/g, " ").toLowerCase();
}

function toClaimDetail(
  scope: IdentityScope,
  claimId: string,
  title: string,
  revisions: ClaimRevision[],
): ClaimDetailResult {
  return {
    scope,
    claimId,
    title,
    activeCount: revisions.filter((r) => r.knownTo === null).length,
    revisions,
  };
}

export function createInboxExportService(deps: {
  withCatalog: WithCatalog;
  now?: () => string;
}) {
  const now = deps.now ?? (() => new Date().toISOString());

  return {
    inboxSubmit(input: InboxSubmitInput): InboxProposalRecord {
      const scope: IdentityScope = {
        projectId: input.projectId,
        bindingId: input.bindingId,
        worktreeId: input.worktreeId,
      };
      const createdAt = now();
      const expiresAt = new Date(
        Date.parse(createdAt) + (input.ttlMs ?? defaultInboxTtlMs),
      ).toISOString();
      const fingerprint = sha256(
        JSON.stringify({
          targetKind: input.targetKind,
          normalized: normalizeContent(input.content),
        }),
      );

      return deps.withCatalog((store) =>
        store.f3.upsertInboxProposal({
          proposalId: randomUUID(),
          scope,
          fingerprint,
          title: input.title,
          content: input.content,
          targetKind: input.targetKind,
          visibility: input.visibility ?? "local_only",
          originLabel: input.originLabel,
          createdAt,
          expiresAt,
        }),
      );
    },

    inboxList(scope: IdentityScope): InboxListResult {
      const nowIso = now();
      return deps.withCatalog((store) => ({
        scope,
        items: store.f3.listInbox(scope, nowIso),
      }));
    },

    inboxReview(input: InboxReviewInput): InboxReviewResult {
      if (!input.humanConfirmed) {
        throw new GitError("memory_invalid_input");
      }
      const scope: IdentityScope = {
        projectId: input.projectId,
        bindingId: input.bindingId,
        worktreeId: input.worktreeId,
      };
      const nowIso = now();

      return deps.withCatalog((store) => {
        const worktree = store.identity.resolveScope(scope);
        const promotedClaim =
          input.decision === "approve"
            ? {
                claimId: randomUUID(),
                legacyProjectId: worktree.legacyProjectId,
                revisionId: randomUUID(),
                requestId: `inbox:${input.proposalId}`,
                authority: input.promoteCanonical
                  ? ("human_promoted" as const)
                  : ("human_local" as const),
                visibility: "local_only" as const,
                validFrom: input.validFrom ?? nowIso,
              }
            : undefined;

        const { proposal, feedback } = store.f3.reviewInboxProposal({
          scope,
          proposalId: input.proposalId,
          decision: input.decision,
          reviewer: input.reviewer,
          note: input.note,
          nowIso,
          feedbackId: randomUUID(),
          promotedClaim,
        });

        let createdClaim: ClaimDetailResult | null = null;
        if (promotedClaim) {
          const loaded = store.f3.getClaim(scope, promotedClaim.claimId);
          if (loaded) {
            createdClaim = toClaimDetail(
              scope,
              loaded.header.claim_id,
              loaded.header.title,
              loaded.revisions,
            );
          }
        }

        return {
          scope,
          proposal,
          feedback,
          createdClaim,
        };
      });
    },

    exportPreview(input: ExportPreviewInput): ExportPreviewResult {
      const scope: IdentityScope = {
        projectId: input.projectId,
        bindingId: input.bindingId,
        worktreeId: input.worktreeId,
      };
      return deps.withCatalog((store) => {
        store.identity.resolveScope(scope);
        return evaluateExportGovernance({
          scope,
          destinationId: input.destinationId,
          policyVersion: input.policyVersion,
          items: input.items,
        });
      });
    },

    exportExceptionGrant(
      input: ExportExceptionGrantInput,
    ): ExportExceptionRecord {
      if (!input.humanConfirmed) {
        throw new GitError("memory_invalid_input");
      }
      if (input.hasDbOnlyItems === true) {
        throw new GitError("export_denied");
      }
      const destination = resolveDestinationPolicy(input.destinationId);
      if (
        !destination.known ||
        (!destination.deliveryAllowed && !destination.allowsLocalOnly)
      ) {
        throw new GitError("export_denied");
      }
      const scope: IdentityScope = {
        projectId: input.projectId,
        bindingId: input.bindingId,
        worktreeId: input.worktreeId,
      };
      const record: ExportExceptionRecord = {
        exceptionId: randomUUID(),
        scope,
        bundleDigest: input.bundleDigest,
        destinationId: input.destinationId,
        policyVersion: input.policyVersion,
        reviewer: input.reviewer,
        reason: input.reason,
        grantedAt: now(),
      };
      return deps.withCatalog((store) =>
        store.f3.insertExportException(record),
      );
    },

    exportExecute(input: ExportExecuteInput): ExportAuditRecord {
      const scope: IdentityScope = {
        projectId: input.projectId,
        bindingId: input.bindingId,
        worktreeId: input.worktreeId,
      };
      const executedAt = now();

      return deps.withCatalog((store) => {
        store.identity.resolveScope(scope);
        let exception: ExportExceptionRecord | null = null;
        if (input.exceptionId !== undefined) {
          exception = store.f3.getExportException(scope, input.exceptionId);
          if (!exception) {
            throw new GitError("export_exception_invalid");
          }
        }

        const evaluation = evaluateExportGovernance({
          scope,
          destinationId: input.destinationId,
          policyVersion: input.policyVersion,
          items: input.items,
          exception,
        });

        if (evaluation.hardDenied) {
          throw new GitError("export_denied");
        }
        if (!evaluation.eligible) {
          throw new GitError(
            input.exceptionId !== undefined
              ? "export_exception_invalid"
              : "export_denied",
          );
        }

        return store.f3.insertExportAudit({
          exportId: randomUUID(),
          scope,
          bundleDigest: evaluation.bundleDigest,
          destinationId: input.destinationId,
          policyVersion: evaluation.policyVersion,
          exceptionId: input.exceptionId ?? null,
          exportedCount: evaluation.items.length,
          itemDigests: evaluation.items.map((item) => item.contentDigest),
          executedAt,
        });
      });
    },
  };
}
