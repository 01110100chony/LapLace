import type { DatabaseSync } from "node:sqlite";
import type {
  AuditedQueryRecord,
  AuditReviewStatus,
  CompiledContextPreview,
  CompiledPublicManifest,
  CompilerManifestStatus,
  ErrorCode,
  IdentityScope,
  ObservedMcpRead,
  ObservedMcpToolName,
  SessionGrantOperation,
  SessionGrantRecord,
  SessionGrantStatus,
} from "@laplace/contracts";
import type { AuthorizedContextPayload } from "@laplace/core";
import { GitError } from "./git.ts";
import type { createIdentityStore } from "./identity-store.ts";

export const f2Migration = `
  CREATE TABLE f2_compiled_manifests (
    manifest_digest TEXT NOT NULL,
    project_id TEXT NOT NULL REFERENCES logical_projects(id),
    binding_id TEXT NOT NULL REFERENCES local_repo_bindings(id),
    worktree_id TEXT NOT NULL REFERENCES worktrees(id),
    legacy_project_id TEXT NOT NULL REFERENCES projects(id),
    destination_id TEXT NOT NULL,
    policy_version TEXT NOT NULL,
    strategy_version TEXT NOT NULL,
    status TEXT NOT NULL CHECK (status IN ('ready', 'mandatory_context_exceeded', 'conflict_suspended', 'destination_blocked')),
    compiled_at TEXT NOT NULL,
    public_manifest TEXT NOT NULL,
    preview_json TEXT NOT NULL,
    payloads_json TEXT NOT NULL,
    PRIMARY KEY (manifest_digest, project_id, binding_id, worktree_id)
  ) STRICT;

  CREATE INDEX f2_compiled_manifests_scope
    ON f2_compiled_manifests (project_id, binding_id, worktree_id, compiled_at DESC);

  CREATE TABLE f2_session_grants (
    grant_id TEXT PRIMARY KEY NOT NULL,
    session_id TEXT NOT NULL,
    project_id TEXT NOT NULL REFERENCES logical_projects(id),
    binding_id TEXT NOT NULL REFERENCES local_repo_bindings(id),
    worktree_id TEXT NOT NULL REFERENCES worktrees(id),
    manifest_digest TEXT NOT NULL,
    policy_version TEXT NOT NULL,
    destination_id TEXT NOT NULL,
    allowed_operations TEXT NOT NULL,
    issued_at TEXT NOT NULL,
    expires_at TEXT NOT NULL,
    revoked_at TEXT,
    revoke_reason TEXT,
    FOREIGN KEY (manifest_digest, project_id, binding_id, worktree_id)
      REFERENCES f2_compiled_manifests (manifest_digest, project_id, binding_id, worktree_id)
  ) STRICT;

  CREATE INDEX f2_session_grants_scope
    ON f2_session_grants (project_id, binding_id, worktree_id, issued_at DESC);

  CREATE TABLE f2_query_audits (
    audit_id TEXT PRIMARY KEY NOT NULL,
    project_id TEXT NOT NULL REFERENCES logical_projects(id),
    binding_id TEXT NOT NULL REFERENCES local_repo_bindings(id),
    worktree_id TEXT NOT NULL REFERENCES worktrees(id),
    grant_id TEXT NOT NULL,
    session_id TEXT NOT NULL,
    manifest_digest TEXT NOT NULL,
    policy_version TEXT NOT NULL,
    destination_id TEXT NOT NULL,
    channel TEXT NOT NULL CHECK (channel IN ('mcp_stdio', 'context_package')),
    mode TEXT NOT NULL CHECK (mode IN ('verified_isolated', 'mock_development', 'unconfined_workspace_development')),
    state TEXT NOT NULL CHECK (state IN ('completed', 'failed', 'denied', 'cancelled', 'timeout')),
    started_at TEXT NOT NULL,
    finished_at TEXT NOT NULL,
    record_json TEXT NOT NULL
  ) STRICT;

  CREATE INDEX f2_query_audits_scope
    ON f2_query_audits (project_id, binding_id, worktree_id, started_at DESC);

  CREATE TABLE f2_mcp_access_log (
    sequence INTEGER PRIMARY KEY,
    project_id TEXT NOT NULL REFERENCES logical_projects(id),
    binding_id TEXT NOT NULL REFERENCES local_repo_bindings(id),
    worktree_id TEXT NOT NULL REFERENCES worktrees(id),
    grant_id TEXT NOT NULL,
    session_id TEXT NOT NULL,
    tool TEXT NOT NULL CHECK (tool IN ('laplace_context_summary', 'laplace_context_search', 'laplace_context_read')),
    opaque_ref TEXT,
    query_text TEXT,
    cursor INTEGER,
    outcome TEXT NOT NULL CHECK (outcome IN ('allowed', 'denied')),
    error_code TEXT,
    at TEXT NOT NULL
  ) STRICT;

  CREATE INDEX f2_mcp_access_grant
    ON f2_mcp_access_log (grant_id, sequence ASC);
`;

export type StoredCompiledManifest = {
  scope: IdentityScope;
  legacyProjectId: string;
  destinationId: string;
  policyVersion: string;
  strategyVersion: string;
  status: CompilerManifestStatus;
  compiledAt: string;
  publicManifest: CompiledPublicManifest;
  preview: CompiledContextPreview;
  authorizedPayloads: Record<string, AuthorizedContextPayload>;
};

type ManifestRow = {
  project_id: string;
  binding_id: string;
  worktree_id: string;
  legacy_project_id: string;
  destination_id: string;
  policy_version: string;
  strategy_version: string;
  status: CompilerManifestStatus;
  compiled_at: string;
  public_manifest: string;
  preview_json: string;
  payloads_json: string;
};

type GrantRow = {
  grant_id: string;
  session_id: string;
  project_id: string;
  binding_id: string;
  worktree_id: string;
  manifest_digest: string;
  policy_version: string;
  destination_id: string;
  allowed_operations: string;
  issued_at: string;
  expires_at: string;
  revoked_at: string | null;
  revoke_reason: string | null;
};

type McpLogRow = {
  sequence: number;
  tool: ObservedMcpToolName;
  opaque_ref: string | null;
  query_text: string | null;
  cursor: number | null;
  outcome: "allowed" | "denied";
  error_code: ErrorCode | null;
  at: string;
};

function computeGrantStatus(row: GrantRow, nowIso: string): SessionGrantStatus {
  if (row.revoked_at !== null) return "revoked";
  if (Date.parse(nowIso) >= Date.parse(row.expires_at)) return "expired";
  return "active";
}

function toGrantRecord(row: GrantRow, nowIso: string): SessionGrantRecord {
  return {
    grantId: row.grant_id,
    sessionId: row.session_id,
    scope: {
      projectId: row.project_id,
      bindingId: row.binding_id,
      worktreeId: row.worktree_id,
    },
    manifestDigest: row.manifest_digest,
    policyVersion: row.policy_version,
    destinationId: row.destination_id,
    allowedOperations: JSON.parse(
      row.allowed_operations,
    ) as SessionGrantOperation[],
    issuedAt: row.issued_at,
    expiresAt: row.expires_at,
    revokedAt: row.revoked_at,
    revokeReason: row.revoke_reason,
    status: computeGrantStatus(row, nowIso),
  };
}

export function createF2Store(
  database: DatabaseSync,
  write: <T>(run: () => T) => T,
  read: <T>(run: () => T) => T,
  identity: ReturnType<typeof createIdentityStore>,
) {
  const upsertManifest = database.prepare(`
    INSERT INTO f2_compiled_manifests (
      manifest_digest, project_id, binding_id, worktree_id, legacy_project_id,
      destination_id, policy_version, strategy_version, status, compiled_at,
      public_manifest, preview_json, payloads_json
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(manifest_digest, project_id, binding_id, worktree_id) DO UPDATE SET
      compiled_at = excluded.compiled_at,
      public_manifest = excluded.public_manifest,
      preview_json = excluded.preview_json,
      payloads_json = excluded.payloads_json
  `);

  const selectManifest = database.prepare(`
    SELECT
      project_id, binding_id, worktree_id, legacy_project_id,
      destination_id, policy_version, strategy_version, status, compiled_at,
      public_manifest, preview_json, payloads_json
    FROM f2_compiled_manifests
    WHERE manifest_digest = ? AND project_id = ? AND binding_id = ? AND worktree_id = ?
  `);

  const insertGrantStmt = database.prepare(`
    INSERT INTO f2_session_grants (
      grant_id, session_id, project_id, binding_id, worktree_id,
      manifest_digest, policy_version, destination_id, allowed_operations,
      issued_at, expires_at, revoked_at, revoke_reason
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, NULL)
  `);

  const selectGrantById = database.prepare(`
    SELECT
      grant_id, session_id, project_id, binding_id, worktree_id,
      manifest_digest, policy_version, destination_id, allowed_operations,
      issued_at, expires_at, revoked_at, revoke_reason
    FROM f2_session_grants
    WHERE grant_id = ?
  `);

  const selectGrantsByScope = database.prepare(`
    SELECT
      grant_id, session_id, project_id, binding_id, worktree_id,
      manifest_digest, policy_version, destination_id, allowed_operations,
      issued_at, expires_at, revoked_at, revoke_reason
    FROM f2_session_grants
    WHERE project_id = ? AND binding_id = ? AND worktree_id = ?
      AND (? IS NULL OR manifest_digest = ?)
    ORDER BY issued_at DESC, grant_id ASC
  `);

  const updateRevokeGrant = database.prepare(`
    UPDATE f2_session_grants
    SET revoked_at = ?, revoke_reason = ?
    WHERE grant_id = ? AND project_id = ? AND binding_id = ? AND worktree_id = ? AND revoked_at IS NULL
  `);

  const insertMcpLog = database.prepare(`
    INSERT INTO f2_mcp_access_log (
      project_id, binding_id, worktree_id, grant_id, session_id,
      tool, opaque_ref, query_text, cursor, outcome, error_code, at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  const selectMaxMcpSeq = database.prepare(`
    SELECT COALESCE(MAX(sequence), 0) AS maxSeq FROM f2_mcp_access_log WHERE grant_id = ?
  `);

  const selectMcpLog = database.prepare(`
    SELECT sequence, tool, opaque_ref, query_text, cursor, outcome, error_code, at
    FROM f2_mcp_access_log
    WHERE project_id = ? AND binding_id = ? AND worktree_id = ?
      AND grant_id = ? AND sequence > ?
    ORDER BY sequence ASC
  `);

  const insertAuditStmt = database.prepare(`
    INSERT INTO f2_query_audits (
      audit_id, project_id, binding_id, worktree_id, grant_id, session_id,
      manifest_digest, policy_version, destination_id, channel, mode, state,
      started_at, finished_at, record_json
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  const selectAuditById = database.prepare(`
    SELECT record_json FROM f2_query_audits
    WHERE audit_id = ? AND project_id = ? AND binding_id = ? AND worktree_id = ?
  `);

  const selectAuditsByScope = database.prepare(`
    SELECT record_json FROM f2_query_audits
    WHERE project_id = ? AND binding_id = ? AND worktree_id = ?
      AND (? IS NULL OR manifest_digest = ?)
    ORDER BY started_at DESC, audit_id ASC
  `);

  const updateAuditRecordStmt = database.prepare(`
    UPDATE f2_query_audits
    SET record_json = ?
    WHERE audit_id = ? AND project_id = ? AND binding_id = ? AND worktree_id = ?
  `);

  return {
    saveCompiledManifest(params: {
      scope: IdentityScope;
      legacyProjectId: string;
      preview: CompiledContextPreview;
      authorizedPayloads: Record<string, AuthorizedContextPayload>;
    }): void {
      write(() => {
        identity.resolveScope(params.scope);
        const { publicManifest } = params.preview;
        upsertManifest.run(
          params.preview.manifestDigest,
          params.scope.projectId,
          params.scope.bindingId,
          params.scope.worktreeId,
          params.legacyProjectId,
          publicManifest.destinationId,
          publicManifest.policyVersion,
          publicManifest.strategyVersion,
          publicManifest.status,
          params.preview.compiledAt,
          JSON.stringify(publicManifest),
          JSON.stringify(params.preview),
          JSON.stringify(params.authorizedPayloads),
        );
      });
    },

    getCompiledManifest(
      scope: IdentityScope,
      manifestDigest: string,
    ): StoredCompiledManifest | undefined {
      return read(() => {
        identity.resolveScope(scope);
        const row = selectManifest.get(
          manifestDigest,
          scope.projectId,
          scope.bindingId,
          scope.worktreeId,
        ) as ManifestRow | undefined;
        if (!row) return undefined;
        return {
          scope: {
            projectId: row.project_id,
            bindingId: row.binding_id,
            worktreeId: row.worktree_id,
          },
          legacyProjectId: row.legacy_project_id,
          destinationId: row.destination_id,
          policyVersion: row.policy_version,
          strategyVersion: row.strategy_version,
          status: row.status,
          compiledAt: row.compiled_at,
          publicManifest: JSON.parse(
            row.public_manifest,
          ) as CompiledPublicManifest,
          preview: JSON.parse(row.preview_json) as CompiledContextPreview,
          authorizedPayloads: JSON.parse(row.payloads_json) as Record<
            string,
            AuthorizedContextPayload
          >,
        };
      });
    },

    insertGrant(record: SessionGrantRecord): SessionGrantRecord {
      return write(() => {
        identity.resolveScope(record.scope);
        insertGrantStmt.run(
          record.grantId,
          record.sessionId,
          record.scope.projectId,
          record.scope.bindingId,
          record.scope.worktreeId,
          record.manifestDigest,
          record.policyVersion,
          record.destinationId,
          JSON.stringify(record.allowedOperations),
          record.issuedAt,
          record.expiresAt,
        );
        return record;
      });
    },

    getGrant(grantId: string, nowIso: string): SessionGrantRecord | undefined {
      return read(() => {
        const row = selectGrantById.get(grantId) as GrantRow | undefined;
        return row ? toGrantRecord(row, nowIso) : undefined;
      });
    },

    listGrants(
      scope: IdentityScope,
      nowIso: string,
      manifestDigest: string | null = null,
    ): SessionGrantRecord[] {
      return read(() => {
        identity.resolveScope(scope);
        const rows = selectGrantsByScope.all(
          scope.projectId,
          scope.bindingId,
          scope.worktreeId,
          manifestDigest,
          manifestDigest,
        ) as GrantRow[];
        return rows.map((row) => toGrantRecord(row, nowIso));
      });
    },

    revokeGrant(
      scope: IdentityScope,
      grantId: string,
      revokedAt: string,
      reason: string,
    ): SessionGrantRecord {
      return write(() => {
        identity.resolveScope(scope);
        const existing = selectGrantById.get(grantId) as GrantRow | undefined;
        if (
          !existing ||
          existing.project_id !== scope.projectId ||
          existing.binding_id !== scope.bindingId ||
          existing.worktree_id !== scope.worktreeId
        ) {
          throw new GitError("grant_invalid");
        }
        if (existing.revoked_at === null) {
          updateRevokeGrant.run(
            revokedAt,
            reason,
            grantId,
            scope.projectId,
            scope.bindingId,
            scope.worktreeId,
          );
        }
        const updated = selectGrantById.get(grantId) as GrantRow;
        return toGrantRecord(updated, revokedAt);
      });
    },

    appendMcpLog(params: {
      scope: IdentityScope;
      grantId: string;
      sessionId: string;
      entry: ObservedMcpRead;
    }): void {
      write(() => {
        insertMcpLog.run(
          params.scope.projectId,
          params.scope.bindingId,
          params.scope.worktreeId,
          params.grantId,
          params.sessionId,
          params.entry.tool,
          params.entry.opaqueRef,
          params.entry.query,
          params.entry.cursor,
          params.entry.outcome,
          params.entry.errorCode,
          params.entry.at,
        );
      });
    },

    getMaxMcpSequence(grantId: string): number {
      return read(() => {
        const row = selectMaxMcpSeq.get(grantId) as { maxSeq: number };
        return Number(row?.maxSeq ?? 0);
      });
    },

    listMcpLog(
      scope: IdentityScope,
      grantId: string,
      afterSequence = 0,
    ): ObservedMcpRead[] {
      return read(() => {
        identity.resolveScope(scope);
        const rows = selectMcpLog.all(
          scope.projectId,
          scope.bindingId,
          scope.worktreeId,
          grantId,
          afterSequence,
        ) as McpLogRow[];
        return rows.map((row) => ({
          tool: row.tool,
          opaqueRef: row.opaque_ref,
          query: row.query_text,
          cursor: row.cursor === null ? null : Number(row.cursor),
          outcome: row.outcome,
          errorCode: row.error_code,
          at: row.at,
        }));
      });
    },

    insertAudit(record: AuditedQueryRecord): AuditedQueryRecord {
      return write(() => {
        identity.resolveScope(record.scope);
        insertAuditStmt.run(
          record.auditId,
          record.scope.projectId,
          record.scope.bindingId,
          record.scope.worktreeId,
          record.grantId,
          record.sessionId,
          record.manifestDigest,
          record.policyVersion,
          record.destinationId,
          record.channel,
          record.mode,
          record.state,
          record.startedAt,
          record.finishedAt,
          JSON.stringify(record),
        );
        return record;
      });
    },

    listAudits(
      scope: IdentityScope,
      manifestDigest: string | null = null,
    ): AuditedQueryRecord[] {
      return read(() => {
        identity.resolveScope(scope);
        const rows = selectAuditsByScope.all(
          scope.projectId,
          scope.bindingId,
          scope.worktreeId,
          manifestDigest,
          manifestDigest,
        ) as { record_json: string }[];
        return rows.map(
          (row) => JSON.parse(row.record_json) as AuditedQueryRecord,
        );
      });
    },

    reviewAudit(
      scope: IdentityScope,
      auditId: string,
      review: {
        status: Exclude<AuditReviewStatus, "pending">;
        reviewer: string;
        note: string;
        reviewedAt: string;
      },
    ): AuditedQueryRecord {
      return write(() => {
        identity.resolveScope(scope);
        const row = selectAuditById.get(
          auditId,
          scope.projectId,
          scope.bindingId,
          scope.worktreeId,
        ) as { record_json: string } | undefined;
        if (!row) throw new GitError("audit_unavailable");
        const existing = JSON.parse(row.record_json) as AuditedQueryRecord;
        const updated: AuditedQueryRecord = {
          ...existing,
          review: {
            status: review.status,
            reviewer: review.reviewer,
            note: review.note,
            reviewedAt: review.reviewedAt,
          },
        };
        updateAuditRecordStmt.run(
          JSON.stringify(updated),
          auditId,
          scope.projectId,
          scope.bindingId,
          scope.worktreeId,
        );
        return updated;
      });
    },
  };
}
