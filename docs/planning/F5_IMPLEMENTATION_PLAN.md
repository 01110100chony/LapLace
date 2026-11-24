# F5 · Plano de implementação e nuances técnicas previstas

[Fase](ROADMAP.md#f5) · [Fonte normativa](ROADMAP.md#fonte-normativa) · [Milestones](MILESTONES.md#f5-m01) · [Estado e entregas](STATUS.md#execução)

**História.** Comparar soluções concorrentes em worktrees isoladas a partir da mesma base Git e critérios equivalentes com revisão humana pareada (`F5-M01`), reproduzir de forma passiva e explicável o estado conhecido em `(validAt, knownAt)` com declaração explícita de lacunas por retenção/expurgo e reconstrução fiel de entregas a agentes (`F5-M02`), evoluir o ranqueamento de contexto com aprendizado simbólico BKM reversível submetido a avaliação held-out rigorosa contra a baseline FTS5/regras simples (`F5-M03`), e oferecer proatividade graduada sem efeitos colaterais automáticos nem daemon persistente oculto (`F5-M04`).

**Pré-requisitos satisfeitos (em `advanced_intelligence_f5` / `03b20ad`):** `F1-M03` (identidades lógica/binding/worktree), `F2-M01`/`F2-M02` (Context Compiler versionado, `SessionGrant`, `f2_compiled_manifests`, `f2_query_audits`, `f2_mcp_access_log`), `F3-M01`–`F3-M04` (temporalidade V/K, KGRAPH causal, CAS/pins/expurgo com tombstones, Inbox/feedback local `f3_local_feedback`, Dirty Overlay OCC), e `F4-M01`–`F4-M03` offline (`planner-git.ts`, `PlannerSupervisor`, `planner-service.ts`, diffs SHA-256, `applyLocal` OCC e verificadores assinados).

**Invariante `INV-07` herdado (`F4-M02.A2`):** `codex_cli_isolated` (`verified_isolated` / `isolated_probe`) permanece **estritamente bloqueado** (`execution_backend_blocked`) devido ao erro `0xc0000142` (`STATUS_DLL_INIT_FAILED`) na sonda LPAC Windows GNU + erro 5 em `GetFinalPathNameByHandleW(FILE_NAME_OPENED)` sobre `CODEX_HOME`. Todos os ensaios F5 (incluindo Arena) operam offline de forma determinística com `mock_supervised` / `local_process_job` sem relaxar ACLs do AppContainer.

**Caminho crítico da F5.** Etapa 0 (`F5_IMPLEMENTATION_PLAN.md`) → Etapa 1 (`@laplace/contracts` + `@laplace/core`) → Etapa 2 (migração SQLite #16 + `arena-service`, `replay-service`, `learning-service`, `proactivity-service` + testes F5) → Etapa 3 (ponte Rust `intelligence_request` + `IntelligenceView.tsx`) → Etapa 4 (bateria integrada + `STATUS.md`).

## Contratos fechados e códigos de erro (`@laplace/contracts`)

Todas as operações F5 em [`packages/contracts/src/intelligence.ts`](../../packages/contracts/src/intelligence.ts) são escopadas por `IdentityScope` (`projectId`, `bindingId`, `worktreeId`), trafegam sobre envelopes IPC v2 (`maxIpcBytes = 192 KiB`) e retornam `{ scope: IdentityScope, ... }` validados em `parseIntelligenceRequest`, `isIntelligenceResult`, `ipc.rs` (`Response::matches`) e `apps/desktop/src/ipc.ts`.

### Códigos de erro F5 (10 códigos fechados + reuso de `execution_backend_blocked`)

| Código                          | Significado normativo e invariante                                                                                                                                 |
| ------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `intelligence_invalid_input`    | Parâmetros inválidos, menos de 2 hipóteses na Arena, confirmação humana ausente ou configuração malformada (`INV-08`, `INV-10`).                                   |
| `intelligence_not_found`        | Sessão da Arena, entrega F2, hipótese BKM, avaliação adaptativa, sugestão ou agendamento inexistente no escopo (`INV-01`).                                         |
| `arena_base_divergence`         | Divergência detectada entre `baseHead`, `baseIndexStamp` ou `baseDigest` das worktrees/execuções concorrentes na Arena (`INV-04`, `INV-10`).                       |
| `arena_review_incomplete`       | Tentativa de concluir revisão pareada sem cobrir todas as hipóteses da sessão ou com hipótese não finalizada (`INV-04`, `INV-08`).                                 |
| `arena_session_invalidated`     | Operação solicitada sobre sessão já invalidada por divergência de base ou critério (`INV-04`).                                                                     |
| `replay_invalid_range`          | Datas `validAt` ou `knownAt` inválidas ou fora da semântica ISO exigida para consulta/diff bitemporal (`INV-04`, `INV-08`).                                        |
| `learning_hypothesis_conflict`  | Transição de estado inválida no BKM (ex.: reativação de hipótese expurgada) ou conflito de versão/request (`INV-06`, `INV-11`).                                    |
| `adaptive_gate_rejected`        | Tentativa de ativar estratégia adaptativa cuja avaliação held-out falhou em algum guardrail ou não superou o limiar mínimo sobre FTS5 (`INV-01`, `INV-09`, `D10`). |
| `proactivity_opt_in_required`   | Tentativa de agendar, disparar janela sem opt-in ativo/fora da janela configurada, ou habilitar modo com app fechado (`INV-05`, `INV-10`, `D16`).                  |
| `proactivity_schedule_conflict` | Conflito de execução/cancelamento no agendamento proativo ou disparo inválido (`INV-10`).                                                                          |

_(Observação: `codex_cli_isolated` na Arena reutiliza o erro `execution_backend_blocked` herdado da F4 por `INV-07`.)_

### Operações escopadas (20 operações fechadas)

| Milestone | Operações IPC v2                                                                                                                                                               | Responsabilidade                                                                                                                                                                         |
| --------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `F5-M01`  | `arena.sessionCreate`, `arena.sessionRun`, `arena.sessionList`, `arena.sessionGet`, `arena.sessionReview`                                                                      | Criar sessão com ≥2 hipóteses e critérios comuns, executar cada hipótese em worktree dedicada F4 verificando equivalência estrita de base, e registrar revisão pareada sem auto-aplicar. |
| `F5-M02`  | `replay.query`, `replay.diff`, `replay.deliveryInspect`                                                                                                                        | Reconstruir passivamente conhecimento em `(validAt, knownAt)`, comparar dois pontos `(V, K)`, declarar lacunas de expurgo/retenção sem ressurreição e recuperar manifesto/política F2.   |
| `F5-M03`  | `learning.hypothesisUpsert`, `learning.hypothesisList`, `learning.hypothesisTransition`, `learning.evaluateAdaptive`, `learning.strategyActivate`, `learning.strategyStatus`   | Gerir hipóteses BKM reversíveis com agrupamento por origem correlacionada, rodar benchmark held-out contra `baseline_fts5_v1`, aplicar gate de ativação e permitir rollback instantâneo. |
| `F5-M04`  | `proactivity.evaluate`, `proactivity.suggestionList`, `proactivity.suggestionRespond`, `proactivity.scheduleUpsert`, `proactivity.scheduleList`, `proactivity.scheduleControl` | Gerar sugestões passivas explicáveis de sinais F3/F4 sem mutar Git/FS/memória, registrar dispensa/adiamento/telemetria local e gerir janelas opt-in idempotentes sem daemon app-closed.  |

## Migração SQLite #16 (`apps/local-service/src/f5-store.ts` & `catalog.ts`)

Aditiva sobre `user_version = 15`, todas as 12 tabelas usando `STRICT`, preservando integralmente tabelas legadas, F1, F2, F3 e F4:

1. `f5_arena_sessions`: sessões da Arena vinculadas a `(project_id, binding_id, worktree_id)` com `request_id` único no escopo, `base_json`, `base_digest`, `criteria_json`, `criteria_digest`, `backend_mode`, `status`, `invalidation_reason`.
2. `f5_arena_hypotheses`: hipóteses da sessão (`ordinal`, `hypothesis_id`, `label`, `summary`, `observed_base_head`, `observed_base_index_stamp`, `observed_base_digest`, `criteria_digest`, `plan_id`, `grant_id`, `execution_id`, `dedicated_worktree_id`, `dedicated_root`, `diff_digest`, `source_refs_json`, `state`).
3. `f5_arena_reviews`: revisão humana pareada por sessão (`outcome IN ('winner_selected', 'tie', 'both_discarded')`, `winner_hypothesis_id`, `reviewer`, `rationale`, `reviewed_hypothesis_ids_json`, `criterion_scores_json`, `evidence_refs_json`, `applied_to_local INTEGER CHECK (applied_to_local = 0)`).
4. `f5_bkm_hypotheses`: hipóteses simbólicas BKM (`hypothesis_id`, `competing_group_key`, `category`, `title`, `statement`, `pattern_json`, `state IN ('candidate', 'active', 'superseded', 'reverted', 'purged')`).
5. `f5_bkm_evidence`: evidências de suporte/oposição (`polarity IN ('support', 'oppose')`, `origin_key`, `origin_kind`, `source_ref_id`, `weight`, `note`).
6. `f5_bkm_transitions`: trilha auditável de ativação, supersessão, reversão e expurgo (`from_state`, `to_state`, `reason`, `reviewer`, `recorded_at`).
7. `f5_adaptive_evaluations`: avaliações held-out versionadas (`evaluation_id`, `strategy_version`, `baseline_version`, `split_boundary_at`, `decision IN ('eligible_for_activation', 'stay_on_baseline')`, `failed_gates_json`, `baseline_metrics_json`, `adaptive_metrics_json`, `explanations_json`, `report_digest`).
8. `f5_adaptive_strategy_state`: estado ativo por escopo (`active_mode IN ('baseline_fts5', 'adaptive_symbolic')`, `active_version`, `evaluation_id`, `activated_at`, `activated_by`, `rollback_reason`).
9. `f5_proactive_suggestions`: sugestões proativas explicáveis por `signal_fingerprint` (`signal_kind`, `title`, `rationale`, `priority_score`, `priority_band`, `source_refs_json`, `proposed_action_json`, `status IN ('active', 'snoozed', 'dismissed', 'accepted')`, `snooze_until`, `dismiss_reason`).
10. `f5_proactivity_telemetry`: eventos locais de utilidade (`event_kind IN ('evaluated', 'accepted', 'dismissed', 'snoozed', 'restored')`, `estimated_manual_seconds`, `estimated_saved_seconds`, `recorded_at`).
11. `f5_proactive_schedules`: configuração de janela opt-in por projeto (`opt_in_active`, `status IN ('active', 'paused', 'revoked')`, `window_start_utc`, `window_end_utc`, `allowed_days_json`, `min_interval_minutes`, `app_closed_mode TEXT NOT NULL CHECK (app_closed_mode = 'disabled_deferred')`).
12. `f5_proactive_schedule_runs`: execuções por janela com chave única `(schedule_id, window_key)` para idempotência (`state IN ('running', 'completed', 'cancelled', 'blocked_out_of_window', 'blocked_revoked', 'interrupted_recovered')`, `recovered_after_restart`).

Atualizações acopladas obrigatórias:

- `catalogSchemaVersion = 16` em `apps/local-service/src/catalog.ts`.
- `assert.equal(catalogSchemaVersion, 16)` em `apps/local-service/test/f1-identity-migration.test.ts`.
- Prefixar `dropIdentitySchema` em `apps/local-service/test/ipc.test.ts` com o `DROP TABLE` das 12 tabelas `f5_*` em ordem inversa de chaves estrangeiras.

## Critério objetivo de corte para `F5-M03.A2` (Avaliação Adaptativa vs. FTS5)

A função pura `evaluateAdaptiveStrategy` em `packages/core/src/intelligence.ts` compara a estratégia simbólica/adaptativa versionada contra `baseline_fts5_v1` sobre um conjunto `heldOutCases` separado por tempo e projeto:

1. **Guardrails obrigatórios (qualquer violação força `decision = "stay_on_baseline"`):**
   - `leakageCount === 0`: nenhum candidato retornado pode pertencer a outro `(projectId, bindingId, worktreeId)` ou conter padrão secreto/canário (`sk-`, `ghp_`, `AKIA`, `PRIVATE KEY`, `db_only`);
   - `mandatoryPreservation === 1`: 100% dos itens marcados como obrigatórios (`mandatory` / canônicos) presentes nos candidatos elegíveis devem ser preservados no top-k;
   - `temporalAccuracy >= 0.85` e `temporalAccuracy >= baseline.temporalAccuracy`: itens vigentes em `queryAt` não podem ser preteridos por revisões expiradas ou substituídas;
   - `computeCostMs <= maxComputeCostMs` (padrão `50` ms) e `costRatio <= 2.0`;
   - `heldOutCases.length >= 3`, `temporalSplitValid === true` (todas as evidências BKM usadas precedem `splitBoundaryAt` e todas as consultas held-out ocorrem em `>= splitBoundaryAt`) e `projectIsolationValid === true`.
2. **Limiar de ganho sobre a baseline:**
   - `recallGain = adaptive.recallAtK - baseline.recallAtK >= minRecallGain` (padrão `+0.05`) **OU** (`recallGain >= 0` e `adaptive.temporalAccuracy - baseline.temporalAccuracy >= +0.05`).
3. **Regra de decisão:**
   - Se todos os guardrails passarem **e** o limiar de ganho for atingido → `decision = "eligible_for_activation"`.
   - Caso contrário → `decision = "stay_on_baseline"`, mantendo `baseline_fts5_v1` ativa e recusando `learning.strategyActivate` com `adaptive_gate_rejected`. Toda ativação mantém rollback imediato para `baseline_fts5_v1`.

## Fronteira estrita de `F5-M04.A2` (Proatividade sem daemon silencioso)

- A avaliação proativa (`proactivity.evaluate`) lê apenas estados já persistidos de F3/F4 sem escrever em Git, filesystem ou memória canônica (`autoExecutable: false`).
- O agendamento de janelas exige `optInConfirmed: true`, hora dentro de `[windowStartUtc, windowEndUtc)` nos dias configurados, e chave única `(schedule_id, window_key)` para suprimir disparos duplicados.
- **`appClosedMode` é travado em `"disabled_deferred"`** tanto no contrato Zod/TS quanto na constraint `CHECK (app_closed_mode = 'disabled_deferred')` do SQLite: qualquer tentativa de habilitar execução com app fechado ou daemon persistente de SO falha com `proactivity_opt_in_required`.
- Execuções interrompidas durante `running` são reconciliadas no `openCatalog()` via `reconcileInterruptedSchedules()` como `interrupted_recovered` (`recoveredAfterRestart: true`) sem reexecutar efeitos automaticamente.

## Matriz de Aceites F5

| Aceite      | Invariantes                                      | Critério objetivo                                                                                                                                                                                                                                               | Suíte / Prova                                                                                     |
| ----------- | ------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| `F5-M01.A1` | `INV-04`, `INV-07`, `INV-10`                     | ≥2 hipóteses executam da mesma base em worktrees dedicadas (`is_main = 0`), geram diffs SHA-256/fontes independentes e concluem revisão pareada persistida; divergência de base ou revisão incompleta invalida; origem intacta; `codex_cli_isolated` bloqueado. | `packages/core/test/intelligence.test.ts`, `apps/local-service/test/f5-arena.test.ts`             |
| `F5-M02.A1` | `INV-01`, `INV-04`, `INV-06`, `INV-08`, `INV-14` | Navegação em `(V, K)` devolve apenas o conhecido em `K` e válido em `V`; expurgos F1/F3 aparecem como lacunas declaradas sem ressuscitar payload; entregas F2 recuperam `manifestDigest` e `policyVersion` exatos; isolamento A/B.                              | `packages/core/test/intelligence.test.ts`, `apps/local-service/test/f5-replay.test.ts`            |
| `F5-M03.A1` | `INV-03`, `INV-06`, `INV-11`                     | Hipóteses concorrentes BKM registram suporte, oposição, deduplicação de origens correlacionadas (`originKey`) e reversão limpa auditável após reinício.                                                                                                         | `packages/core/test/intelligence.test.ts`, `apps/local-service/test/f5-learning-adaptive.test.ts` |
| `F5-M03.A2` | `INV-01`, `INV-03`, `INV-09`, `INV-11`           | Benchmark held-out por tempo/projeto mede `Recall@k`, acurácia temporal, obrigatórios, vazamentos e custo; ganho suficiente habilita com explicação e rollback; ganho insuficiente ou violação mantém `baseline_fts5_v1` (`stay_on_baseline`).                  | `packages/core/test/intelligence.test.ts`, `apps/local-service/test/f5-learning-adaptive.test.ts` |
| `F5-M04.A1` | `INV-03`, `INV-05`, `INV-08`, `INV-10`           | Sugestões locais derivam de sinais reais F3/F4 com justificativa, fontes verificáveis, prioridade, dispensa/adiamento/restauração reversível e telemetria local, com zero mutações Git/FS/memória.                                                              | `packages/core/test/intelligence.test.ts`, `apps/local-service/test/f5-proactivity.test.ts`       |
| `F5-M04.A2` | `INV-05`, `INV-06`, `INV-10`, `INV-11`           | Janela opt-in UTC, bloqueio fora da janela e após revogação, idempotência por `(scheduleId, windowKey)`, recuperação pós-reinício (`interrupted_recovered`) e bloqueio estrito de modo app fechado.                                                             | `packages/core/test/intelligence.test.ts`, `apps/local-service/test/f5-proactivity.test.ts`       |
