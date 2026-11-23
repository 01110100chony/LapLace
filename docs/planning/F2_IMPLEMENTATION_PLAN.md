# F2 · Plano de implementação

[Fase](ROADMAP.md#f2) · [Fonte normativa](ROADMAP.md#fonte-normativa) · [Milestones](MILESTONES.md#f2-m01) · [Tarefa ativa e resultados](STATUS.md#execução)

**História.** Antes de enviar contexto para o Codex, compilar e inspecionar localmente quais fontes entram, sob qual precedência, orçamento, conflitos e omissões divulgáveis; conceder um `SessionGrant` escopado e revogável para o destino aprovado; expor a mesma seleção via **Gateway MCP local (stdio)** por referência opaca e via **ContextPackage / handoff** versionado; e registrar uma consulta auditada comparável nos dois canais com revisão humana no cockpit.

Execute as tarefas respeitando suas dependências e os invariantes `INV-01/03/04/07/09/10`. Preserve os contratos legados de F1 e C01–C04. Cada `.An` indica condição verificável. Para fechar uma tarefa, registre no [STATUS](STATUS.md#registro-de-entregas) os aceites, diff/commit, comandos, ambiente, saída e limitações. Use Node `24.22.3`, toolchain GNU para checks Rust locais e dados sintéticos/mock para testes automatizados sem chamadas externas de API.

**Caminho crítico da F2.** T01 → T02 → T03 → T04 (`F2-M01`) → T05 → T06/T07 → T08 (`F2-M02`) → T09 → T10 → T11 (`F2-M03`).

## Compilação e preview local (`F2-M01`)

### F2-T01

**Definir os contratos e validadores de runtime da F2.** [F2-M01](MILESTONES.md#f2-m01) · §§8–9, 16 · D6/D7/D10/D18 · INV-01/03/04/09.

- **Contexto e alvos.** [Contratos](../../packages/contracts/src/index.ts), módulo novo [context-compiler.ts](../../packages/contracts/src/context-compiler.ts) e [protocol.test.ts](../../packages/contracts/test/protocol.test.ts).
- **Entrada e saída.** Definir constantes de orçamento/política/TTL, 8 códigos de erro (`compiler_invalid_input`, `destination_unknown`, `destination_denied`, `grant_invalid`, `grant_revoked`, `grant_expired`, `handoff_invalid`, `audit_unavailable`), DTOs para compilação, manifesto público (`CompiledPublicManifest`) vs. preview local (`CompiledContextPreview`), `DestinationPolicy`, `SessionGrantRecord`, `ContextPackage`, `HandoffArtifact`, `HandoffEvaluationResult`, `McpToolResponse`, `AuditedQueryRecord` e as 10 operações IPC `compiler.*` vinculadas a `IdentityScope`.
- **Contratos.** `compiler.compile`, `compiler.grantIssue`, `compiler.grantList`, `compiler.grantRevoke`, `compiler.packageExport`, `compiler.handoffImport`, `compiler.mcpCall`, `compiler.queryRun`, `compiler.auditList`, `compiler.auditReview`. Rejeitar em runtime payloads com escopo trocado, `opaqueRef` inválido, `mandatory_context_exceeded` com itens entregáveis, ou `handoff` sem `requiresReevaluation: true`.
- **Dependências.** Identidade `F1-M03` e contratos F1 existentes.
- **Testes e aceite.** **F2-T01.A1** `parseRequest` e `isResponse` validam todas as 10 operações `compiler.*` e rejeitam entradas malformadas, escopo cruzado e estados inconsistentes, mantendo 100% dos testes legados e F1 aprovados.
- **DoD e evidência.** Tipos, validadores e testes em `protocol.test.ts` aprovados com `pnpm typecheck` e `pnpm test`. **Risco.** Vazamento de metadados locais no DTO público ou relaxamento de limites IPC (`192 KiB`).

### F2-T02

**Implementar o Context Compiler determinístico em domínio puro.** [F2-M01](MILESTONES.md#f2-m01) · §§8–9, 16 · D6/D7/D10 · INV-01/03/04/09.

- **Contexto e alvos.** `@laplace/core` com módulos novos [hash.ts](../../packages/core/src/hash.ts), [context-compiler.ts](../../packages/core/src/context-compiler.ts), exportação em [index.ts](../../packages/core/src/index.ts) e testes em [context-compiler.test.ts](../../packages/core/test/context-compiler.test.ts). Zero I/O, zero `node:*` e `"types": []`.
- **Entrada e saída.** Recebe `IdentityScope`, objetivo, `destinationId`, orçamento em bytes, versões de política/estratégia, candidatos e conflitos prévios. Ordena deterministicamente antes de filtrar para garantir invariância à permutação, aplica precedência estrita (**invariante/decisão canônica → preferência do projeto → perfil pessoal**), remove metadados privados, filtra escopo cruzado e itens `db_only`/`local_only` não divulgáveis, detecta contradições canônicas, deduplica trechos idênticos por digest e aplica orçamento sem truncamento silencioso (emitindo `mandatory_context_exceeded` com lista de excesso quando itens obrigatórios ultrapassam o limite).
- **Contratos.** `resolveDestinationPolicy`, `compileContext`, `sha256Hex` e `canonicalJson` puros usando DTOs de `F2-T01`.
- **Dependências.** [F2-T01](#f2-t01).
- **Testes e aceite.** **F2-T02.A1** Permutações da mesma entrada produzem o mesmo `manifestDigest` e `opaqueRef`s; precedência e conflito material bloqueante suspendem recomendação; orçamento excedido em obrigatório não trunca silenciosamente; destino desconhecido bloqueia entrega preservando preview local; zero metadados privados no manifesto público.
- **DoD e evidência.** Testes puros em `@laplace/core` validando paridade SHA-256 com `node:crypto` e matriz determinística. **Risco.** Dependência acidental de relógio interno ou API Node no core puro.

### F2-T03

**Persistência aditiva v13 e compilação no sidecar.** [F2-M01](MILESTONES.md#f2-m01) · §§8, 18 · D6/D7/D18 · INV-01/03/04/09.

- **Contexto e alvos.** [f2-store.ts](../../apps/local-service/src/f2-store.ts), [context-compiler-service.ts](../../apps/local-service/src/context-compiler-service.ts), [catalog.ts](../../apps/local-service/src/catalog.ts), [main.ts](../../apps/local-service/src/main.ts) e [f2-compiler.test.ts](../../apps/local-service/test/f2-compiler.test.ts).
- **Entrada e saída.** Migração aditiva `#13` (`f2_compiled_manifests`, `f2_session_grants`, `f2_query_audits`, `f2_mcp_access_log`) preservando catálogo existente. Serviço coleta decisões humanas (`canonical_verified` como obrigatórias, `local_only` sujeitas à política), capturas C01/C02 verificadas (sem leitura arbitrária de disco), omissões e conflitos do escopo, executa `compileContext` e grava manifesto/preview em SQLite.
- **Contratos.** `compiler.compile` no dispatcher IPC.
- **Dependências.** [F2-T02](#f2-t02), `F1-M03`, `F1-M04`.
- **Testes e aceite.** **F2-T03.A1** Compilação real no sidecar distingue canônica vs. `local_only`, verifica integridade C01/C02, rejeita `contextId` cruzado e reprova orçamento insuficiente sem truncamento silencioso; migrações antigas e testes existentes mantêm compatibilidade em `catalogSchemaVersion = 13`.
- **DoD e evidência.** `f2-compiler.test.ts` e toda a suíte `local-service` aprovadas. **Risco.** Hardcode de versão de schema em testes legados ou vazamento de caminhos locais no manifesto público.

### F2-T04

**Ponte Tauri, cliente desktop e preview local na UI.** [F2-M01](MILESTONES.md#f2-m01) · §§8, 14 · D7/D8/D10 · INV-01/05/09.

- **Contexto e alvos.** [ipc.rs](../../apps/desktop/src-tauri/src/ipc.rs), [main.rs](../../apps/desktop/src-tauri/src/main.rs), [build.rs](../../apps/desktop/src-tauri/build.rs), [desktop.json](../../apps/desktop/src-tauri/capabilities/desktop.json), [ipc.ts](../../apps/desktop/src/ipc.ts), [ContextCompilerView.tsx](../../apps/desktop/src/ContextCompilerView.tsx), [ContextView.tsx](../../apps/desktop/src/ContextView.tsx), [views.tsx](../../apps/desktop/src/views.tsx), [App.tsx](../../apps/desktop/src/App.tsx) e [styles.css](../../apps/desktop/src/styles.css).
- **Entrada e saída.** Comando fechado `compiler_request` no Rust validando `IdentityScope` em ida e volta para todas as 10 operações `compiler.*`, cliente tipado `desktop.compiler` em `ipc.ts` e interface de compilação/preview local na aba Contexto (destino, orçamento, precedência, conflitos, omissões e itens selecionados antes de qualquer concessão).
- **Contratos.** `compiler_request` e `CompilerRequest` / `ScopePayload`.
- **Dependências.** [F2-T03](#f2-t03).
- **Testes e aceite.** **F2-T04.A1** `cargo test` valida round-trip e rejeição de escopo cruzado das 10 operações; `ipc.test.ts` valida cliente desktop; `pnpm build:web` e `cargo check` GNU passam sem erros.
- **DoD e evidência.** Testes Rust + desktop aprovados e UI acessível para prévia local. **Risco.** Esquecer permissão Tauri (`allow-compiler-request`) ou desalinhamento de `camelCase` entre TS e Rust.

## Autorização e canais de leitura (`F2-M02`)

### F2-T05

**Política de destinos e `SessionGrant` escopado e revogável.** [F2-M02](MILESTONES.md#f2-m02) · §§8–9, 11, 16 · D1/D7/D9/D17 · INV-01/03/07/10.

- **Contexto e alvos.** [session-grant-store.ts](../../apps/local-service/src/session-grant-store.ts) e [f2-store.ts](../../apps/local-service/src/f2-store.ts).
- **Entrada e saída.** Emissão (`compiler.grantIssue`), listagem (`compiler.grantList`), validação estrita a cada uso (`validate`) e revogação imediata (`compiler.grantRevoke`) vinculando `(projectId, bindingId, worktreeId)`, `sessionId`, `manifestDigest`, `policyVersion`, `destinationId`, `allowedOperations` e `expiresAt`. Destino desconhecido ou bloqueado (`local_preview`, `codex_cli_isolated`) impede concessão; `codex_cli_workspace` exige `unconfinedConfirmed: true` e `humanConfirmed: true`.
- **Contratos.** `compiler.grantIssue`, `compiler.grantList`, `compiler.grantRevoke`.
- **Dependências.** [F2-T03](#f2-t03).
- **Testes e aceite.** **F2-T05.A1** Concessão só é emitida para manifesto `ready` e destino permitido; validação recusa escopo cruzado, sessão divergente, destino alterado, manifesto/política divergentes, expiração e revogação imediata.
- **DoD e evidência.** Regras de validação compartilhadas pelos canais MCP, ContextPackage e consulta auditada. **Risco.** Cache em memória mascarando revogação gravada em SQLite por outro processo.

### F2-T06

**Gateway MCP local sobre stdio com referência opaca.** [F2-M02](MILESTONES.md#f2-m02) · §§9, 16 · D1/D7/D14 · INV-01/03/07/09/10.

- **Contexto e alvos.** [mcp-gateway.ts](../../apps/local-service/src/mcp-gateway.ts), [mcp-stdio.ts](../../apps/local-service/src/mcp-stdio.ts), [prepare-sidecar.mjs](../../apps/desktop/scripts/prepare-sidecar.mjs) e [tauri.conf.json](../../apps/desktop/src-tauri/tauri.conf.json).
- **Entrada e saída.** Servidor JSON-RPC 2.0 sobre stdio expondo exclusivamente 3 ferramentas: `laplace_context_summary`, `laplace_context_search` (paginação por cursor sobre itens autorizados do manifesto) e `laplace_context_read` (por `opaqueRef` `ref-[a-f0-9]{16}`, nunca caminho em disco nem SQL arbitrário). Toda chamada (`tools/list`, `tools/call`) revalida o grant diretamente no SQLite e grava auditoria de leitura em `f2_mcp_access_log`.
- **Contratos.** Protocolo MCP stdio (`initialize`, `tools/list`, `tools/call`) + `compiler.mcpCall` para inspeção/teste direto pelo IPC e bundle `mcp-gateway.cjs`.
- **Dependências.** [F2-T05](#f2-t05).
- **Testes e aceite.** **F2-T06.A1** Processo stdio real responde resumo, busca paginada e leitura por `opaqueRef` do manifesto aprovado e interrompe imediatamente com `grant_revoked` se o grant for revogado entre busca e leitura.
- **DoD e evidência.** Gateway compilado em `prepare:sidecar` e testado em processo filho real via stdin/stdout. **Risco.** Escrever logs de diagnóstico em `stdout` corrompendo o canal JSON-RPC.

### F2-T07

**`ContextPackage` versionado e `Handoff` mínimo com reavaliação.** [F2-M02](MILESTONES.md#f2-m02) · §§9, 16 · D7/D14/D20 · INV-03/07/09/10.

- **Contexto e alvos.** [context-package.ts](../../apps/local-service/src/context-package.ts) e integração em [main.ts](../../apps/local-service/src/main.ts).
- **Entrada e saída.** Exportação (`compiler.packageExport`) a partir da mesma seleção aprovada pelo manifesto e grant, verificando digests de cada item e emitindo `ContextPackage` + `HandoffArtifact` opcional (`requiresReevaluation: true`, sem grants nem credenciais). Importação (`compiler.handoffImport`) verifica integridade, escopo, destino e confirmação humana, exigindo obrigatoriamente nova concessão (`requiresNewGrant: true`).
- **Contratos.** `compiler.packageExport`, `compiler.handoffImport`.
- **Dependências.** [F2-T05](#f2-t05).
- **Testes e aceite.** **F2-T07.A1** Pacote e MCP entregam exatamente os mesmos `opaqueRef`s, digests e bytes; importação adulterada, sem confirmação ou cruzada entre projetos falha sem expor payload; importação legítima nunca concede acesso automático.
- **DoD e evidência.** Round-trip de exportação/reavaliação testado em `f2-grants-channels.test.ts`. **Risco.** Pacote carregando metadados internos ou handoff bypassando avaliação de escopo.

### F2-T08

**Executar matriz obrigatória positiva e negativa de segurança e canais.** [F2-M02](MILESTONES.md#f2-m02) · §§9, 17 · INV-01/03/07/09/10.

- **Contexto e alvos.** [f2-grants-channels.test.ts](../../apps/local-service/test/f2-grants-channels.test.ts).
- **Entrada e saída.** Bateria automatizada cobrindo fluxo autorizado ponta a ponta nos dois canais e matriz negativa: (1) escopo cruzado A × B; (2) grant expirado; (3) grant revogado em voo entre busca paginada e leitura no mesmo processo MCP stdio; (4) destino desconhecido/alterado; (5) tentativa de leitura de item omitido, `local_only`, `db_only` ou caminho arbitrário (`../`, caminho absoluto); (6) importação inválida/cruzada/não confirmada de handoff.
- **Contratos.** Todos os contratos de `F2-M02`.
- **Dependências.** [F2-T06](#f2-t06), [F2-T07](#f2-t07).
- **Testes e aceite.** **F2-T08.A1** 100% dos cenários positivos entregam seleção idêntica e 100% dos cenários negativos retornam recusa estruturada com **zero vazamento de bytes ou metadados canário** em saída padrão ou erro.
- **DoD e evidência.** Suíte `f2-grants-channels.test.ts` verde em execução offline. **Risco.** Canário sensível escapar em mensagem de erro ou paginação não revalidar grant.

## Primeira consulta real auditada (`F2-M03`)

### F2-T09

**Trilha auditada de entrega, leituras observadas e revisão humana.** [F2-M03](MILESTONES.md#f2-m03) · §§9, 11, 17 · D1/D3/D7/D19 · INV-01/03/07.

- **Contexto e alvos.** [audit-query-service.ts](../../apps/local-service/src/audit-query-service.ts), [f2-store.ts](../../apps/local-service/src/f2-store.ts) e [main.ts](../../apps/local-service/src/main.ts).
- **Entrada e saída.** Execução controlada (`compiler.queryRun`), listagem (`compiler.auditList`) e revisão humana persistida (`compiler.auditReview`). Registra tentativa (inclusive bloqueios), manifesto e material entregues, leituras efetivamente observadas em `f2_mcp_access_log`, aderência MCP (`observed` / `not_used` / `not_applicable`), citações verificadas por `[ref-...]` e revisão humana (`approved` / `rejected` / `needs_followup`).
- **Contratos.** `compiler.queryRun`, `compiler.auditList`, `compiler.auditReview`.
- **Dependências.** [F2-T08](#f2-t08).
- **Testes e aceite.** **F2-T09.A1** Tentativas negadas e aprovadas são registradas com proveniência; `verified_isolated` permanece bloqueado (`codex_unavailable`) e nunca é promovido a partir de Mock ou Workspace Dev; revisão humana persiste após reinício.
- **DoD e evidência.** Persistência e integridade de citações comprovadas em SQLite. **Risco.** Misturar rótulo de `mock_development` / `unconfined_workspace_development` com `verified_isolated`.

### F2-T10

**Comparação `mcp_stdio` × `context_package`, suporte MCP no adaptador e UI F2.** [F2-M03](MILESTONES.md#f2-m03) · §§9, 17 · D1/D3/D14/D19 · INV-01/03/07.

- **Contexto e alvos.** [codex.ts](../../packages/agents/src/codex.ts), [codex.test.ts](../../packages/agents/test/codex.test.ts), [ContextCompilerView.tsx](../../apps/desktop/src/ContextCompilerView.tsx), [ipc.test.ts](../../apps/desktop/test/ipc.test.ts) e [f2-audited-query.test.ts](../../apps/local-service/test/f2-audited-query.test.ts).
- **Entrada e saída.** `workspaceCodexExecArgs` aceita configuração opcional de servidor MCP stdio local mantendo `mcp_servers={}` por padrão e preservando `codexExecArgs` intacto. Painel F2 na UI expõe grants, exportação/reavaliação de pacote/handoff, execução pareada nos dois canais, leituras MCP observadas, citações e revisão humana.
- **Contratos.** Contratos F2 + `workspaceCodexExecArgs` em `@laplace/agents`.
- **Dependências.** [F2-T04](#f2-t04), [F2-T09](#f2-t09).
- **Testes e aceite.** **F2-T10.A1** Rodadas pareadas sobre o mesmo manifesto e objetivo comparam `mcp_stdio` (com processo stdio real e `observedReads`) vs. `context_package`, verificam citações, testam recusa de `verified_isolated` e recusa de `unconfined_workspace_development` sem confirmação, e persistem revisão após reinício.
- **DoD e evidência.** `f2-audited-query.test.ts`, `codex.test.ts` e `desktop/test/ipc.test.ts` aprovados; consulta externa ao Codex CLI real permanece separada como piloto humano autorizado. **Risco.** Assumir que execução offline com Mock ou suporte no adaptador comprova aderência empírica da CLI externa sem piloto real.

### F2-T11

**Validação integrada da F2 e atualização do registro de entregas.** [F2-M01](MILESTONES.md#f2-m01) · [F2-M02](MILESTONES.md#f2-m02) · [F2-M03](MILESTONES.md#f2-m03) · §17 · `AGENTS.md`.

- **Contexto e alvos.** Todos os pacotes do workspace (`contracts`, `core`, `agents`, `local-service`, `desktop` Web + Rust GNU) e [STATUS.md](STATUS.md).
- **Entrada e saída.** Executar bateria completa (`pnpm lint`, `pnpm typecheck`, `pnpm format:check`, `pnpm test`, `pnpm build:web`, `prepare:sidecar`, `cargo fmt --check`, `cargo test` GNU, `cargo check --features custom-protocol` GNU e `git diff --check`) com Node `24.22.3` e registrar `EV-F2-M01-01`, `EV-F2-M02-01`, `EV-F2-M03-01` no `STATUS.md` mantendo separação estrita entre testes automatizados/Mock e piloto real pendente com Codex CLI autenticado.
- **Contratos.** Definition of Done de `AGENTS.md`.
- **Dependências.** [F2-T10](#f2-t10).
- **Testes e aceite.** **F2-T11.A1** Toda a bateria local passa com `pnpm format:check` = `0`, `prepare:sidecar` empacota `service.cjs` e `mcp-gateway.cjs`, e `STATUS.md` reflete fielmente evidências e pendências reais sem interferir no checkout principal.
- **DoD e evidência.** Relatório consolidado no `STATUS.md` e status limpo/formatado na worktree da F2. **Risco.** Extrapolar resultado offline para garantia de cliente externo ou MSVC sem execução real.
