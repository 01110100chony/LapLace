# Roadmap · seis sprints de construção

Cada sprint termina com uma demonstração reproduzível na janela desktop. O produto já pode ser usado em estágios diferentes: build de fundação ao fim da S1, alpha integrada ao fim da S3, MVP com Git e evidências ao fim da S4 e beta distribuível ao fim da S6. Entrevistas, comparações competitivas e experimentos acadêmicos podem informar releases a partir de software funcional.

## Capacidade e caminho crítico

Estimativas de esforço produtivo incluem desenho, implementação, testes, correções e instruções da demo. Separar 20% da disponibilidade de calendário para imprevistos; não contar essa reserva duas vezes. Para Anthony a 15–25 h/semana, o orçamento útil é de 12–20 h/semana, ou 16 h na referência de 20 h. As durações abaixo variam com o ambiente Windows, experiência com Rust/Tauri e a matriz de isolamento disponível.

| Sprint | Esforço | Acumulado | Entrega que outra pessoa consegue abrir |
|---|---:|---:|---|
| S1 · Fundação desktop | 32–44 h | 32–44 h | Build de desenvolvimento com dois projetos locais, Git real e persistência |
| S2 · Contexto e chat | 36–52 h | 68–96 h | Pergunta real ao Codex, resposta com fonte e histórico |
| S3 · Operações de agente | 42–62 h | 110–158 h | Alpha com tarefa, execução supervisionada, saída e prévia de alteração isolada |
| S4 · Git e evidências | 42–64 h | 152–222 h | MVP com diff por estado, contexto efetivo e revisão persistida |
| S5 · Sessões concorrentes | 45–70 h | 197–292 h | Dois trabalhos isolados e uma fila operável |
| S6 · Inteligência e beta | 40–65 h | 237–357 h | Instalador público, resumo verificável, documentação e atualização |

Total em calendário solo: **aproximadamente 12–30 semanas** nos extremos de capacidade e esforço, ou **15–23 semanas** na referência de 20 h/semana. A faixa de 120–180 dias é razoável para perseguir o beta, com risco de ultrapassagem no extremo de 15 h. Um único responsável integra o programa e o esquema de dados. Só operações restritas por dependências e permissão entram no caminho crítico.

## S1 · Fundação e desktop

**História.** “Quero abrir dois clones e saber imediatamente em qual branch estava trabalhando.” Começar pelo primeiro card do [backlog](11-IMPLEMENTATION-BACKLOG.md) num diretório dedicado. Montar monorepo e shell Tauri, seletor nativo, comando de resumo Git e SQLite, sidebar, portfólio, visão do projeto e retorno à seleção. Usar exemplos apenas para composição visual e testes. A Home de produção é alimentada pelos registros locais.

**Dependências e contrato.** Git, toolchain Tauri, WebView2 no Windows e runtime do sidecar. Contratos workspace.addLocal e project.inspect. **Aceite/testes.** Abrir dois clones, incluindo um com mudanças staged/unstaged e um caminho com acento. A contagem concorda com Git. Reiniciar recupera os dois projetos e o selecionado. Pasta inválida, Git ausente e repo sem commits recebem ações próprias. **DoD e demo.** CI com migração, parser, build e smoke de IPC. Em máquina de desenvolvimento, abrir janela com navegação offline e mostrar um projeto real sem editar arquivo algum. **Risco.** Binding SQLite/sidecar não inicia fora do ambiente do autor; empacotar e testar cedo. Esforço 32–44 h.

## S2 · Contexto e chat

**História.** “Quero fazer uma pergunta sobre estes dois arquivos e abrir a linha que sustentou a resposta.” Criar seleção por projeto e digest, indexar manifestos e caminhos com FTS5 e exibir prévia do envio. Usar o mesmo adaptador Codex previsto para operações. Implementar conversa, citações clicáveis, saída parcial e histórico reaberto offline.

**Dependências e contrato.** S1, perfil de leitura homologável e credencial configurada pelo usuário. context.prepare, session.ask, eventos JSONL. **Aceite/testes.** Uma consulta real lê só a seleção autorizada, responde e referencia o arquivo certo. Testar falta de autenticação, stdout parcial, ausência de referência, timeout e acesso a sentinela externa negado. Testes automáticos determinísticos podem reproduzir eventos gravados; uma execução real identificada por versão é obrigatória à demonstração dessa capacidade. **DoD e demo.** Perguntar, abrir fonte, reiniciar, ler conversa sem modelo. **Risco.** Leitura além do escopo; limitar o adaptador nesse ambiente e manter a inspeção local utilizável. Esforço 36–52 h.

## S3 · Operações de agentes

**História.** “Transformo a conversa em tarefa, acompanho Codex e vejo exatamente o que ele produziu.” Persistir tarefa e tentativas, supervisor com uma execução ativa, limites e cancelamento. Separar sessão local e sessão do provedor. Autorizar edição numa área materializada, registrar estado anterior/posterior e apresentar o diff básico. Manter o original intacto nesta etapa.

**Dependências e contrato.** S2, processo confinado e área de saída identificada. task.start, execution.events, execution.cancel e resultado com referências de artefato. **Aceite/testes.** Rodar tarefa real, alternar de projeto e voltar ao mesmo evento. Interromper tentativa, simular falha da janela/serviço e confirmar que não houve repetição automática. Verificar que o clone original não foi modificado. **DoD e demo.** Alpha em que uma execução real produz mudança inspecionável, uma falha exibe recuperação e a sessão permanece após reinício. **Risco.** Cancelamento não encerra toda a árvore de processos. Sem confirmação, mostrar estado desconhecido e bloquear escrita concorrente nessa área. Esforço 42–62 h.

## S4 · Git e evidências

**História.** “Quero comparar o que estava no índice, o que estava no disco e a entrada usada pelo agente; depois decidir se aplico o resultado.” Completar Working Tree State, diff unificado e por arquivo, evidências versionadas e compilação por orçamento. Acrescentar clone GitHub por URL com destino aprovado. Persistir decisão, base da aplicação e revalidação após mudanças.

**Dependências e contrato.** S3, materialização de conteúdo e journal de alteração. result.review(expectedBase), EvidenceSnapshot, comparação de captura. **Aceite/testes.** Mesmo arquivo em três estados distintos, untracked opt-in, renome, deleção, conflito de base e escrita concorrente. Recuperar de falha simulada durante aplicação; registrar arquivos afetados e conservar alterações externas. Clonar exemplo autorizado e tratar destino já ocupado. **DoD e demo.** Aplicar um patch compatível autorizado, recusar aplicação obsoleta, voltar ao projeto e entender a decisão. **Risco.** Subestimar submódulos ou binários. Apresentar metadados e caminho externo para revisão manual até haver suporte próprio. Esforço 42–64 h.

## S5 · Fundações multiagente

**História.** “Enquanto uma sessão trabalha, reviso outra sem confundir diffs.” Adicionar até duas execuções, dependências acíclicas simples, leases por área e worktrees controladas pelo host. Manter uma única fila local com projeto explícito. Avaliar segundo adaptador pela disponibilidade de start/events/cancel e autenticação oficial; iniciar com duas sessões Codex caso a segunda integração tenha capacidade insuficiente.

**Dependências e contrato.** S4, ownership de worktree e compensação após falha; adapter.describe e perfil de capacidades. **Aceite/testes.** Dois workers em tarefas distintas, cancelar um, persistir o outro, detectar colisão de caminhos e recusar ciclo na dependência. Não remover worktree com arquivos de usuário pendentes. **DoD e demo.** Abrir os resultados lado a lado ou alterná-los por teclado, identificar base e agente, resolver intervenção humana em uma sessão. **Risco.** Conflito semântico apesar de arquivos diferentes; manter integração manual. Esforço 45–70 h.

## S6 · Inteligência do projeto e beta

**História.** “Ao abrir o app, entendo o que aconteceu em vários projetos e qual execução precisa de mim.” Produzir resumo com fontes, consolidar eventos repetidos e permitir silenciar. Finalizar acessibilidade, medição de latência, instalador Windows, compatibilidade, documentação PT/EN e canal de bugs. Issues, PRs e checks por conector somente leitura são incremento opcional após o fluxo local; mostrar carimbo de sincronização e indisponibilidade.

**Dependências e contrato.** S4 fornece fontes, S5 fornece operações concorrentes. project.activity(since), fonte local/remota e revisão de esquema. **Aceite/testes.** Máquina limpa sem Node, instalação e remoção, migração de banco antigo, update inválido, navegação com teclado e uso sem login próprio. Resumo sem evidência omite a afirmação ou a sinaliza como inferência. **DoD e demo.** Um usuário externo abre a demo e seu próprio clone a partir da documentação. Publicação e assinatura pertencem à futura implementação autorizada. **Risco.** Manutenção simultânea de três SOs. Distribuir primeiro o alvo que passou os testes e publicar o estado dos demais. Esforço 40–65 h.

## Calendário orientador

| Horizonte | Trabalho principal | Evidência ao fim |
|---|---|---|
| Dias 1–7 | No primeiro dia, criar workspace e abrir a janela Tauri. Dias 2–3, ligar serviço e resumo Git. Dias 4–5, seletor e persistência. Nos blocos restantes, integrar sidebar e tratar caminho inválido. | Janela real e primeira leitura Git em desenvolvimento. Se houver apenas 12 h úteis, levar persistência polida para a segunda semana. |
| Dia 30 | S1 concluída e S2 iniciada conforme capacidade | Executável de desenvolvimento, dois clones, reinício e inspeção sem rede. Primeira chamada real pode caber nesta janela, sem compromisso de S3 completa. |
| Dia 60 | S2 concluída na referência de capacidade; S3 em integração | Conversa com fontes reais e demonstração de tarefa sob supervisão quando o perfil passar os testes. |
| Dia 90 | Buscar S3 concluída e S4 em curso/encerrada conforme esforço | Alpha executável, diff básico, recuperação e primeira rodada de uso em trabalho próprio. |
| Dias 120–180 | Fechar S4, trabalhar concorrência e distribuir beta no alvo homologado | Patch revisado, duas sessões isoladas, documentação e instalador Windows. Adiar segundo provedor antes de comprometer estabilidade. |

## Cenário com 3–5 colaboradores

A 15–25 h por integrante, três pessoas têm 45–75 h brutas por semana; cinco têm 75–125 h. Reservar 30% para revisão e integração dá aproximadamente 32–53 h e 53–88 h úteis, respectivamente. Isso não divide o caminho crítico por três ou cinco: início do runner depende de IPC, escrita segura depende da captura e a release depende de testes de atualização. Estimativa de calendário até beta: 8–15 semanas com três e 7–13 com cinco, sob disponibilidade regular. Reestimar ao fim de S1.

| Dono | Três colaboradores | Com quarto e quinto |
|---|---|---|
| Anthony | Contratos, supervisor, integração real, decisões de produto e release | Mantém a revisão das fronteiras e integra os incrementos |
| Desktop | Shell, navegação, chat e acessibilidade | Quarto assume fluxos de revisão, diffs e teste de usabilidade |
| Estado local | Git, banco, fixtures e testes de recuperação | Quinto assume CI Windows, empacotamento, documentação e testes de falha |

Definition of Done comum: caminho feliz e erro acionável demonstrados a partir da janela, estado persistido reaberto, testes do risco específico verdes e limites registrados na nota de versão. Cada sprint pode simplificar um mecanismo ou deslocar uma extensão. A demonstração do fluxo central permanece íntegra.

[Plano central](MASTER-PLAN.md) · [Backlog e prompt de execução](11-IMPLEMENTATION-BACKLOG.md)
