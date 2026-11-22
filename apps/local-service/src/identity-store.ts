import { randomBytes } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import type {
  BindingVerificationState,
  IdentityCandidate,
  IdentityScope,
  ProjectIdentityResult,
  WorktreeRecord,
} from "@laplace/contracts";
import { GitError, type RepositoryInspection } from "./git.ts";

export const identityMigration = `
  CREATE TABLE logical_projects (
    id TEXT PRIMARY KEY NOT NULL,
    name TEXT NOT NULL,
    created_at TEXT NOT NULL
  ) STRICT;

  CREATE TABLE local_repo_bindings (
    id TEXT PRIMARY KEY NOT NULL,
    project_id TEXT NOT NULL REFERENCES logical_projects(id),
    common_git_identity TEXT UNIQUE,
    common_git_dir TEXT,
    verification TEXT NOT NULL CHECK (
      verification IN ('verified', 'unverified_legacy', 'ambiguous', 'divergent', 'unavailable')
    ),
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  ) STRICT;

  CREATE TABLE worktrees (
    id TEXT PRIMARY KEY NOT NULL,
    binding_id TEXT NOT NULL REFERENCES local_repo_bindings(id),
    project_id TEXT NOT NULL REFERENCES logical_projects(id),
    legacy_project_id TEXT NOT NULL UNIQUE REFERENCES projects(id),
    checkout_identity TEXT UNIQUE,
    root TEXT NOT NULL UNIQUE,
    is_main INTEGER NOT NULL CHECK (is_main IN (0, 1)),
    verification TEXT NOT NULL CHECK (
      verification IN ('verified', 'unverified_legacy', 'ambiguous', 'divergent', 'unavailable')
    ),
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  ) STRICT;

  CREATE INDEX local_repo_bindings_project ON local_repo_bindings (project_id);
  CREATE INDEX worktrees_binding ON worktrees (binding_id);

  INSERT INTO logical_projects (id, name, created_at)
  SELECT
    lower(substr('123456789abcdef0', instr('0123456789abcdef', lower(substr(id, 1, 1))), 1)) || substr(id, 2),
    name,
    strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
  FROM projects;

  INSERT INTO local_repo_bindings (
    id, project_id, common_git_identity, common_git_dir, verification, created_at, updated_at
  )
  SELECT
    lower(substr('23456789abcdef01', instr('0123456789abcdef', lower(substr(id, 1, 1))), 1)) || substr(id, 2),
    lower(substr('123456789abcdef0', instr('0123456789abcdef', lower(substr(id, 1, 1))), 1)) || substr(id, 2),
    NULL,
    NULL,
    CASE WHEN git_identity IS NOT NULL THEN 'verified' ELSE 'unverified_legacy' END,
    strftime('%Y-%m-%dT%H:%M:%fZ', 'now'),
    strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
  FROM projects;

  INSERT INTO worktrees (
    id, binding_id, project_id, legacy_project_id, checkout_identity, root, is_main, verification, created_at, updated_at
  )
  SELECT
    lower(substr('3456789abcdef012', instr('0123456789abcdef', lower(substr(id, 1, 1))), 1)) || substr(id, 2),
    lower(substr('23456789abcdef01', instr('0123456789abcdef', lower(substr(id, 1, 1))), 1)) || substr(id, 2),
    lower(substr('123456789abcdef0', instr('0123456789abcdef', lower(substr(id, 1, 1))), 1)) || substr(id, 2),
    id,
    git_identity,
    root,
    1,
    CASE WHEN git_identity IS NOT NULL THEN 'verified' ELSE 'unverified_legacy' END,
    strftime('%Y-%m-%dT%H:%M:%fZ', 'now'),
    strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
  FROM projects;
`;

type BindingRow = {
  id: string;
  project_id: string;
  common_git_identity: string | null;
  common_git_dir: string | null;
  verification: BindingVerificationState;
};

type WorktreeRow = {
  id: string;
  binding_id: string;
  project_id: string;
  legacy_project_id: string;
  checkout_identity: string | null;
  root: string;
  is_main: number;
  verification: BindingVerificationState;
  project_name: string;
};

export type LocationProbe =
  { available: false } | { available: true; inspection: RepositoryInspection };

function newId() {
  return randomBytes(32).toString("hex");
}

function nowIso() {
  return new Date().toISOString();
}

function toWorktreeRecord(row: WorktreeRow): WorktreeRecord {
  return {
    worktreeId: row.id,
    bindingId: row.binding_id,
    projectId: row.project_id,
    legacyProjectId: row.legacy_project_id,
    name: row.project_name,
    root: row.root,
    isMain: row.is_main === 1,
    verification: row.verification,
  };
}

export function createIdentityStore(
  database: DatabaseSync,
  write: <T>(run: () => T) => T = (run) => run(),
) {
  const selectByLegacyId = database.prepare(`
    SELECT
      w.id, w.binding_id, w.project_id, w.legacy_project_id, w.checkout_identity,
      w.root, w.is_main, w.verification, p.name AS project_name
    FROM worktrees AS w
    JOIN logical_projects AS p ON p.id = w.project_id
    WHERE w.legacy_project_id = ?
  `);

  const selectByScope = database.prepare(`
    SELECT
      w.id, w.binding_id, w.project_id, w.legacy_project_id, w.checkout_identity,
      w.root, w.is_main, w.verification, p.name AS project_name
    FROM worktrees AS w
    JOIN logical_projects AS p ON p.id = w.project_id
    WHERE w.project_id = ? AND w.binding_id = ? AND w.id = ?
  `);

  const selectBindingById = database.prepare(`
    SELECT id, project_id, common_git_identity, common_git_dir, verification
    FROM local_repo_bindings WHERE id = ?
  `);

  const selectBindingByCommon = database.prepare(`
    SELECT id, project_id, common_git_identity, common_git_dir, verification
    FROM local_repo_bindings WHERE common_git_identity = ?
  `);

  const selectWorktreesByBinding = database.prepare(`
    SELECT
      w.id, w.binding_id, w.project_id, w.legacy_project_id, w.checkout_identity,
      w.root, w.is_main, w.verification, p.name AS project_name
    FROM worktrees AS w
    JOIN logical_projects AS p ON p.id = w.project_id
    WHERE w.binding_id = ?
    ORDER BY w.is_main DESC, w.created_at ASC, w.id ASC
  `);

  const insertLogicalProject = database.prepare(`
    INSERT INTO logical_projects (id, name, created_at) VALUES (?, ?, ?)
  `);

  const insertBinding = database.prepare(`
    INSERT INTO local_repo_bindings (
      id, project_id, common_git_identity, common_git_dir, verification, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?)
  `);

  const insertWorktree = database.prepare(`
    INSERT INTO worktrees (
      id, binding_id, project_id, legacy_project_id, checkout_identity, root, is_main, verification, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  const updateBinding = database.prepare(`
    UPDATE local_repo_bindings
    SET common_git_identity = ?, common_git_dir = ?, verification = ?, updated_at = ?
    WHERE id = ?
  `);

  const updateWorktree = database.prepare(`
    UPDATE worktrees
    SET checkout_identity = ?, root = ?, is_main = ?, verification = ?, updated_at = ?
    WHERE id = ?
  `);

  function requireByLegacyId(legacyProjectId: string): WorktreeRow {
    const row = selectByLegacyId.get(legacyProjectId) as
      WorktreeRow | undefined;
    if (!row) throw new GitError("project_unavailable");
    return row;
  }

  return {
    registerFromInspection(
      legacyProject: { id: string; name: string; root: string },
      inspection: RepositoryInspection,
    ): IdentityScope {
      const existingWorktree = selectByLegacyId.get(legacyProject.id) as
        WorktreeRow | undefined;
      if (existingWorktree) {
        this.syncFromInspection(legacyProject.id, inspection);
        return {
          projectId: existingWorktree.project_id,
          bindingId: existingWorktree.binding_id,
          worktreeId: existingWorktree.id,
        };
      }

      const timestamp = inspection.observedAt || nowIso();
      const existingBinding = selectBindingByCommon.get(
        inspection.commonGitIdentity,
      ) as BindingRow | undefined;

      if (existingBinding) {
        const worktreeId = newId();
        insertWorktree.run(
          worktreeId,
          existingBinding.id,
          existingBinding.project_id,
          legacyProject.id,
          inspection.identity,
          inspection.root,
          inspection.isLinkedWorktree ? 0 : 1,
          "verified",
          timestamp,
          timestamp,
        );
        return {
          projectId: existingBinding.project_id,
          bindingId: existingBinding.id,
          worktreeId,
        };
      }

      const projectId = newId();
      const bindingId = newId();
      const worktreeId = newId();
      insertLogicalProject.run(projectId, legacyProject.name, timestamp);
      insertBinding.run(
        bindingId,
        projectId,
        inspection.commonGitIdentity,
        inspection.commonGitDir,
        "verified",
        timestamp,
        timestamp,
      );
      insertWorktree.run(
        worktreeId,
        bindingId,
        projectId,
        legacyProject.id,
        inspection.identity,
        inspection.root,
        inspection.isLinkedWorktree ? 0 : 1,
        "verified",
        timestamp,
        timestamp,
      );
      return { projectId, bindingId, worktreeId };
    },

    syncFromInspection(
      legacyProjectId: string,
      inspection: RepositoryInspection,
    ): void {
      const worktree = requireByLegacyId(legacyProjectId);
      const binding = selectBindingById.get(worktree.binding_id) as
        BindingRow | undefined;
      if (!binding) throw new GitError("project_unavailable");
      const timestamp = inspection.observedAt || nowIso();

      const owner = selectBindingByCommon.get(inspection.commonGitIdentity) as
        BindingRow | undefined;
      if (!owner || owner.id === binding.id) {
        updateBinding.run(
          inspection.commonGitIdentity,
          inspection.commonGitDir,
          "verified",
          timestamp,
          binding.id,
        );
      }
      updateWorktree.run(
        inspection.identity,
        inspection.root,
        inspection.isLinkedWorktree ? 0 : 1,
        "verified",
        timestamp,
        worktree.id,
      );
    },

    resolveScope(scope: IdentityScope): WorktreeRecord {
      const row = selectByScope.get(
        scope.projectId,
        scope.bindingId,
        scope.worktreeId,
      ) as WorktreeRow | undefined;
      if (!row) throw new GitError("project_unavailable");
      return toWorktreeRecord(row);
    },

    getByLegacyId(legacyProjectId: string): WorktreeRecord {
      return toWorktreeRecord(requireByLegacyId(legacyProjectId));
    },

    resolve(
      legacyProjectId: string,
      probe: LocationProbe,
      explicitPath: boolean,
    ): ProjectIdentityResult {
      const current = requireByLegacyId(legacyProjectId);
      const binding = selectBindingById.get(current.binding_id) as
        BindingRow | undefined;
      if (!binding) throw new GitError("project_unavailable");

      const currentScope: IdentityScope = {
        projectId: current.project_id,
        bindingId: current.binding_id,
        worktreeId: current.id,
      };
      const siblingRows = selectWorktreesByBinding.all(
        current.binding_id,
      ) as WorktreeRow[];
      const worktrees = siblingRows.map(toWorktreeRecord);

      if (current.verification === "unverified_legacy") {
        const candidates: IdentityCandidate[] = probe.available
          ? [
              {
                scope: currentScope,
                legacyProjectId: current.legacy_project_id,
                root: probe.inspection.root,
                isMain: !probe.inspection.isLinkedWorktree,
                verification: "unverified_legacy",
                reason: "unverified_legacy",
              },
            ]
          : [];
        return {
          scope: currentScope,
          legacyProjectId: current.legacy_project_id,
          root: current.root,
          verification: probe.available ? "unverified_legacy" : "unavailable",
          requiresConfirmation: true,
          worktrees,
          candidates,
        };
      }

      if (!probe.available) {
        return {
          scope: currentScope,
          legacyProjectId: current.legacy_project_id,
          root: current.root,
          verification: "unavailable",
          requiresConfirmation: true,
          worktrees,
          candidates: [],
        };
      }

      const { inspection } = probe;
      if (inspection.identity === current.checkout_identity) {
        if (!explicitPath && inspection.root !== current.root) {
          return {
            scope: currentScope,
            legacyProjectId: current.legacy_project_id,
            root: current.root,
            verification: "divergent",
            requiresConfirmation: true,
            worktrees,
            candidates: [
              {
                scope: currentScope,
                legacyProjectId: current.legacy_project_id,
                root: inspection.root,
                isMain: !inspection.isLinkedWorktree,
                verification: "divergent",
                reason: "identity_mismatch",
              },
            ],
          };
        }
        if (inspection.root === current.root) {
          write(() => {
            const owner = selectBindingByCommon.get(
              inspection.commonGitIdentity,
            ) as BindingRow | undefined;
            if (!owner || owner.id === binding.id) {
              updateBinding.run(
                inspection.commonGitIdentity,
                inspection.commonGitDir,
                "verified",
                inspection.observedAt || nowIso(),
                binding.id,
              );
            }
            updateWorktree.run(
              inspection.identity,
              current.root,
              inspection.isLinkedWorktree ? 0 : 1,
              "verified",
              inspection.observedAt || nowIso(),
              current.id,
            );
          });
        }
        const refreshed = (
          selectWorktreesByBinding.all(current.binding_id) as WorktreeRow[]
        ).map(toWorktreeRecord);
        const candidates: IdentityCandidate[] = refreshed.map((entry) => ({
          scope: {
            projectId: entry.projectId,
            bindingId: entry.bindingId,
            worktreeId: entry.worktreeId,
          },
          legacyProjectId: entry.legacyProjectId,
          root: entry.root,
          isMain: entry.isMain,
          verification: "verified",
          reason:
            entry.worktreeId === current.id
              ? "verified_match"
              : "shared_common_git",
        }));
        return {
          scope: currentScope,
          legacyProjectId: current.legacy_project_id,
          root: inspection.root,
          verification: "verified",
          requiresConfirmation: false,
          worktrees: refreshed,
          candidates,
        };
      }

      if (
        binding.common_git_identity !== null &&
        inspection.commonGitIdentity === binding.common_git_identity
      ) {
        const candidates: IdentityCandidate[] = worktrees.map((entry) => ({
          scope: {
            projectId: entry.projectId,
            bindingId: entry.bindingId,
            worktreeId: entry.worktreeId,
          },
          legacyProjectId: entry.legacyProjectId,
          root: entry.root,
          isMain: entry.isMain,
          verification: "ambiguous",
          reason: "shared_common_git",
        }));
        if (!worktrees.some((entry) => entry.root === inspection.root)) {
          candidates.push({
            scope: currentScope,
            legacyProjectId: current.legacy_project_id,
            root: inspection.root,
            isMain: !inspection.isLinkedWorktree,
            verification: "ambiguous",
            reason: "shared_common_git",
          });
        }
        return {
          scope: currentScope,
          legacyProjectId: current.legacy_project_id,
          root: current.root,
          verification: "ambiguous",
          requiresConfirmation: true,
          worktrees,
          candidates,
        };
      }

      return {
        scope: currentScope,
        legacyProjectId: current.legacy_project_id,
        root: current.root,
        verification: "divergent",
        requiresConfirmation: true,
        worktrees,
        candidates: [
          {
            scope: currentScope,
            legacyProjectId: current.legacy_project_id,
            root: inspection.root,
            isMain: !inspection.isLinkedWorktree,
            verification: "divergent",
            reason: "identity_mismatch",
          },
        ],
      };
    },
  };
}
