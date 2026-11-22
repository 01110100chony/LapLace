# Contexto do projeto Laplace

**Atualizado em:** 20/11/2026  
**Raiz canônica observada (realpath.native):** C:\projetos2026\LapLace  
**Nome do produto:** Laplace  
**Escopo:** contexto recuperável deste checkout e das instruções disponíveis nesta conversa. Não representa acesso ao histórico completo da conta anterior.

## LEIA ISTO ANTES DE CONTINUAR O PROJETO

Laplace é um aplicativo desktop Windows x64 para organizar projetos Git locais, inspecionar seu estado, preservar capturas de arquivos e consultar essas capturas com o Codex. O objetivo é permitir retomar o trabalho com contexto e origem verificáveis, mantendo o catálogo local e funcionando offline para tarefas locais.

O checkout está no branch feat/codex-read-adapter, commit 9ccf08a. Já existem a janela Tauri, o catálogo SQLite, inspeção e relocalização de projetos Git, capturas C01, busca FTS5 C02 e um fluxo Codex C03 em desenvolvimento. O bloqueio principal é de segurança: a fronteira que deve provar que uma consulta só lê fontes autorizadas ainda não foi homologada. O modo unconfined_workspace_development pode ler outros arquivos do host. Use-o somente com dados fictícios ou não sensíveis; ele não comprova isolamento. Para desenvolver sem uma CLI real, o modo mock_development é o recomendado pelo README.

**Primeira tarefa recomendada para a nova conta:** implementar e validar a fronteira host de leitura para verified_isolated; demonstrar no Windows um controle positivo que lê a fonte permitida e um controle negativo que recebe acesso negado ao canário externo; depois repetir uma consulta Codex autenticada dentro dessa fronteira. Até essa prova existir, mantenha consultas reais estritas bloqueadas. Veja “Plano de continuidade” para arquivos e critérios.

Antes de editar, leia este documento, AGENTS.md, as seções atuais de C03 no README.md e o estado do Git. Confirme as premissas no checkout atual. Preserve os arquivos de planejamento e protótipos não rastreados; não faça limpeza baseada somente no fato de não estarem no Git.

## 1. Identidade e objetivo

- **Nome:** Laplace. package.json identifica o workspace como laplace; apps/desktop/src-tauri/tauri.conf.json define productName Laplace e identificador br.laplace.desktop. O PRD chama Laplace de “nome de trabalho”, mas a configuração atual confirma o uso no aplicativo.
- **Categoria:** aplicativo desktop de desenvolvimento com Git local, preservação de contexto e adaptador de agente.
- **Problema:** ao alternar entre repositórios e agentes, é difícil reconstruir o estado do projeto, as fontes consultadas e a origem de respostas ou alterações.
- **Objetivo principal:** abrir projetos locais, mostrar seu estado Git, preservar fontes selecionadas, consultar Codex com escopo explícito e, em etapas posteriores, supervisionar tarefas e revisar resultados.
- **Público descrito nos planos:** desenvolvedores brasileiros, freelancers, estudantes avançados e revisores/equipes pequenas. É público pretendido, não validação de mercado ou adoção observada.
- **Idioma e plataforma iniciais:** português brasileiro e Windows x64. Linux/macOS são possibilidades futuras, sem homologação demonstrada neste documento.
- **Operação prevista:** tarefas locais offline; sem conta Laplace/backend cloud no MVP. Consulta real usa a própria CLI autenticada do usuário.

A entrega de longo prazo descrita nos documentos é uma bancada multiprojeto: retomar sessão, consultar fontes com referências, transformar conversa em tarefa, acompanhar execução supervisionada, revisar diff e decidir sobre uma mudança. Também estão planejados GitHub, múltiplas sessões/worktrees, evidências/decisões persistidas e beta. Não são entregas completas do checkout. O plano tem seis sprints: S1 fundação, S2 contexto/chat, S3 operações de agente, S4 Git/evidências, S5 concorrência e S6 inteligência/beta; estimativas são orientadoras.

## 2. Confiabilidade e histórico recuperável

Use estas distinções:

- **Implementado/observado:** sustentado por código, arquivos, Git ou resultado registrado em README/log local.
- **Decisão registrada:** direção documentada em plano/changelog; não prova aprovação em conversa inacessível.
- **Planejado:** proposta ou critério futuro.
- **Não verificado:** evidência insuficiente; não apresente como fato.

Nenhuma conversa anterior a esta solicitação foi acessível. O histórico técnico foi reconstruído pelo Git, README e planos; pedidos, feedbacks e aprovações ausentes desses arquivos não foram inventados.

### Direção documentada

Em 19/11/2026, Laplace_Plano_v2/REVISION-CHANGELOG.md registra a Revisão 2: priorizar desktop sobre CLI, colocar projetos/operações antes de pesquisa, separar commit/índice/árvore de trabalho, priorizar Windows/PT-BR e aprofundar pesquisa após uma implementação funcional. Trate isso como decisão registrada nos documentos, não como transcrição de conversa.

O histórico registra fundação Tauri/Git, barra de título, catálogo SQLite, workspace/relocalização e empacotamento Windows. Em 20/11, os commits evoluíram por C01 captura (479a3e5), C02 busca FTS5 (0e1f4a6), preparação de consulta Codex (d346481) e modos de desenvolvimento Codex (9ccf08a).

### Decisões confirmadas no código ou nas instruções disponíveis

- Tauri 2, React, Vite, TypeScript, host Rust e serviço local Node/TypeScript.
- Git invocado com argumentos, sem interpolação de shell; inspeção evita executar hooks FSMonitor e filtros externos.
- Catálogo SQLite local; host-sidecar por JSON/stdio, sem servidor HTTP local.
- Capturas conservam bytes selecionados, SHA-256, manifesto e metadados Git; a busca local usa SQLite FTS5.
- Grant Codex vinculado a projeto, captura, modo e digest; consultas reais exigem confirmação nativa.
- Segundo README, credenciais vêm da sessão autenticada da CLI e não são copiadas para a área temporária.
- O README alerta que conteúdo sensível com nome não reconhecido ainda pode ser capturado.

### Preferências/restrições explícitas acessíveis

As instruções do checkout mandam usar PowerShell/GNU em Windows sem MSVC, Git for Windows, WebView2, GCC e windres MinGW-w64; usar Node de .node-version e pnpm de package.json; separar evidência local GNU da hospedada MSVC. Fixtures D04 devem registrar a raiz canônica de realpath.native com a caixa do disco. project.inspect exige a raiz Git igual à cadastrada; relocalização confere identidade do checkout e diretório Git.

Esta solicitação permite criar/atualizar somente o Markdown de contexto; não alterar código, ativos, configuração, branches ou worktrees, não instalar dependências e não modificar o histórico Git.

Público, roadmap, pesquisa de mercado e funcionalidades futuras são propostas. Protótipos podem usar nomes/dados fictícios e não comprovam acesso, autorização ou adoção. Não há como validar aprovação de decisões antigas nas conversas inacessíveis.

## 3. Estado real encontrado

### Implementado, conforme código/README

- Janela Tauri, renderer React/Vite, navegação de workspace e visão de projeto.
- Diálogo nativo para selecionar diretório, inspeção Git e resumo de branch/HEAD/alterações.
- Catálogo SQLite persistente, seleção do último projeto, migrações e relocalização validada por identidade da worktree.
- C01: captura de fontes selecionadas, recibos e bytes preservados; histórico e comparação.
- C02: indexação sob demanda por FTS5 e prévia de trechos históricos verificados.
- C03: preparação/autorização de consulta, eventos JSONL, cancelamento, mock e modo de desenvolvimento com CLI real.
- Empacotamento NSIS Windows x64 com runtime Node oficial como sidecar; o usuário não precisa instalar Node/Rust para executar a distribuição. Git continua necessário para operar repositórios.

### Parcial/bloqueado

- A fronteira VerifiedCodexBoundary é requisito para verified_isolated, mas prova de negação fora das fontes autorizadas ainda falta; o README afirma que C03 não está fechado.
- unconfined_workspace_development consulta CLI autenticada em modo somente leitura, mas pode ler outros arquivos do host. Não demonstra confinamento.
- Persistência das conversas e validação das citações são atribuídas a C04 pelo README; não as declare concluídas.
- Logs .validation/c031-final-* têm timestamps entre 16:33 e 16:34 de 20/11. O HEAD 9ccf08a é posterior (16:39); esses logs não provam que o HEAD atual foi validado.
- CI está configurado para Windows 2025/MSVC. Resultado hospedado para HEAD atual não foi consultado. O branch atual não consta nos filtros de push (main e feat/desktop-foundation); PR direcionado aos branches listados é coberto por pull_request. Não inferir existência/estado de PR.

### Planejado/não demonstrado

- Confinamento confiável para escrita/execução, tarefas reais, diff e aplicação revisada.
- Persistência C04 e validação de referências do Codex.
- Clone GitHub, diff por estado Git e aplicação de patch (principalmente S4).
- Worktrees de tarefa, execução concorrente, resumo de atividade e beta pública (S5/S6).
- Assinatura Authenticode e publicação de beta.

## 4. Arquitetura, estrutura e arquivos

```text
Renderer React
  └─ comandos tipados Tauri
       └─ host Rust (comandos permitidos, timeout, supervisão)
            └─ sidecar Node/TypeScript por stdio/JSONL
                 ├─ SQLite, capturas e FTS5
                 ├─ leitor Git
                 └─ adaptador Codex/eventos
```

A UI envia IDs/operações; o serviço resolve caminhos cadastrados. Diálogo nativo seleciona/relocaliza diretórios. Sidecar começa sob demanda e termina com a janela. IPC é v2, 192 KiB/mensagem; README registra timeout do host de 18 s e resumo Git de 7 s.

Catálogo: %LOCALAPPDATA%\br.laplace.desktop\catalog.sqlite3, node:sqlite e journal DELETE. README registra migração 3 para C01 e 4 para C02. FTS é reconstruível; recibos e blobs preservados são históricos.

C01 preserva bytes selecionados e hashes, não uma transação atômica da árvore toda. Mudanças detectadas durante leitura invalidam a geração; mudanças que começam e terminam entre observações podem passar despercebidas. Filtros excluem .git, dependências, caches, symlinks/hard links e padrões comuns de segredo, mas nome/codificação não identificam todos os segredos em texto. A prévia deve ser conferida pelo usuário.

C02 usa FTS5 para nome/caminho/trechos associados a captura e projeto; prévia reabre bytes preservados e verifica manifesto/hash. C03 valida captura/digest e prepara autorização. Modo mock dispensa CLI/rede; workspace usa CLI/área temporária mas não prova leitura confinada.

Árvore real:

```text
apps/
  desktop/                  React, Vite e telas
    src-tauri/              host Rust/Tauri, IPC e configuração
  local-service/            sidecar; catálogo, Git, contexto, busca, Codex
packages/
  contracts/                tipos e validação IPC
  agents/                   Codex e mock
scripts/                    smoke Windows e sonda Codex
Laplace_Plano_v2/            planos e protótipos
```

O plano menciona packages/core, mas esse pacote não existe no checkout atual. A implementação está em apps/local-service, packages/contracts e packages/agents.

Arquivos de entrada:

- README.md: comportamento, comandos, limites, resultados reportados e C01–C03.
- AGENTS.md: ambiente GNU/MSVC, validação e raiz canônica.
- package.json, pnpm-workspace.yaml, pnpm-lock.yaml, .node-version: workspace e versões.
- apps/desktop/src/App.tsx, ContextView.tsx, ContextSearchView.tsx, CodexQueryView.tsx: UI.
- apps/desktop/src/ipc.ts e apps/desktop/src-tauri/src/ipc.rs: ponte host/renderer/sidecar.
- apps/desktop/src-tauri/tauri.conf.json, tauri.windows.conf.json, capabilities/desktop.json: configuração/permissões.
- apps/local-service/src/main.ts, catalog.ts, git.ts, context*.ts e codex.ts: serviços.
- packages/contracts/src/context.ts, context-search.ts, codex.ts; packages/agents/src/codex.ts e mock.ts.
- scripts/smoke-windows.ps1 e scripts/probe-codex-read.mjs.
- .github/workflows/ci.yml: CI Windows MSVC.
- Laplace_Plano_v2/MASTER-PLAN.md, REVISION-CHANGELOG.md, 09-RISKS-DECISIONS-AND-OPEN-QUESTIONS.md e 11-IMPLEMENTATION-BACKLOG.md: direção e planejamento (não rastreados).

## 5. Ambiente e validação

Versões documentadas: Windows x64, WebView2, Git for Windows; para GNU, GCC e windres MinGW-w64 no PATH; Node 24.22.3 (.node-version), pnpm 11.19.0, Rust pacote 1.90+, MSVC CI 1.95.0 e GNU stable; Tauri 2, React 19, Vite 7, TypeScript 5.9, node:sqlite e SQLite 3.54.1 empacotado. Codex real requer CLI/autenticação; README cita perfil estrito 0.141.0 e workspace-dev 0.157.0. Ferramentas instaladas/autenticadas no PATH não foram verificadas.

Desenvolvimento GNU indicado em AGENTS.md:

```powershell
Set-Location 'C:\projetos2026\LapLace'
$env:RUSTUP_TOOLCHAIN = 'stable-x86_64-pc-windows-gnu'
pnpm install --frozen-lockfile
pnpm dev --target x86_64-pc-windows-gnu
```

Caso ausente, instalar toolchain GNU estável com rustfmt via rustup. Não houve instalação nesta tarefa.

Verificações prescritas:

```powershell
$env:RUSTUP_TOOLCHAIN = 'stable-x86_64-pc-windows-gnu'
pnpm lint
pnpm typecheck
pnpm format:check
pnpm test
pnpm build:web
pnpm --filter @laplace/desktop prepare:sidecar
cargo fmt --manifest-path apps/desktop/src-tauri/Cargo.toml --all -- --check
cargo check --manifest-path apps/desktop/src-tauri/Cargo.toml --locked --target x86_64-pc-windows-gnu --features custom-protocol
```

AGENTS.md descreve build GNU de NSIS e smoke por scripts/smoke-windows.ps1. Leia o roteiro do README/script antes de execução. Nenhum teste ou build foi executado para esta documentação.

.github/workflows/ci.yml valida em windows-2025/MSVC: lint, typecheck, formato, testes, build web, sidecar, fmt/check Rust, NSIS e smoke; artifact retido por 14 dias. O branch atual não está no filtro de push. Mantenha resultados locais GNU separados dos hospedados MSVC.

Build inclui node.exe oficial e o sidecar. README diz que instalador não tem assinatura Authenticode, podendo gerar alertas; Git for Windows não é empacotado e é necessário para funções Git.

Variáveis documentadas:

- LAPLACE_CODEX_DEV=mock e LAPLACE_CODEX_MOCK_SCENARIO (fragmented padrão; completed, cancel, timeout, malformed_jsonl, authentication_error, interrupted, preparation_failure, late_after_cancel).
- LAPLACE_CODEX_DEV=workspace: execução real sem confinamento provado; usar só dados fictícios/não sensíveis.
- LAPLACE_CONTEXT_EXCLUDES: caminhos adicionais relativos separados por ponto e vírgula.
  São lidas no startup de desenvolvimento; não grave credenciais neste documento.

## 6. Git e artefatos

Snapshot antes deste documento:

- Raiz canônica: C:\projetos2026\LapLace.
- Branch feat/codex-read-adapter, HEAD 9ccf08a59edd2fa39751c026b7ae8fb5393e743a, feat: habilita modos de desenvolvimento do Codex.
- Única worktree Git observada: C:/projetos2026/LapLace.
- Branches locais: main e feat/desktop-foundation em ad967e1; feat/context-snapshot em 479a3e5; feat/context-search em 0e1f4a6; feat/codex-read-adapter em 9ccf08a.
- Refs remotas observadas: origin/main e origin/feat/desktop-foundation em ad967e1; origin/feat/context-snapshot em 479a3e5; origin/feat/context-search em 0e1f4a6. Nenhuma ref remota para branch atual no snapshot.
- Histórico recente: 1809358 fundação; 6edabb3 titlebar; 192ba60 SQLite; 0785a68 workspace/relocalização; e78b5e6 empacotamento/CI; ad967e1 D04; 479a3e5 C01; 0e1f4a6 C02; d346481 preparação Codex; 9ccf08a modos de dev.
- git status não mostrou mudanças rastreadas ou staged.

Não rastreados no snapshot: Laplace_Plano_Desktop_v2.zip, Laplace_Prototipo_Desktop.html, Laplace_Resumo_Executivo.pdf e Laplace_Plano_v2/ (planos Markdown, PDF e visuais). Preserve até o responsável definir destino. Este documento também é novo e poderá aparecer como não rastreado. .validation/, node_modules/, .pnpm-store/ e saídas geradas são ignorados; artefatos locais não substituem commits ou backup.

Não foram observados conflitos. PRs, outros clones/worktrees, pushes e estado remoto além das refs locais são desconhecidos. Não executar checkout, commit, merge, rebase, reset, remoção ou limpeza para organizar o snapshot.

## 7. Resultados e lições

Resultados abaixo vêm do README/logs; não foram executados nesta tarefa.

- **D04:** README registra 19 testes, lint, typecheck, Prettier, rustfmt, build web e build GNU debug. Automação leu janela mas não acionou controles; seletor e algumas ações não tiveram confirmação visual nesse ciclo.
- **D05/D06:** 24 testes e verificações TS/Rust/build Tauri GNU de produção registrados. Janela GNU validou seletor, navegação por teclado, Git, cache e relocalização; testes cobriram cópia com mesmo HEAD e resposta atrasada.
- **D07:** 26 testes, lint, typecheck, Prettier, rustfmt, cargo check GNU, build web, NSIS e smoke local registrados. Smoke informa Node 24.22.3, SQLite 3.54.1, IPC, Git, reinício/recuperação e catálogo intacto.
- **Limites D07:** Sandbox Windows bloqueado por falta do serviço hvhost; instalação limpa, WebView2 ausente, ciclo completo pela UI instalada e reinstalação na VM ficaram pendentes. Relatório também indica falta de link.exe local; MSVC é destinado ao runner hospedado.
- **C02:** README descreve busca/prévia históricas após reinício em fixture de dois arquivos e informa que MSVC hospedado ainda não havia sido executado para C02.
- **C03.1:** logs .validation/c031-final-* têm timestamps antes do HEAD atual. .validation/d07-smoke-local.log é evidência do D07, não valida branch atual.

Cuidados recorrentes:

1. Diretório temporário e CLI read-only, por si só, não confinam leitura; controle positivo e negativo devem ocorrer sob a mesma política.
2. Caminho textual ou HEAD igual não identificam checkout. Usar identidade raiz/worktree e realpath canônico.
3. Captura é leitura observada, não snapshot transacional do filesystem inteiro; mudanças detectadas invalidam geração, mas mudanças transitórias entre observações podem escapar.
4. Filtros por nomes não encontram todos os segredos no conteúdo textual; conferir seleção/prévia.
5. Distribuição é sem assinatura segundo README; bootstrapper WebView2 pode exigir internet; máquina limpa ainda não foi totalmente homologada.
6. Commit posterior não herda automaticamente testes de logs antigos. Registrar GNU e MSVC separadamente.
7. Laplace_Plano_v2 não é rastreado e contém roadmap; validar planos contra código antes de agir.

## 8. Plano de continuidade

### Prioridade alta

- [ ] **Provar confinamento para verified_isolated.** Estado: bloqueio aberto no README. Começar por packages/agents/src/codex.ts, apps/local-service/src/codex.ts, apps/desktop/src-tauri/src/ipc.rs e apps/desktop/src-tauri/codex-job/src/main.rs. Dependência: política host/Windows verificável. Critério: mesmo processo/perfil lê fonte autorizada e recebe negação ao canário externo; falha de inicialização ou incapacidade de ler fonte válida não é prova. Não confundir Job Object de recursos, pasta temporária ou read-only com confinamento.
- [ ] **Repetir consulta autenticada dentro da fronteira.** Estado: pendente. Usar dados fictícios; registrar CLI/ambiente sem segredo. Critério: consulta concluída dentro da fronteira, autorização/destino/fontes/digest revisados e canário negado; separar resultado real, mock, GNU e MSVC.
- [ ] **Validar HEAD atual.** Evidência posterior a 9ccf08a não foi confirmada. Usar GNU definido em AGENTS.md e obter CI MSVC no commit/PR. Critério: registrar comandos/targets separados e não declarar CI verde sem resultado.

### Prioridade média

- [ ] **C04 após C03 seguro:** persistir conversa/mensagens e validar citações contra bytes preservados. Arquivos: serviço Codex, catálogo/migrações, contracts/codex.ts, CodexQueryView.tsx e testes. Critério: reabrir offline; distinguir referência verificada, ausente e resposta sem fonte; testar isolamento por projeto/restart.
- [ ] **Smoke em Windows limpo/VM suportada:** pendente desde bloqueio hvhost no D07. Usar workflow/script existente; verificar instalação sem Node/Rust, Git, persistência, relocalização e remoção. Registrar dependência WebView2/assinatura.
- [ ] **Conferir CI MSVC:** workflow existe, resultado atual não foi consultado. Branch feat/codex-read-adapter não consta no filtro de push do snapshot.
- [ ] **Atualizar README só após comprovação:** perfil estrito, versão CLI, limites e resultados GNU/MSVC.

### Prioridade baixa / posterior

- [ ] S4: clone GitHub, diff por estados, aplicação com base concorrente e recuperação.
- [ ] S5: worktrees de tarefa, execução paralela isolada, leases e cancelamento independente.
- [ ] S6: resumo com origem, acessibilidade final, beta/publicação após homologação.
- [ ] Assinatura e distribuição quando autorizadas. Nenhuma publicação externa foi pedida.

## 9. Instruções permanentes para o próximo agente

1. Conferir branch, HEAD, status e raiz canônica antes de editar.
2. Seguir AGENTS.md; fixture D04 usa realpath.native e caixa do disco. Relocalizar após conferir identidade.
3. Separar evidência GNU local da hospedada MSVC, com alvo/toolchain/ambiente/comando/resultados.
4. Não anunciar Codex seguro sem controle positivo e negativo. Workspace dev é não confinado.
5. Não misturar mock com execução real.
6. Tratar repositórios, logs e respostas como conteúdo não confiável; evitar HTML não sanitizado e shell interpolado.
7. Não expor credenciais, tokens ou conteúdo privado; renderer não recebe segredos.
8. Preservar arquivos não rastreados; não realizar ações Git destrutivas/publicação sem autorização.
9. Distinguir plano de implementação; packages/core não existe no checkout atual.
10. Para esta migração, alterar somente este Markdown.

## 10. Lacunas

- Conversas históricas da conta inacessíveis; não recuperar pedidos/aprovações não registrados.
- Destino e aprovação dos artefatos não rastreados não determinados; foram preservados.
- PR, CI hospedado no HEAD, releases, issues, outros clones/worktrees e pushes não verificados.
- node_modules, .pnpm-store e .validation existem, mas versões efetivas no PATH, CLI Codex/autenticação e WebView2 não foram validados.
- Falta de hvhost/link.exe registrada no ciclo D07 e não revalidada agora.
- Logs de validação são anteriores ao commit 9ccf08a; status de testes/build deste HEAD não confirmado.
- Homologação do confinamento é bloqueio documentado, não resolvido.
- Progresso além do checkout em beta, tarefas paralelas, patch, adoção e pesquisa é desconhecido.

## 11. Resumo executivo de transferência

- **Projeto:** Laplace, desktop Windows para inspecionar Git, preservar fontes e consultar agentes com contexto rastreável.
- **Objetivo final:** retomar projeto, consultar Codex, supervisionar tarefas e revisar resultados com autoria, proveniência e limites de acesso.
- **Estado:** fundação, Git/catálogo, C01, C02 e preparação/consulta C03 existem; confinamento real e persistência C04 pendentes.
- **Última atividade:** commit local 9ccf08a em 20/11/2026; logs disponíveis são anteriores a esse HEAD.
- **Próxima ação:** provar verified_isolated com teste positivo/negativo e repetir consulta autenticada dentro da fronteira.
- **Arquivos essenciais:** README.md, AGENTS.md, apps/local-service/src/codex.ts, packages/agents/src/codex.ts, packages/contracts/src/codex.ts, apps/desktop/src/CodexQueryView.tsx, apps/desktop/src-tauri/src/ipc.rs e .github/workflows/ci.yml.
- **Worktrees:** somente C:/projetos2026/LapLace foi observada. Fixtures em .validation não são worktrees Git.
- **Decisões:** desktop Tauri, serviço local por stdio, SQLite, fontes com hashes, autorização visível, Windows/PT-BR, sem alegar confinamento sem prova; GNU e MSVC ficam separados.
- **Pendências críticas:** confinamento, consulta segura, validação do HEAD, C04 e CI/instalação limpa.
- **Conclusão:** fronteira passa positivo/negativo; histórico reabre offline; instalador/migrações passam smoke compatível; resultados locais/hospedados permanecem identificados e não se misturam.

## Fontes consultadas

README.md; AGENTS.md e instruções nesta conversa; package.json, .node-version, pnpm-workspace.yaml, manifests e pnpm-lock.yaml; código/configuração Tauri, renderer, contratos, serviço e agentes; .github/workflows/ci.yml, .gitignore e scripts de smoke/sonda; Laplace_Plano_v2 (não rastreado); git status, branches, worktree list, commits e logs .validation.

Não foram feitas instalações, alterações de código/configuração, execuções de teste, operações Git de escrita ou consultas a conversas inacessíveis.
