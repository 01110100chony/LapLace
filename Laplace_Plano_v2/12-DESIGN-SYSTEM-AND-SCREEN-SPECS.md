# Especificação de telas e componentes

O [protótipo offline](visual/Workspace.html) é uma referência de composição para desenvolvimento. Os tokens a seguir são a decisão inicial. “Laplace” é um nome provisório. O componente de revisão de evidências continua existindo dentro da bancada de projetos.

## Grade e tipografia

| Região | Desktop amplo | Adaptação |
|---|---|---|
| Sidebar | 220 px, nome do workspace e projetos persistentes. Conta/configuração no rodapé. | 190 px abaixo de 1100 px e 158 px em largura intermediária. Em janela muito estreita, abrir navegação por botão com nome acessível. |
| Barra superior | 58 px, breadcrumb e busca com atalho local | Preservar botão da paleta mesmo com o hint de teclado oculto |
| Centro | Margens de 20–32 px, faixa de continuidade com 24 px internos, texto corrido até cerca de 75 caracteres por linha | Abaixo de 850 px mover contexto secundário para baixo ou para drawer acessível |
| Inspetor e operações | 230–340 px ou 28% da área útil, largura ajustável na aplicação | Em janela estreita, usar tela de detalhe com voltar e histórico de foco |
| Tipografia | Inter/Segoe UI para interface, IBM Plex Mono/Consolas para código, branches e logs. Títulos 30–46 px, subtítulos 16–20, corpo 14–16 e código 12–14 | Reflow a 200%; não truncar nome e caminho sem alternativa para leitura completa |
| Ritmo | 4, 8, 12, 16, 24 e 32 px. Linhas de lista entre 36–52 px. Cantos de 4–7 px. | Preferir espaço e divisores entre grupos. Um selo só entra para comunicar estado ou escopo. |

| Token | Escuro | Claro | Aplicação |
|---|---|---|---|
| canvas / navegação | #151719 / #101214 | #F7F6F1 / #EFECE5 | Grandes campos contínuos |
| superfície / seleção | #1B1E20 / #232628 | #FFFEFA / #E7E6DF | Log, menu e item selecionado |
| texto / secundário | #F3F0E9 / #B6B6B1 | #242A2C / #515859 | Conteúdo e metadados |
| acento / texto sobre acento | #FFAE87 / #281912 | #923F23 / #FFFAF1 | Ação primária e foco contextual |
| sucesso / atenção / falha | #9CD1BA / #EBC581 / #F1A49C | #295D49 / #73551E / #89473B | Símbolo e rótulo acompanham a cor |
| divisor / foco | #343738 / #FFD0A7 | #CED0C9 / #934818 | Separação estrutural e contorno de foco de 2 px |

## Anatomia das nove superfícies

| Superfície e fase | Composição, elemento dominante e ações | Recuperação e aceite visual |
|---|---|---|
| 1. Home · S1 → S6 | Sidebar, título com Add, faixa “Continuar”, lista de projetos e coluna de operações. Uma ação principal por área. Atividade abre fonte ou sessão. | Primeira instalação abre seletor ou exemplo. Retorno mostra projeto, tarefa e agentes em poucos segundos; itens de fases futuras só aparecem quando úteis. |
| 2. Project Overview · S1 | Caminho, branch/HEAD, contagens de mudança, manifestos observados e tarefa atual. Nova tarefa e conversa permanecem perto do cabeçalho. | Sem Git, orientar selecionar outro local. Em repositório vazio mostrar “Sem commits”. Repo movido preserva histórico. |
| 3. Contextual Chat · S2 | Pergunta e resposta ficam no centro; compositor fixo e fontes em inspetor. Ações “Abrir fonte” e “Criar tarefa desta conversa”. | Retornar ao mesmo texto após abrir referência. Sem agente, reabrir conversas antigas e oferecer configuração opcional. |
| 4. Agent Sessions · S3/S5 | Índice ordenado por intervenção necessária, estado, projeto e horário. Filtros por projeto/estado, indicador de execução única ou paralela. | Sem sessão, atalho direto à primeira tarefa. Cancelamento exibe estado real. Abrir uma linha não troca o dono da execução. |
| 5. Agent Operations / Task Workspace · S3 | Título da tarefa, objetivo editável, agente escolhido, escopo, tentativa atual, log e ação principal dependente do estado. | Falha abre motivo, saída parcial e nova tentativa. Resultado sem alterações continua legível. |
| 6. Git Changes & Diff · S3 básico/S4 completo | Lista de arquivos e contagens, origem do diff (índice, trabalho ou resultado isolado), hunk com números, +/−, decisão do revisor. | Binário mostra tipo/tamanho. Arquivo excluído conserva base. HEAD mudou: comparar antes de aplicar. Manter cabeçalho do diff junto à ação. |
| 7. Context & Evidence Inspector · S2/S4 | Fonte imutável/capturada, digest copiável, trecho, motivo de inclusão, omissões e última decisão. Navegável em lista. | Sem prova, mostrar “Sem verificação nesta versão”. Existência de teste não altera o estado de execução. |
| 8. Project Graph / Architecture Map · depois do beta | Entrar por módulo, tarefa ou decisão; relações rotuladas e apenas vizinhança inicial. Abrir aresta mostra origem e versão. | Renderizar lista equivalente por teclado. Relações inferidas têm tipo distinto; dados escassos abrem lista. O HTML demonstra a lista, não um grafo calculado. |
| 9. Settings & Integrations · S1/S2/S6 | Geral, aparência, Git, agentes, dados locais. Para cada adaptador: versão, destino, capacidades verificadas e teste local. | Se o teste enviar conteúdo, informar antes. Revogação não apaga material já exportado. Exportar diagnóstico sem segredos. |

## Componentes e comportamento

| Componente reutilizável | Entrada / estado controlado | Responsabilidade de implementação |
|---|---|---|
| WorkspaceSidebar e ProjectRow | projetado por projectId, selectedId, estado, última observação | Botão com nome e estado semântico; preservar seleção ao receber nova atividade |
| ContinueTask e ActivityLine | taskId, projectId, branch, timestamp, target | Abrir o destino correto mesmo quando o projeto ativo na janela é outro |
| ProjectScope e ContextPreview | caminho, seleção, alcance real, destino | Diferenciar leitura local, envio e escrita; revisão retorna ao mesmo foco |
| SessionRow e RunStatus | tentativa, agente, estado confirmado e horário | Texto de estado + sinal gráfico; anúncio acessível só de marcos |
| Composer e SourceLink | draft por projeto, sourceId, revisão e posição | Preservar rascunhos e permitir abrir/voltar à referência |
| DiffViewer e EvidenceInspector | variantes, escopo, evidência e decisão | Diff unificado por padrão, opção lado a lado ampla, fonte histórica sempre identificada |
| CommandPalette e RecoverableError | consulta e lista de ações permitidas / erro, escopo e recuperação | Busca por projeto/tarefa, navegação por teclado, Esc restaura foco; erro identifica o que ainda é utilizável |

### Verificações da primeira build

Comparar janela em 1440×900 e 1024×768 com as composições. Em 800 px, priorizar tarefa e fonte; conferir em zoom 200% e em largura lógica de 320 px com diff em rolagem horizontal contida. Medir contraste de texto normal ≥4,5:1, elementos funcionais/foco ≥3:1 sobre fundos adjacentes, alvos preferencialmente ≥32 px e ordem de teclado previsível. Testar tema claro/escuro, alto contraste do SO e NVDA no Windows. Medir latência de digitação com log recebendo eventos; virtualizar saídas longas e preservar modo de leitura linear. A referência adotada é WCAG 2.2 AA. [WCAG 2.2](https://www.w3.org/TR/WCAG22/) · [WAI, diálogos](https://www.w3.org/WAI/ARIA/apg/patterns/dialog-modal/)

[Direção visual](05-UX-UI-DIRECTION.md) · [Backlog de componentes S1](11-IMPLEMENTATION-BACKLOG.md)
