import { randomUUID } from "node:crypto";
import {
  sessionGrantDefaultTtlMs,
  type GrantIssueInput,
  type GrantRevokeInput,
  type IdentityScope,
  type SessionGrantOperation,
  type SessionGrantRecord,
} from "@laplace/contracts";
import { resolveDestinationPolicy } from "@laplace/core";
import type { openCatalog } from "./catalog.ts";
import type { StoredCompiledManifest } from "./f2-store.ts";
import { GitError } from "./git.ts";

type CatalogStore = ReturnType<typeof openCatalog>;
type WithCatalog = <T>(operation: (store: CatalogStore) => T) => T;

export type ValidatedGrantContext = {
  grant: SessionGrantRecord;
  manifestRecord: StoredCompiledManifest;
};

export function createSessionGrantService(deps: {
  withCatalog: WithCatalog;
  now?: () => string;
}) {
  const now = deps.now ?? (() => new Date().toISOString());

  return {
    issue(input: GrantIssueInput): SessionGrantRecord {
      if (!input.humanConfirmed) {
        throw new GitError("codex_authorization_required");
      }
      const policy = resolveDestinationPolicy(input.destinationId);
      if (!policy.known) {
        throw new GitError("destination_unknown");
      }
      if (!policy.deliveryAllowed) {
        throw new GitError("destination_denied");
      }
      if (
        policy.executionMode === "unconfined_workspace_development" &&
        input.unconfinedConfirmed !== true
      ) {
        throw new GitError("codex_authorization_required");
      }

      const scope: IdentityScope = {
        projectId: input.projectId,
        bindingId: input.bindingId,
        worktreeId: input.worktreeId,
      };
      const issuedAt = now();
      const ttlMs = input.ttlMs ?? sessionGrantDefaultTtlMs;
      const expiresAt = new Date(Date.parse(issuedAt) + ttlMs).toISOString();

      return deps.withCatalog((store) => {
        store.identity.resolveScope(scope);
        const manifestRecord = store.f2.getCompiledManifest(
          scope,
          input.manifestDigest,
        );
        if (!manifestRecord) {
          throw new GitError("grant_invalid");
        }
        if (
          manifestRecord.policyVersion !== input.policyVersion ||
          manifestRecord.destinationId !== input.destinationId
        ) {
          throw new GitError("grant_invalid");
        }
        if (manifestRecord.status !== "ready") {
          throw new GitError("compiler_invalid_input");
        }

        const record: SessionGrantRecord = {
          grantId: randomUUID(),
          sessionId: input.sessionId,
          scope,
          manifestDigest: input.manifestDigest,
          policyVersion: input.policyVersion,
          destinationId: input.destinationId,
          allowedOperations: [...new Set(input.allowedOperations)],
          issuedAt,
          expiresAt,
          revokedAt: null,
          revokeReason: null,
          status: "active",
        };
        return store.f2.insertGrant(record);
      });
    },

    list(scope: IdentityScope, manifestDigest?: string): SessionGrantRecord[] {
      const current = now();
      return deps.withCatalog((store) =>
        store.f2.listGrants(scope, current, manifestDigest ?? null),
      );
    },

    revoke(input: GrantRevokeInput): SessionGrantRecord {
      const scope: IdentityScope = {
        projectId: input.projectId,
        bindingId: input.bindingId,
        worktreeId: input.worktreeId,
      };
      return deps.withCatalog((store) =>
        store.f2.revokeGrant(scope, input.grantId, now(), input.reason),
      );
    },

    validate(params: {
      scope: IdentityScope;
      grantId: string;
      sessionId: string;
      destinationId: string;
      manifestDigest: string;
      policyVersion: string;
      requiredOperation?: SessionGrantOperation;
    }): ValidatedGrantContext {
      const requestedPolicy = resolveDestinationPolicy(params.destinationId);
      if (!requestedPolicy.known) {
        throw new GitError("destination_unknown");
      }

      const current = now();
      return deps.withCatalog((store) => {
        store.identity.resolveScope(params.scope);
        const grant = store.f2.getGrant(params.grantId, current);
        if (!grant) {
          throw new GitError("grant_invalid");
        }
        if (
          grant.scope.projectId !== params.scope.projectId ||
          grant.scope.bindingId !== params.scope.bindingId ||
          grant.scope.worktreeId !== params.scope.worktreeId ||
          grant.sessionId !== params.sessionId ||
          grant.manifestDigest !== params.manifestDigest ||
          grant.policyVersion !== params.policyVersion
        ) {
          throw new GitError("grant_invalid");
        }
        if (grant.destinationId !== params.destinationId) {
          throw new GitError("destination_denied");
        }
        const boundPolicy = resolveDestinationPolicy(grant.destinationId);
        if (!boundPolicy.known) {
          throw new GitError("destination_unknown");
        }
        if (!boundPolicy.deliveryAllowed) {
          throw new GitError("destination_denied");
        }
        if (grant.status === "revoked") {
          throw new GitError("grant_revoked");
        }
        if (grant.status === "expired") {
          throw new GitError("grant_expired");
        }
        if (
          params.requiredOperation !== undefined &&
          !grant.allowedOperations.includes(params.requiredOperation)
        ) {
          throw new GitError("grant_invalid");
        }
        const manifestRecord = store.f2.getCompiledManifest(
          params.scope,
          params.manifestDigest,
        );
        if (!manifestRecord || manifestRecord.status !== "ready") {
          throw new GitError("grant_invalid");
        }
        return { grant, manifestRecord };
      });
    },
  };
}
