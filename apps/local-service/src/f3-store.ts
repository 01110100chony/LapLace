import {
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import type { DatabaseSync } from "node:sqlite";
import type {
  CasPinRecord,
  ClaimRevision,
  ConflictPolarity,
  DirtyOverlayManifest,
  DirtyOverlaySummary,
  EvidenceAttachmentRef,
  ExportAuditRecord,
  ExportExceptionRecord,
  IdentityScope,
  InboxProposalRecord,
  LocalFeedbackRecord,
  MemoryAuthority,
  MemoryVisibility,
  PurgeJobRecord,
  PurgeStage,
  PurgeTargetKind,
  RelationKind,
  RelationRecord,
  TimelineSignalKind,
} from "@laplace/contracts";
import type { createCasStore } from "./cas-store.ts";
import { GitError } from "./git.ts";
import type { createIdentityStore } from "./identity-store.ts";

export const f3Migration = `
  CREATE TABLE f3_claims (
    claim_id TEXT PRIMARY KEY NOT NULL,
    project_id TEXT NOT NULL REFERENCES logical_projects(id),
    binding_id TEXT NOT NULL REFERENCES local_repo_bindings(id),
    worktree_id TEXT NOT NULL REFERENCES worktrees(id),
    legacy_project_id TEXT NOT NULL REFERENCES projects(id),
    title TEXT NOT NULL,
    next_tx_seq INTEGER NOT NULL,
    next_segment_seq INTEGER NOT NULL,
    created_at TEXT NOT NULL
  ) STRICT;

  CREATE TABLE f3_claim_revisions (
    revision_id TEXT PRIMARY KEY NOT NULL,
    claim_id TEXT NOT NULL REFERENCES f3_claims(claim_id) ON DELETE CASCADE,
    project_id TEXT NOT NULL,
    binding_id TEXT NOT NULL,
    worktree_id TEXT NOT NULL,
    segment_seq INTEGER NOT NULL,
    tx_seq INTEGER NOT NULL,
    request_id TEXT NOT NULL,
    content TEXT NOT NULL,
    author TEXT NOT NULL,
    reason TEXT NOT NULL,
    authority TEXT NOT NULL CHECK (authority IN ('human_local', 'human_promoted')),
    visibility TEXT NOT NULL CHECK (visibility IN ('local_only', 'canonical_verified', 'captured_eligible', 'db_only')),
    conflict_key TEXT,
    conflict_polarity TEXT CHECK (conflict_polarity IS NULL OR conflict_polarity IN ('require', 'forbid')),
    valid_from TEXT NOT NULL,
    valid_to TEXT,
    known_from TEXT NOT NULL,
    known_to TEXT,
    supersedes_revision_id TEXT,
    evidence_ref_json TEXT,
    recorded_at TEXT NOT NULL
  ) STRICT;

  CREATE INDEX f3_claim_revs_scope
    ON f3_claim_revisions (project_id, binding_id, worktree_id, claim_id);
  CREATE UNIQUE INDEX f3_claim_revs_req
    ON f3_claim_revisions (claim_id, request_id, segment_seq);

  CREATE TABLE f3_kgraph_edges (
    relation_id TEXT PRIMARY KEY NOT NULL,
    project_id TEXT NOT NULL REFERENCES logical_projects(id),
    binding_id TEXT NOT NULL REFERENCES local_repo_bindings(id),
    worktree_id TEXT NOT NULL REFERENCES worktrees(id),
    from_id TEXT NOT NULL,
    to_id TEXT NOT NULL,
    kind TEXT NOT NULL,
    signal_kind TEXT NOT NULL,
    rationale TEXT NOT NULL,
    author TEXT NOT NULL,
    known_at TEXT NOT NULL
  ) STRICT;

  CREATE TABLE f3_cas_pins (
    pin_id TEXT PRIMARY KEY NOT NULL,
    project_id TEXT NOT NULL REFERENCES logical_projects(id),
    binding_id TEXT NOT NULL REFERENCES local_repo_bindings(id),
    worktree_id TEXT NOT NULL REFERENCES worktrees(id),
    label TEXT NOT NULL,
    digest TEXT NOT NULL,
    bytes INTEGER NOT NULL,
    source_kind TEXT NOT NULL CHECK (source_kind IN ('context_excerpt', 'inline')),
    source_context_id TEXT,
    source_path TEXT,
    source_chunk INTEGER,
    protected_claim_id TEXT,
    status TEXT NOT NULL CHECK (status IN ('active', 'released', 'purged')),
    created_at TEXT NOT NULL
  ) STRICT;

  CREATE TABLE f3_purge_jobs (
    purge_id TEXT PRIMARY KEY NOT NULL,
    tombstone_id TEXT NOT NULL UNIQUE,
    project_id TEXT NOT NULL,
    binding_id TEXT NOT NULL,
    worktree_id TEXT NOT NULL,
    target_kind TEXT NOT NULL CHECK (target_kind IN ('claim', 'pin', 'overlay')),
    target_id TEXT NOT NULL,
    stage TEXT NOT NULL CHECK (stage IN ('access_revoked', 'blobs_removed', 'projections_cleared', 'completed')),
    state TEXT NOT NULL CHECK (state IN ('in_progress', 'completed')),
    removed_blobs INTEGER NOT NULL,
    preserved_shared_blobs INTEGER NOT NULL,
    reason TEXT NOT NULL,
    candidate_digests_json TEXT NOT NULL,
    started_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    completed_at TEXT
  ) STRICT;

  CREATE TABLE f3_purge_tombstones (
    tombstone_id TEXT PRIMARY KEY NOT NULL,
    target_kind TEXT NOT NULL,
    target_id TEXT NOT NULL,
    project_id TEXT NOT NULL,
    binding_id TEXT NOT NULL,
    worktree_id TEXT NOT NULL,
    purged_at TEXT NOT NULL,
    UNIQUE (target_kind, target_id)
  ) STRICT;

  CREATE TABLE f3_inbox_proposals (
    proposal_id TEXT PRIMARY KEY NOT NULL,
    project_id TEXT NOT NULL REFERENCES logical_projects(id),
    binding_id TEXT NOT NULL REFERENCES local_repo_bindings(id),
    worktree_id TEXT NOT NULL REFERENCES worktrees(id),
    fingerprint TEXT NOT NULL,
    title TEXT NOT NULL,
    content TEXT NOT NULL,
    target_kind TEXT NOT NULL,
    visibility TEXT NOT NULL,
    status TEXT NOT NULL CHECK (status IN ('pending', 'approved', 'rejected', 'expired')),
    duplicate_count INTEGER NOT NULL,
    origins_json TEXT NOT NULL,
    created_at TEXT NOT NULL,
    expires_at TEXT NOT NULL,
    reviewed_at TEXT,
    reviewer TEXT,
    review_note TEXT,
    promoted_claim_id TEXT
  ) STRICT;

  CREATE TABLE f3_local_feedback (
    feedback_id TEXT PRIMARY KEY NOT NULL,
    project_id TEXT NOT NULL REFERENCES logical_projects(id),
    binding_id TEXT NOT NULL REFERENCES local_repo_bindings(id),
    worktree_id TEXT NOT NULL REFERENCES worktrees(id),
    proposal_id TEXT NOT NULL,
    decision TEXT NOT NULL CHECK (decision IN ('approve', 'reject')),
    reviewer TEXT NOT NULL,
    note TEXT NOT NULL,
    recorded_at TEXT NOT NULL
  ) STRICT;

  CREATE TABLE f3_export_exceptions (
    exception_id TEXT PRIMARY KEY NOT NULL,
    project_id TEXT NOT NULL REFERENCES logical_projects(id),
    binding_id TEXT NOT NULL REFERENCES local_repo_bindings(id),
    worktree_id TEXT NOT NULL REFERENCES worktrees(id),
    bundle_digest TEXT NOT NULL,
    destination_id TEXT NOT NULL,
    policy_version TEXT NOT NULL,
    reviewer TEXT NOT NULL,
    reason TEXT NOT NULL,
    granted_at TEXT NOT NULL
  ) STRICT;

  CREATE TABLE f3_export_audits (
    export_id TEXT PRIMARY KEY NOT NULL,
    project_id TEXT NOT NULL REFERENCES logical_projects(id),
    binding_id TEXT NOT NULL REFERENCES local_repo_bindings(id),
    worktree_id TEXT NOT NULL REFERENCES worktrees(id),
    bundle_digest TEXT NOT NULL,
    destination_id TEXT NOT NULL,
    policy_version TEXT NOT NULL,
    exception_id TEXT,
    exported_count INTEGER NOT NULL,
    item_digests_json TEXT NOT NULL,
    executed_at TEXT NOT NULL
  ) STRICT;

  CREATE TABLE f3_dirty_overlays (
    overlay_id TEXT PRIMARY KEY NOT NULL,
    project_id TEXT NOT NULL REFERENCES logical_projects(id),
    binding_id TEXT NOT NULL REFERENCES local_repo_bindings(id),
    worktree_id TEXT NOT NULL REFERENCES worktrees(id),
    label TEXT NOT NULL,
    head TEXT,
    branch TEXT,
    captured_at TEXT NOT NULL,
    manifest_digest TEXT NOT NULL,
    file_count INTEGER NOT NULL,
    gap_count INTEGER NOT NULL,
    manifest_json TEXT NOT NULL
  ) STRICT;

  CREATE TABLE f3_overlay_blobs (
    overlay_id TEXT NOT NULL REFERENCES f3_dirty_overlays(overlay_id) ON DELETE CASCADE,
    digest TEXT NOT NULL,
    bytes INTEGER NOT NULL,
    PRIMARY KEY (overlay_id, digest)
  ) STRICT, WITHOUT ROWID;
`;

export type F3PurgeJournalEntry = {
  tombstoneId: string;
  targetKind: PurgeTargetKind;
  targetId: string;
  projectId: string;
  bindingId: string;
  worktreeId: string;
  purgedAt: string;
};

type ClaimRow = {
  claim_id: string;
  project_id: string;
  binding_id: string;
  worktree_id: string;
  legacy_project_id: string;
  title: string;
  next_tx_seq: number;
  next_segment_seq: number;
  created_at: string;
};

type RevisionRow = {
  revision_id: string;
  claim_id: string;
  project_id: string;
  binding_id: string;
  worktree_id: string;
  segment_seq: number;
  tx_seq: number;
  request_id: string;
  content: string;
  author: string;
  reason: string;
  authority: MemoryAuthority;
  visibility: MemoryVisibility;
  conflict_key: string | null;
  conflict_polarity: ConflictPolarity | null;
  valid_from: string;
  valid_to: string | null;
  known_from: string;
  known_to: string | null;
  supersedes_revision_id: string | null;
  evidence_ref_json: string | null;
  recorded_at: string;
};

type EdgeRow = {
  relation_id: string;
  project_id: string;
  binding_id: string;
  worktree_id: string;
  from_id: string;
  to_id: string;
  kind: RelationKind;
  signal_kind: TimelineSignalKind;
  rationale: string;
  author: string;
  known_at: string;
};

type PinRow = {
  pin_id: string;
  project_id: string;
  binding_id: string;
  worktree_id: string;
  label: string;
  digest: string;
  bytes: number;
  source_kind: "context_excerpt" | "inline";
  source_context_id: string | null;
  source_path: string | null;
  source_chunk: number | null;
  protected_claim_id: string | null;
  status: "active" | "released" | "purged";
  created_at: string;
};

type PurgeJobRow = {
  purge_id: string;
  tombstone_id: string;
  project_id: string;
  binding_id: string;
  worktree_id: string;
  target_kind: PurgeTargetKind;
  target_id: string;
  stage: PurgeStage;
  state: "in_progress" | "completed";
  removed_blobs: number;
  preserved_shared_blobs: number;
  reason: string;
  candidate_digests_json: string;
  started_at: string;
  updated_at: string;
  completed_at: string | null;
};

type TombstoneRow = {
  tombstone_id: string;
  target_kind: PurgeTargetKind;
  target_id: string;
  project_id: string;
  binding_id: string;
  worktree_id: string;
  purged_at: string;
};

type InboxRow = {
  proposal_id: string;
  project_id: string;
  binding_id: string;
  worktree_id: string;
  fingerprint: string;
  title: string;
  content: string;
  target_kind: "claim" | "preference";
  visibility: MemoryVisibility;
  status: "pending" | "approved" | "rejected" | "expired";
  duplicate_count: number;
  origins_json: string;
  created_at: string;
  expires_at: string;
  reviewed_at: string | null;
  reviewer: string | null;
  review_note: string | null;
  promoted_claim_id: string | null;
};

type ExceptionRow = {
  exception_id: string;
  project_id: string;
  binding_id: string;
  worktree_id: string;
  bundle_digest: string;
  destination_id: string;
  policy_version: string;
  reviewer: string;
  reason: string;
  granted_at: string;
};

type OverlayRow = {
  overlay_id: string;
  project_id: string;
  binding_id: string;
  worktree_id: string;
  label: string;
  head: string | null;
  branch: string | null;
  captured_at: string;
  manifest_digest: string;
  file_count: number;
  gap_count: number;
  manifest_json: string;
};

function toClaimRevision(row: RevisionRow): ClaimRevision {
  return {
    revisionId: row.revision_id,
    claimId: row.claim_id,
    segmentSeq: row.segment_seq,
    txSeq: row.tx_seq,
    content: row.content,
    author: row.author,
    reason: row.reason,
    authority: row.authority,
    visibility: row.visibility,
    conflictKey: row.conflict_key,
    conflictPolarity: row.conflict_polarity,
    validFrom: row.valid_from,
    validTo: row.valid_to,
    knownFrom: row.known_from,
    knownTo: row.known_to,
    supersedesRevisionId: row.supersedes_revision_id,
    evidenceRef: row.evidence_ref_json
      ? (JSON.parse(row.evidence_ref_json) as EvidenceAttachmentRef)
      : null,
    recordedAt: row.recorded_at,
  };
}

function toPinRecord(row: PinRow): CasPinRecord {
  return {
    pinId: row.pin_id,
    scope: {
      projectId: row.project_id,
      bindingId: row.binding_id,
      worktreeId: row.worktree_id,
    },
    label: row.label,
    digest: row.digest,
    bytes: row.bytes,
    sourceKind: row.source_kind,
    sourceContextId: row.source_context_id,
    sourcePath: row.source_path,
    sourceChunk: row.source_chunk,
    protectedClaimId: row.protected_claim_id,
    status: row.status,
    createdAt: row.created_at,
  };
}

function toPurgeJobRecord(row: PurgeJobRow): PurgeJobRecord {
  return {
    purgeId: row.purge_id,
    tombstoneId: row.tombstone_id,
    scope: {
      projectId: row.project_id,
      bindingId: row.binding_id,
      worktreeId: row.worktree_id,
    },
    targetKind: row.target_kind,
    targetId: row.target_id,
    stage: row.stage,
    state: row.state,
    removedBlobs: row.removed_blobs,
    preservedSharedBlobs: row.preserved_shared_blobs === 1,
    reason: row.reason,
    startedAt: row.started_at,
    updatedAt: row.updated_at,
    completedAt: row.completed_at,
  };
}

function toInboxRecord(row: InboxRow, nowIso?: string): InboxProposalRecord {
  const effectiveStatus =
    row.status === "pending" &&
    nowIso &&
    Date.parse(nowIso) >= Date.parse(row.expires_at)
      ? "expired"
      : row.status;
  return {
    proposalId: row.proposal_id,
    scope: {
      projectId: row.project_id,
      bindingId: row.binding_id,
      worktreeId: row.worktree_id,
    },
    fingerprint: row.fingerprint,
    title: row.title,
    content: row.content,
    targetKind: row.target_kind,
    visibility: row.visibility,
    status: effectiveStatus,
    duplicateCount: row.duplicate_count,
    origins: JSON.parse(row.origins_json) as string[],
    createdAt: row.created_at,
    expiresAt: row.expires_at,
    reviewedAt: row.reviewed_at,
    reviewer: row.reviewer,
    reviewNote: row.review_note,
    promotedClaimId: row.promoted_claim_id,
  };
}

export function createF3Store(
  database: DatabaseSync,
  dataDir: string,
  write: <T>(run: () => T) => T,
  read: <T>(run: () => T) => T,
  identity: ReturnType<typeof createIdentityStore>,
  cas: ReturnType<typeof createCasStore>,
) {
  const journalPath = join(dataDir, "f3-purge-tombstones.json");

  function readJournal(): F3PurgeJournalEntry[] {
    if (!existsSync(journalPath)) return [];
    try {
      const parsed = JSON.parse(readFileSync(journalPath, "utf8")) as unknown;
      if (!Array.isArray(parsed)) return [];
      return parsed.filter(
        (item): item is F3PurgeJournalEntry =>
          typeof item === "object" &&
          item !== null &&
          typeof (item as F3PurgeJournalEntry).tombstoneId === "string" &&
          typeof (item as F3PurgeJournalEntry).targetKind === "string" &&
          typeof (item as F3PurgeJournalEntry).targetId === "string",
      );
    } catch {
      return [];
    }
  }

  function writeJournal(entries: F3PurgeJournalEntry[]): void {
    mkdirSync(dataDir, { recursive: true });
    const tmp = `${journalPath}.tmp`;
    writeFileSync(tmp, JSON.stringify({ version: 1, entries }, null, 2));
    renameSync(tmp, journalPath);
  }

  function readJournalItems(): F3PurgeJournalEntry[] {
    if (!existsSync(journalPath)) return [];
    try {
      const raw = JSON.parse(readFileSync(journalPath, "utf8")) as {
        entries?: unknown;
      };
      if (!raw || !Array.isArray(raw.entries)) return readJournal();
      return raw.entries as F3PurgeJournalEntry[];
    } catch {
      return [];
    }
  }

  const selectAllTombstones = database.prepare(
    "SELECT tombstone_id, target_kind, target_id, project_id, binding_id, worktree_id, purged_at FROM f3_purge_tombstones ORDER BY purged_at ASC",
  );
  const selectTombstone = database.prepare(
    "SELECT tombstone_id, target_kind, target_id, project_id, binding_id, worktree_id, purged_at FROM f3_purge_tombstones WHERE target_kind = ? AND target_id = ?",
  );
  const insertTombstone = database.prepare(`
    INSERT INTO f3_purge_tombstones (tombstone_id, target_kind, target_id, project_id, binding_id, worktree_id, purged_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(target_kind, target_id) DO NOTHING
  `);

  function syncJournal(): void {
    const rows = selectAllTombstones.all() as TombstoneRow[];
    writeJournal(
      rows.map((row) => ({
        tombstoneId: row.tombstone_id,
        targetKind: row.target_kind,
        targetId: row.target_id,
        projectId: row.project_id,
        bindingId: row.binding_id,
        worktreeId: row.worktree_id,
        purgedAt: row.purged_at,
      })),
    );
  }

  function applyTombstoneSuppression(
    targetKind: PurgeTargetKind,
    targetId: string,
  ): void {
    if (targetKind === "claim") {
      database
        .prepare("DELETE FROM f3_claims WHERE claim_id = ?")
        .run(targetId);
      database
        .prepare("DELETE FROM f3_kgraph_edges WHERE from_id = ? OR to_id = ?")
        .run(targetId, targetId);
    } else if (targetKind === "pin") {
      database
        .prepare("DELETE FROM f3_cas_pins WHERE pin_id = ?")
        .run(targetId);
    } else if (targetKind === "overlay") {
      database
        .prepare("DELETE FROM f3_overlay_blobs WHERE overlay_id = ?")
        .run(targetId);
      database
        .prepare("DELETE FROM f3_dirty_overlays WHERE overlay_id = ?")
        .run(targetId);
    }
  }

  function listProtectedDigestsInternal(): string[] {
    const digests = new Set<string>();
    const activePins = database
      .prepare("SELECT pin_id, digest FROM f3_cas_pins WHERE status = 'active'")
      .all() as { pin_id: string; digest: string }[];
    for (const row of activePins) {
      if (selectTombstone.get("pin", row.pin_id)) continue;
      digests.add(row.digest);
    }
    const overlayBlobs = database
      .prepare("SELECT overlay_id, digest FROM f3_overlay_blobs")
      .all() as { overlay_id: string; digest: string }[];
    for (const row of overlayBlobs) {
      if (selectTombstone.get("overlay", row.overlay_id)) continue;
      digests.add(row.digest);
    }
    // Any active claim whose evidence_ref points to a pin also protects that pin's digest.
    const revRows = database
      .prepare(
        "SELECT claim_id, evidence_ref_json FROM f3_claim_revisions WHERE known_to IS NULL AND evidence_ref_json IS NOT NULL",
      )
      .all() as { claim_id: string; evidence_ref_json: string }[];
    for (const row of revRows) {
      if (selectTombstone.get("claim", row.claim_id)) continue;
      try {
        const ref = JSON.parse(row.evidence_ref_json) as EvidenceAttachmentRef;
        if (ref.kind === "pin") {
          if (selectTombstone.get("pin", ref.pinId)) continue;
          const pin = database
            .prepare("SELECT digest FROM f3_cas_pins WHERE pin_id = ?")
            .get(ref.pinId) as { digest: string } | undefined;
          if (pin) digests.add(pin.digest);
        } else if (ref.kind === "context_excerpt") {
          digests.add(ref.sha256);
        }
      } catch {
        // Ignore unparseable JSON cleanly.
      }
    }
    return [...digests].sort();
  }

  return {
    syncJournal,
    readJournalItems,

    isTombstoned(targetKind: PurgeTargetKind, targetId: string): boolean {
      return Boolean(selectTombstone.get(targetKind, targetId));
    },

    reconcileTombstones(): void {
      const entries = readJournalItems();
      const orphanDigests = new Set<string>();
      write(() => {
        for (const entry of entries) {
          insertTombstone.run(
            entry.tombstoneId,
            entry.targetKind,
            entry.targetId,
            entry.projectId,
            entry.bindingId,
            entry.worktreeId,
            entry.purgedAt,
          );
          if (entry.targetKind === "pin") {
            const p = database
              .prepare("SELECT digest FROM f3_cas_pins WHERE pin_id = ?")
              .get(entry.targetId) as { digest: string } | undefined;
            if (p) orphanDigests.add(p.digest);
          } else if (entry.targetKind === "overlay") {
            const obs = database
              .prepare(
                "SELECT digest FROM f3_overlay_blobs WHERE overlay_id = ?",
              )
              .all(entry.targetId) as { digest: string }[];
            for (const o of obs) orphanDigests.add(o.digest);
          } else if (entry.targetKind === "claim") {
            const revs = database
              .prepare(
                "SELECT evidence_ref_json FROM f3_claim_revisions WHERE claim_id = ? AND evidence_ref_json IS NOT NULL",
              )
              .all(entry.targetId) as { evidence_ref_json: string }[];
            for (const r of revs) {
              try {
                const ref = JSON.parse(
                  r.evidence_ref_json,
                ) as EvidenceAttachmentRef;
                if (ref.kind === "pin") {
                  const p = database
                    .prepare("SELECT digest FROM f3_cas_pins WHERE pin_id = ?")
                    .get(ref.pinId) as { digest: string } | undefined;
                  if (p) orphanDigests.add(p.digest);
                }
              } catch {
                // Ignore malformed JSON cleanly.
              }
            }
          }
          applyTombstoneSuppression(entry.targetKind, entry.targetId);
        }
        const stillTombstoned = selectAllTombstones.all() as TombstoneRow[];
        for (const t of stillTombstoned) {
          applyTombstoneSuppression(t.target_kind, t.target_id);
        }
      });
      if (entries.length > 0) {
        const protectedSet = new Set(listProtectedDigestsInternal());
        for (const d of orphanDigests) {
          if (!protectedSet.has(d)) cas.remove(d);
        }
        syncJournal();
      }
    },

    // ---- Bitemporal Claims & Relations ----

    getClaim(
      scope: IdentityScope,
      claimId: string,
    ): {
      header: ClaimRow;
      revisions: ClaimRevision[];
    } | null {
      return read(() => {
        identity.resolveScope(scope);
        if (selectTombstone.get("claim", claimId)) return null;
        const header = database
          .prepare("SELECT * FROM f3_claims WHERE claim_id = ?")
          .get(claimId) as ClaimRow | undefined;
        if (
          !header ||
          header.project_id !== scope.projectId ||
          header.binding_id !== scope.bindingId ||
          header.worktree_id !== scope.worktreeId
        ) {
          return null;
        }
        const revs = database
          .prepare(
            "SELECT * FROM f3_claim_revisions WHERE claim_id = ? ORDER BY tx_seq ASC, segment_seq ASC",
          )
          .all(claimId) as RevisionRow[];
        return { header, revisions: revs.map(toClaimRevision) };
      });
    },

    findClaimByRequestId(
      scope: IdentityScope,
      requestId: string,
    ): string | null {
      const row = database
        .prepare(
          `SELECT r.claim_id FROM f3_claim_revisions AS r
           JOIN f3_claims AS c ON c.claim_id = r.claim_id
           WHERE c.project_id = ? AND c.binding_id = ? AND c.worktree_id = ? AND r.request_id = ?
           LIMIT 1`,
        )
        .get(scope.projectId, scope.bindingId, scope.worktreeId, requestId) as
        { claim_id: string } | undefined;
      return row?.claim_id ?? null;
    },

    insertClaimWithRevision(params: {
      scope: IdentityScope;
      legacyProjectId: string;
      claimId: string;
      title: string;
      createdAt: string;
      revision: ClaimRevision & { requestId: string };
    }): void {
      write(() => {
        database
          .prepare(
            `INSERT INTO f3_claims (
               claim_id, project_id, binding_id, worktree_id, legacy_project_id,
               title, next_tx_seq, next_segment_seq, created_at
             ) VALUES (?, ?, ?, ?, ?, ?, 2, 2, ?)`,
          )
          .run(
            params.claimId,
            params.scope.projectId,
            params.scope.bindingId,
            params.scope.worktreeId,
            params.legacyProjectId,
            params.title,
            params.createdAt,
          );

        database
          .prepare(
            `INSERT INTO f3_claim_revisions (
               revision_id, claim_id, project_id, binding_id, worktree_id,
               segment_seq, tx_seq, request_id, content, author, reason,
               authority, visibility, conflict_key, conflict_polarity,
               valid_from, valid_to, known_from, known_to,
               supersedes_revision_id, evidence_ref_json, recorded_at
             ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          )
          .run(
            params.revision.revisionId,
            params.claimId,
            params.scope.projectId,
            params.scope.bindingId,
            params.scope.worktreeId,
            params.revision.segmentSeq,
            params.revision.txSeq,
            params.revision.requestId,
            params.revision.content,
            params.revision.author,
            params.revision.reason,
            params.revision.authority,
            params.revision.visibility,
            params.revision.conflictKey,
            params.revision.conflictPolarity,
            params.revision.validFrom,
            params.revision.validTo,
            params.revision.knownFrom,
            params.revision.knownTo,
            params.revision.supersedesRevisionId,
            params.revision.evidenceRef
              ? JSON.stringify(params.revision.evidenceRef)
              : null,
            params.revision.recordedAt,
          );
      });
    },

    applyClaimCorrection(params: {
      scope: IdentityScope;
      claimId: string;
      requestId: string;
      closedRevisionIds: string[];
      knownTo: string;
      nextTxSeq: number;
      nextSegmentSeq: number;
      newRevisions: (ClaimRevision & { requestId: string })[];
    }): void {
      write(() => {
        const closeStmt = database.prepare(
          "UPDATE f3_claim_revisions SET known_to = ? WHERE revision_id = ? AND known_to IS NULL",
        );
        for (const revId of params.closedRevisionIds) {
          closeStmt.run(params.knownTo, revId);
        }
        const insStmt = database.prepare(
          `INSERT INTO f3_claim_revisions (
             revision_id, claim_id, project_id, binding_id, worktree_id,
             segment_seq, tx_seq, request_id, content, author, reason,
             authority, visibility, conflict_key, conflict_polarity,
             valid_from, valid_to, known_from, known_to,
             supersedes_revision_id, evidence_ref_json, recorded_at
           ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        );
        for (const rev of params.newRevisions) {
          insStmt.run(
            rev.revisionId,
            params.claimId,
            params.scope.projectId,
            params.scope.bindingId,
            params.scope.worktreeId,
            rev.segmentSeq,
            rev.txSeq,
            params.requestId,
            rev.content,
            rev.author,
            rev.reason,
            rev.authority,
            rev.visibility,
            rev.conflictKey,
            rev.conflictPolarity,
            rev.validFrom,
            rev.validTo,
            rev.knownFrom,
            rev.knownTo,
            rev.supersedesRevisionId,
            rev.evidenceRef ? JSON.stringify(rev.evidenceRef) : null,
            rev.recordedAt,
          );
        }
        database
          .prepare(
            "UPDATE f3_claims SET next_tx_seq = ?, next_segment_seq = ? WHERE claim_id = ?",
          )
          .run(params.nextTxSeq, params.nextSegmentSeq, params.claimId);
      });
    },

    listAllScopeClaimsAndRevisions(scope: IdentityScope): {
      titles: Map<string, string>;
      revisions: ClaimRevision[];
    } {
      return read(() => {
        identity.resolveScope(scope);
        const claimRows = database
          .prepare(
            "SELECT claim_id, title FROM f3_claims WHERE project_id = ? AND binding_id = ? AND worktree_id = ?",
          )
          .all(scope.projectId, scope.bindingId, scope.worktreeId) as {
          claim_id: string;
          title: string;
        }[];
        const titles = new Map<string, string>();
        for (const c of claimRows) {
          if (!selectTombstone.get("claim", c.claim_id)) {
            titles.set(c.claim_id, c.title);
          }
        }
        const revs = database
          .prepare(
            "SELECT * FROM f3_claim_revisions WHERE project_id = ? AND binding_id = ? AND worktree_id = ? ORDER BY claim_id ASC, tx_seq ASC, segment_seq ASC",
          )
          .all(
            scope.projectId,
            scope.bindingId,
            scope.worktreeId,
          ) as RevisionRow[];
        return {
          titles,
          revisions: revs
            .filter((r) => titles.has(r.claim_id))
            .map(toClaimRevision),
        };
      });
    },

    insertRelation(record: RelationRecord): RelationRecord {
      return write(() => {
        identity.resolveScope(record.scope);
        database
          .prepare(
            `INSERT INTO f3_kgraph_edges (
               relation_id, project_id, binding_id, worktree_id,
               from_id, to_id, kind, signal_kind, rationale, author, known_at
             ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          )
          .run(
            record.relationId,
            record.scope.projectId,
            record.scope.bindingId,
            record.scope.worktreeId,
            record.fromId,
            record.toId,
            record.kind,
            record.signalKind,
            record.rationale,
            record.author,
            record.knownAt,
          );
        return record;
      });
    },

    listRelations(scope: IdentityScope): RelationRecord[] {
      return read(() => {
        identity.resolveScope(scope);
        const rows = database
          .prepare(
            "SELECT * FROM f3_kgraph_edges WHERE project_id = ? AND binding_id = ? AND worktree_id = ? ORDER BY known_at ASC",
          )
          .all(scope.projectId, scope.bindingId, scope.worktreeId) as EdgeRow[];
        return rows
          .filter(
            (row) =>
              !selectTombstone.get("claim", row.from_id) &&
              !selectTombstone.get("claim", row.to_id),
          )
          .map((row) => ({
            relationId: row.relation_id,
            scope,
            fromId: row.from_id,
            toId: row.to_id,
            kind: row.kind,
            signalKind: row.signal_kind,
            rationale: row.rationale,
            author: row.author,
            knownAt: row.known_at,
          }));
      });
    },

    // ---- CAS Pins & Resumable Purge ----

    insertPin(pin: CasPinRecord): CasPinRecord {
      return write(() => {
        identity.resolveScope(pin.scope);
        database
          .prepare(
            `INSERT INTO f3_cas_pins (
               pin_id, project_id, binding_id, worktree_id, label,
               digest, bytes, source_kind, source_context_id, source_path,
               source_chunk, protected_claim_id, status, created_at
             ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          )
          .run(
            pin.pinId,
            pin.scope.projectId,
            pin.scope.bindingId,
            pin.scope.worktreeId,
            pin.label,
            pin.digest,
            pin.bytes,
            pin.sourceKind,
            pin.sourceContextId,
            pin.sourcePath,
            pin.sourceChunk,
            pin.protectedClaimId,
            pin.status,
            pin.createdAt,
          );
        return pin;
      });
    },

    getPin(scope: IdentityScope, pinId: string): CasPinRecord | null {
      return read(() => {
        identity.resolveScope(scope);
        if (selectTombstone.get("pin", pinId)) return null;
        const row = database
          .prepare("SELECT * FROM f3_cas_pins WHERE pin_id = ?")
          .get(pinId) as PinRow | undefined;
        if (
          !row ||
          row.project_id !== scope.projectId ||
          row.binding_id !== scope.bindingId ||
          row.worktree_id !== scope.worktreeId ||
          row.status === "purged"
        ) {
          return null;
        }
        return toPinRecord(row);
      });
    },

    listPins(scope: IdentityScope): CasPinRecord[] {
      return read(() => {
        identity.resolveScope(scope);
        const rows = database
          .prepare(
            "SELECT * FROM f3_cas_pins WHERE project_id = ? AND binding_id = ? AND worktree_id = ? AND status != 'purged' ORDER BY created_at DESC",
          )
          .all(scope.projectId, scope.bindingId, scope.worktreeId) as PinRow[];
        return rows
          .filter((row) => !selectTombstone.get("pin", row.pin_id))
          .map(toPinRecord);
      });
    },

    countActivePinsProtectingClaim(
      claimId: string,
      excludePinId?: string,
    ): number {
      const claimExists = database
        .prepare("SELECT 1 FROM f3_claims WHERE claim_id = ?")
        .get(claimId);
      if (!claimExists) return 0;
      const rows = database
        .prepare(
          "SELECT pin_id FROM f3_cas_pins WHERE protected_claim_id = ? AND status = 'active'",
        )
        .all(claimId) as { pin_id: string }[];
      return rows.filter((r) => r.pin_id !== excludePinId).length;
    },

    countActiveClaimAttachmentsForPin(pinId: string): number {
      const rows = database
        .prepare(
          "SELECT DISTINCT claim_id, evidence_ref_json FROM f3_claim_revisions WHERE known_to IS NULL AND evidence_ref_json IS NOT NULL",
        )
        .all() as { claim_id: string; evidence_ref_json: string }[];
      let count = 0;
      for (const row of rows) {
        if (selectTombstone.get("claim", row.claim_id)) continue;
        try {
          const ref = JSON.parse(
            row.evidence_ref_json,
          ) as EvidenceAttachmentRef;
          if (ref.kind === "pin" && ref.pinId === pinId) count++;
        } catch {
          // ignore
        }
      }
      return count;
    },

    markPinReleased(pinId: string): void {
      write(() => {
        database
          .prepare(
            "UPDATE f3_cas_pins SET status = 'released' WHERE pin_id = ?",
          )
          .run(pinId);
      });
    },

    listProtectedDigests(): string[] {
      return read(() => listProtectedDigestsInternal());
    },

    collectCandidateDigestsForTarget(
      scope: IdentityScope,
      targetKind: PurgeTargetKind,
      targetId: string,
    ): string[] {
      return read(() => {
        const digests = new Set<string>();
        if (targetKind === "pin") {
          const pin = database
            .prepare(
              "SELECT digest FROM f3_cas_pins WHERE pin_id = ? AND project_id = ? AND binding_id = ? AND worktree_id = ?",
            )
            .get(
              targetId,
              scope.projectId,
              scope.bindingId,
              scope.worktreeId,
            ) as { digest: string } | undefined;
          if (pin) digests.add(pin.digest);
        } else if (targetKind === "overlay") {
          const obs = database
            .prepare("SELECT digest FROM f3_overlay_blobs WHERE overlay_id = ?")
            .all(targetId) as { digest: string }[];
          for (const o of obs) digests.add(o.digest);
        } else if (targetKind === "claim") {
          const revs = database
            .prepare(
              "SELECT evidence_ref_json FROM f3_claim_revisions WHERE claim_id = ? AND evidence_ref_json IS NOT NULL",
            )
            .all(targetId) as { evidence_ref_json: string }[];
          for (const r of revs) {
            try {
              const ref = JSON.parse(
                r.evidence_ref_json,
              ) as EvidenceAttachmentRef;
              if (ref.kind === "pin") {
                const pin = database
                  .prepare("SELECT digest FROM f3_cas_pins WHERE pin_id = ?")
                  .get(ref.pinId) as { digest: string } | undefined;
                if (pin) digests.add(pin.digest);
              }
            } catch {
              // ignore
            }
          }
        }
        return [...digests];
      });
    },

    createPurgeJob(params: {
      purgeId: string;
      tombstoneId: string;
      scope: IdentityScope;
      targetKind: PurgeTargetKind;
      targetId: string;
      reason: string;
      candidateDigests: string[];
      startedAt: string;
    }): PurgeJobRecord {
      const job = write(() => {
        identity.resolveScope(params.scope);
        insertTombstone.run(
          params.tombstoneId,
          params.targetKind,
          params.targetId,
          params.scope.projectId,
          params.scope.bindingId,
          params.scope.worktreeId,
          params.startedAt,
        );
        database
          .prepare(
            `INSERT INTO f3_purge_jobs (
               purge_id, tombstone_id, project_id, binding_id, worktree_id,
               target_kind, target_id, stage, state, removed_blobs,
               preserved_shared_blobs, reason, candidate_digests_json,
               started_at, updated_at, completed_at
             ) VALUES (?, ?, ?, ?, ?, ?, ?, 'access_revoked', 'in_progress', 0, 1, ?, ?, ?, ?, NULL)`,
          )
          .run(
            params.purgeId,
            params.tombstoneId,
            params.scope.projectId,
            params.scope.bindingId,
            params.scope.worktreeId,
            params.targetKind,
            params.targetId,
            params.reason,
            JSON.stringify(params.candidateDigests),
            params.startedAt,
            params.startedAt,
          );
        return database
          .prepare("SELECT * FROM f3_purge_jobs WHERE purge_id = ?")
          .get(params.purgeId) as PurgeJobRow;
      });
      syncJournal();
      return toPurgeJobRecord(job);
    },

    getPurgeJob(
      scope: IdentityScope,
      purgeId: string,
    ): { job: PurgeJobRecord; candidateDigests: string[] } | null {
      return read(() => {
        identity.resolveScope(scope);
        const row = database
          .prepare("SELECT * FROM f3_purge_jobs WHERE purge_id = ?")
          .get(purgeId) as PurgeJobRow | undefined;
        if (
          !row ||
          row.project_id !== scope.projectId ||
          row.binding_id !== scope.bindingId ||
          row.worktree_id !== scope.worktreeId
        ) {
          return null;
        }
        return {
          job: toPurgeJobRecord(row),
          candidateDigests: JSON.parse(row.candidate_digests_json) as string[],
        };
      });
    },

    advancePurgeStage(params: {
      purgeId: string;
      stage: PurgeStage;
      state: "in_progress" | "completed";
      removedBlobs: number;
      preservedSharedBlobs: boolean;
      updatedAt: string;
      completedAt: string | null;
      clearTarget?: { kind: PurgeTargetKind; id: string };
    }): PurgeJobRecord {
      const row = write(() => {
        if (params.clearTarget) {
          applyTombstoneSuppression(
            params.clearTarget.kind,
            params.clearTarget.id,
          );
        }
        database
          .prepare(
            `UPDATE f3_purge_jobs
             SET stage = ?, state = ?, removed_blobs = ?, preserved_shared_blobs = ?, updated_at = ?, completed_at = ?
             WHERE purge_id = ?`,
          )
          .run(
            params.stage,
            params.state,
            params.removedBlobs,
            params.preservedSharedBlobs ? 1 : 0,
            params.updatedAt,
            params.completedAt,
            params.purgeId,
          );
        return database
          .prepare("SELECT * FROM f3_purge_jobs WHERE purge_id = ?")
          .get(params.purgeId) as PurgeJobRow;
      });
      return toPurgeJobRecord(row);
    },

    // ---- Inbox & Governed Export ----

    upsertInboxProposal(params: {
      proposalId: string;
      scope: IdentityScope;
      fingerprint: string;
      title: string;
      content: string;
      targetKind: "claim" | "preference";
      visibility: MemoryVisibility;
      originLabel: string;
      createdAt: string;
      expiresAt: string;
    }): InboxProposalRecord {
      return write(() => {
        identity.resolveScope(params.scope);
        const existing = database
          .prepare(
            `SELECT * FROM f3_inbox_proposals
             WHERE project_id = ? AND binding_id = ? AND worktree_id = ?
               AND fingerprint = ? AND status = 'pending'`,
          )
          .get(
            params.scope.projectId,
            params.scope.bindingId,
            params.scope.worktreeId,
            params.fingerprint,
          ) as InboxRow | undefined;

        if (
          existing &&
          Date.parse(params.createdAt) < Date.parse(existing.expires_at)
        ) {
          const origins = JSON.parse(existing.origins_json) as string[];
          if (!origins.includes(params.originLabel)) {
            origins.push(params.originLabel);
          }
          database
            .prepare(
              `UPDATE f3_inbox_proposals
               SET duplicate_count = duplicate_count + 1, origins_json = ?
               WHERE proposal_id = ?`,
            )
            .run(JSON.stringify(origins), existing.proposal_id);
          const updated = database
            .prepare("SELECT * FROM f3_inbox_proposals WHERE proposal_id = ?")
            .get(existing.proposal_id) as InboxRow;
          return toInboxRecord(updated, params.createdAt);
        }

        database
          .prepare(
            `INSERT INTO f3_inbox_proposals (
               proposal_id, project_id, binding_id, worktree_id, fingerprint,
               title, content, target_kind, visibility, status,
               duplicate_count, origins_json, created_at, expires_at,
               reviewed_at, reviewer, review_note, promoted_claim_id
             ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', 1, ?, ?, ?, NULL, NULL, NULL, NULL)`,
          )
          .run(
            params.proposalId,
            params.scope.projectId,
            params.scope.bindingId,
            params.scope.worktreeId,
            params.fingerprint,
            params.title,
            params.content,
            params.targetKind,
            params.visibility,
            JSON.stringify([params.originLabel]),
            params.createdAt,
            params.expiresAt,
          );
        const inserted = database
          .prepare("SELECT * FROM f3_inbox_proposals WHERE proposal_id = ?")
          .get(params.proposalId) as InboxRow;
        return toInboxRecord(inserted, params.createdAt);
      });
    },

    listInbox(scope: IdentityScope, nowIso: string): InboxProposalRecord[] {
      return read(() => {
        identity.resolveScope(scope);
        const rows = database
          .prepare(
            "SELECT * FROM f3_inbox_proposals WHERE project_id = ? AND binding_id = ? AND worktree_id = ? ORDER BY created_at DESC",
          )
          .all(
            scope.projectId,
            scope.bindingId,
            scope.worktreeId,
          ) as InboxRow[];
        return rows.map((row) => toInboxRecord(row, nowIso));
      });
    },

    reviewInboxProposal(params: {
      scope: IdentityScope;
      proposalId: string;
      decision: "approve" | "reject";
      reviewer: string;
      note: string;
      nowIso: string;
      feedbackId: string;
      promotedClaim?: {
        claimId: string;
        legacyProjectId: string;
        revisionId: string;
        requestId: string;
        authority: MemoryAuthority;
        visibility: MemoryVisibility;
        validFrom: string;
      };
    }): {
      proposal: InboxProposalRecord;
      feedback: LocalFeedbackRecord;
    } {
      return write(() => {
        identity.resolveScope(params.scope);
        const row = database
          .prepare("SELECT * FROM f3_inbox_proposals WHERE proposal_id = ?")
          .get(params.proposalId) as InboxRow | undefined;
        if (
          !row ||
          row.project_id !== params.scope.projectId ||
          row.binding_id !== params.scope.bindingId ||
          row.worktree_id !== params.scope.worktreeId
        ) {
          throw new GitError("memory_not_found");
        }
        const current = toInboxRecord(row, params.nowIso);
        if (current.status === "expired") {
          database
            .prepare(
              "UPDATE f3_inbox_proposals SET status = 'expired' WHERE proposal_id = ?",
            )
            .run(params.proposalId);
          throw new GitError("memory_conflict");
        }
        if (current.status !== "pending") {
          throw new GitError("memory_conflict");
        }

        const nextStatus =
          params.decision === "approve" ? "approved" : "rejected";
        if (params.decision === "approve" && params.promotedClaim) {
          database
            .prepare(
              `INSERT INTO f3_claims (
                 claim_id, project_id, binding_id, worktree_id, legacy_project_id,
                 title, next_tx_seq, next_segment_seq, created_at
               ) VALUES (?, ?, ?, ?, ?, ?, 2, 2, ?)`,
            )
            .run(
              params.promotedClaim.claimId,
              params.scope.projectId,
              params.scope.bindingId,
              params.scope.worktreeId,
              params.promotedClaim.legacyProjectId,
              row.title,
              params.nowIso,
            );
          database
            .prepare(
              `INSERT INTO f3_claim_revisions (
                 revision_id, claim_id, project_id, binding_id, worktree_id,
                 segment_seq, tx_seq, request_id, content, author, reason,
                 authority, visibility, conflict_key, conflict_polarity,
                 valid_from, valid_to, known_from, known_to,
                 supersedes_revision_id, evidence_ref_json, recorded_at
               ) VALUES (?, ?, ?, ?, ?, 1, 1, ?, ?, ?, ?, ?, ?, NULL, NULL, ?, NULL, ?, NULL, NULL, NULL, ?)`,
            )
            .run(
              params.promotedClaim.revisionId,
              params.promotedClaim.claimId,
              params.scope.projectId,
              params.scope.bindingId,
              params.scope.worktreeId,
              params.promotedClaim.requestId,
              row.content,
              params.reviewer,
              params.note,
              params.promotedClaim.authority,
              params.promotedClaim.visibility,
              params.promotedClaim.validFrom,
              params.nowIso,
              params.nowIso,
            );
        }

        database
          .prepare(
            `UPDATE f3_inbox_proposals
             SET status = ?, reviewed_at = ?, reviewer = ?, review_note = ?, promoted_claim_id = ?
             WHERE proposal_id = ?`,
          )
          .run(
            nextStatus,
            params.nowIso,
            params.reviewer,
            params.note,
            params.promotedClaim?.claimId ?? null,
            params.proposalId,
          );

        database
          .prepare(
            `INSERT INTO f3_local_feedback (
               feedback_id, project_id, binding_id, worktree_id,
               proposal_id, decision, reviewer, note, recorded_at
             ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          )
          .run(
            params.feedbackId,
            params.scope.projectId,
            params.scope.bindingId,
            params.scope.worktreeId,
            params.proposalId,
            params.decision,
            params.reviewer,
            params.note,
            params.nowIso,
          );

        const updated = database
          .prepare("SELECT * FROM f3_inbox_proposals WHERE proposal_id = ?")
          .get(params.proposalId) as InboxRow;
        return {
          proposal: toInboxRecord(updated),
          feedback: {
            feedbackId: params.feedbackId,
            scope: params.scope,
            proposalId: params.proposalId,
            decision: params.decision,
            reviewer: params.reviewer,
            note: params.note,
            recordedAt: params.nowIso,
          },
        };
      });
    },

    insertExportException(
      record: ExportExceptionRecord,
    ): ExportExceptionRecord {
      return write(() => {
        identity.resolveScope(record.scope);
        database
          .prepare(
            `INSERT INTO f3_export_exceptions (
               exception_id, project_id, binding_id, worktree_id,
               bundle_digest, destination_id, policy_version,
               reviewer, reason, granted_at
             ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          )
          .run(
            record.exceptionId,
            record.scope.projectId,
            record.scope.bindingId,
            record.scope.worktreeId,
            record.bundleDigest,
            record.destinationId,
            record.policyVersion,
            record.reviewer,
            record.reason,
            record.grantedAt,
          );
        return record;
      });
    },

    getExportException(
      scope: IdentityScope,
      exceptionId: string,
    ): ExportExceptionRecord | null {
      return read(() => {
        identity.resolveScope(scope);
        const row = database
          .prepare("SELECT * FROM f3_export_exceptions WHERE exception_id = ?")
          .get(exceptionId) as ExceptionRow | undefined;
        if (
          !row ||
          row.project_id !== scope.projectId ||
          row.binding_id !== scope.bindingId ||
          row.worktree_id !== scope.worktreeId
        ) {
          return null;
        }
        return {
          exceptionId: row.exception_id,
          scope,
          bundleDigest: row.bundle_digest,
          destinationId: row.destination_id,
          policyVersion: row.policy_version,
          reviewer: row.reviewer,
          reason: row.reason,
          grantedAt: row.granted_at,
        };
      });
    },

    insertExportAudit(record: ExportAuditRecord): ExportAuditRecord {
      return write(() => {
        identity.resolveScope(record.scope);
        database
          .prepare(
            `INSERT INTO f3_export_audits (
               export_id, project_id, binding_id, worktree_id,
               bundle_digest, destination_id, policy_version,
               exception_id, exported_count, item_digests_json, executed_at
             ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          )
          .run(
            record.exportId,
            record.scope.projectId,
            record.scope.bindingId,
            record.scope.worktreeId,
            record.bundleDigest,
            record.destinationId,
            record.policyVersion,
            record.exceptionId,
            record.exportedCount,
            JSON.stringify(record.itemDigests),
            record.executedAt,
          );
        return record;
      });
    },

    // ---- Dirty Overlays ----

    insertOverlay(
      manifest: DirtyOverlayManifest,
      blobs: { digest: string; bytes: number }[],
    ): DirtyOverlayManifest {
      return write(() => {
        identity.resolveScope(manifest.scope);
        database
          .prepare(
            `INSERT INTO f3_dirty_overlays (
               overlay_id, project_id, binding_id, worktree_id,
               label, head, branch, captured_at, manifest_digest,
               file_count, gap_count, manifest_json
             ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          )
          .run(
            manifest.overlayId,
            manifest.scope.projectId,
            manifest.scope.bindingId,
            manifest.scope.worktreeId,
            manifest.label,
            manifest.head,
            manifest.branch,
            manifest.capturedAt,
            manifest.manifestDigest,
            manifest.files.length,
            manifest.gaps.length,
            JSON.stringify(manifest),
          );
        const insBlob = database.prepare(
          "INSERT INTO f3_overlay_blobs (overlay_id, digest, bytes) VALUES (?, ?, ?)",
        );
        for (const blob of blobs) {
          insBlob.run(manifest.overlayId, blob.digest, blob.bytes);
        }
        return manifest;
      });
    },

    getOverlay(
      scope: IdentityScope,
      overlayId: string,
    ): DirtyOverlayManifest | null {
      return read(() => {
        identity.resolveScope(scope);
        if (selectTombstone.get("overlay", overlayId)) return null;
        const row = database
          .prepare("SELECT * FROM f3_dirty_overlays WHERE overlay_id = ?")
          .get(overlayId) as OverlayRow | undefined;
        if (
          !row ||
          row.project_id !== scope.projectId ||
          row.binding_id !== scope.bindingId ||
          row.worktree_id !== scope.worktreeId
        ) {
          return null;
        }
        return JSON.parse(row.manifest_json) as DirtyOverlayManifest;
      });
    },

    listOverlays(scope: IdentityScope): DirtyOverlaySummary[] {
      return read(() => {
        identity.resolveScope(scope);
        const rows = database
          .prepare(
            "SELECT * FROM f3_dirty_overlays WHERE project_id = ? AND binding_id = ? AND worktree_id = ? ORDER BY captured_at DESC",
          )
          .all(
            scope.projectId,
            scope.bindingId,
            scope.worktreeId,
          ) as OverlayRow[];
        return rows
          .filter((row) => !selectTombstone.get("overlay", row.overlay_id))
          .map((row) => ({
            overlayId: row.overlay_id,
            scope,
            label: row.label,
            head: row.head,
            branch: row.branch,
            capturedAt: row.captured_at,
            manifestDigest: row.manifest_digest,
            fileCount: row.file_count,
            gapCount: row.gap_count,
            stability: "occ_verified" as const,
          }));
      });
    },
  };
}
