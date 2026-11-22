# Engenharia demonstrável, pesquisa e reputação

O histórico de Anthony no NexTM mostra capacidade de construir e apresentar um produto industrial. A oportunidade agora é mostrar o que acontece depois da demo: distribuir um desktop, controlar processos externos, preservar a história do trabalho e estudar métodos de recuperação que outras pessoas consigam reproduzir.

| Eixo | Evidência que sustenta a afirmação | Momento |
|---|---|---|
| Curricular · qualidade de implementação | Build instalável, ADRs, testes de falha, logs expurgados e explicação do desenho | Desde a primeira janela |
| Acadêmico · contribuição investigada | Pergunta delimitada, baseline competente, corpus versionado e análise de resultados inclusive negativos | Preparar a instrumentação durante a implementação; conduzir o experimento após uma versão funcional |
| Reputacional · adoção open source | Uso independente, issues reproduzidas, integrações ou contribuições recorrentes e estudos de caso autorizados | Após releases públicas. Estrelas isoladas não comprovam uso |

## Cinco contribuições para o portfólio

| Contribuição | Profundidade de engenharia | Prova pública a produzir |
|---|---|---|
| Workspace desktop responsivo e multiplataforma | Host nativo, renderer, IPC tipado, migração SQLite, distribuição e acessibilidade | Instalação Windows limpa e matriz por SO; perfil de memória, inicialização e teclado em logs extensos |
| Supervisor de agentes locais | Integração de CLI, normalização de eventos, idempotência, cancelamento de subprocessos e recuperação | Vídeo de falha no meio de uma execução; teste que demonstra ausência de redisparo silencioso |
| Coordenação por worktree | Concorrência, leases, dependências, isolamento e revisão de resultados independentes | Reproduzir duas tarefas, cancelamento unilateral e conflito entre mudanças |
| Inteligência contextual sobre estado vivo | Seleção orçada, busca lexical/semântica, grafo de relações, identidade do índice/disco e revalidação | Comparar ranking, latência, recall e falsos aceites em bases de tamanhos diferentes |
| Plataforma aberta observável | Contrato de adaptadores, versionamento, custo por tentativa e priorização de atenção por evento | Adaptador externo, replay sanitizado, medição de ruído do ranking, contribuição externa e release reprodutível |

**Interesse por leitor.** Um recrutador no Brasil precisa entender a responsabilidade individual e abrir a demo em português. Um Engineering Manager pode examinar uma falha, sua recuperação e a decisão de escopo. Um arquiteto pode discutir a separação entre autoridade do host e do executor. Um especialista em IA aplicada pode comparar o contexto realmente enviado e as métricas de busca. Um avaliador acadêmico precisa conseguir reproduzir uma afirmação específica. Para o público internacional, publicar versão inglesa da especificação, instruções de reprodução e limitações de cada plataforma.

## Recorte científico recomendado

Depois da S4, investigar se expor a versão efetiva do ambiente e das fontes melhora a precisão de revisão ao trocar de sessão ou provedor. O desktop fornece um instrumento para medir dúvidas, tempo e decisões. Incluir três origens de mudança nas fixtures: commit, índice e cópia de trabalho. Acrescentar uma quarta classe com arquivo novo autorizado. Para cada uma, guardar versão inteira e hash, tornar o teste equivalente entre braços e estratificar resultados quando o baseline só aceita commit. Um espelho temporário commitado pode viabilizar o ensaio compatível, desde que reportado separadamente.

## O que a literatura já cobre

Fontes primárias consultadas em 19/11/2026. Os trabalhos marcados como preprint relatam experimentos de seus autores. A tabela delimita que comparação cada trabalho exige do projeto.

| Trabalho | O que foi estudado | Consequência para o desenho |
|---|---|---|
| [RepoCoder, EMNLP 2023](https://aclanthology.org/2023.emnlp-main.151/) | Recuperação iterativa de exemplos dentro do repositório para completar código. | Comparar o pacote com busca lexical competente e inspecionar a seleção de contexto separadamente da resposta final. |
| [LocAgent, ACL 2025](https://aclanthology.org/2025.acl-long.426/) | Localização de entidades de código com relações estruturais e consultas ao grafo. | Medir quando uma dependência a dois saltos ajuda. Localizar o arquivo correto é apenas um componente da retomada. |
| [SWE-ContextBench, preprint, versão de maio de 2026](https://arxiv.org/abs/2602.08316v3) | Reúso de experiências entre issues relacionadas, com avaliação de recuperação e eficiência. | Incluir um resumo bem selecionado e casos onde experiência irrelevante atrapalha. |
| [DreamBench-SWE, preprint de agosto de 2026](https://arxiv.org/abs/2608.20664) | Tarefas posteriores dependem de evidência de sessões antigas. Há oráculos executáveis e comparações com memória literal e estruturada. | Armazenar evidência entre sessões já tem precedente. Um controle com log literal recuperável testa o ganho adicional da estrutura. |
| [MemTrace, preprint de outubro de 2026](https://arxiv.org/abs/2610.04838v3) e [implementação dos autores](https://github.com/Homy-Xu/MemTrace) | Rastros imutáveis, ancoragem na revisão e recuperação que valida evidências contra o repositório atual. O repositório descreve backends para Codex CLI e mini-swe-agent. | É o comparador técnico mais próximo. A tese de que memória com proveniência, revalidação ou suporte a múltiplos backends seja inédita já tem contraexemplo. |
| [METR, estudo randomizado de 2025](https://arxiv.org/abs/2507.09089) e [revisão do desenho, fevereiro de 2026](https://metr.org/blog/2026-02-24-uplift-update/) | Medidas de tempo em tarefas reais divergiram das percepções dos participantes. O seguimento identificou seleção de participantes e dificuldade de medição com agentes concorrentes. | Medir tempo ativo e tempo decorrido, registrar desistências e separar satisfação de desempenho. |

**Lacuna operacional a testar.** Um revisor recebe uma tarefa em andamento, troca de ferramenta e precisa decidir quais critérios continuam comprovados. Quanto trabalho economiza ao ver os trechos originais e as mudanças desde a coleta? O recorte combina portabilidade de um arquivo, troca explícita de executor, churn controlado e decisão humana verificável. A busca foi dirigida, sem revisão sistemática de todas as publicações. Antes de apresentar alegação de originalidade, atualizar a busca com orientador e comparar contratos dos trabalhos mais próximos. Uma replicação aplicada tem valor próprio.

## Perguntas e hipóteses testáveis

| Questão | Contraste planejado | O que enfraqueceria a hipótese |
|---|---|---|
| RQ1. Na troca de agente, o pacote revalidado reduz o tempo até a primeira decisão correta do revisor? | Comparação pareada com o melhor fluxo viável escolhido no conjunto de desenvolvimento. Orçamentos iguais e participantes alternando tarefas equivalentes. | Com revisor independente, o ganho desaparece ou o tempo cai à custa de aceites incorretos. |
| RQ2. Quais mudanças tornam a revalidação útil? | Mesmo pacote com a avaliação de validade ligada e desligada. Analisar alterações materiais, deslocamento de linhas, mudança indireta e controle sem alteração. | Aparece o mesmo efeito em exemplos sem alteração ou o sinal de desatualização provoca rejeição sistemática de provas válidas. |
| RQ3. A busca estrutural melhora a seleção além de BM25? | Mesmo compilador com e sem expansão por arestas, nos mesmos orçamentos. Medir acerto por arquivo, evidência por critério e custo de indexação. | Melhora a recuperação de arquivos, mas a revisão não melhora ou a manutenção do índice supera o ganho. |
| RQ4. A troca de ferramenta preserva a interpretação dos critérios? | A→A, A→B e, posteriormente, B→A sobre as mesmas entradas. Registrar se a pessoa teve de explicar novamente a tarefa. | O ganho existe apenas na ferramenta de origem ou exige ajuste manual maior que o do fluxo habitual. |

RQ1 é primária. RQ2–RQ4 são explicativas ou exploratórias até haver amostra dimensionada. Uma integração Codex somente leitura permite a primeira medição intra-agente. Um segundo cliente real consumindo o mesmo arquivo permite avaliar transferência com importação manual, medida como tal. Generalizar para integração automática entre runtimes exige dois adaptadores verificados.

## Como construir o experimento

**Unidade.** Um episódio contém objetivo, dois a quatro critérios, revisão de origem A, evidências observáveis em A, revisão posterior B e uma pergunta de revisão. Uma fixture pública independente de engenharia, escrita do zero, pode trazer o critério “a soma de tempo fixo e movimentos mantém a unidade especificada”. Em A o teste passa. Entre A e B alguém altera o contrato de conversão numa dependência, preservando intacto o arquivo citado. O julgamento correto sobre a prova antiga é “precisa revalidar”. Um segundo critério conserva evidência suficiente. O revisor deve apontar ambos e indicar a verificação mínima faltante. Esse exemplo não descreve um defeito observado no NexTM.

1. **Piloto de instrumentação.** Construir 6–8 episódios com dois mantenedores. Incluir mudança direta, indireta, cosmética, renomeação, teste antigo que ainda aparece verde e ausência genuína de evidência. Para cada critério, guardar gabarito e justificativa. Dois avaliadores rotulam sem conhecer a variante experimental. Resolver conflitos antes de abrir os resultados. Anotar alternativas de prova válidas.
2. **Conjunto principal proposto.** Planejar inicialmente 24–40 episódios em 4–6 repositórios licenciados para a montagem do corpus. Separar projetos e famílias de tarefas entre desenvolvimento e teste. Repositórios próprios funcionam para calibrar, preservando ao menos um projeto de terceiros reservado para validação externa. A consulta ao NexTM encontrou repositório privado e README que descreve Ficha PO auditável, oráculos documentais e estratégia de testes. As funcionalidades não foram executadas. Usar esse projeto apenas em ensaio interno autorizado. A consulta a Iuris e JabotiOS retornou 404, o que deixa sua acessibilidade em aberto. Para o benchmark público, criar fixtures independentes de matemática/engenharia e incluir projetos de terceiros com licença compatível.
3. **Evitar conhecimento do futuro.** Construir cada ambiente a partir de histórico saneado até B. Entregar apenas fatos que o usuário teria visto até B. Manter testes de avaliação, respostas dos revisores, comentários posteriores, branches remotas, patches futuros e gabarito fora do ambiente visível. Hospedar o verificador separado. Navegação, ferramentas e diffs A..B são permitidos igualmente a todos. Deduplicar forks, commits equivalentes e variantes geradas do mesmo caso antes da divisão. Reservar parte das alterações inéditas até o congelamento para reduzir memorização em modelos fechados.
4. **Fixar e registrar.** Congelar IDs das versões de agente/modelo, prompts, política de ferramentas, ambiente, timeout, preços e tokenizador. Aplicar o mesmo teto de entrada, saída, chamadas e tempo, por exemplo 8 mil tokens de contexto enviado por rodada na análise primária e 4/16 mil em sensibilidade. Cobrar também resumo inicial, montagem, chamadas de busca e releituras no custo fim a fim. Usar a mesma sessão de origem pré-gravada entre braços. Descrever diferenças inevitáveis de modelo entre clientes como confundidores.
5. **Rodar em duas fases.** Ensaiar primeiro sem pessoas, em cópias somente leitura, retornando decisões estruturadas e referências. Usar um verificador externo para conferir caminho, revisão, intervalo e rótulos e dois revisores cegos para divergências semânticas. A etapa com pessoas dá o desfecho primário de RQ1. Contrabalançar a ordem dos fluxos e a dificuldade. Cada participante vê um episódio uma única vez. Para o braço manual incluir o tempo de construção do resumo pelo autor na medição fim a fim.
6. **Controlar custo.** Simulação de escala para o estudo automatizado: 24 episódios × 4 métodos × 2 repetições = 192 retomadas na análise principal. Medir tokens e latência em 6 episódios antes de fechar o orçamento. Executar ablações em bloco reservado e publicar quais comparações ficaram de fora. Duas repetições medem alguma variabilidade do modelo. O tamanho amostral continua sendo o número de episódios independentes, com dependência adicional por repositório.

### Comparadores e ablações

| Braço | Entrada disponível ao agente receptor/revisor | Pergunta que responde |
|---|---|---|
| Padrão prático | Anotações do mantenedor, AGENTS.md, diff A..B, Git e busca. Na mesma ferramenta, incluir retomada nativa disponível. | O custo de instalar a ferramenta se justifica frente ao que o usuário já consegue fazer? [Integrações oficiais do Codex](https://developers.openai.com/blog/codex-as-a-platform) |
| Recuperação simples | Log cronológico original + BM25 nos arquivos atuais, com as mesmas citações permitidas e capacidade reservada para os critérios. | Formato e validade acrescentam algo à recuperação lexical econômica? |
| Precedente mais próximo | MemTrace original fixado a um commit, no subconjunto em que seu adaptador lê os mesmos dados e respeita os mesmos recursos. | Há ganho além de um sistema existente com memória alinhada ao estado? Em caso de incompatibilidade, documentar motivo, medir custos de adaptação e publicar a limitação. Uma regra local “hash mudou” deve ser rotulada como aproximação e jamais como reprodução do MemTrace. |
| Produto | Manifesto portátil, critérios explícitos, âncoras em A, diff até B, sinalização de prova ausente e decisão humana final. | Qual é o efeito combinado disponível ao usuário? |

No teste reservado, predefinir o comparador primário entre os braços viáveis usando apenas o conjunto de desenvolvimento. Se um baseline puder usar cache nativo sem expor tokens internos, reportar sua experiência natural e indicar quais custos não puderam ser equiparados. Para isolar causalidade, rodar um núcleo controlado usando o mesmo agente receptor e os mesmos limites em todos os braços observáveis.

**Ablações.** Aplicar fatorial 2×2 entre revalidação ligada/desligada e expansão por grafo ligada/desligada. Manter fatias, tokenização, ordenação estável, orçamento, rótulos da interface e corpus de origem. O braço de revalidação desligada ainda recebe acesso ao diff, para medir o que a automação acrescenta. Avaliar baseline complementar “marcar todo arquivo alterado como suspeito”, incluindo o falso alerta gerado por alteração cosmética. Uma ligação entre módulos é evidência de possível impacto, e o teste do critério determina a conclusão. Filtrar a quantidade de arestas devolvidas para não dar contexto extra ao braço com grafo.

### Métricas e interpretação

| Medida | Definição operacional |
|---|---|
| Tempo até retomada correta | Do recebimento do caso ao primeiro julgamento integralmente correto e com fontes suficientes. Contar timeouts como sem sucesso e analisar tempo até sucesso com censura no limite fixo. Exibir também proporção que resolveu até o limite e tempos de preparação, leitura e revisão. Se a mediana não for atingida, reportar isso e tempo médio restrito ao horizonte. |
| Qualidade e segurança do aceite | Proporção de episódios em que todos os critérios recebem o rótulo correto, com evidência no SHA adequado. Contar falso aceite crítico por casos críticos expostos, e número de retornos “pendente” em casos decidíveis. Ocorrência zero no piloto não determina risco zero. |
| Qualidade da recuperação | Recall de evidências válidas por critério sob orçamento fixo, considerando conjuntos alternativos equivalentes. Precisão das citações contra gabarito, por classe de alteração. |
| Comportamento do usuário | Tempo humano ativo e de espera, número de reexplicações, consultas manuais, correções e abandono. Cronometrar a partir de eventos e confirmar amostras por observação consentida. |
| Desempenho e custo | Mediana e p95 de compilação e retomada, entradas/saídas, memória e tamanho do índice, latência da atualização incremental, custo total e custo por retomada correta. Exibir custos observados por moeda e data, incluindo falhas. |
| Reprodutibilidade | Percentual de referências resolvíveis no ambiente congelado e taxa de concordância entre revisores antes da arbitragem. Inspecionar desacordos com exemplos. |

**Análise.** Publicar diferença pareada de tempo e de proporção correta com intervalos de incerteza, cobertura por repositório e distribuição das falhas. Para amostra adequada, reamostrar por repositório e depois por episódio, preservando os braços do par. No piloto com poucos projetos, apresentar números por projeto e análise de sensibilidade retirando um projeto por vez. Para pessoas, ajustar por participante, projeto, dificuldade e ordem quando o tamanho permitir. Tratar desistências, falhas de infraestrutura e timeouts com categorias e denominadores predefinidos. Corrigir multiplicidade se as ablações se tornarem inferenciais. Um intervalo amplo deixa a conclusão em aberto.

**Piloto humano.** Recrutar 10–20 pessoas que já alternam sessões ou ferramentas e 3–5 equipes pequenas para observação do uso, com registro consentido. Esses alvos medem viabilidade e informam dimensionamento posterior a partir da variância, do efeito mínimo de interesse e das perdas. Fazer um ensaio de laboratório breve e separar o diário de uso de quatro semanas. Relatar a proporção que voltou espontaneamente e por qual motivo. Exposições demonstrativas, tarefas próprias e pessoas da equipe do autor recebem rótulos separados. Alinhar com orientador as exigências institucionais para pesquisa com participantes antes do recrutamento.

### Validade e resultados publicáveis

- **Seleção e aprendizagem.** Colegas da UTFPR, usuários avançados e repositórios TypeScript super-representam o perfil inicial. Estratificar, documentar recusas, alternar a ordem e replicar com uma segunda comunidade, linguagem e agente.
- **Gabarito e vazamento.** Um teste pode não cobrir a regra de negócio. Submeter a um mantenedor independente, testar contraprovas e admitir rótulo indeterminado. Versionar correções do gabarito e reexecutar todos os braços afetados.
- **Deriva e concorrência.** Modelos hospedados variam e serviços têm filas. Intercalar condições na mesma janela, fixar versões disponíveis, registrar tentativas, falhas e cache. Repetir com modelo fixável quando possível.
- **Validade ecológica.** Revisar um snapshot não equivale a manter um sistema comercial por meses. Cruzar a avaliação com relatos e logs voluntários do piloto. Separar qualidade do julgamento, implementação efetiva e impacto empresarial.
- **Saídas publicáveis.** Benchmark com licença e guia de anotação, replicação dos baselines em nova população, taxonomia de falsas evidências por tipo de mudança, estudo de custo/benefício de revalidação e artefatos de um resultado nulo. Uma faixa de incerteza estreita indicando que um resumo manual atende tão bem quanto o produto seria motivo para simplificar o software. Um preprint cabe após registrar protocolo e avaliar o conjunto reservado.


## Do resultado medido à apresentação profissional

Publicar a release usada, git tag, scripts de geração dos episódios, orçamento, dados permitidos e relatório de casos falhos. Na demo, abrir o workspace, iniciar uma tarefa real, interromper, recuperar o histórico e conferir uma evidência alterada antes de mostrar qualquer gráfico. Uma linha de currículo defensável identifica a responsabilidade, o artefato público e o resultado medido, com denominador e limitações quando existirem. Até haver dados, descrever apenas capacidades implementadas e verificadas.

[Plano central](MASTER-PLAN.md) · [Distribuição e comunidade](08-OPEN-SOURCE-AND-GO-TO-MARKET.md)
