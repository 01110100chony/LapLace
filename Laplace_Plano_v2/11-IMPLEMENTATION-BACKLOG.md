# Backlog de implementação e prompt para Codex

Começar por D01 hoje. Uma pessoa pode concluir as tarefas em ordem; com equipe, o campo de dependência libera trabalho paralelo. Horas da primeira sprint são estimativas produtivas, já incluídas no [roadmap](06-ROADMAP-AND-EXECUTION.md).

| ID · épico | Tarefa pronta para assumir | Depende de | Aceite | Horas S1 |
|---|---|---|---|---:|
| D01 · Desktop | Criar pnpm workspace no diretório dedicado, Tauri 2 + React/Vite/TS, lockfile e scripts dev/check | Diretório autorizado | Um comando documentado abre janela local com título e tela inicial em PT-BR | 4–6 |
| D02 · IPC | Criar sidecar TypeScript, registrar comando de health e obter versão com timeout | D01 | Renderer recebe resposta tipada ou erro acionável; sem acesso arbitrário a shell | 4–6 |
| D03 · Git | Implementar seleção nativa de pasta e leitor Git por argv, com raiz canônica e parser de status | D02 | Uma fixture com índice modificado e worktree suja tem contagens separadas, com Unicode e caminho com espaços | 5–7 |
| D04 · Persistência | Criar primeira migração SQLite, cadastro idempotente e preferências de seleção | D02 | Registrar duas vezes a mesma raiz não duplica projeto; reinício conserva seleção | 4–5 |
| D05 · Experiência | Montar sidebar, Home, seleção por teclado, Project Overview e estados vazio/erro | D01, depois D03–04 para ligar dados | Dois clones navegam com branch e atividade corretas; sem modelo a UI continua operacional | 6–8 |
| D06 · Integração | Ligar projeto selecionado → resumo → cache; descartar resposta atrasada da seleção anterior | D03–05 | Trocar rapidamente de projeto não exibe conteúdo do outro; pasta movida oferece relocalização | 3–4 |
| D07 · Entrega | CI, smoke de inicialização, empacotar sidecar/SQLite no Windows e registrar demonstração | D01–06 | Executável de desenvolvimento e instrução reproduzível; teste de parser, migração e erro de IPC verdes | 6–8 |

**Soma S1: 32–44 h.** Dependências para o dia 1: clone/diretório explicitamente destinado ao projeto, Git e toolchain Tauri em máquina de desenvolvimento. Chave de modelo, conta cloud e repositório remoto não são necessários.

| ID · incremento | Implementação seguinte | Depende de | Condição de aceite |
|---|---|---|---|
| C01 · Contexto | Capturar arquivos selecionados, digest e omissões | D03–04 | Um arquivo alterado durante a captura não é enviado silenciosamente |
| C02 · Busca | Indexar nomes, manifestos e trechos em FTS5 | C01 | Resultado abre caminho e trecho no estado de origem; índices de dois projetos isolados |
| C03 · Codex leitura | Detectar CLI, montar perfil de leitura, autorizar destino e consumir JSONL | D02, C01 | Chamada real com arquivos fictícios autorizados e resposta inspecionável; canário externo inacessível |
| C04 · Chat | Vincular mensagens, execução e citações à sessão e renderizar saída parcial | C02–03 | Pergunta → fonte → retorno ao mesmo ponto → reinício com histórico |
| O01 · Tarefa | Criar tarefa diretamente ou converter conversa | C04 | Não duplica contexto; mudança de projeto valida IDs |
| O02 · Supervisor | Máquina de estados, requestId idempotente, persistência e cancelamento | O01, C03 | Retry após queda não dispara segunda execução externa |
| O03 · Resultado | Preparar área isolada mínima, capturar edição e diff; testar restrição de acesso | O02 | Uma alteração real do agente aparece na aba correta e o clone permanece preservado |
| G01 · Estado Git | Modelar index/worktree, arquivos novos autorizados, exclusões e conflito | D03, C01, O03 | Caso simultaneamente staged e unstaged conserva ambos os conteúdos |
| G02 · Revisão | EvidenceSnapshot, decisão, comparação e aplicação assistida | G01 | Base nova impede sobrescrita; aplicação interrompida é reconciliável |
| G03 · GitHub | Adicionar fluxo de clone por URL, progresso, credencial do Git e cancelamento | D03–04 | Repo novo entra pela mesma importação local; pasta de destino preexistente é preservada |
| M01 · Operações | Worktrees geridas pelo host, fila de duas sessões e dependências | G01–02 | Interromper A não altera B; ambos têm origem e saída verificáveis |
| B01 · Beta | Resumo por evento, instalador, guia PT-BR/EN, teste de migração | O03, G02, M01 | Dev externo completa instalação e fluxo local em máquina limpa |

## Prompt para iniciar no Codex

Copiar o bloco abaixo para uma sessão aberta na pasta dedicada ao novo projeto. Anexar este pacote de documentação. A primeira solicitação é delimitada à Sprint 1; o adaptador real é o próximo incremento aproveitando o mesmo IPC.

```text
Implemente a Sprint 1 do workspace desktop descrito neste pacote. Leia MASTER-PLAN.md, 04-SYSTEM-ARCHITECTURE.md, 05-UX-UI-DIRECTION.md, 06-ROADMAP-AND-EXECUTION.md, 11-IMPLEMENTATION-BACKLOG.md e 12-DESIGN-SYSTEM-AND-SCREEN-SPECS.md. Use visual/Workspace.html como referência de composição. Trabalhe apenas na pasta dedicada indicada nesta sessão. Se houver um projeto relacionado já iniciado, preserve o trabalho existente. Não altere NexTM, Iuris, JabotiOS ou outro repo usado como entrada. Não use subagentes nem publique externamente.

Execute D01–D07. Use Tauri 2, React, Vite, TypeScript e SQLite, com um sidecar TS e IPC tipado. Registre apenas as interfaces que o incremento consome. Abra uma janela desktop real, selecione um clone local pelo seletor nativo, resolva sua raiz no host, leia branch/HEAD e o status Git real, salve o projeto e mostre o resumo na Home e na visão do projeto. Suporte dois projetos e reabertura na última seleção. O app precisa funcionar offline. Use o layout do protótipo para espaçamento, navegação e tipografia. Nas superfícies da primeira sprint, renderize dados reais e ações implementadas.

Comece pela janela e por um comando real de leitura, depois acrescente banco, navegação e tratamento de erros. Teste status staged/unstaged/untracked, repositório sem commits, pasta inválida, reabertura e resposta atrasada após trocar de projeto. Use fixtures criadas nos testes. Limite o renderer a comandos específicos, passe argumentos ao Git sem interpolação de shell e impeça traversal da raiz. Não execute código do repositório durante a inspeção.

Rode testes, lint/typecheck e build disponíveis no ambiente. Demonstre o caminho desde o início do aplicativo, com resultado observado. Entregue comandos exatos de instalação e execução no Windows, arquivos alterados, testes que passaram e limitações que exigem outro SO ou máquina. Se o ambiente não abrir WebView2, siga com os testes portáveis e prepare o build/smoke Windows em CI, registrando separadamente o que continua sem verificação. Não declare desktop validado apenas pelo preview do Vite.

Considere a Sprint 1 concluída quando dois repositórios reais puderem ser importados, inspecionados e reencontrados após reiniciar o executável em ambiente homologado. O próximo incremento será C01–C04 com a primeira pergunta real ao Codex e citação de uma fonte. Evite adicionar backend cloud, telemetria remota e plugins nesta entrega.
```

[Plano central](MASTER-PLAN.md) · [Contratos](04-SYSTEM-ARCHITECTURE.md)
