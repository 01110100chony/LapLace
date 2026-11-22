# PRD · Workspace desktop para desenvolvimento com agentes

**Visão.** Abrir um projeto, compreender o que mudou, trabalhar com um agente e decidir o próximo passo sem reconstruir o contexto em cada ferramenta. A unidade de valor é **uma sessão de trabalho de projeto que leva a um resultado inspecionado**. Pode ser uma resposta com fonte, uma decisão registrada ou uma alteração revisada. “Laplace” é o nome de trabalho usado nos exemplos visuais.

**North Star.** Dias de trabalho por semana em que um desenvolvedor volta ao workspace e conclui pelo menos um desses ciclos. Contar uma vez por pessoa/projeto/dia para análise por projeto e deduplicar por pessoa/dia para o indicador geral. Abertura, volume de mensagens, minutos com a janela aberta e execuções automáticas isoladas ficam fora do numerador. Medir localmente ou por adesão voluntária após os primeiros releases.

## Público, problemas e trabalhos a realizar

| Pessoa e episódio | Trabalho a realizar | Resultado observável |
|---|---|---|
| Freelancer brasileiro alterna entre clientes e ramos temporários | Identificar o projeto, a revisão local e o que merece atenção antes de enviar código | Abre a Home, escolhe uma tarefa e confirma a branch e o destino do contexto |
| Desenvolvedor independente usa Codex todos os dias | Consultar código e transformar a resposta em uma tarefa sem copiar o histórico | Envia uma pergunta, abre uma fonte e inicia a tarefa a partir do mesmo fio |
| Estudante avançado assume parte de um projeto da equipe | Entender uma decisão antiga e seus limites antes de editar | Recupera a decisão, abre o trecho e identifica uma alteração posterior |
| Revisor de software house acompanha trabalho em paralelo | Descobrir qual sessão precisa dele e onde está o resultado | Abre o diff da tarefa certa, aprova ou devolve com justificativa |
| Responsável técnico controla o código de vários clientes | Dar ao executor acesso só ao projeto e aos arquivos autorizados | Confere perfil e destino; um projeto jamais aparece no contexto do outro |

## Quatro pilares que compartilham o mesmo projeto

| Módulo | Primeira experiência | Evolução intermediária | Visão de plataforma |
|---|---|---|---|
| Inteligência de projetos | Portfólio local, branch e status reais, linguagens/manifestações observadas, conversa com fontes | Clone GitHub, resumos desde a última visita, decisões e próximos passos com origem | Issues/PRs correlacionados, mapa de dependências navegável e sugestões por evento |
| Operações de agentes | Tarefa, uma sessão de Codex, eventos, cancelamento onde suportado e resultado revisável | Sessões concorrentes, worktrees separadas, dependências simples e segundo adaptador | Planejador e agentes especializados com limites por projeto |
| Contexto e evidências | Escopo de leitura visível, histórico persistido, origem dos trechos e da tentativa | Compilação por orçamento, memória explícita e comparação entre versões | Handoff entre provedores, impacto provável, incerteza e revalidação seletiva |
| Extensibilidade | Contratos internos de adaptador e eventos com versão | Leitor do formato, exportação, SDK e testes de conformidade | Plugins MCP, integrações e relatórios; JOB, empresa e memória pessoal com capacidades próprias |

## Objetos do produto

| Entidade | Identidade útil para o usuário e relação |
|---|---|
| Workspace e Project | A biblioteca local guarda projetos e preferências. O projeto reúne as tarefas, sessões e decisões sobre um produto. |
| Repository, Branch e Worktree | Um projeto começa com um clone. Branch é uma referência móvel; worktree é uma área de trabalho que pode conter mudanças locais. Um projeto poderá reunir vários clones. |
| Task e Agent | Tarefa descreve uma intenção com critérios opcionais. Agente é uma integração com versão, destino e capacidades conhecidas. |
| Session e Execution | Sessão preserva a conversa e pertence a um projeto; pode nascer antes de haver tarefa. Cada tentativa de execução pertence a uma sessão e tem estado, escopo e resultado próprios. |
| Context e Evidence | Context é a seleção exata entregue numa tentativa. Evidence identifica uma observação em versão, ambiente e instante específicos. |
| Decision e Event | Decisão humana registra uma escolha com justificativa e origem. Evento registra um acontecimento, inclusive progresso, cancelamento e recuperação após interrupção. |

Branch, agente disponível e worktree podem começar como projeções dos adaptadores. A representação persistida mínima está no [modelo de dados](04-SYSTEM-ARCHITECTURE.md).

## Três jornadas completas

### 1. Do GitHub a uma mudança revisada · freelancer

Ana recebe a URL de um repositório. Na Home, **Adicionar projeto** oferece pasta local desde S1 e clone GitHub a partir da S4. O clone mostra destino e usa as credenciais do Git configuradas no computador. Se já existir uma cópia, Ana a seleciona. A visão do projeto mostra a branch, mudanças locais e tecnologias identificadas em manifestos. Sem rede, a cópia local continua disponível.

Ana pergunta por que o exportador trata um campo como opcional. O chat seleciona arquivos, permite retirá-los e devolve uma resposta com referência clicável. Ela cria a tarefa “Preservar o campo na exportação” a partir da conversa. Escolhe o modo de alteração em área isolada, verifica o escopo e inicia Codex. A sessão recebe eventos enquanto Ana navega em outro projeto. Ao terminar, abre o diff, inspeciona a fonte e decide se quer aplicar o patch. Se o arquivo original mudou nesse intervalo, compara as versões e resolve o conflito antes da aplicação. A sessão, o resultado e a decisão ficam no projeto.

**Corte de entrega.** O percurso com um clone local está operacional na alpha da S3, incluindo a prévia das alterações produzidas em área isolada. Clonagem GitHub pela UI, revisão detalhada e aplicação explícita ao projeto entram na S4. Issues e PRs remotos têm integração posterior e exibem “não conectado” quando indisponíveis.

### 2. Duas atividades sem perder a autoria · pequena equipe

Bruno divide uma mudança em correção do exportador e documentação de instalação. No workspace da tarefa ele vincula ambas ao mesmo projeto e marca se uma depende da outra. Na S3 pode executá-las em sequência. Na S5, duas sessões independentes podem operar simultaneamente com o mesmo agente ou adaptadores distintos, cada uma em sua worktree. A Home continua mostrando qual execução precisa de decisão.

Bruno abre a primeira sessão durante a execução da segunda, consulta a última decisão e compara os dois diffs. Se ambas alteraram o mesmo contrato, marca a dependência e revisa manualmente a ordem de integração. Uma tarefa cancelada mantém log parcial e não recebe estado “concluída”. O resultado é uma revisão acessível por tarefa, com responsável, área de origem e arquivos afetados.

### 3. Voltar depois de alguns dias · projeto universitário ou cliente

Ao reabrir o app, Carla encontra o projeto e a tarefa no ponto em que parou. Desde a S1, a seleção e o histórico local reaparecem. Na S4, o registro da última visita identifica a revisão e a captura do diretório de trabalho. No retorno, aparecem commits novos, mudanças sem commit e as sessões registradas. Informações que surgiram fora do aplicativo têm origem Git ou remota identificada. Uma lacuna de observação permanece visível.

Carla vê que um teste foi executado na revisão anterior. O código citado não mudou, mas a configuração usada pelo teste mudou. O inspetor mostra a evidência original, descreve o alcance conhecido e oferece pedir uma nova verificação. Carla registra a decisão ou abre uma tarefa. Na S6, um resumo pode condensar esses acontecimentos, com links para cada fonte. A lista de fatos locais continua disponível mesmo sem modelo.

## Entregas, requisitos funcionais e aceites

| ID / entrega | Capacidade | Aceite demonstrável |
|---|---|---|
| P01 · S1 | Adicionar, selecionar e reabrir projetos locais | Adicionar duas pastas válidas, alternar entre elas, reiniciar e recuperar seleção; pasta movida permite relocalizar sem apagar tarefas. |
| P02 · S1 | Ler Git e apresentar resumo local | Nome, branch/HEAD destacado, SHA quando existe, contagens staged, unstaged e untracked concordam com Git; repositório sem commit abre com estado próprio. |
| P03 · S2 | Chat por projeto com Codex e seleção de fontes | Em repo autorizado, pergunta real retorna ao menos uma referência resolvível quando existe material pertinente; resposta sem suporte aparece como hipótese. Histórico reaparece offline. |
| P04 · S3 | Criar tarefa e iniciar execução supervisionada | Uma tarefa pode nascer do chat ou de uma linha de texto. Rodar Codex com contexto autorizado cria uma tentativa durável com projeto e sessão corretos. |
| P05 · S3 | Acompanhar tentativa e resultado | Trocar de projeto preserva o trabalho, falha e cancelamento têm estado próprio, conclusão abre saída/diff disponível; reiniciar não redispara trabalho. |
| P06 · S3 | Isolar escrita | Demonstração real de uma edição em diretório isolado autorizado, com diff antes/depois e clone original intacto; perfil sem confinamento confirmado oferece apenas os modos homologados. |
| P07 · S4 | Capturar contexto e revisar diff por estado | Um arquivo com edições staged e unstaged diferentes mostra as duas versões. Untracked só entra por seleção e uma evidência antiga continua vinculada aos bytes originais. |
| P08 · S4 | Clonar GitHub e incorporar resultado escolhido | Mostrar destino antes do clone. Aplicar resultado autorizado apenas se a base ainda coincide; detectar conflito antes de escrever e, em interrupção durante a escrita, identificar exatamente o estado recuperável. |
| P09 · S4 | Recuperar uma decisão e pedir revalidação | Abrir a fonte e sua revisão, apontar alteração conhecida e salvar uma nova decisão sem sobrescrever a anterior. |
| P10 · S5 | Supervisionar dois trabalhos isolados | Uma sessão pode parar sem interromper a outra. Cada diff abre no projeto e na worktree corretos. |
| P11 · S6 | Resumo do projeto e beta instalável | Usuário externo instala no Windows, abre repo sem login do app, inspeciona fatos e distingue o estado local do dado remoto. Resumo liga cada afirmação factual a uma origem. |

## Estados e permissões

O acesso local nasce da escolha do projeto. Navegar, abrir logs e consultar dados locais reutiliza esse escopo. Alterar destino, ampliar arquivos, executar código, escrever, aplicar patch, enviar ou publicar introduz capacidades distintas. A interface mostra a capacidade na ação que a usa. Preferências de projeto podem guardar autorização delimitada e revogável; operações externas relevantes e destrutivas permanecem explícitas.

Um agente pode estar desconectado com sessões anteriores legíveis. Uma sessão pode ter uma tentativa falha e outra concluída. Uma tarefa pode ter resultado disponível e continuar em revisão. Uma evidência pode ser íntegra e insuficiente. Esses quatro eixos independentes evitam que “processo terminou” vire “tarefa aprovada”.

## Requisitos não funcionais

- **Offline e privacidade.** Home, Git, tarefas existentes e revisão local funcionam sem conta própria ou chamada de modelo. Um teste de integração observa tráfego durante navegação offline.
- **Responsividade.** Metas de engenharia iniciais em Windows 11, 8 GB e SSD: Home com dados locais visíveis em até 2 s em abertura quente e troca de projeto em até 300 ms com cache. Medir p50/p95 em 30 ciclos e publicar hardware, tamanho do repo e número de eventos. Indexação em segundo plano jamais segura teclado ou navegação.
- **Confiabilidade.** Estado de tentativa e último evento persistidos de forma consistente. Queda do app não perde uma decisão confirmada. Colisão de versões exige releitura; nenhum retry de escrita acontece sem chave de idempotência.
- **Acessibilidade.** Percurso projeto → sessão → diff → fonte executável por teclado, foco restaurado, estados com texto, escala de 200%, tema claro e escuro. Verificar com leitor de tela no Windows.
- **Limites de dados e custo.** Conteúdo de arquivo, saída do agente e logs recebem limites configuráveis. O envio informa destino e orçamento estimado. Uso indisponível aparece como desconhecido. Telemetria externa começa desligada.
- **Idioma e distribuição.** PT-BR é a experiência padrão, strings localizáveis desde S1, formatos persistidos independentes da língua. Windows é a primeira plataforma de distribuição; Linux e macOS têm matriz de compatibilidade progressiva.

[Índice](MASTER-PLAN.md) · [Especificação das telas](12-DESIGN-SYSTEM-AND-SCREEN-SPECS.md) · [Backlog](11-IMPLEMENTATION-BACKLOG.md)
