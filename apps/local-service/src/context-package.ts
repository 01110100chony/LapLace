import { randomUUID } from "node:crypto";
import {
  contextCompilerSchemaVersion,
  isContextPackage,
  isHandoffArtifact,
  type ContextPackage,
  type ContextPackageBundle,
  type ContextPackageItem,
  type HandoffArtifact,
  type HandoffEvaluationResult,
  type HandoffImportInput,
  type IdentityScope,
  type PackageExportInput,
} from "@laplace/contracts";
import { canonicalJson, resolveDestinationPolicy } from "@laplace/core";
import type { openCatalog } from "./catalog.ts";
import { sha256 } from "./context.ts";
import { GitError } from "./git.ts";
import type { createSessionGrantService } from "./session-grant-store.ts";

type CatalogStore = ReturnType<typeof openCatalog>;
type WithCatalog = <T>(operation: (store: CatalogStore) => T) => T;
type GrantService = ReturnType<typeof createSessionGrantService>;

export function createContextPackageService(deps: {
  withCatalog: WithCatalog;
  grants: GrantService;
  now?: () => string;
}) {
  const now = deps.now ?? (() => new Date().toISOString());

  return {
    exportPackage(input: PackageExportInput): ContextPackageBundle {
      const scope: IdentityScope = {
        projectId: input.projectId,
        bindingId: input.bindingId,
        worktreeId: input.worktreeId,
      };
      const validated = deps.grants.validate({
        scope,
        grantId: input.grantId,
        sessionId: input.sessionId,
        destinationId: input.destinationId,
        manifestDigest: input.manifestDigest,
        policyVersion: input.policyVersion,
        requiredOperation: "package",
      });
      if (
        input.includeHandoff &&
        !validated.grant.allowedOperations.includes("handoff")
      ) {
        throw new GitError("grant_invalid");
      }

      const { publicManifest, authorizedPayloads } = validated.manifestRecord;
      const createdAt = now();
      const items: ContextPackageItem[] = [];

      for (const item of publicManifest.items) {
        const payload = authorizedPayloads[item.opaqueRef];
        if (
          !payload ||
          sha256(payload.text) !== item.contentDigest ||
          Buffer.byteLength(payload.text, "utf8") !== item.bytes
        ) {
          throw new GitError("context_source_unavailable");
        }
        items.push({
          opaqueRef: item.opaqueRef,
          version: item.version,
          tier: item.tier,
          mandatory: item.mandatory,
          contentDigest: item.contentDigest,
          bytes: item.bytes,
          anchor: item.anchor,
          text: payload.text,
        });
      }

      const packageCore: Omit<ContextPackage, "packageDigest"> = {
        schemaVersion: contextCompilerSchemaVersion,
        packageId: randomUUID(),
        createdAt,
        manifestDigest: publicManifest.manifestDigest,
        policyVersion: publicManifest.policyVersion,
        strategyVersion: publicManifest.strategyVersion,
        destinationId: validated.grant.destinationId,
        publicManifest,
        items,
      };
      const packageDigest = sha256(canonicalJson(packageCore));
      const contextPackage: ContextPackage = {
        ...packageCore,
        packageDigest,
      };

      const handoff: HandoffArtifact | null = input.includeHandoff
        ? {
            schemaVersion: contextCompilerSchemaVersion,
            handoffId: randomUUID(),
            createdAt,
            sourceProjectId: scope.projectId,
            objective: publicManifest.objective,
            manifestDigest: publicManifest.manifestDigest,
            policyVersion: publicManifest.policyVersion,
            strategyVersion: publicManifest.strategyVersion,
            destinationHint: validated.grant.destinationId,
            selectedRefs: items.map((item) => ({
              opaqueRef: item.opaqueRef,
              version: item.version,
              tier: item.tier,
              contentDigest: item.contentDigest,
              bytes: item.bytes,
            })),
            pendingConflicts: publicManifest.conflicts,
            openQuestions: [],
            requiresReevaluation: true,
          }
        : null;

      return {
        scope,
        grantId: validated.grant.grantId,
        contextPackage,
        handoff,
      };
    },

    importHandoff(input: HandoffImportInput): HandoffEvaluationResult {
      const destination = resolveDestinationPolicy(input.destinationId);
      if (!destination.known) {
        throw new GitError("destination_unknown");
      }
      if (!destination.deliveryAllowed) {
        throw new GitError("destination_denied");
      }
      if (!input.humanConfirmed) {
        throw new GitError("codex_authorization_required");
      }

      const scope: IdentityScope = {
        projectId: input.projectId,
        bindingId: input.bindingId,
        worktreeId: input.worktreeId,
      };
      deps.withCatalog((store) => {
        store.identity.resolveScope(scope);
      });

      const pkg = input.contextPackage;
      const handoff = input.handoff;
      if (!pkg && !handoff) {
        throw new GitError("handoff_invalid");
      }

      let sourceProjectId: string | null = null;
      let manifestDigest: string | null = null;
      let selectedRefCount = 0;
      let pendingConflicts = handoff?.pendingConflicts ?? [];

      if (pkg) {
        if (!isContextPackage(pkg)) {
          throw new GitError("handoff_invalid");
        }
        const { packageDigest, ...packageBody } = pkg;
        if (sha256(canonicalJson(packageBody)) !== packageDigest) {
          throw new GitError("handoff_invalid");
        }
        const { manifestDigest: rawManifestDigest, ...manifestBody } =
          pkg.publicManifest;
        if (
          sha256(canonicalJson(manifestBody)) !== rawManifestDigest ||
          rawManifestDigest !== pkg.manifestDigest
        ) {
          throw new GitError("handoff_invalid");
        }
        for (const item of pkg.items) {
          if (
            sha256(item.text) !== item.contentDigest ||
            Buffer.byteLength(item.text, "utf8") !== item.bytes
          ) {
            throw new GitError("handoff_invalid");
          }
        }
        if (
          pkg.publicManifest.scope.projectId !== scope.projectId ||
          pkg.publicManifest.scope.bindingId !== scope.bindingId ||
          pkg.publicManifest.scope.worktreeId !== scope.worktreeId
        ) {
          throw new GitError("handoff_invalid");
        }
        sourceProjectId = pkg.publicManifest.scope.projectId;
        manifestDigest = pkg.manifestDigest;
        selectedRefCount = pkg.items.length;
        pendingConflicts = pkg.publicManifest.conflicts;
      }

      if (handoff) {
        if (!isHandoffArtifact(handoff)) {
          throw new GitError("handoff_invalid");
        }
        if (handoff.sourceProjectId !== scope.projectId) {
          throw new GitError("handoff_invalid");
        }
        if (
          pkg &&
          (handoff.manifestDigest !== pkg.manifestDigest ||
            handoff.policyVersion !== pkg.policyVersion)
        ) {
          throw new GitError("handoff_invalid");
        }
        sourceProjectId = handoff.sourceProjectId;
        manifestDigest = handoff.manifestDigest;
        selectedRefCount = handoff.selectedRefs.length;
        pendingConflicts = handoff.pendingConflicts;
      }

      return {
        scope,
        evaluation: "accepted_requires_grant",
        requiresNewGrant: true,
        sourceProjectId,
        manifestDigest,
        destination,
        reason:
          "Integridade e escopo validados; emita novo SessionGrant explícito nesta sessão antes de qualquer leitura ou envio.",
        selectedRefCount,
        pendingConflicts,
      };
    },
  };
}
