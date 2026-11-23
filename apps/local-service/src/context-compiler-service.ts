import type {
  CompiledContextPreview,
  CompilerCompileInput,
  CompilerConflict,
  IdentityScope,
} from "@laplace/contracts";
import { compileContext, type CompilerCandidate } from "@laplace/core";
import type { openCatalog } from "./catalog.ts";
import { sha256 } from "./context.ts";
import { GitError } from "./git.ts";

type CatalogStore = ReturnType<typeof openCatalog>;
type WithCatalog = <T>(operation: (store: CatalogStore) => T) => T;

export function createContextCompilerService(deps: {
  withCatalog: WithCatalog;
  now?: () => string;
}) {
  const now = deps.now ?? (() => new Date().toISOString());

  return {
    compile(input: CompilerCompileInput): CompiledContextPreview {
      const scope: IdentityScope = {
        projectId: input.projectId,
        bindingId: input.bindingId,
        worktreeId: input.worktreeId,
      };
      const compiledAt = now();

      return deps.withCatalog((store) => {
        const worktree = store.identity.resolveScope(scope);
        const blockingConflicts: CompilerConflict[] = [];

        if (worktree.verification === "divergent") {
          blockingConflicts.push({
            kind: "identity_divergent",
            blocking: true,
            summary:
              "O checkout encontrado diverge da identidade vinculada ao projeto.",
            detectedAt: compiledAt,
          });
        } else if (worktree.verification === "ambiguous") {
          blockingConflicts.push({
            kind: "identity_ambiguous",
            blocking: true,
            summary:
              "O repositório compartilhado possui múltiplos checkouts candidatos.",
            detectedAt: compiledAt,
          });
        } else if (worktree.verification === "unverified_legacy") {
          blockingConflicts.push({
            kind: "legacy_unverified",
            blocking: true,
            summary:
              "Projeto migrado sem identidade verificada; confirmação explícita necessária.",
            detectedAt: compiledAt,
          });
        }

        const candidates: CompilerCandidate[] = [];
        const decisions = store.decisions.list(scope).items;

        for (const decision of decisions) {
          if (
            decision.evidence.state === "gap" &&
            decision.evidence.gap !== "no_source_attached"
          ) {
            blockingConflicts.push({
              kind: "evidence_gap",
              blocking: true,
              summary: `A fonte vinculada à decisão ${decision.assertionId.slice(0, 8)} apresenta lacuna (${decision.evidence.gap}).`,
              detectedAt: compiledAt,
              relatedRefs: [decision.assertionId],
            });
          }

          const canonical = decision.visibility === "canonical_verified";
          candidates.push({
            candidateId: `dec-${decision.assertionId.slice(0, 12)}`,
            scope,
            kind: "decision",
            tier: canonical ? "invariant_canonical" : "project_preference",
            mandatory: canonical,
            visibility: canonical ? "canonical_verified" : "local_only",
            version: `rev-${decision.revision}`,
            title: canonical
              ? `Invariante canônico #${decision.revision}`
              : `Decisão local #${decision.revision}`,
            text: decision.content,
            capturedAt: decision.recordedAt,
            rationale: canonical
              ? "Decisão humana promovida como invariante canônico verificável."
              : "Decisão humana local não promovida; restrita em destinos externos.",
            anchor: {
              kind: "decision",
              assertionId: decision.assertionId,
              revisionId: decision.revisionId,
              revision: decision.revision,
            },
            privateMetadata: {
              localRoot: worktree.root,
              author: decision.author,
            },
          });
        }

        if (input.contextId) {
          const snapshot = store.context.get(
            worktree.legacyProjectId,
            input.contextId,
          );
          if (snapshot.status === "invalidated") {
            throw new GitError("codex_selection_invalid");
          }

          const omittedEntries = snapshot.entries.filter(
            (entry) => entry.outcome === "omitted",
          );
          const selectionList = input.selection;

          if (selectionList && selectionList.length > 0) {
            for (const sel of selectionList) {
              const entry = snapshot.entries.find(
                (item) => item.path === sel.path,
              );
              if (!entry) throw new GitError("codex_selection_invalid");
              if (entry.outcome === "omitted") {
                candidates.push({
                  candidateId: `omit-${sha256(entry.path).slice(0, 12)}`,
                  scope,
                  kind: "context_source",
                  tier: "project_preference",
                  mandatory: false,
                  visibility: "db_only",
                  version: snapshot.digest.slice(0, 12),
                  title: entry.path,
                  text: "",
                  capturedAt: snapshot.completedAt,
                  rationale: "Entrada omitida na captura C01.",
                  anchor: {
                    kind: "preference",
                    key: `omitted-${sha256(entry.path).slice(0, 12)}`,
                  },
                  omissionHint: "snapshot_omission",
                });
                continue;
              }
              if (entry.sha256 !== sel.sha256) {
                throw new GitError("codex_selection_invalid");
              }

              if (sel.chunk === null) {
                const bytes = Buffer.from(
                  store.context.readSource(
                    worktree.legacyProjectId,
                    snapshot.contextId,
                    entry.path,
                    entry.sha256,
                    snapshot.digest,
                  ),
                );
                if (sha256(bytes) !== entry.sha256) {
                  throw new GitError("context_source_unavailable");
                }
                const text = bytes.toString("utf8");
                if (text.includes("\0")) {
                  throw new GitError("codex_selection_invalid");
                }
                const lastLine = Math.max(1, text.split(/\r?\n/).length);
                candidates.push({
                  candidateId: `src-${sha256(entry.path).slice(0, 12)}`,
                  scope,
                  kind: "context_source",
                  tier: "project_preference",
                  mandatory: false,
                  visibility: "captured_eligible",
                  version: entry.sha256.slice(0, 12),
                  title: entry.path,
                  text,
                  capturedAt: snapshot.completedAt,
                  rationale: "Arquivo completo verificado de captura C01.",
                  anchor: {
                    kind: "context_excerpt",
                    contextId: snapshot.contextId,
                    path: entry.path,
                    sha256: entry.sha256,
                    chunk: 0,
                    firstLine: 1,
                    lastLine,
                  },
                  privateMetadata: { localRoot: worktree.root },
                });
              } else {
                const part = store.contextSearch.readExcerpt(
                  worktree.legacyProjectId,
                  {
                    contextId: snapshot.contextId,
                    path: entry.path,
                    sha256: entry.sha256,
                    chunk: sel.chunk,
                  },
                );
                const text = part.preview.text;
                candidates.push({
                  candidateId: `exc-${sha256(`${entry.path}:${sel.chunk}`).slice(0, 12)}`,
                  scope,
                  kind: "evidence_excerpt",
                  tier: "project_preference",
                  mandatory: false,
                  visibility: "captured_eligible",
                  version: sha256(part.bytes).slice(0, 12),
                  title: `${entry.path}#${sel.chunk}`,
                  text,
                  capturedAt: snapshot.completedAt,
                  rationale: `Trecho indexado C02 (linhas ${part.preview.firstLine}-${part.preview.lastLine}).`,
                  anchor: {
                    kind: "context_excerpt",
                    contextId: snapshot.contextId,
                    path: entry.path,
                    sha256: entry.sha256,
                    chunk: sel.chunk,
                    firstLine: part.preview.firstLine,
                    lastLine: part.preview.lastLine,
                  },
                  privateMetadata: { localRoot: worktree.root },
                });
              }
            }
          } else {
            for (const entry of snapshot.entries) {
              if (entry.outcome !== "included") continue;
              const bytes = Buffer.from(
                store.context.readSource(
                  worktree.legacyProjectId,
                  snapshot.contextId,
                  entry.path,
                  entry.sha256,
                  snapshot.digest,
                ),
              );
              const text = bytes.toString("utf8");
              if (text.includes("\0")) continue;
              const lastLine = Math.max(1, text.split(/\r?\n/).length);
              candidates.push({
                candidateId: `src-${sha256(entry.path).slice(0, 12)}`,
                scope,
                kind: "context_source",
                tier: "project_preference",
                mandatory: false,
                visibility: "captured_eligible",
                version: entry.sha256.slice(0, 12),
                title: entry.path,
                text,
                capturedAt: snapshot.completedAt,
                rationale: "Fonte preservada elegível da captura C01.",
                anchor: {
                  kind: "context_excerpt",
                  contextId: snapshot.contextId,
                  path: entry.path,
                  sha256: entry.sha256,
                  chunk: 0,
                  firstLine: 1,
                  lastLine,
                },
                privateMetadata: { localRoot: worktree.root },
              });
            }
          }

          for (const omitted of omittedEntries) {
            if (
              selectionList?.some((sel) => sel.path === omitted.path) ??
              false
            ) {
              continue;
            }
            candidates.push({
              candidateId: `omit-${sha256(omitted.path).slice(0, 12)}`,
              scope,
              kind: "context_source",
              tier: "project_preference",
              mandatory: false,
              visibility: "db_only",
              version: snapshot.digest.slice(0, 12),
              title: omitted.path,
              text: "",
              capturedAt: snapshot.completedAt,
              rationale: `Omitido na captura C01 (${omitted.reason}).`,
              anchor: {
                kind: "preference",
                key: `omitted-${sha256(omitted.path).slice(0, 12)}`,
              },
              omissionHint: "snapshot_omission",
            });
          }
        }

        for (const pref of input.projectPreferences ?? []) {
          candidates.push({
            candidateId: `proj-${pref.key}`,
            scope,
            kind: "project_preference",
            tier: "project_preference",
            mandatory: Boolean(pref.mandatory),
            visibility: "captured_eligible",
            version: "pref-1",
            title: pref.title,
            text: pref.content,
            capturedAt: compiledAt,
            rationale: "Preferência explícita do projeto.",
            anchor: { kind: "preference", key: pref.key },
            conflictKey: pref.conflictKey,
            conflictPolarity: pref.conflictPolarity,
          });
        }

        for (const pref of input.personalPreferences ?? []) {
          candidates.push({
            candidateId: `prof-${pref.key}`,
            scope,
            kind: "personal_profile",
            tier: "personal_profile",
            mandatory: Boolean(pref.mandatory),
            visibility: "captured_eligible",
            version: "pref-1",
            title: pref.title,
            text: pref.content,
            capturedAt: compiledAt,
            rationale: "Preferência de perfil pessoal.",
            anchor: { kind: "preference", key: pref.key },
            conflictKey: pref.conflictKey,
            conflictPolarity: pref.conflictPolarity,
          });
        }

        for (const extra of input.extraCandidates ?? []) {
          candidates.push({
            candidateId: extra.candidateId,
            scope: extra.scope ?? scope,
            kind: extra.kind,
            tier: extra.tier,
            mandatory: extra.mandatory,
            visibility: extra.visibility,
            version: extra.version,
            title: extra.title,
            text: extra.text,
            capturedAt: compiledAt,
            rationale: "Candidato explícito da compilação.",
            anchor: { kind: "preference", key: extra.candidateId },
            conflictKey: extra.conflictKey,
            conflictPolarity: extra.conflictPolarity,
            privateMetadata: extra.privateMetadata,
          });
        }

        const compiled = compileContext({
          scope,
          now: compiledAt,
          objective: input.objective,
          destinationId: input.destinationId,
          budgetBytes: input.budgetBytes,
          policyVersion: input.policyVersion,
          strategyVersion: input.strategyVersion,
          candidates,
          blockingConflicts,
        });

        store.f2.saveCompiledManifest({
          scope,
          legacyProjectId: worktree.legacyProjectId,
          preview: compiled.preview,
          authorizedPayloads: compiled.authorizedPayloads,
        });

        return compiled.preview;
      });
    },
  };
}
