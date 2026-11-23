# F4 · Plano de implementação e nuances técnicas previstas

[Fase](ROADMAP.md#f4) · [Fonte normativa](ROADMAP.md#fonte-normativa) · [Milestones](MILESTONES.md#f4-m01) · [Estado e entregas](STATUS.md#execução)

**História.** Permitir ao usuário inspecionar, planejar e simular operações Git sem tocar o checkout de origem (`F4-M01`), delegar execução observável a um agente ou comando em worktree dedicada sob fronteira de confinamento verificada no Windows e grant por operação (`F4-M02`), revisar o diff resultante com proveniência, aplicar alterações locais com revalidação concorrente e aprovar verificadores executáveis com vínculo estrito à definição (`F4-M03`).

**Pré-requisitos satisfeitos (em `LapLace-f2` / `85bce93`):** `F1-M03` (identidades lógica/binding/worktree), `F2-M02` (gateway MCP stdio + `SessionGrant` + `ContextPackage`), `F3-M02`/`F3-M04` (retenção CAS, proteção de provas e Dirty Overlay sob OCC), mais base O02/O03 (`TaskSupervisor`, `task-execution-store.ts`, `task-result-store.ts`, `result-review.ts`) e sonda LPAC base (`codex-job/src/confinement.rs`).

**Caminho crítico da F4.** T01 → T02 (`F4-M01`) → T03 → T04 → T05 (`F4-M02`) → T06 → T07 → T08 (`F4-M03`) → T09 → T10.

## Contratos fechados e códigos de erro (`@laplace/contracts`)

Todas as operações F4 em [`packages/contracts/src/planner.ts`](../../packages/contracts/src/planner.ts) são escopadas por `IdentityScope` (`projectId`, `bindingId`, `worktreeId`), usam envelopes IPC v2 (`maxIpcBytes = 192 KiB`) e retornam `{ scope: IdentityScope, ... }` validado em `parsePlannerRequest`, `isPlannerResult`, `ipc.rs` (`Response::matches`) e `apps/desktop/src/ipc.ts`.

### Códigos de erro F4 (11 códigos fechados)

| Código                         | Significado normativo e invariante                                                                                                                                                |
| ------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `planner_invalid_input`        | Parâmetros, caminhos, edições propostas ou definição de verificador inválidos.                                                                                                    |
| `planner_not_found`            | Plano, grant operacional, execução, diff, aplicação ou verificador inexistente no escopo.                                                                                         |
| `planner_drift_detected`       | Divergência entre base planejada e estado atual (`head`, `branch`, `indexStamp` ou `dirtyDigest`) detectada no Pre-Flight ou antes da execução (`INV-02`, `INV-08`).              |
| `planner_worktree_unavailable` | Worktree dedicada ausente, removida ou fora da área segura isolada.                                                                                                               |
| `operation_grant_invalid`      | `OperationGrant` inválido, revogado, fora do escopo/plano ou sem o efeito exigido (`INV-07`, `INV-10`).                                                                           |
| `operation_grant_expired`      | `OperationGrant` vencido pelo TTL contratual (`INV-07`).                                                                                                                          |
| `execution_backend_blocked`    | Backend `codex_cli_isolated` / `isolated_probe` ou destino sem prova real da fronteira Windows LPAC (`INV-07`).                                                                   |
| `execution_interrupted`        | Tentativa encerrada abruptamente ou reconciliada após queda sem reexecução automática (`INV-10`).                                                                                 |
| `apply_not_approved`           | Tentativa de aplicação local sem aprovação prévia do diff ou sem confirmação humana própria (`applyConfirmed: true`) (`INV-08`, `INV-13`).                                        |
| `apply_conflict_detected`      | Corrida OCC (`HEAD`, `indexStamp` ou digest de arquivo alvo modificado externamente) ou falha parcial revertida no checkout de destino (`INV-02`, `INV-04`).                      |
| `verifier_approval_invalid`    | Aprovação humana ausente ou revogada por divergência de `definitionDigest` (`definitionId`, `argv`, `cwd`, `envWhitelist`, `timeoutMs`, `privilegeProfile`) (`INV-07`, `INV-13`). |

### Operações escopadas `planner.*` (20 operações fechadas)

| Milestone | Operações IPC v2                                                                                                                                                                                                               | Responsabilidade                                                                                                                                                                                                                                                                                                                       |
| --------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `F4-M01`  | `planner.explore`, `planner.planCreate`, `planner.planList`, `planner.planPreflight`                                                                                                                                           | Leitura passiva Git (`--no-optional-locks`), criação e listagem de planos somente leitura com classificação de risco/conflitos/efeitos (`mutatesOrigin: false`), e revalidação `PreFlightCheckResult` (`valid` / `blocked` / `invalidated_by_drift`).                                                                                  |
| `F4-M02`  | `planner.grantIssue`, `planner.grantList`, `planner.grantRevoke`, `planner.boundaryStatus`, `planner.executionStart`, `planner.executionList`, `planner.executionEvents`, `planner.executionCancel`, `planner.worktreeCleanup` | Concessão revogável por operação vinculada a `(planId, baseDigest, backendMode, allowedEffects)`, status explícito da fronteira Windows LPAC (`codex_cli_isolated` bloqueado até prova real), execução multi-tentativa em worktree dedicada, paginação de eventos, cancelamento com término de árvore e limpeza explícita pós-revisão. |
| `F4-M03`  | `planner.diffGet`, `planner.diffReview`, `planner.applyLocal`, `planner.verifierDefine`, `planner.verifierList`, `planner.verifierApprove`, `planner.verifierRun`                                                              | Diff verificável por SHA-256 com bytes crus preservados, revisão humana persistente como evento distinto da aplicação, aplicação local sob `DirtyOverlayManifest` + OCC + rollback de falha parcial, e ciclo completo de verificadores com aprovação assinada por `definitionDigest`.                                                  |

## Migração SQLite #15 (`apps/local-service/src/f4-store.ts` & `catalog.ts`)

Aditiva sobre `user_version = 14`, todas as 11 tabelas usando `STRICT`, preservando integralmente tabelas legadas, F1, F2 e F3:

1. `f4_plans`: planos vinculados a `(project_id, binding_id, worktree_id)` com `base_head`, `base_branch`, `base_index_stamp`, `base_dirty_digest`, `simulation_digest`, `preflight_status` e `plan_json`.
2. `f4_operation_grants`: grants por operação referenciando `f4_plans(plan_id)` com `base_digest`, `backend_mode`, `allowed_effects_json`, `expires_at`, `revoked_at`, `revoke_reason`.
3. `f4_dedicated_worktrees`: worktrees dedicadas criadas para execuções (`source_worktree_id TEXT NOT NULL REFERENCES worktrees(id)`, `is_main INTEGER NOT NULL CHECK (is_main = 0)`, `strategy IN ('git_worktree', 'isolated_checkout')`, `dedicated_root`, `base_head`, `status IN ('active', 'retained_for_review', 'cleaned', 'orphaned')`). Mantém `source_worktree_id` separado de `worktrees` de origem para nunca poluir `workspace.list()` ou a tabela legada `projects` com checkouts temporários descartáveis.
4. `f4_executions`: tentativas supervisionadas multi-instância (sem `task_executions_one_active`), referenciando `f4_plans(plan_id)`, `f4_operation_grants(grant_id)` e `f4_dedicated_worktrees(dedicated_worktree_id)`, com `request_id` único por escopo, `backend_mode`, `session_grant_id`, `state IN ('running', 'cancelling', 'completed', 'failed', 'cancelled', 'interrupted', 'timeout')`, `owner_id`, `owner_pid`, `child_pid`, `lease_until`, `recovered_after_restart`, `last_seq`.
5. `f4_execution_events`: log sequencial por `(execution_id, seq)` (`WITHOUT ROWID`).
6. `f4_execution_diffs`: resumo verificável do diff da tentativa (`execution_id` PK, `diff_digest`, `base_head`, `file_count`, `summary_json`).
7. `f4_diff_blobs`: bytes crus (`BLOB NOT NULL`, incluindo `CRLF`) indexados por `sha256` PK, preservando integridade independente de coleta F3.
8. `f4_diff_reviews`: revisões humanas OCC por `(execution_id, revision)` (`request_id` único, `diff_digest`, `choice IN ('approved', 'rejected')`, `reviewer`, `note`, `recorded_at`).
9. `f4_apply_records`: auditoria de tentativas de aplicação local (`apply_id` PK, `execution_id`, `diff_digest`, `overlay_id`, `status IN ('applied', 'aborted_conflict', 'rolled_back')`, `files_json`, `detail`, `applied_at`).
10. `f4_verifiers`: definição versionada de verificador com `definition_digest`, `argv_json`, `cwd_relative`, `env_whitelist_json`, `timeout_ms`, `privilege_profile`, `approval_status IN ('pending', 'approved', 'revoked_by_redefinition')`, `approved_digest`, `approved_by`, `approved_at`.
11. `f4_verifier_runs`: histórico de execuções verificadoras vinculadas ao `definition_digest` aprovado (`run_id` PK, `verifier_id`, `definition_digest`, `execution_id`, `state`, `exit_code`, `timed_out`, `stdout_excerpt`, `stderr_excerpt`, `duration_ms`).

## Explorer, Pre-Flight e simulação Git (`F4-M01`)

### F4-T01

**Contratos e modelo puro do Git Visual Planner & Pre-Flight (`@laplace/contracts`, `@laplace/core`).** [F4-M01](MILESTONES.md#f4-m01) · §§12, 16 · D8/D11 · INV-02/04/08/10.

- **Escopo.** Novos DTOs `planner.*` em `@laplace/contracts` (plano somente leitura, grafo de base/alvo/worktree, lista de precondições verificáveis, simulação de efeitos e estado `invalidated_by_drift`) e funções puras em `@laplace/core` (`computeGitBaseDigest`, `simulateGitPlan`, `evaluatePreFlight`, `computeDiffDigest`, `computeVerifierDefinitionDigest`, `validateVerifierApproval`) para classificar risco, conflitos potenciais e comparar snapshot de base esperado vs. observado.
- **Aceite.** **F4-T01.A1** Planos validam escopo completo `IdentityScope` e invalidam automaticamente quando `head`, `branch`, `indexStamp` ou `dirtyDigest` divergem do esperado.

### F4-T02

**Serviço read-only do Explorer e simulação sem mutação do checkout (`@laplace/local-service`).** [F4-M01](MILESTONES.md#f4-m01) · §§12, 17 · INV-02/04.

- **Escopo.** Inspecionar árvore/ramos/worktrees/conflitos em modo `--no-optional-locks`, calcular `dirtyDigest` cobrindo arquivos rastreados sujos e caminhos observados no plano, gerar `PreFlightCheckResult` revalidável no momento da execução e validar que simulação e leitura preservam `HEAD`, `.git/index` e `refs` intactos.
- **Aceite.** **F4-T02.A1** Mudança concorrente de `HEAD`/índice/disco invalida o plano antes da execução; nenhuma ref/índice de origem é alterada.

## Execução observável em worktree dedicada e confinamento (`F4-M02`)

### F4-T03

**Ciclo de vida de worktree dedicada isolada (`git worktree` / sandbox checkout).** [F4-M02](MILESTONES.md#f4-m02) · §§10–12 · D13/D15 · INV-02/04.

- **Escopo.** Criar (`git worktree add --detach` quando `baseHead` existe, ou diretório isolado controlado em `unborn HEAD`), vincular em `f4_dedicated_worktrees` (`source_worktree_id` + `is_main = 0`), limpar com `humanConfirmed` e recuperar worktrees dedicadas a uma execução sem tocar a worktree principal do usuário.

### F4-T04

**Estratégia LPAC, separação de binários e `codex_cli_isolated` (`codex-job`, `@laplace/agents`).** [F4-M02](MILESTONES.md#f4-m02) · §9, §17 · D1/D3/D14 · INV-07/10.

- **Escopo e estratégia explícita LPAC:**
  1. Separar estritamente dois binários nativos no empacotamento (`prepare-sidecar.mjs` + `tauri.conf.json` + `smoke-windows.ps1`):
     - `laplace-git-job-<target>.exe` (`--features clone-only`): aceita **apenas** `--laplace-clone-job`, recusando `--laplace-codex-job`, `--laplace-verifier-job` e sondas LPAC com código `126`.
     - `laplace-codex-job-<target>.exe` (completo, sem `--features clone-only`): aceita `--laplace-codex-job`, `--laplace-verifier-job` (Job Object com `KILL_ON_JOB_CLOSE`, limite de memória e timeout drenado) e `--laplace-codex-boundary-probe`/`--laplace-codex-boundary-read`, recusando `--laplace-clone-job` com código `126`.
  2. Parametrizar `supervisedCodexExecArgs` em `packages/agents/src/codex.ts` preservando `codexExecArgs` intacto (`-c mcp_servers={}`) e injetando unicamente `mcp_servers.laplace.*` vinculado ao `SessionGrant` válido de F2 quando autorizado, mantendo `--strict-config`, `--ignore-user-config`, `--ignore-rules` e `web_search="disabled"`.
  3. **Invariante estrito `INV-07`:** nunca relaxar ACLs do AppContainer LPAC (`PROCESS_CREATION_ALL_APPLICATION_PACKAGES_OPT_OUT` + `ERROR_ACCESS_DENIED` no canário). Enquanto a sonda `--laplace-codex-boundary-probe` em Windows 10 22H2 GNU não confirmar leitura autorizada + negação do canário + consulta autenticada `codex.exe` sob a mesma fronteira LPAC, `codex_cli_isolated` / `verified_isolated` e `isolated_probe` permanecem **bloqueados** (`execution_backend_blocked`).
- **Aceite.** **F4-T04.A1 / F4-M02.A2** Separação entre helpers validada no build/smoke; sonda LPAC executada e evidenciada com saída exata; `codex_cli_isolated` estritamente bloqueado se a sonda/consulta autenticada LPAC não passar integralmente.

### F4-T05

**Supervisor multi-tentativa, grants por operação e cancelamento/recuperação (`@laplace/local-service`).** [F4-M02](MILESTONES.md#f4-m02) · §§9, 12, 16 · D1/D15 · INV-01/07/10.

- **Escopo.** Evoluir `TaskSupervisor` e criar `PlannerSupervisor` indexados por `(scope, executionId)`, vincular tentativa a `OperationGrant` específico + base (`head`, `indexStamp`) + worktree dedicada, persistir eventos/`child_pid`/lease, encerrar árvore de processos em cancelamento/queda do sidecar (Job Object + `taskkill /T /F`) e reconciliar interrupções após reinício (`interrupted`, `recoveredAfterRestart: true`) sem reexecutar efeitos automaticamente.
- **Aceite.** **F4-T05.A1 / F4-M02.A1** Múltiplas execuções concorrentes em worktrees dedicadas, cancelamento confirmado e reinício após queda preservam checkout de origem intacto e não duplicam efeitos colaterais.

## Revisão, aplicação local e verificadores (`F4-M03`)

### F4-T06

**Revisão de diff real por tentativa com proveniência e recuperação (`@laplace/local-service`).** [F4-M03](MILESTONES.md#f4-m03) · D8/D20 · INV-04/08.

- **Escopo.** Capturar diff SHA-256 (`f4_execution_diffs` + `f4_diff_blobs`) comparando base da tentativa vs. worktree dedicada (preservando bytes crus `CRLF`), recuperar offline após reinício e persistir aprovação/recusa OCC (`planner.diffReview`) como evento distinto da aplicação no checkout principal.

### F4-T07

**Aplicação local controlada com revalidação OCC e rollback recuperável (`F4-M03.A2`).** [F4-M03](MILESTONES.md#f4-m03) · §§10, 12 · D8/D13/D15 · INV-02/04/10.

- **Escopo.** Exigir aprovação humana vigente do diff + `applyConfirmed: true` + `OperationGrant` válido com `"apply_local"`; capturar backup preventivo via `dirtyOverlayService.capture` (`F3-M04`); revalidar via OCC `HEAD`, `branch`, `indexStamp` e SHA-256 em disco dos arquivos afetados imediatamente antes da escrita; abortar sem sobrescrever edições externas e reverter arquivos gravados em falha parcial no Windows, preservando `CRLF` bit a bit.

### F4-T08

**Verificadores executáveis com vínculo estrito à definição (`F4-M03.A3`).** [F4-M03](MILESTONES.md#f4-m03) · §§11, 16 · D1/D20 · INV-07/10/13.

- **Escopo.** Aprovação humana assina `definitionDigest` canônico (`canonicalJson` + `sha256Hex`) de `(definitionId, argv, cwd, envWhitelist, timeoutMs, privilegeProfile)`. Qualquer modificação de 1 byte nesses parâmetros revoga automaticamente a aprovação (`revoked_by_redefinition`) e exige nova confirmação antes de executar sob ambiente filtrado (`envWhitelist`) e Job Object com timeout drenado.

## Integração Desktop e validação F4

### F4-T09 & F4-T10

**Ponte Tauri `planner_request`, UI Living Systems 2.0 e suítes integradas F4.**

- **Escopo.** Novo comando `planner_request` em `ipc.rs`/`main.rs`/`build.rs`/`desktop.json`/`ipc.ts`, promoção dos fluxos reais de Planejador Git, Pre-Flight e Central de agentes/Verificadores em `PlannerSupervisionView.tsx` com isolamento `INV-01` (`scopeKey` + `generationRef`), atualização da migração em testes legados (`catalogSchemaVersion = 15`), suítes F4 dedicadas e bateria integrada Windows x64 GNU.

## Matriz de Aceites F4

| Aceite      | Critério objetivo                                                                                                                                                                                                                                   | Suíte / Prova                                                                                        |
| ----------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| `F4-M01.A1` | Plano expõe base, alvo, worktree, conflitos e efeitos (`mutatesOrigin: false`); mudança posterior em arquivo/índice/`HEAD` invalida Pre-Flight (`invalidated_by_drift`) e bloqueia execução; `readGitInvariantSnapshot` da origem inalterado.       | `packages/core/test/planner.test.ts`, `apps/local-service/test/f4-planner-preflight.test.ts`         |
| `F4-M02.A1` | `OperationGrant` delimita plano/base/backend/efeitos; worktree dedicada (`is_main = 0`) isola mutações da origem; cancelamento mata árvore de processos; queda abrupta reconcilia como `interrupted` após reinício sem reexecutar efeitos.          | `apps/local-service/test/f4-execution-supervision.test.ts`                                           |
| `F4-M02.A2` | Separação estrita `laplace-git-job` vs `laplace-codex-job` verificada; sonda LPAC documentada sem relaxar ACLs; `codex_cli_isolated` permanece bloqueado até leitura autorizada + negação do canário + consulta autenticada real passarem sob LPAC. | `cargo test` (`codex-job`), `prepare:sidecar`, `smoke-windows.ps1`, `--laplace-codex-boundary-probe` |
| `F4-M03.A1` | Diff verificável por SHA-256 recuperável após reinício; `diffReview` aprova/recusa com proveniência como evento distinto da aplicação (origem inalterada).                                                                                          | `apps/local-service/test/f4-review-apply-verifiers.test.ts`                                          |
| `F4-M03.A2` | `applyLocal` exige confirmação própria + backup `DirtyOverlayManifest` + OCC de `HEAD`/índice/digests; aborta em corrida preservando edições externas; reverte em falha parcial; preserva `CRLF`.                                                   | `apps/local-service/test/f4-review-apply-verifiers.test.ts`                                          |
| `F4-M03.A3` | Aprovação do verificador vincula `definitionDigest` dos 6 campos; alteração de 1 byte revoga aprovação (`revoked_by_redefinition`) e bloqueia execução; processo filho recebe apenas `envWhitelist`.                                                | `packages/core/test/planner.test.ts`, `apps/local-service/test/f4-review-apply-verifiers.test.ts`    |

---

## Nuances técnicas previstas e restrições herdadas de F1–F3

1. **Restrição LPAC em `GetFinalPathNameByHandleW` / `CODEX_HOME` e erro `0xc0000142` (`codex-job/src/confinement.rs`):**
   - Em Windows 10 x64 22H2 GNU, o controle interno (`probe.exe` compilado com toolchain GNU) pode falhar na inicialização DLL (`0xc0000142`) quando dependências do binário/ambiente temporário não têm permissão LPAC ou quando `GetFinalPathNameByHandleW(FILE_NAME_OPENED)` retorna erro 5 (`Access Denied`) em caminhos DOS, quebrando `std::fs::canonicalize()` sobre `CODEX_HOME`.
   - **Ação na F4:** nunca relaxar ACLs do AppContainer LPAC; separar `laplace-git-job` e `laplace-codex-job`, enriquecer diagnósticos em `confinement.rs` e manter `verified_isolated` / `codex_cli_isolated` estritamente bloqueado até prova LPAC autenticada real completa.
2. **Empacotamento dual de auxiliares nativos (`apps/desktop/scripts/prepare-sidecar.mjs` & `tauri.conf.json`):**
   - `prepare-sidecar.mjs` compila e copia ambos `laplace-git-job-<target>.exe` (`--features clone-only`) e `laplace-codex-job-<target>.exe` (completo) listados em `bundle.externalBin`, e `Sidecar::spawn()` repassa `--supervision-helper` com o caminho de `laplace-codex-job.exe` quando presente ao lado do runtime.
3. **Desacoplamento de `mcp_servers={}` em `codexExecArgs` (`packages/agents/src/codex.ts`):**
   - Preservar `codexExecArgs(cwd)` intacto para F2/C03 e introduzir `supervisedCodexExecArgs` exclusivamente para execuções F4 portadoras de `SessionGrant` F2 válido.
4. **Supervisor multi-tentativa (`task-supervisor.ts` & `planner-supervisor.ts`):**
   - Indexar tentativas ativas em `Map` por chave escopada, encerrar árvores de processo em cancelamento/queda e reconciliar tentativas interrompidas após reinício sem reexecutar efeitos.
5. **Proteção via `DirtyOverlayManifest` antes da aplicação (`F3-M04` → `F4-M03.A2`):**
   - Gravar snapshot preventivo via `dirty-overlay-service.ts`, revalidar OCC imediatamente antes de escrever, preservar `CRLF` e reverter qualquer escrita parcial em falha de I/O.
6. **Assinatura canônica de verificadores (`F4-M03.A3`):**
   - Usar `canonicalJson` e `sha256Hex` (`@laplace/core`) sobre os 6 campos da definição para invalidar automaticamente qualquer aprovação quando houver mutação de 1 byte.
