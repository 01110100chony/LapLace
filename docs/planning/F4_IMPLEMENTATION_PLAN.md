# F4 · Plano de implementação e nuances técnicas previstas

[Fase](ROADMAP.md#f4) · [Fonte normativa](ROADMAP.md#fonte-normativa) · [Milestones](MILESTONES.md#f4-m01) · [Estado e entregas](STATUS.md#execução)

**História.** Permitir ao usuário inspecionar, planejar e simular operações Git sem tocar o checkout de origem (`F4-M01`), delegar execução observável a um agente ou comando em worktree dedicada sob fronteira de confinamento verificada no Windows e grant por operação (`F4-M02`), revisar o diff resultante com proveniência, aplicar alterações locais com revalidação concorrente e aprovar verificadores executáveis com vínculo estrito à definição (`F4-M03`).

**Pré-requisitos satisfeitos (em `LapLace-f2`):** `F1-M03` (identidades lógica/binding/worktree), `F2-M02` (gateway MCP stdio + `SessionGrant` + `ContextPackage`), `F3-M02`/`F3-M04` (retenção CAS, proteção de provas e Dirty Overlay sob OCC), mais base O02/O03 (`TaskSupervisor`, `task-execution-store.ts`, `task-result-store.ts`, `result-review.ts`) e sonda LPAC base (`codex-job/src/confinement.rs`).

**Caminho crítico proposto da F4.** T01 → T02 (`F4-M01`) → T03 → T04 → T05 (`F4-M02`) → T06 → T07 → T08 (`F4-M03`) → T09 → T10.

## Explorer, Pre-Flight e simulação Git (`F4-M01`)

### F4-T01

**Contratos e modelo puro do Git Visual Planner & Pre-Flight (`@laplace/contracts`, `@laplace/core`).** [F4-M01](MILESTONES.md#f4-m01) · §§12, 16 · D8/D11 · INV-02/04/08/10.

- **Escopo.** Novos DTOs `planner.*` em `@laplace/contracts` (plano somente leitura, grafo de base/alvo/worktree, lista de precondições verificáveis, simulação de efeitos e estado `invalidated_by_drift`) e funções puras em `@laplace/core` para classificar risco, conflitos potenciais e comparar snapshot de base esperado vs. observado.
- **Aceite.** **F4-T01.A1** Planos validam escopo completo `IdentityScope` e invalidam automaticamente quando `head`, `indexStamp` ou alvo divergem do esperado.

### F4-T02

**Serviço read-only do Explorer e simulação sem mutação do checkout (`@laplace/local-service`).** [F4-M01](MILESTONES.md#f4-m01) · §§12, 17 · INV-02/04.

- **Escopo.** Inspecionar árvore/ramos/worktrees/conflitos em modo `--no-optional-locks`, gerar `PreFlightCheck` revalidável no momento da execução e validar que simulação e leitura preservam `HEAD`, `.git/index` e `refs` intactos.
- **Aceite.** **F4-T02.A1** Mudança concorrente de `HEAD`/índice/disco invalida o plano antes da execução; nenhuma ref/índice de origem é alterada.

## Execução observável em worktree dedicada e confinamento (`F4-M02`)

### F4-T03

**Ciclo de vida de worktree dedicada isolada (`git worktree` / sandbox checkout).** [F4-M02](MILESTONES.md#f4-m02) · §§10–12 · D13/D15 · INV-02/04.

- **Escopo.** Criar, vincular (`worktrees.is_main = 0`), limpar e recuperar worktrees dedicadas a uma execução sem tocar a worktree principal do usuário; capturar Dirty Overlay prévio se necessário para transferência controlada de contexto/estado sem contaminar o checkout principal.

### F4-T04

**Prova real da fronteira Windows LPAC + `codex_cli_isolated` (`codex-job`, `@laplace/agents`).** [F4-M02](MILESTONES.md#f4-m02) · §9, §17 · D1/D3/D14 · INV-07/10.

- **Escopo.** Resolver o bloqueio observado em `confinement.rs` com `CODEX_HOME`, habilitar compilação do helper completo (`laplace-codex-job` sem `--features clone-only`) para o runtime empacotado, parametrizar `codexExecArgs` para permitir apenas o servidor MCP autorizado pelo `SessionGrant` vigente e comprovar com `codex.exe` autenticado leitura da fonte permitida + `ERROR_ACCESS_DENIED` no canário externo.
- **Aceite.** **F4-T04.A1 / F4-M02.A2** Sonda autenticada real passa em AppContainer LPAC negando canário externo; sem essa prova, `codex_cli_isolated` permanece bloqueado.

### F4-T05

**Supervisor multi-tentativa, grants por operação e cancelamento/recuperação (`@laplace/local-service`).** [F4-M02](MILESTONES.md#f4-m02) · §§9, 12, 16 · D1/D15 · INV-01/07/10.

- **Escopo.** Evoluir `TaskSupervisor` e `task-execution-store.ts` para vincular execução a `IdentityScope` + worktree dedicada + `OperationGrant` específico, persistir base/eventos/PID/Job, encerrar árvore de processos em cancelamento/perda do pai e recuperar estado interrompido após reinício sem reexecutar efeitos automaticamente.
- **Aceite.** **F4-M05.A1 / F4-M02.A1** Cancelamento confirmado e reinício após queda preservam checkout de origem intacto e não duplicam efeitos colaterais.

## Revisão, aplicação local e verificadores (`F4-M03`)

### F4-T06

**Revisão de diff real por tentativa com proveniência e recuperação (`@laplace/local-service`).** [F4-M03](MILESTONES.md#f4-m03) · D8/D20 · INV-04/08.

- **Escopo.** Estender `result-review.ts` e `working-tree.ts` para comparar a worktree dedicada contra a base registrada da tentativa, exibir diff verificável por SHA-256 e persistir aprovação/recusa como evento distinto da aplicação no checkout principal.

### F4-T07

**Aplicação local controlada com revalidação OCC e rollback recuperável (`F4-M03.A2`).** [F4-M03](MILESTONES.md#f4-m03) · §§10, 12 · D8/D13/D15 · INV-02/04/10.

- **Escopo.** Antes de materializar qualquer alteração aprovada na worktree principal, exigir confirmação humana própria + captura preventiva (`DirtyOverlayManifest` da F3) + revalidação de `HEAD`, `indexStamp` e arquivos afetados. Abortar imediatamente em corrida ou divergência sem sobrescrever edições externas.

### F4-T08

**Verificadores executáveis com vínculo estrito à definição (`F4-M03.A3`).** [F4-M03](MILESTONES.md#f4-m03) · §§11, 16 · D1/D20 · INV-07/10/13.

- **Escopo.** Aprovação humana assina digest canônico de `(definitionId, argv, cwd, envWhitelist, timeoutMs, privilegeProfile)`. Qualquer modificação nesses parâmetros invalida a aprovação vigente e exige nova confirmação antes de executar testes, builds ou linters supervisionados.

## Integração Desktop e validação F4

### F4-T09 & F4-T10

**Ponte Tauri `planner_request`, UI do Planner/Supervisão Living Systems 2.0 e suítes integradas F4.**

- **Escopo.** Novos comandos IPC escopados em `ipc.rs`/`ipc.ts`, integração dos painéis de Planner, Pre-Flight, Worktree/Execução e Verificadores na barra do projeto em `Laplace`, testes offline completos (`F4-M01`–`F4-M03`) mais ensaio em fronteira LPAC para `F4-M02.A2`.

---

## Nuances técnicas previstas e restrições herdadas de F1–F3

As nuances abaixo decorrem diretamente da inspeção do código atual em `C:/projetos2026/LapLace-f2` e devem orientar a implementação da F4 desde `F4-T01`:

1. **Restrição LPAC em `GetFinalPathNameByHandleW` / `CODEX_HOME` (`codex-job/src/confinement.rs` e `README.md`):**
   - Na sonda já existente (`--laplace-codex-boundary-probe`), o AppContainer LPAC no Windows 10 x64 22H2 lê o arquivo autorizado e recebe `ERROR_ACCESS_DENIED` no canário externo, porém `GetFinalPathNameByHandleW` com `FILE_NAME_OPENED` retorna erro 5 (`Access Denied`) para caminhos DOS enquanto apenas `VOLUME_NAME_NT` resolve. Isso faz `std::fs::canonicalize()` dentro de `codex.exe` (`0.157.0`) falhar ao resolver `CODEX_HOME`.
   - **Ação na F4:** investigar em `F4-T04` o posicionamento/ACL do `CODEX_HOME` efêmero ou estratégia equivalente para o token LPAC e testar obrigatoriamente contra `--laplace-codex-boundary-probe <codex.exe>` com autenticação; caso a CLI continue incompatível com o perfil LPAC sem violar a fronteira do canário, manter `verified_isolated` tecnicamente bloqueado conforme `INV-07` em vez de relaxar o AppContainer.

2. **Empacotamento do helper nativo com e sem `--features clone-only` (`apps/desktop/scripts/prepare-sidecar.mjs`):**
   - Atualmente `prepare-sidecar.mjs` compila `apps/desktop/src-tauri/codex-job` com `--features clone-only` para produzir `laplace-git-job-<target>.exe` (deixando `confinement.rs` e `--laplace-codex-job` fora do binário de produção), e só compila o binário completo `laplace-codex-job.exe` quando `prepare:sidecar:dev` roda com `LAPLACE_CODEX_DEV=workspace`.
   - **Ação na F4:** ao habilitar `F4-M02` em produção, atualizar `prepare-sidecar.mjs`, `tauri.conf.json` e o host Rust para incluir e verificar explicitamente o auxiliar completo com isolamento, separando permissões de `--laplace-clone-job`, `--laplace-codex-job` e verificadores.

3. **Desacoplamento de `mcp_servers={}` em `codexExecArgs` (`packages/agents/src/codex.ts`):**
   - Hoje `codexExecArgs(cwd)` injeta fixamente `-c mcp_servers={}` e `--sandbox read-only`.
   - **Ação na F4:** evitar mutar o comportamento de `F2`/`C03` quando `mcp_servers` não for autorizado; introduzir um construtor parametrizado apenas para execuções em F4 portadoras de `SessionGrant` válido, injetando unicamente o comando stdio de `mcp-gateway.cjs` vinculado ao `(grantId, sessionId, manifestDigest, policyVersion)` e mantendo `web_search="disabled"`, `--strict-config` e `--ignore-user-config`.

4. **Limite atual do `TaskSupervisor` (`apps/local-service/src/task-supervisor.ts`):**
   - O `TaskSupervisor` atual suporta um único processo `active` em memória por sidecar, sem vinculação a `worktreeId` nem controle de processos externos reais por Job Object em múltiplos planos concorrentes.
   - **Ação na F4:** indexar execuções ativas por `(scope, executionId)`, persistir estado terminal/interrompido no SQLite em encerramento abrupto e acoplar limpeza segura via `temporary-workspace.ts` / `git worktree remove` apenas após revisão humana ou expiração explícita.

5. **Proteção de alterações locais via `DirtyOverlayManifest` antes da aplicação (`F3-M04` → `F4-M03.A2`):**
   - Aplicações parciais no Windows estão sujeitas a locks de arquivo aberto (antivírus/editor/build) e conversões `CRLF`/`LF` implícitas caso o cliente normalize texto.
   - **Ação na F4:** antes de aplicar qualquer patch da F4 sobre a worktree de destino, gravar um snapshot preventivo usando a infraestrutura de `dirty-overlay-service.ts` (preservando bytes crus `CRLF` e checando `indexStamp` + `HEAD` + arquivos alvo via OCC), tratando falha parcial sem destruir estado prévio do usuário.

6. **Assinatura canônica de verificadores (`F4-M03.A3`) seguindo o modelo da F3:**
   - Reaproveitar `canonicalJson` e `sha256Hex` (`@laplace/core`) já validados em F2/F3 para vincular a aprovação do verificador ao digest completo de definição/argumentos/diretório/ambiente/timeout/privilégio — garantindo a mesma rigidez de invalidação observada em `exportExceptionGrant` quando qualquer campo muda.
