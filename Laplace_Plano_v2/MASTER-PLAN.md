# Laplace · plano de construção do workspace desktop

**Revisão 2 · 19 de novembro de 2026.** Laplace é o nome de trabalho do protótipo. O produto é uma bancada desktop open source para compreender projetos, conversar com o código e supervisionar agentes. A decisão é iniciar pela Sprint 1. A cada release, uso real, falhas observadas e feedback técnico refinam a experiência.

**Comece aqui:** leia o [resumo de uma página](Resumo_Executivo.pdf), abra o [protótipo navegável offline](visual/Workspace.html) e entregue o [prompt da Sprint 1](11-IMPLEMENTATION-BACKLOG.md) ao Codex na pasta dedicada. O pacote contém especificação e protótipo de design; a aplicação Tauri e o adaptador real são entregas futuras.

## As dez decisões centrais

| Pergunta | Decisão |
|---|---|
| 1. O que construir? | Um workspace local em que projeto, tarefa e sessão organizam Git, conversa, execução e revisão. |
| 2. Por que abrir todo dia? | A Home permite continuar uma tarefa, descobrir a sessão que precisa de intervenção e conferir o que mudou em vários projetos. North Star: dias de trabalho com pelo menos um ciclo de projeto concluído e inspecionado. |
| 3. Como usar os precedentes? | Operação inspirada em Orca, continuidade inspirada em Entire e fluidez conversacional inspirada em ChatGPT Desktop. Projetos guiam nossa navegação e os mesmos objetos atravessam todas as telas. |
| 4. Onde está o diferencial técnico? | O estado Git observado, o contexto efetivamente entregue, a execução e a evidência têm identidade própria. Busca, memória, resumo, diff e handoff podem reutilizar essas relações. |
| 5. Qual a primeira experiência? | Home multiprojeto, sidebar persistente, seletor de pasta e visão do projeto. Chat, sessões e revisão passam a ocupar o mesmo shell nos incrementos seguintes. |
| 6. O que o primeiro release faz? | S1 entrega build desktop offline com Git e persistência. A primeira alpha integrada (S3) soma pergunta com fontes, tarefa real no Codex, eventos e prévia de alteração isolada. S4 completa o MVP de revisão e retomada. |
| 7. Qual o núcleo comum? | IDs estáveis de projeto/sessão/tentativa, serviço local, Git, SQLite, seleção com digest e journal de eventos ordenados. |
| 8. Como evitar burocracia? | Capturar origem e versão automaticamente. O humano autoriza mudança de alcance, decide sobre o resultado e pode registrar um motivo. Navegar em um projeto já escolhido é imediato. |
| 9. Qual stack? | Tauri 2, React, Vite, TypeScript, sidecar local, SQLite/FTS5 e Codex como primeiro adaptador. Windows primeiro; testes e empacotamento progressivos em outros sistemas. |
| 10. Como começar amanhã? | Rodar D01–D03 até obter o primeiro caminho janela → IPC → Git real. Em seguida, persistir duas pastas, ligar a Home e testar reinício. |

## Documentos e materiais

| Arquivo | Função |
|---|---|
| [00 · Resumo executivo](00-EXECUTIVE-ASSESSMENT.md) | Decisão, primeiro release e próximos 90 dias |
| [01 · Mercado e concorrentes](01-MARKET-AND-COMPETITORS.md) | Pesquisa preservada e oportunidades de composição |
| [02 · Visão e PRD](02-PRODUCT-VISION-PRD.md) | Pilares, entidades, jornadas, capacidades e aceites |
| [03 · Funcionalidades e inovação](03-FEATURES-AND-INNOVATION.md) | Priorização por release, combinações e experiências futuras |
| [04 · Arquitetura](04-SYSTEM-ARCHITECTURE.md) | Monorepo, contratos, estados Git, persistência e segurança |
| [05 · Direção da experiência](05-UX-UI-DIRECTION.md) | Três direções, Home, navegação e primeiros 30 segundos |
| [06 · Roadmap](06-ROADMAP-AND-EXECUTION.md) | Seis sprints, horas, equipe, demonstrações e calendário |
| [07 · Valor acadêmico e curricular](07-ACADEMIC-AND-CAREER-VALUE.md) | Cinco contribuições e protocolo científico posterior |
| [08 · Open source e adoção](08-OPEN-SOURCE-AND-GO-TO-MARKET.md) | Licença, Brasil, custos, releases e comunidade |
| [09 · Riscos e decisões](09-RISKS-DECISIONS-AND-OPEN-QUESTIONS.md) | Fronteiras de segurança e escolhas reversíveis |
| [10 · North Star e experiência integral](10-NORTH-STAR-AND-PRODUCT-EXPERIENCE.md) | Um dia de uso e definição da unidade de valor |
| [11 · Backlog e prompt Codex](11-IMPLEMENTATION-BACKLOG.md) | Cartões com dependências e primeira demanda copiável |
| [12 · Sistema visual e telas](12-DESIGN-SYSTEM-AND-SCREEN-SPECS.md) | Nove superfícies, componentes, tokens e acessibilidade |
| [Changelog da revisão](REVISION-CHANGELOG.md) | Decisões substituídas e efeitos no plano atual |

**Ambiente.** A revisão foi produzida em workspace documental. Os nomes de projetos e as ações do protótipo ilustram os fluxos. A documentação distingue os comportamentos demonstrados no HTML das integrações a homologar no software nativo. Os caminhos relativos funcionam após extrair o ZIP completo.
