# F3 · Plano de implementação

[Fase](ROADMAP.md#f3) · [Fonte normativa](ROADMAP.md#fonte-normativa) · [Milestones](MILESTONES.md#f3-m01) · [Estado e entregas](STATUS.md#execução)

**História.** Responder corretamente o que se sabia em uma data conhecida (`K`) sobre qualquer intervalo de validade (`V`) preservando histórico e conflitos após correções retroativas parciais; navegar na timeline causal do KGRAPH distinguindo ligação confirmada, deriva objetiva, inferência e sinal verificador; reter provas e bytes no CAS administrado com pins, proteção à última prova ativa, cota e expurgo retomável sem ressurgimento; governar propostas na caixa de memória e exportações elegíveis; e capturar/reconstruir Dirty Overlays fiéis sob controle de concorrência otimista (OCC).

Execute as tarefas por dependência (`F3-M01` → `F3-M02` → `F3-M03` → `F3-M04`), respeitando os invariantes `INV-02/03/04/06/08/09/10/11/14`, preservando todos os contratos existentes (`F1`, `F2`, `C01`–`C04`, `G01`–`G03`, `O01`–`O03`) e mantendo execução determinística offline sem chamadas externas nem mutação do checkout de origem.

**Caminho crítico da F3.** T01 → T02 → T03 (`F3-M01`) → T04 → T05 (`F3-M02`) → T06 → T07 (`F3-M03`) → T08 → T09 (`F3-M04`) → T10 → T11 → T12.

## Temporalidade e primeira projeção do KGRAPH (`F3-M01`)

### F3-T01

**Contratos e validadores de runtime da F3 (`@laplace/contracts`).** [F3-M01](MILESTONES.md#f3-m01) · §§7, 10–13, 16 · D4/D5/D6/D9/D13/D17 · INV-02/03/04/06/08/09/10/11/14.

- **Contexto e alvos.** [Contratos](../../packages/contracts/src/index.ts), módulo [memory.ts](../../packages/contracts/src/memory.ts) e [protocol.test.ts](../../packages/contracts/test/protocol.test.ts).
- **Entrada e saída.** 11 códigos de erro F3 (`memory_invalid_input`, `memory_not_found`, `memory_conflict`, `pin_quota_exceeded`, `pin_protected`, `purge_in_progress`, `export_denied`, `export_exception_invalid`, `overlay_race_detected`, `overlay_blob_missing`, `overlay_unsafe_target`) e 22 operações escopadas `memory.*` vinculadas a `IdentityScope`. Validação estrita de intervalos bitemporais (`validFrom < validTo` ou aberto), distinção de sinais KGRAPH (`confirmed_link`, `objective_drift`, `inference`, `verifier_signal`), exceções de exportação ligadas a `(bundleDigest, destinationId, policyVersion)` e manifestos de overlay fiel.
- **Testes e aceite.** **F3-T01.A1** `parseRequest` e `isResponse` validam todas as 22 operações `memory.*` e rejeitam intervalos invertidos, escopo cruzado e estados inválidos sem quebrar F1/F2/C01–C04.

### F3-T02

**Motor bitemporal V/K, projeção KGRAPH e governança pura de exportação (`@laplace/core`).** [F3-M01](MILESTONES.md#f3-m01) · [F3-M03](MILESTONES.md#f3-m03) · §§7, 11–13 · INV-03/04/06/08/09/10/11/14.

- **Contexto e alvos.** Módulo puro [memory.ts](../../packages/core/src/memory.ts) exportado em [index.ts](../../packages/core/src/index.ts) e testes em [memory.test.ts](../../packages/core/test/memory.test.ts). Zero I/O, zero `node:*`, `"types": []`.
- **Entrada e saída.** `applyPartialCorrection` fecha a revisão vigente em `knownTo = K2` e gera segmentos imutáveis de resíduo esquerdo `[validFrom, correctFrom)`, segmento corrigido `[correctFrom, correctTo)` e resíduo direito `[correctTo, validTo)` em `knownFrom = K2`; `projectBitemporalState` responde exatamente o conhecido em qualquer par `(K, V)` e destaca conflitos materiais; `projectKgraphTimeline` separa sinais objetivos de inferência e verificação; `scanExportItems` e `evaluateExportGovernance` aplicam política de maior restrição.
- **Dependências.** [F3-T01](#f3-t01).
- **Testes e aceite.** **F3-T02.A1** Correção parcial preserva exatamente `K1`, recorta apenas o intervalo em `K2` com resíduos intactos, expõe conflitos e recusa `db_only` ou exceção de digest/destino alterados.

### F3-T03

**Persistência SQLite v14 e serviço bitemporal/timeline (`F3-M01`).** [F3-M01](MILESTONES.md#f3-m01) · §§7, 12, 18 · D6/D8/D11/D15 · INV-04/08/11/14.

- **Contexto e alvos.** [f3-store.ts](../../apps/local-service/src/f3-store.ts), [catalog.ts](../../apps/local-service/src/catalog.ts), [bitemporal-service.ts](../../apps/local-service/src/bitemporal-service.ts), [main.ts](../../apps/local-service/src/main.ts) e [f3-bitemporal-timeline.test.ts](../../apps/local-service/test/f3-bitemporal-timeline.test.ts).
- **Entrada e saída.** Migração aditiva `#14` preservando tabelas F1/F2/legado. `memory.claimRecord`, `memory.claimCorrect`, `memory.relationRecord` e `memory.timeline` respondem consultas para múltiplas datas `K` e `V`, filtram por tipo/sinal e resolvem prova verificada ou lacuna explícita sem mutar histórico nem Git.
- **Dependências.** [F3-T02](#f3-t02), `F1-M04`.
- **Testes e aceite.** **F3-T03.A1** Ensaio §7 com dois `K`, resíduos esquerdo/direito, conflito material visível, separação de sinais na timeline e resolução de prova/lacuna preservando `HEAD`/`.git/index`/`refs`.

## CAS administrado, pins, retenção e expurgo retomável (`F3-M02`)

### F3-T04

**Armazenamento CAS, publicação atômica e política de cota.** [F3-M02](MILESTONES.md#f3-m02) · §§10–11, 18 · D5/D13 · INV-04/06/14.

- **Contexto e alvos.** [cas-store.ts](../../apps/local-service/src/cas-store.ts), [f3-store.ts](../../apps/local-service/src/f3-store.ts).
- **Entrada e saída.** Gravação atômica `tmp -> SHA-256 -> rename` em `<dataDir>/cas`, verificação de bytes contra digest, controle de cota máxima e regra estrita commit-before-publish (falha de gravação/cota não publica manifesto).
- **Dependências.** [F3-T03](#f3-t03).

### F3-T05

**Pins seletivos, GC protegido e expurgo em etapas retomável com reconciliação de tombstones.** [F3-M02](MILESTONES.md#f3-m02) · §§10–11, 16–17 · D5/D13/D17 · INV-04/06/14.

- **Contexto e alvos.** [pin-purge-service.ts](../../apps/local-service/src/pin-purge-service.ts) e [f3-cas-pins-purge.test.ts](../../apps/local-service/test/f3-cas-pins-purge.test.ts).
- **Entrada e saída.** `memory.pinCreate`, `memory.pinList`, `memory.pinVerify`, `memory.pinRelease`, `memory.gcRun`, `memory.purgeStart`, `memory.purgeResume`, `memory.purgeStatus`. Protege obrigatoriamente a última prova arquivada de decisão ou claim ativa (`pin_protected`), verifica bytes fixados após perda da origem enquanto referência simples revela lacuna, e persiste tombstone SQLite + `f3-purge-tombstones.json` permitindo retomar expurgo interrompido sem ressuscitar payload em backups restaurados.
- **Dependências.** [F3-T04](#f3-t04).
- **Testes e aceite.** **F3-T05.A1** Pin sobrevive à perda da origem; falha de gravação/cota não publica manifesto; GC preserva última prova ativa; expurgo interrompido retoma após reinício e backup SQLite pré-expurgo com tombstone suprime o item sem ressurgimento.

## Inbox humana e portabilidade governada (`F3-M03`)

### F3-T06

**Inbox de memória com deduplicação, expiração, rejeição e promoção humana.** [F3-M03](MILESTONES.md#f3-m03) · §§7, 13 · D4/D6/D9 · INV-03/06/11.

- **Contexto e alvos.** [inbox-export-service.ts](../../apps/local-service/src/inbox-export-service.ts) (`memory.inboxSubmit`, `memory.inboxList`, `memory.inboxReview`).
- **Entrada e saída.** Agrupamento de duplicatas idênticas por escopo/alvo, expiração automática sem promoção, rejeição registrando feedback local mínimo (`f3_local_feedback`) sem promover, e aprovação humana confirmada criando revisão bitemporal com autoridade e origem.
- **Dependências.** [F3-T03](#f3-t03).

### F3-T07

**Preview de exportação, scanner de segredos e exceção escopada (`F3-M03`).** [F3-M03](MILESTONES.md#f3-m03) · §§9, 11, 16 · D9/D17/D20 · INV-03/09/10.

- **Contexto e alvos.** [inbox-export-service.ts](../../apps/local-service/src/inbox-export-service.ts) (`memory.exportPreview`, `memory.exportExceptionGrant`, `memory.exportExecute`) e [f3-inbox-export.test.ts](../../apps/local-service/test/f3-inbox-export.test.ts).
- **Entrada e saída.** Preview classifica elegibilidade, executa scanner de segredos e impõe restrição mais forte; `db_only` é recusado incondicionalmente; exceção escopada só vale para `(bundleDigest, destinationId, policyVersion)` exatos e trilha redigida fica gravada no catálogo.
- **Dependências.** [F3-T05](#f3-t05), [F3-T06](#f3-t06).
- **Testes e aceite.** **F3-T07.A1** Matriz cobrindo deduplicação, expiração, rejeição, promoção humana, recusa `db_only`, bloqueio por segredo, validade da exceção escopada e invalidação ao mudar digest ou destino.

## Dirty Overlay fiel condicionado a OCC (`F3-M04`)

### F3-T08

**Captura read-only multiestágio/CRLF/links/gitlink e verificação OCC.** [F3-M04](MILESTONES.md#f3-m04) · §§10, 16–18 · D13 · INV-02/04.

- **Contexto e alvos.** [dirty-overlay-service.ts](../../apps/local-service/src/dirty-overlay-service.ts) (`memory.overlayCapture`, `memory.overlayList`, `memory.overlayVerify`).
- **Entrada e saída.** Captura sem modificar `HEAD`, índice ou refs cobrindo `HEAD` ausente, múltiplos estágios do índice, preservação byte a byte incluindo `CRLF`, deleções, symlinks/junctions e gitlinks (`160000`). Validação pré/pós captura com aborto (`overlay_race_detected`) em qualquer corrida concorrente e persistência de blobs no CAS antes de publicar manifesto.
- **Dependências.** [F3-T04](#f3-t04).

### F3-T09

**Reconstrução isolada em destino descartável e suite §17 (`F3-M04`).** [F3-M04](MILESTONES.md#f3-m04) · §§10, 17–18 · D13 · INV-02/04.

- **Contexto e alvos.** [dirty-overlay-service.ts](../../apps/local-service/src/dirty-overlay-service.ts) (`memory.overlayReconstruct`) e [f3-dirty-overlay.test.ts](../../apps/local-service/test/f3-dirty-overlay.test.ts).
- **Entrada e saída.** Exige `disposableTargetConfirmed: true` e caminho fora de raízes cadastradas, checkouts e `dataDir` (`overlay_unsafe_target`); recusa blobs ausentes (`overlay_blob_missing`); materializa bytes e reporta lacunas explícitas em gitlinks/links não portáveis mantendo origem intacta.
- **Dependências.** [F3-T08](#f3-t08).
- **Testes e aceite.** **F3-T09.A1** Fixture §17 completa aprovada com verificação byte a byte do destino reconstruído, aborto OCC em corrida real, erro em blob faltante, recusa de alvo inseguro e `HEAD`/`.git/index`/`refs` inalterados.

## Integração Desktop e homologação F3

### F3-T10

**Ponte Tauri Rust (`memory_request`) e cliente desktop.** [F3-M01](MILESTONES.md#f3-m01)–[F3-M04](MILESTONES.md#f3-m04) · INV-01/05.

- **Contexto e alvos.** [ipc.rs](../../apps/desktop/src-tauri/src/ipc.rs), [main.rs](../../apps/desktop/src-tauri/src/main.rs), [build.rs](../../apps/desktop/src-tauri/build.rs), [desktop.json](../../apps/desktop/src-tauri/capabilities/desktop.json), [ipc.ts](../../apps/desktop/src/ipc.ts), [ipc.test.ts](../../apps/desktop/test/ipc.test.ts).
- **Testes e aceite.** **F3-T10.A1** `all_memory_variants_round_trip_and_match_scope` no Rust e testes de escopo cruzado em `apps/desktop/test/ipc.test.ts` aprovados.

### F3-T11

**Superfície Memória Living Systems 2.0 no desktop.** [F3-M01](MILESTONES.md#f3-m01)–[F3-M04](MILESTONES.md#f3-m04) · INV-01/04/05/09.

- **Contexto e alvos.** [MemoryWorkspaceView.tsx](../../apps/desktop/src/MemoryWorkspaceView.tsx), [navigation.ts](../../apps/desktop/src/navigation.ts), [views.tsx](../../apps/desktop/src/views.tsx), [App.tsx](../../apps/desktop/src/App.tsx).
- **Entrada e saída.** Nova seção de projeto `Memória` integrada ao cockpit Living Systems 2.0 com isolamento `INV-01` por `scopeKey` e geração, exibindo timeline bitemporal V/K e sinais KGRAPH, pins/cota/GC/expurgo, caixa de entrada/exportação governada e overlay fiel.
- **Dependências.** [F3-T10](#f3-t10).
- **Testes e aceite.** **F3-T11.A1** `pnpm typecheck`, `pnpm build:web` e `pnpm lint` aprovados sem erros.

### F3-T12

**Validação integrada F3 e registro no `STATUS.md`.** [F3-M01](MILESTONES.md#f3-m01)–[F3-M04](MILESTONES.md#f3-m04) · `AGENTS.md`.

- **Contexto e alvos.** Toda a árvore `LapLace-f2` e [STATUS.md](STATUS.md).
- **Testes e aceite.** **F3-T12.A1** Bateria completa (`pnpm lint`, `pnpm format:check` = `0`, `pnpm typecheck`, `pnpm test`, `pnpm build:web`, `prepare:sidecar` + smoke `mcp-gateway.cjs`, `cargo fmt/test/check --features custom-protocol` GNU e `git diff --check`) aprovada e evidenciada em `STATUS.md`.

## Nuances técnicas e limites documentados (F3)

1. **Coexistência entre `decisions` (F1) e `f3_claims` (F3):** `decisions` / `decision_revisions` continua governando `project.resume` e alimentando os candidatos do `ContextCompilerService` (F2) para preservar integralmente F1/F2. `f3_claims` / `f3_claim_revisions` implementa a temporalidade bitemporal `V/K` com correções retroativas parciais e timeline `KGRAPH`. Em evoluções futuras que exponham revisões `f3_claims` ao compilador F2, manter compatibilidade de leitura com `decisions` v11 e projeção explícita por escopo `IdentityScope`.
2. **Symlinks (`120000`), gitlinks (`160000`) e NTFS no Dirty Overlay (`F3-M04`):**
   - Criar links simbólicos de arquivo no Windows sem elevação ou Developer Mode falha com `EPERM`. Por isso, `dirty-overlay-service.ts` registra o destino de entradas `120000` (tanto de worktree via `readlink` quanto do índice via blob `120000`) com lacuna explícita (`symlink_target_only`), e a reconstrução reporta `skipped_gap` sem criar links parciais nem falhar por permissão.
   - Gitlinks (`160000`) apontam para commit OIDs de submódulos, não para blobs Git; portanto `dirty-overlay-service.ts` filtra `mode !== "160000"` antes de consultar `repo.blobs(...)` (evitando erro `git_failed` em `git cat-file --batch`), registra `gitlinkOid` e marca lacuna `gitlink_pointer_only` na reconstrução.
3. **Fronteira do controle OCC e destino de reconstrução:** `dirty-overlay-service.ts` valida dupla leitura (`readIndexStamp` em nanosegundos + comparação de status + re-leitura de bytes/SHA-256 por arquivo) antes de gravar no CAS e SQLite, declarando em `occLimits` a ausência de lock exclusivo do sistema de arquivos sobre escritas concorrentes externas. `overlayReconstruct` exige `disposableTargetConfirmed: true`, caminho absoluto e ausência de sobreposição bidirecional (`pathsOverlap`) com `dataDir`, `worktree.root` ou qualquer raiz em `projects`.
4. **Reconciliação de expurgo anti-ressurreição e resolução de provas:** o journal atômico `f3-purge-tombstones.json` (`tmp → rename` em `dataDir`) é reconciliado na abertura de `openCatalog`, suprimindo itens purgados mesmo após restauração de backup `.sqlite3` pré-expurgo. Na timeline, `objective_drift` detectado para revisões visíveis recebe `recordedAt = revision.knownFrom` (garantindo consistência temporal para consultas históricas `K` menores que o relógio de parede atual).
5. **Superfície standalone Vite:** ao abrir o frontend isolado via `vite` sem o host Tauri/sidecar, as telas exibem a UI completa, mas chamadas IPC (`desktop.memory.*`) requerem o aplicativo desktop Tauri conectado ao sidecar Node.
