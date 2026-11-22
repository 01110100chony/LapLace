# Resumo executivo · construir a bancada de projetos

**Decisão de execução.** Começar pelo aplicativo desktop open source, em português brasileiro, para quem alterna entre repositórios e coding agents. A pessoa abre a bancada para entender o estado de um projeto, conversar sobre o código, iniciar uma tarefa e revisar seu resultado. O valor recorrente aparece quando essas ações preservam projeto, sessão, contexto e origem das mudanças.

**Mudança de direção.** Desktop e projetos passam à frente da CLI. A memória e a revalidação de evidências passam a servir ao chat, às sessões, ao diff e ao retorno ao trabalho. Orca inspira a operação de agentes, Entire inspira continuidade e ChatGPT Desktop inspira a interação cotidiana. O formato de contexto pode evoluir junto com a implementação.

**Stack escolhida.** Tauri 2 + React + Vite + TypeScript. Host Rust com IPC limitado, serviço local TypeScript, Git, SQLite/FTS5 e adaptador Codex por CLI com eventos JSONL. O aplicativo funciona offline para navegar, inspecionar e reler histórico. O usuário autentica o seu provedor quando decide usar um agente.

**Primeiro release integrado.** Abrir um clone local, ver branch e mudanças reais, fazer uma pergunta com fontes, criar uma tarefa, autorizar o Codex, acompanhar os eventos e abrir o resultado ou o diff em área isolada. Fechar e retornar recupera a sessão. A primeira build da Sprint 1 já entrega os projetos e a inspeção Git; a alpha da Sprint 3 fecha o ciclo com agente. A Sprint 4 acrescenta clone GitHub pela interface, comparação detalhada de estados e aplicação revisada.

**Direção visual.** A Home mostra o que continuar, quem está trabalhando e onde uma decisão humana faz diferença. Projetos ficam na sidebar, conversa e código ocupam o centro e fontes aparecem em um inspetor. No protótipo, uma tarefa de exemplo no NexTM precisa de revisão enquanto uma sessão do Iuris continua em execução.

| Horizonte solo | Resultado esperado |
|---|---|
| Primeiros 7 dias | Montar o workspace, abrir a janela Tauri e ligar a primeira leitura Git. |
| 30 dias | Build executável com dois projetos reais, seleção durável e navegação offline. |
| 60 dias | Chat sobre repositório real com Codex e referências; supervisor em integração. |
| 90 dias | Alpha com tarefa executada, saída inspecionável, diff básico e recuperação. Ampliar Git e evidências conforme a capacidade. |

**Riscos que afetam a entrega.** Empacotar e testar o sidecar no Windows ainda na S1. Validar isolamento real antes de liberar escrita pelo agente. Vincular cada resultado à entrada efetiva para proteger edições locais e evitar que um teste antigo pareça válido sobre uma alteração nova. A previsão assume 15–25 h/semana de desenvolvimento individual e pode mudar com esses testes.

**Próxima ação concreta.** Abrir o Codex no diretório dedicado ao novo projeto e usar o prompt D01–D07. A primeira demonstração termina ao importar dois clones, alternar entre eles, reiniciar o desktop e reencontrar a seleção com os dados corretos.

[Prompt e backlog](11-IMPLEMENTATION-BACKLOG.md) · [Resumo em PDF](Resumo_Executivo.pdf) · [Índice](MASTER-PLAN.md)
