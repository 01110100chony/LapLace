import { randomBytes } from "node:crypto";
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
  DecisionDetailResult,
  DecisionListResult,
  DecisionPurgeInput,
  DecisionPurgeReceipt,
  DecisionRecordInput,
  IdentityScope,
  ResumeDecision,
  ResumeEvidence,
} from "@laplace/contracts";
import { rankActiveDecisions } from "@laplace/core";
import type { createEvidenceAdapter } from "./evidence-adapter.ts";
import { GitError } from "./git.ts";
import type { createIdentityStore } from "./identity-store.ts";

export const decisionMigration = `
  CREATE TABLE decisions (
    assertion_id TEXT PRIMARY KEY NOT NULL,
    project_id TEXT NOT NULL REFERENCES logical_projects(id),
    binding_id TEXT NOT NULL REFERENCES local_repo_bindings(id),
    worktree_id TEXT NOT NULL REFERENCES worktrees(id),
    legacy_project_id TEXT NOT NULL REFERENCES projects(id),
    current_revision INTEGER NOT NULL CHECK (current_revision > 0),
    status TEXT NOT NULL CHECK (status IN ('active', 'superseded')),
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  ) STRICT;

  CREATE INDEX decisions_scope
    ON decisions (project_id, binding_id, worktree_id, updated_at DESC);

  CREATE TABLE decision_revisions (
    revision_id TEXT PRIMARY KEY NOT NULL,
    assertion_id TEXT NOT NULL REFERENCES decisions(assertion_id) ON DELETE CASCADE,
    revision INTEGER NOT NULL CHECK (revision > 0),
    request_id TEXT NOT NULL,
    content TEXT NOT NULL,
    author TEXT NOT NULL,
    reason TEXT NOT NULL,
    authority TEXT NOT NULL CHECK (authority IN ('human_local', 'human_promoted')),
    visibility TEXT NOT NULL CHECK (visibility IN ('local_only', 'canonical_verified')),
    status TEXT NOT NULL CHECK (status IN ('active', 'superseded')),
    effective_at TEXT NOT NULL,
    recorded_at TEXT NOT NULL,
    UNIQUE (assertion_id, revision),
    UNIQUE (assertion_id, request_id)
  ) STRICT;

  CREATE TABLE decision_evidence_links (
    revision_id TEXT PRIMARY KEY NOT NULL REFERENCES decision_revisions(revision_id) ON DELETE CASCADE,
    assertion_id TEXT NOT NULL REFERENCES decisions(assertion_id) ON DELETE CASCADE,
    context_id TEXT NOT NULL REFERENCES context_snapshots(context_id),
    path TEXT NOT NULL,
    sha256 TEXT NOT NULL CHECK (length(sha256) = 64),
    chunk INTEGER NOT NULL CHECK (chunk >= 0),
    linked_at TEXT NOT NULL
  ) STRICT;

  CREATE TABLE decision_purge_tombstones (
    tombstone_id TEXT PRIMARY KEY NOT NULL,
    assertion_id TEXT NOT NULL UNIQUE,
    project_id TEXT NOT NULL,
    binding_id TEXT NOT NULL,
    worktree_id TEXT NOT NULL,
    purged_revision INTEGER NOT NULL CHECK (purged_revision > 0),
    purged_at TEXT NOT NULL
  ) STRICT;
`;

export type PurgeJournalEntry = {
  tombstoneId: string;
  assertionId: string;
  projectId: string;
  bindingId: string;
  worktreeId: string;
  purgedRevision: number;
  purgedAt: string;
};

type DecisionHeaderRow = {
  assertion_id: string;
  project_id: string;
  binding_id: string;
  worktree_id: string;
  current_revision: number;
  status: "active" | "superseded";
};

type RevisionJoinRow = {
  revision_id: string;
  assertion_id: string;
  revision: number;
  request_id: string;
  content: string;
  author: string;
  reason: string;
  authority: "human_local" | "human_promoted";
  visibility: "local_only" | "canonical_verified";
  status: "active" | "superseded";
  effective_at: string;
  recorded_at: string;
  context_id: string | null;
  evidence_path: string | null;
  evidence_sha256: string | null;
  evidence_chunk: number | null;
};

type TombstoneRow = {
  tombstone_id: string;
  assertion_id: string;
  project_id: string;
  binding_id: string;
  worktree_id: string;
  purged_revision: number;
  purged_at: string;
};

function newId() {
  return randomBytes(32).toString("hex");
}

function nowIso() {
  return new Date().toISOString();
}

function scopeKey(scope: IdentityScope) {
  return `${scope.projectId}:${scope.bindingId}:${scope.worktreeId}`;
}

function noSourceEvidence(): ResumeEvidence {
  return {
    state: "gap",
    coverage: "none",
    durability: "none",
    sourceOrigin: "none",
    capturedAt: null,
    excerptDigest: null,
    ref: null,
    gap: "no_source_attached",
  };
}

export function createDecisionStore(
  database: DatabaseSync,
  dataDir: string,
  write: <T>(run: () => T) => T,
  read: <T>(run: () => T) => T,
  identity: ReturnType<typeof createIdentityStore>,
  evidenceAdapter: ReturnType<typeof createEvidenceAdapter>,
) {
  const journalPath = join(dataDir, "purge-tombstones.json");
  const purgeEpochs = new Map<string, number>();

  const selectDecision = database.prepare(`
    SELECT assertion_id, project_id, binding_id, worktree_id, current_revision, status
    FROM decisions
    WHERE assertion_id = ?
  `);

  const selectTombstone = database.prepare(`
    SELECT tombstone_id, assertion_id, project_id, binding_id, worktree_id, purged_revision, purged_at
    FROM decision_purge_tombstones
    WHERE assertion_id = ?
  `);

  const selectAllTombstones = database.prepare(`
    SELECT tombstone_id, assertion_id, project_id, binding_id, worktree_id, purged_revision, purged_at
    FROM decision_purge_tombstones
    ORDER BY purged_at ASC, tombstone_id ASC
  `);

  const selectReplayByScopeRequest = database.prepare(`
    SELECT
      r.revision_id, r.assertion_id, r.revision, r.request_id, r.content, r.author, r.reason,
      r.authority, r.visibility, r.status, r.effective_at, r.recorded_at,
      l.context_id, l.path AS evidence_path, l.sha256 AS evidence_sha256, l.chunk AS evidence_chunk
    FROM decision_revisions AS r
    JOIN decisions AS d ON d.assertion_id = r.assertion_id
    LEFT JOIN decision_evidence_links AS l ON l.revision_id = r.revision_id
    WHERE d.project_id = ? AND d.binding_id = ? AND d.worktree_id = ?
      AND r.request_id = ? AND r.revision = 1
  `);

  const selectReplayByAssertionRequest = database.prepare(`
    SELECT
      r.revision_id, r.assertion_id, r.revision, r.request_id, r.content, r.author, r.reason,
      r.authority, r.visibility, r.status, r.effective_at, r.recorded_at,
      l.context_id, l.path AS evidence_path, l.sha256 AS evidence_sha256, l.chunk AS evidence_chunk
    FROM decision_revisions AS r
    LEFT JOIN decision_evidence_links AS l ON l.revision_id = r.revision_id
    WHERE r.assertion_id = ? AND r.request_id = ?
  `);

  const selectActiveByScope = database.prepare(`
    SELECT
      r.revision_id, r.assertion_id, r.revision, r.request_id, r.content, r.author, r.reason,
      r.authority, r.visibility, r.status, r.effective_at, r.recorded_at,
      l.context_id, l.path AS evidence_path, l.sha256 AS evidence_sha256, l.chunk AS evidence_chunk
    FROM decisions AS d
    JOIN decision_revisions AS r
      ON r.assertion_id = d.assertion_id AND r.revision = d.current_revision
    LEFT JOIN decision_evidence_links AS l ON l.revision_id = r.revision_id
    WHERE d.project_id = ? AND d.binding_id = ? AND d.worktree_id = ? AND r.status = 'active'
    ORDER BY r.recorded_at DESC, d.assertion_id ASC
  `);

  const selectRevisionsByAssertion = database.prepare(`
    SELECT
      r.revision_id, r.assertion_id, r.revision, r.request_id, r.content, r.author, r.reason,
      r.authority, r.visibility, r.status, r.effective_at, r.recorded_at,
      l.context_id, l.path AS evidence_path, l.sha256 AS evidence_sha256, l.chunk AS evidence_chunk
    FROM decision_revisions AS r
    LEFT JOIN decision_evidence_links AS l ON l.revision_id = r.revision_id
    WHERE r.assertion_id = ?
    ORDER BY r.revision ASC
  `);

  const insertDecision = database.prepare(`
    INSERT INTO decisions (
      assertion_id, project_id, binding_id, worktree_id, legacy_project_id,
      current_revision, status, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, 'active', ?, ?)
  `);

  const updateDecisionRevision = database.prepare(`
    UPDATE decisions SET current_revision = ?, updated_at = ? WHERE assertion_id = ?
  `);

  const supersedeRevisions = database.prepare(`
    UPDATE decision_revisions SET status = 'superseded'
    WHERE assertion_id = ? AND status = 'active'
  `);

  const insertRevision = database.prepare(`
    INSERT INTO decision_revisions (
      revision_id, assertion_id, revision, request_id, content, author, reason,
      authority, visibility, status, effective_at, recorded_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'active', ?, ?)
  `);

  const insertEvidenceLink = database.prepare(`
    INSERT INTO decision_evidence_links (
      revision_id, assertion_id, context_id, path, sha256, chunk, linked_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?)
  `);

  const insertTombstone = database.prepare(`
    INSERT OR IGNORE INTO decision_purge_tombstones (
      tombstone_id, assertion_id, project_id, binding_id, worktree_id, purged_revision, purged_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?)
  `);

  const deleteLinksByAssertion = database.prepare(
    "DELETE FROM decision_evidence_links WHERE assertion_id = ?",
  );
  const deleteRevisionsByAssertion = database.prepare(
    "DELETE FROM decision_revisions WHERE assertion_id = ?",
  );
  const deleteDecisionByAssertion = database.prepare(
    "DELETE FROM decisions WHERE assertion_id = ?",
  );

  function readJournal(): PurgeJournalEntry[] {
    if (!existsSync(journalPath)) return [];
    const parsed: unknown = JSON.parse(readFileSync(journalPath, "utf8"));
    return Array.isArray(parsed) ? (parsed as PurgeJournalEntry[]) : [];
  }

  function writeJournal(entries: PurgeJournalEntry[]): void {
    mkdirSync(dataDir, { recursive: true });
    const tempPath = join(
      dataDir,
      `purge-tombstones.${randomBytes(8).toString("hex")}.tmp`,
    );
    writeFileSync(tempPath, JSON.stringify(entries, null, 2), "utf8");
    renameSync(tempPath, journalPath);
  }

  function hydrateEvidence(
    scope: IdentityScope,
    row: RevisionJoinRow,
  ): ResumeEvidence {
    if (
      row.context_id === null ||
      row.evidence_path === null ||
      row.evidence_sha256 === null ||
      row.evidence_chunk === null
    ) {
      return noSourceEvidence();
    }
    try {
      return evidenceAdapter.resolve(scope, {
        contextId: row.context_id,
        path: row.evidence_path,
        sha256: row.evidence_sha256,
        chunk: row.evidence_chunk,
      }).evidence;
    } catch (error) {
      if (
        !(error instanceof GitError) ||
        error.code !== "context_source_unavailable"
      ) {
        throw error;
      }
      return {
        state: "gap",
        coverage: "none",
        durability: "missing_blob",
        sourceOrigin: "context_capture",
        capturedAt: null,
        excerptDigest: null,
        ref: {
          projectId: scope.projectId,
          contextId: row.context_id,
          path: row.evidence_path,
          sha256: row.evidence_sha256,
          chunk: row.evidence_chunk,
        },
        gap: "source_unavailable",
      };
    }
  }

  function toResumeDecision(
    scope: IdentityScope,
    row: RevisionJoinRow,
  ): ResumeDecision {
    return {
      assertionId: row.assertion_id,
      revisionId: row.revision_id,
      revision: row.revision,
      projectId: scope.projectId,
      content: row.content,
      author: row.author,
      authority: row.authority,
      visibility: row.visibility,
      status: row.status,
      effectiveAt: row.effective_at,
      recordedAt: row.recorded_at,
      sourceOrigin: "human_decision",
      evidence: hydrateEvidence(scope, row),
    };
  }

  const selectTombstoneCountByScope = database.prepare(`
    SELECT COUNT(*) AS count
    FROM decision_purge_tombstones
    WHERE project_id = ? AND binding_id = ? AND worktree_id = ?
  `);

  function sameReplayPayload(
    row: RevisionJoinRow,
    input: DecisionRecordInput,
    authority: "human_local" | "human_promoted",
    visibility: "local_only" | "canonical_verified",
  ) {
    const sameRef =
      input.evidence === null
        ? row.context_id === null
        : row.context_id === input.evidence.contextId &&
          row.evidence_path === input.evidence.path &&
          row.evidence_sha256 === input.evidence.sha256 &&
          row.evidence_chunk === input.evidence.chunk;
    return (
      row.revision === input.expectedRevision + 1 &&
      row.content === input.content &&
      row.author === input.author &&
      row.reason === input.reason &&
      row.authority === authority &&
      row.visibility === visibility &&
      (input.effectiveAt === undefined ||
        row.effective_at === input.effectiveAt) &&
      sameRef
    );
  }

  return {
    getPurgeEpoch(scope: IdentityScope): number {
      return purgeEpochs.get(scopeKey(scope)) ?? 0;
    },

    countTombstones(scope: IdentityScope): number {
      const row = selectTombstoneCountByScope.get(
        scope.projectId,
        scope.bindingId,
        scope.worktreeId,
      ) as { count: number } | undefined;
      return Number(row?.count ?? 0);
    },

    reconcileTombstones(): void {
      const fromJournal = readJournal();
      const fromDb = selectAllTombstones.all() as TombstoneRow[];
      const merged = new Map<string, PurgeJournalEntry>();

      for (const entry of fromJournal) {
        merged.set(entry.assertionId, entry);
      }
      for (const row of fromDb) {
        if (!merged.has(row.assertion_id)) {
          merged.set(row.assertion_id, {
            tombstoneId: row.tombstone_id,
            assertionId: row.assertion_id,
            projectId: row.project_id,
            bindingId: row.binding_id,
            worktreeId: row.worktree_id,
            purgedRevision: row.purged_revision,
            purgedAt: row.purged_at,
          });
        }
      }

      if (merged.size === 0) return;

      write(() => {
        for (const entry of merged.values()) {
          insertTombstone.run(
            entry.tombstoneId,
            entry.assertionId,
            entry.projectId,
            entry.bindingId,
            entry.worktreeId,
            entry.purgedRevision,
            entry.purgedAt,
          );
          deleteLinksByAssertion.run(entry.assertionId);
          deleteRevisionsByAssertion.run(entry.assertionId);
          deleteDecisionByAssertion.run(entry.assertionId);
        }
      });

      if (fromJournal.length !== merged.size) {
        writeJournal([...merged.values()]);
      }
    },

    record(input: DecisionRecordInput): ResumeDecision {
      if (!input.humanConfirmed) {
        throw new GitError("decision_authorization_required");
      }
      const scope: IdentityScope = {
        projectId: input.projectId,
        bindingId: input.bindingId,
        worktreeId: input.worktreeId,
      };
      const authority: "human_local" | "human_promoted" = input.promoteCanonical
        ? "human_promoted"
        : "human_local";
      const visibility: "local_only" | "canonical_verified" =
        input.promoteCanonical ? "canonical_verified" : "local_only";

      return write(() => {
        const worktree = identity.resolveScope(scope);

        const resolvedEvidence =
          input.evidence !== null
            ? evidenceAdapter.resolve(scope, input.evidence)
            : null;

        if (
          resolvedEvidence &&
          resolvedEvidence.evidence.state !== "verified"
        ) {
          throw new GitError("context_source_unavailable");
        }

        if (
          input.promoteCanonical &&
          (!resolvedEvidence || resolvedEvidence.evidence.state !== "verified")
        ) {
          throw new GitError("decision_conflict");
        }

        let recordedRow: RevisionJoinRow;
        if (input.assertionId !== null) {
          const tombstone = selectTombstone.get(input.assertionId) as
            TombstoneRow | undefined;
          if (tombstone) throw new GitError("decision_unavailable");

          const existing = selectDecision.get(input.assertionId) as
            DecisionHeaderRow | undefined;
          if (
            !existing ||
            existing.project_id !== scope.projectId ||
            existing.binding_id !== scope.bindingId ||
            existing.worktree_id !== scope.worktreeId
          ) {
            throw new GitError("decision_unavailable");
          }

          const replay = selectReplayByAssertionRequest.get(
            input.assertionId,
            input.requestId,
          ) as RevisionJoinRow | undefined;
          if (replay) {
            if (!sameReplayPayload(replay, input, authority, visibility)) {
              throw new GitError("decision_conflict");
            }
            return toResumeDecision(scope, replay);
          }

          if (existing.current_revision !== input.expectedRevision) {
            throw new GitError("decision_conflict");
          }

          const nextRevision = existing.current_revision + 1;
          const recordedAt = nowIso();
          const effectiveAt = input.effectiveAt ?? recordedAt;
          const revisionId = newId();

          supersedeRevisions.run(input.assertionId);
          updateDecisionRevision.run(
            nextRevision,
            recordedAt,
            input.assertionId,
          );
          insertRevision.run(
            revisionId,
            input.assertionId,
            nextRevision,
            input.requestId,
            input.content,
            input.author,
            input.reason,
            authority,
            visibility,
            effectiveAt,
            recordedAt,
          );
          if (input.evidence !== null) {
            insertEvidenceLink.run(
              revisionId,
              input.assertionId,
              input.evidence.contextId,
              input.evidence.path,
              input.evidence.sha256,
              input.evidence.chunk,
              recordedAt,
            );
          }

          recordedRow = selectReplayByAssertionRequest.get(
            input.assertionId,
            input.requestId,
          ) as RevisionJoinRow;
        } else {
          if (input.expectedRevision !== 0) {
            throw new GitError("decision_conflict");
          }

          const createReplay = selectReplayByScopeRequest.get(
            scope.projectId,
            scope.bindingId,
            scope.worktreeId,
            input.requestId,
          ) as RevisionJoinRow | undefined;
          if (createReplay) {
            if (
              !sameReplayPayload(createReplay, input, authority, visibility)
            ) {
              throw new GitError("decision_conflict");
            }
            return toResumeDecision(scope, createReplay);
          }

          const assertionId = newId();
          const revisionId = newId();
          const recordedAt = nowIso();
          const effectiveAt = input.effectiveAt ?? recordedAt;

          insertDecision.run(
            assertionId,
            scope.projectId,
            scope.bindingId,
            scope.worktreeId,
            worktree.legacyProjectId,
            1,
            recordedAt,
            recordedAt,
          );
          insertRevision.run(
            revisionId,
            assertionId,
            1,
            input.requestId,
            input.content,
            input.author,
            input.reason,
            authority,
            visibility,
            effectiveAt,
            recordedAt,
          );
          if (input.evidence !== null) {
            insertEvidenceLink.run(
              revisionId,
              assertionId,
              input.evidence.contextId,
              input.evidence.path,
              input.evidence.sha256,
              input.evidence.chunk,
              recordedAt,
            );
          }

          recordedRow = selectReplayByAssertionRequest.get(
            assertionId,
            input.requestId,
          ) as RevisionJoinRow;
        }

        return toResumeDecision(scope, recordedRow);
      });
    },

    list(scope: IdentityScope): DecisionListResult {
      return read(() => {
        identity.resolveScope(scope);
        const rows = selectActiveByScope.all(
          scope.projectId,
          scope.bindingId,
          scope.worktreeId,
        ) as RevisionJoinRow[];
        const items = rankActiveDecisions(
          rows.map((row) => toResumeDecision(scope, row)),
          scope.projectId,
        );
        return {
          scope,
          active: items[0] ?? null,
          items,
        };
      });
    },

    get(scope: IdentityScope, assertionId: string): DecisionDetailResult {
      return read(() => {
        identity.resolveScope(scope);
        const tombstone = selectTombstone.get(assertionId) as
          TombstoneRow | undefined;
        if (tombstone) throw new GitError("decision_unavailable");

        const header = selectDecision.get(assertionId) as
          DecisionHeaderRow | undefined;
        if (
          !header ||
          header.project_id !== scope.projectId ||
          header.binding_id !== scope.bindingId ||
          header.worktree_id !== scope.worktreeId
        ) {
          throw new GitError("decision_unavailable");
        }

        const rows = selectRevisionsByAssertion.all(
          assertionId,
        ) as RevisionJoinRow[];
        return {
          scope,
          assertionId,
          revisions: rows.map((row) => toResumeDecision(scope, row)),
        };
      });
    },

    purge(input: DecisionPurgeInput): DecisionPurgeReceipt {
      if (!input.confirmedScope) {
        throw new GitError("decision_authorization_required");
      }
      const scope: IdentityScope = {
        projectId: input.projectId,
        bindingId: input.bindingId,
        worktreeId: input.worktreeId,
      };

      const receipt = write(() => {
        identity.resolveScope(scope);
        const existingTombstone = selectTombstone.get(input.assertionId) as
          TombstoneRow | undefined;
        if (existingTombstone) {
          if (
            existingTombstone.project_id !== scope.projectId ||
            existingTombstone.binding_id !== scope.bindingId ||
            existingTombstone.worktree_id !== scope.worktreeId
          ) {
            throw new GitError("decision_unavailable");
          }
          return {
            scope,
            assertionId: input.assertionId,
            purgedRevision: existingTombstone.purged_revision,
            status: "already_purged" as const,
            purgedAt: existingTombstone.purged_at,
            removed: { revisions: 0, evidenceLinks: 0, cacheEntriesCleared: 0 },
            preservedSharedBlobs: true,
            tombstoneId: existingTombstone.tombstone_id,
            scopeBoundary: "f1_local_decisions_only" as const,
          };
        }

        const header = selectDecision.get(input.assertionId) as
          DecisionHeaderRow | undefined;
        if (
          !header ||
          header.project_id !== scope.projectId ||
          header.binding_id !== scope.bindingId ||
          header.worktree_id !== scope.worktreeId
        ) {
          throw new GitError("decision_unavailable");
        }

        if (header.current_revision !== input.expectedRevision) {
          throw new GitError("decision_conflict");
        }

        const tombstoneId = newId();
        const purgedAt = nowIso();
        insertTombstone.run(
          tombstoneId,
          input.assertionId,
          scope.projectId,
          scope.bindingId,
          scope.worktreeId,
          header.current_revision,
          purgedAt,
        );

        const removedLinks = Number(
          deleteLinksByAssertion.run(input.assertionId).changes,
        );
        const removedRevisions = Number(
          deleteRevisionsByAssertion.run(input.assertionId).changes,
        );
        deleteDecisionByAssertion.run(input.assertionId);

        return {
          scope,
          assertionId: input.assertionId,
          purgedRevision: header.current_revision,
          status: "purged" as const,
          purgedAt,
          removed: {
            revisions: removedRevisions,
            evidenceLinks: removedLinks,
            cacheEntriesCleared: 0,
          },
          preservedSharedBlobs: true,
          tombstoneId,
          scopeBoundary: "f1_local_decisions_only" as const,
        };
      });

      if (receipt.status === "purged") {
        const key = scopeKey(scope);
        purgeEpochs.set(key, (purgeEpochs.get(key) ?? 0) + 1);
      }

      const currentTombstones = (
        selectAllTombstones.all() as TombstoneRow[]
      ).map((row) => ({
        tombstoneId: row.tombstone_id,
        assertionId: row.assertion_id,
        projectId: row.project_id,
        bindingId: row.binding_id,
        worktreeId: row.worktree_id,
        purgedRevision: row.purged_revision,
        purgedAt: row.purged_at,
      }));
      writeJournal(currentTombstones);

      return receipt;
    },
  };
}
