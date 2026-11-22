# Roadmap operacional do LapLace

## Fonte normativa

A referência desta entrega é o anexo **LapLace — Arquitetura consolidada v2.1**, versão candidata de 22/11/2026, fornecido como `LAPLACE_ARQUITETURA_CONSOLIDADA_V2_1 (2).md` (332 linhas, SHA-256 `6bc5833076964b88b92a247fe132f97e9de522262de02d37c23898b9bf3621af`). A cópia normativa está fora do checkout auditado. Abra o anexo da tarefa e confira a versão e as seções citadas. Se a cópia estiver indisponível, solicite-a quando a decisão depender do texto normativo.

Use a §15 para a sequência de entregas, a §16 para os invariantes por capacidade, a §17 para os ensaios, a §18 para a migração, a §20 para as decisões D1–D21 e a §24 para a execução de F1. Os IDs `F1`–`F5`, `Fn-Mnn` e `F1-Tnn` identificam, respectivamente, fase, milestone e tarefa. Os sufixos `.An` identificam aceites. Da fase, siga o link do milestone e, em F1, o da tarefa que verifica o aceite. A evidência correspondente é registrada no [STATUS](STATUS.md#registro-de-entregas) com os mesmos IDs. A [baseline](STATUS.md#baseline-da-auditoria) estabelece o estado observado.

O [contexto histórico](../../CONTEXTO_LAPLACE.md), o [plano v2](../../Laplace_Plano_v2/MASTER-PLAN.md), seu [roadmap](../../Laplace_Plano_v2/06-ROADMAP-AND-EXECUTION.md) e seu [backlog](../../Laplace_Plano_v2/11-IMPLEMENTATION-BACKLOG.md) explicam a origem da fundação. Os seis sprints, prazos e cards históricos dão lugar à ordem por dependência abaixo. D1–D21 identificam decisões da §20. D04/D06, C01–C04, O01–O03 e G01–G03 identificam entregas legadas.

## F1

**Retomada verificável · PI01, E1.a/b · §§6–7, 14–18, 24.** Reabrir dois projetos reais, reconhecer o checkout, ler a decisão vigente e sua fonte, entender o Git observado e escolher o próximo passo.

- **Capacidades.** Catálogo com projeto lógico, binding e worktree distintos, observação Git datada e cache, decisão humana versionada e local, abertura de fonte C01/C02 com cobertura e comparação com o presente, última atividade disponível e próxima ação sugerida. Home e cockpit funcionam offline.
- **Dependências e entrega.** Partir da linha avançada auditada e preservar `ad967e1` como referência de fundação. Usar catálogo SQLite, Git, contratos, sidecar e janela existentes. A fixture legada guia a migração aditiva. A leitura do cockpit depende das portas de identidade, decisão e evidência. [F1-M01](MILESTONES.md#f1-m01) → [F1-M02](MILESTONES.md#f1-m02) → [F1-M03](MILESTONES.md#f1-m03) → [F1-M04](MILESTONES.md#f1-m04) → [F1-M05](MILESTONES.md#f1-m05) → [F1-M06](MILESTONES.md#f1-m06).
- **Riscos e conclusão.** Associação de clone errada, migração irrecuperável, resposta atrasada de outro projeto e fonte histórica apresentada como atual são falhas de aceite. Após reinício, pelo desktop normal e sem rede ou CLI de IA, o autor registra e recupera decisão com fonte, abre prova e comparação, identifica ação e lacuna. Demonstrar também HEAD ausente, pasta ausente e memória vazia. Registrar os dois casos reais autorizados e comparar com Git + notas. [Aceite final](MILESTONES.md#f1-m06).
- **Adiados.** MCP, pacote externo, WAL multiprocesso, overlay fiel, pin/GC geral, Replay histórico por V/K arbitrários, KGRAPH visual, Planner, verificadores executáveis, presets completos, provedor externo e daemon.

## F2

**Contexto para o Codex · PI02/03, E1.c mínimo + E2 leitura · §§8–9, 11, 15–17.** Inspecionar quais fontes serão usadas e conferir a resposta a uma pergunta real no mesmo contexto autorizado.

- **Capacidades.** Context Compiler com um manifesto versionado, precedência, conflitos, orçamento e omissões divulgáveis. Gateway MCP local por stdio para resumo, busca e referência opaca, com grant revogável. ContextPackage e handoff mínimo usam a mesma seleção. Registrar tentativa, entrega, fontes efetivamente consultadas quando observáveis, citações e revisão.
- **Dependências e entrega.** Identidade, escopo e seleção local de F1. A preparação offline precede a autorização de destino. O piloto real depende do gateway e do canal por pacote, de cliente compatível e de autorização de dados e destino. [F2-M01](MILESTONES.md#f2-m01) → [F2-M02](MILESTONES.md#f2-m02) → [F2-M03](MILESTONES.md#f2-m03). F3 pode avançar em paralelo.
- **Riscos e conclusão.** CLI pode ignorar o MCP, revelar destino insuficiente ou citar uma edição errada. Comparar canais com corpus equivalente. Uma consulta legítima autenticada precisa concluir com fonte verificável e o conjunto negativo precisa produzir zero respostas indevidas. Usar pacote autorizado e declarar a degradação se a aderência MCP for insuficiente. No piloto com cliente independente, a garantia cobre o canal, conforme §9.
- **Adiados.** Segundo CLI (Antigravity experimental), verificador executável, inferência adaptativa, escrita Git, CAS de overlay fiel e promessa de execução confinada sem prova específica.

## F3

**Memória durável e histórico · restante de E1.b/c e E2 · §§7, 10–13, 15–18.** Entender o que se sabia em uma data, recuperar uma prova fixada e navegar de uma decisão à evidência ou à lacuna.

- **Capacidades.** Revisões imutáveis bitemporais V/K, relações tipadas, conflitos e correções parciais. Timeline como primeira projeção do KGRAPH, com ligações confirmadas e sinais de deriva distintos de inferência. Pin seletivo, retenção, expurgo retomável, supressão e reconstrução. Inbox para propostas e revisão humana com feedback mínimo local. Exportação local elegível/preview e sync controlado somente quando habilitado. Dirty Overlay fiel é trilha própria, condicionada à sua prova.
- **Dependências e entrega.** Revisões e escopo F1 permitem histórico e timeline. Vínculos e catálogo F1 permitem pins em paralelo à integração F2. Exportação depende de política de divulgação e dos controles de expurgo aplicáveis. [F3-M01](MILESTONES.md#f3-m01), [F3-M02](MILESTONES.md#f3-m02), [F3-M03](MILESTONES.md#f3-m03) e [F3-M04](MILESTONES.md#f3-m04).
- **Riscos e conclusão.** Prova referenciada pode sumir, cota pode esgotar e backup pode ressuscitar conteúdo expurgado. Demonstrar correção retroativa parcial com dois limites de conhecimento, acesso ao pin após perda do objeto de origem, lacuna para referência indisponível e reconstrução sem ressurgimento. Para exportação, provar elegibilidade, preview, recusa e registro escopado antes de disponibilizar a operação.
- **Adiados.** Grafo visual completo, overlay de cobertura ampla, GC automático sem ensaio, modelos, compartilhamento de equipe e mudança do runtime por motivos de desempenho ainda não medidos.

## F4

**Supervisão e Planner · E3 · §§9–12, 15–17.** Entender e revisar uma alteração planejada e produzida em uma worktree dedicada, com base e garantias visíveis.

- **Capacidades.** Git Visual Planner de leitura e simulação, Pre-Flight com precondições e mudanças objetivas, backend por capacidade, grant por operação, tentativa observável, cancelamento, recuperação, diff e revisão humana. Aplicação local, quando habilitada, revalida base/índice/destino e exige confirmação própria. Verificador executável depende de aprovação escopada e backend apropriado ao risco.
- **Dependências e entrega.** Explorer pode aproveitar identidade e Git de F1 antes de MCP. Uma execução que recebe contexto usa o manifesto e os controles de destino de F2. Reutilizar tentativas e revisão de G02/O02/O03; usar o armazenamento de F3 apenas para garantias de retenção/overlay que a operação alegar. [F4-M01](MILESTONES.md#f4-m01), [F4-M02](MILESTONES.md#f4-m02), [F4-M03](MILESTONES.md#f4-m03).
- **Riscos e conclusão.** Mudança concorrente de base, processo órfão, aplicação parcial e falsa promessa de confinamento. Demonstrar plano que invalida base obsoleta, tentativa real e cancelável em área dedicada com backend adequado, recuperação de interrupção e revisão do diff. C03/LPAC ou prova equivalente bloqueia a modalidade estrita, incluindo consulta autenticada sob a mesma fronteira.
- **Adiados.** Daemon, operações remotas novas, aplicação automática, autonomia transversal e Planner avançado sem caso de uso.

## F5

**Inteligência avançada · E4 · §§8, 12–13, 15–17, 22.** Comparar soluções com critérios comuns, explicar sugestões e reproduzir o conhecimento registrado em uma data.

- **Capacidades.** Arena de hipóteses em worktrees de mesma base, Replay bitemporal de dados disponíveis, KGRAPH para explicar causalidade, aprendizado simbólico com BKM e revisão do usuário, avaliação de ranqueamento/adaptação contra FTS5 e regras simples. Proatividade começa por sugestões durante o uso, depois opt-in, janelas, cancelamento e histórico.
- **Dependências e entrega.** Arena usa execução supervisionada F4. Replay usa histórico, versões e durabilidade F3. Aprendizado usa feedback local e versionamento da estratégia. Sugestões locais só dependem das fontes e sinais que explicam. Coordenação com app fechado depende de demanda e de recuperação comprovada. [F5-M01](MILESTONES.md#f5-m01), [F5-M02](MILESTONES.md#f5-m02), [F5-M03](MILESTONES.md#f5-m03), [F5-M04](MILESTONES.md#f5-m04).
- **Riscos e conclusão.** Comparação enviesada por bases diferentes, generalização entre projetos, alertas sem utilidade e custo sem ganho. Cada experiência demonstra utilidade ante baseline, com limites e reversão. Replay explica lacunas de retenção e a versão conhecida. Arena registra bases, critérios e revisão pareada. Estratégia adaptativa só avança com ganho mensurado e invariantes preservados.
- **Adiados ou condicionais.** Modelos treinados, daemon, proatividade persistente, políticas de equipe, sincronização multiusuário e comercialização aguardam justificativa e autorização próprias.

## Invariantes por capacidade

| Capacidade ativada                       | Invariantes e prova mínima                                                                                                                                                                               | Milestone                                                                                      |
| ---------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| Cadastro e relocalização                 | INV-12 · SQLite vincula IDs, duas cópias com mesmo HEAD ficam distintas, mudança de caminho exige identidade verificada.                                                                                 | [F1-M03](MILESTONES.md#f1-m03)                                                                 |
| Observação e cockpit                     | INV-01/02/04/05/08/09 · A→B descarta resposta atrasada. HEAD, índice e refs ficam intactos. Origem, data, bytes/cobertura e lacunas visíveis. Seleção determinística distingue fato, decisão e sugestão. | [F1-M05](MILESTONES.md#f1-m05)                                                                 |
| Decisão local, projeções e retenção real | INV-03/04/06/11 · local por padrão, decisão humana e fonte escopadas, expurgo dos derivados administrados introduzidos na fatia. Nenhum feedback com payload novo em F1.                                 | [F1-M04](MILESTONES.md#f1-m04)                                                                 |
| Compilação, gateway e divulgação         | INV-01/03/07/09/10 · precedência, orçamento, interseção de permissões, destino e política revalidados até a entrega, grant expirado/revogado e acesso cruzado recusados.                                 | [F2-M01](MILESTONES.md#f2-m01), [F2-M02](MILESTONES.md#f2-m02)                                 |
| Timeline, pin, replay e expurgo          | INV-04/06/08/11/14 · história V/K, conflitos visíveis, prova retida e verificável, reconstrução e ausência após expurgo. Proteção da última prova arquivada antes de coleta automática.                  | [F3-M01](MILESTONES.md#f3-m01), [F3-M02](MILESTONES.md#f3-m02), [F5-M02](MILESTONES.md#f5-m02) |
| Exportação e propostas                   | INV-03/06/09/10/11 · marcar elegibilidade, exigir preview e política, respeitar a restrição mais forte, limitar exceção a digest e destino e exigir revisão humana para promoção.                        | [F3-M03](MILESTONES.md#f3-m03)                                                                 |
| Overlay fiel                             | INV-02/04 · cobertura explícita, OCC com aborto de corrida observável, blobs prontos antes da publicação, reconstrução em fixture descartável.                                                           | [F3-M04](MILESTONES.md#f3-m04)                                                                 |
| Planner, execução e verificadores        | INV-02/07/08/10/13 · operação e isolamento classificados, revalidar precondições, restringir aprovação a definição, privilégio e escopo, exigir autorização específica para efeitos.                     | [F4-M01](MILESTONES.md#f4-m01), [F4-M02](MILESTONES.md#f4-m02), [F4-M03](MILESTONES.md#f4-m03) |
| Arena, aprendizado e proatividade        | INV-01/03/04/05/06/08/10/11/14 · mesmo ponto de partida, feedback local, padrões reversíveis, consentimento e histórico rastreável, degradação offline.                                                  | [F5-M01](MILESTONES.md#f5-m01), [F5-M03](MILESTONES.md#f5-m03), [F5-M04](MILESTONES.md#f5-m04) |

Os experimentos da §17 registram commit, Windows, hardware, filesystem, Git/SQLite/CLI quando aplicáveis, configuração, fixture/seed, repetições e falhas. Defina o envelope de UX antes de medir. O ensaio WAL depende de uma necessidade observada de concorrência; até lá, o sidecar mantém a política atual. Para corpus privado, use dados autorizados em ambiente local. Um experimento valida somente a capacidade e a garantia testadas.
