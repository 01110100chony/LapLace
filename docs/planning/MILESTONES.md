# Milestones

[Fonte normativa e fases](ROADMAP.md#fonte-normativa) · [Tarefas F1](F1_IMPLEMENTATION_PLAN.md) · [Estado e evidências](STATUS.md)

O estado inicial descreve o ponto de partida da [auditoria](STATUS.md#baseline-da-auditoria). A execução corrente é registrada no STATUS. Dependência de uma capacidade futura só se aplica à garantia que a exige.

## F1 · Retomada verificável

### F1-M01

**Auditoria reproduzível.** [F1](ROADMAP.md#f1) · v2.1 §§4, 18, 24.1 · D12/D18/D21.

- **Estado inicial e componentes.** Inspeção e verificações de baseline registradas. Catálogo, Git e IPC existentes, fixtures separadas em `apps/local-service/test`. Falta a reprodução combinada dos dados que a fatia precisa preservar.
- **Entrada e dependências.** Checkout efetivo identificado, Git e Node de projeto disponíveis, diretório de dados descartável. Sem dependência de outro milestone.
- **Aceite.** **F1-M01.A1** Fixture via fluxo legado abre A e B com a raiz canônica do D04, lê snapshot parcial/trecho e recupera revisão de tarefa simulada com origem, após reinício. Registra esquema, vínculos/digests e comandos. [F1-T01](F1_IMPLEMENTATION_PLAN.md#f1-t01).
- **Evidência e bloqueio.** Referenciar fixture, commit e saída do teste, incluindo falhas preexistentes. Bloqueiam origem do dado irrecuperável, impossibilidade de reproduzir o catálogo isoladamente ou ambiguidade na referência de migração.
- **Demonstração.** Abrir os dois projetos e as fontes históricas pelo IPC legado e usar o recibo como oráculo de comparação.

### F1-M02

**Contrato da retomada.** [F1](ROADMAP.md#f1) · §§6, 14, 16, 24.2 · D5/D10/D18/D21.

- **Estado inicial e componentes.** IPC v2 com validação em TypeScript, host Tauri e renderer. `project.resume` e DTOs da fatia a criar.
- **Entrada e dependências.** [F1-M01](#f1-m01) fornece versões e abrangência real das fontes reutilizadas. Nenhum banco novo é necessário para validar o DTO.
- **Aceite.** **F1-M02.A1** Contrato representa fresh, cached, unavailable e memória vazia, HEAD nulo, três IDs escopados, autoria, versão e fonte/lacuna. Request e response rejeitam dados inválidos e escopo incorreto, preservando IPC existente. [F1-T02](F1_IMPLEMENTATION_PLAN.md#f1-t02).
- **Evidência e bloqueio.** Referenciar testes de protocolo e decisão de compatibilidade. Bloqueiam contrato que confunda vazio, ausência de HEAD e indisponibilidade, ou exija dados de LLM.
- **Demonstração.** Inspecionar payloads válidos e exemplos recusados pelo validador.

### F1-M03

**Identidade migrada e verificável.** [F1](ROADMAP.md#f1) · §§6, 14, 16, 18, 24.3 · D12/D18/D21 · INV-12.

- **Estado inicial e componentes.** Catálogo v10 associa ID legado a raiz e identidade do checkout. Git já inspeciona worktree e valida relocalização. Faltam projeto lógico, binding e worktree separados.
- **Entrada e dependências.** [F1-M01](#f1-m01) para paridade da fixture. [F1-M02](#f1-m02) define os tipos usados na resolução. Trabalhar em cópia com backup consistente, sem conversão destrutiva.
- **Aceite.** **F1-M03.A1** Migração aditiva e transacional preserva registros, seleção e fontes. Reabertura mantém mapeamento único e falha injetada preserva versão anterior. **F1-M03.A2** Identidades sobrevivem a movimento verificado e permanecem distintas em clones/forks/templates e worktrees vinculadas. Associação ambígua requer ação explícita. [F1-T03](F1_IMPLEMENTATION_PLAN.md#f1-t03), [F1-T04](F1_IMPLEMENTATION_PLAN.md#f1-t04).
- **Evidência e bloqueio.** Contagens, vínculos e digests antes/depois, restauração ensaiada e matriz de cenários Git. Bloqueiam reassociação por heurística, perda ou falta de recuperação reproduzível.
- **Demonstração.** O mesmo checkout movido conserva IDs. Uma segunda cópia com o mesmo HEAD fica separada.

### F1-M04

**Decisão humana e fonte.** [F1](ROADMAP.md#f1) · §§6–7, 10–11, 18, 24.3 · D5/D6/D9/D17 · INV-01/03/04/06/11.

- **Estado inicial e componentes.** C01/C02 preservam fontes selecionadas. O legado registra revisão de artefato mock. Revisão de decisão do projeto, resolução por escopo e expurgo dos derivados F1 a criar no serviço e nos contratos.
- **Entrada e dependências.** [F1-M03](#f1-m03) fornece vínculo escopado. A resolução de fonte pode ser desenvolvida a partir do mapeamento migrado enquanto a integração do binding é finalizada.
- **Aceite.** **F1-M04.A1** A fonte verificada carrega captura, digest, âncora, cobertura e disponibilidade. Fonte cruzada ou inválida é recusada, fonte perdida vira lacuna. **F1-M04.A2** Registro humano local e nova revisão persistem de forma atômica e reaparecem no reinício. Resultado de tarefa mantém a origem de revisão da tentativa. **F1-M04.A3** Expurgo deliberado no escopo F1 retira a decisão e seus derivados, preserva outras origens legítimas e pode ser repetido com segurança. [F1-T05](F1_IMPLEMENTATION_PLAN.md#f1-t05), [F1-T06](F1_IMPLEMENTATION_PLAN.md#f1-t06), [F1-T07](F1_IMPLEMENTATION_PLAN.md#f1-t07).
- **Evidência e bloqueio.** Casos de integridade, autoria, conflito de revisão, reinício e expurgo reaplicado no ensaio de restauração quando aplicável. Bloqueiam fonte sem escopo, promoção autônoma e reaparecimento de decisão apagada.
- **Demonstração.** Registrar, revisar, recuperar a origem e excluir uma decisão sintética sem apagar uma captura que outra origem ainda usa.

### F1-M05

**Cockpit offline pelo fluxo real.** [F1](ROADMAP.md#f1) · §§8, 12, 14, 16, 24.4 · D2/D5/D6/D8/D10/D18/D19 · INV-01/02/04/05/08/09.

- **Estado inicial e componentes.** Home, inspeção Git, histórico de fontes e comparação em telas existentes. Composição determinística em `packages/core` proposto, serviço de leitura, ponte Tauri e composição do cockpit a criar.
- **Entrada e dependências.** [F1-M02](#f1-m02) permite avançar no core puro com dados sintéticos. Leitura integrada depende de [F1-M03](#f1-m03) e dos aceites A1/A2 de [F1-M04](#f1-m04). Piloto com retenção de decisões reais depende também de A3.
- **Aceite.** **F1-M05.A1** Mesmo input produz a mesma seleção com procedência e conflitos. **F1-M05.A2** Serviço valida escopo, devolve dado datado e bloqueia publicação obsoleta, incluindo A→B após troca. **F1-M05.A3** Desktop exibe Git, decisão/atividade/sugestão e abre a prova ou lacuna, podendo comparar com o presente e registrar manualmente. [F1-T08](F1_IMPLEMENTATION_PLAN.md#f1-t08), [F1-T09](F1_IMPLEMENTATION_PLAN.md#f1-t09), [F1-T10](F1_IMPLEMENTATION_PLAN.md#f1-t10), [F1-T11](F1_IMPLEMENTATION_PLAN.md#f1-t11).
- **Evidência e bloqueio.** Testes de core, IPC, fluxo UI e prova de Git intacto. Bloqueiam resultado cruzado, cache com aparência de dado atual, comparador que abre arquivo vivo como prova histórica ou dependência de rede/CLI.
- **Demonstração.** Fechar e reabrir o desktop e seguir o caminho da última decisão até o trecho preservado.

### F1-M06

**Validação da fatia e pilotagem.** [F1](ROADMAP.md#f1) · §§15–18, 24.5–6 · D2/D5/D12/D18.

- **Estado inicial e componentes.** Suíte e smoke legados existem. Aceites da fatia, comparação com linha de base manual e homologação desta entrega estão pendentes.
- **Entrada e dependências.** [F1-M04](#f1-m04) completa e [F1-M05](#f1-m05) integrada. Para ensaio real, dois projetos autorizados. Para distribuição, perfil Windows descartável e execução MSVC no commit candidato ou no merge validado.
- **Aceite.** **F1-M06.A1** Dois projetos reais distintos passam pelo critério final de F1, offline e após reinício. Demonstração sintética cobre pasta ausente, HEAD nulo e memória vazia. Comparação com Git + notas registra duração, correção da ação, abertura da prova e correções. **F1-M06.A2** Verificações de raiz, sidecar e Rust GNU registradas com resultado real. **F1-M06.A3 (distribuição)** NSIS e smoke passam em ambiente descartável, com evidência hospedada MSVC separada. [F1-T12](F1_IMPLEMENTATION_PLAN.md#f1-t12), [F1-T13](F1_IMPLEMENTATION_PLAN.md#f1-t13), [F1-T14](F1_IMPLEMENTATION_PLAN.md#f1-t14).
- **Evidência e bloqueio.** Vídeo ou roteiro reproduzível, resultados por caso e log por comando/ambiente no STATUS. Formatação global já falha na baseline. Registrar sua resolução ou uma exceção explícita para o desvio legado antes de fechar A2. Smoke/CI pendentes mantêm distribuição aberta.
- **Demonstração.** Desenvolvedor retoma os projetos e encontra o próximo passo com evidência. Distribuição tem aceite próprio.

## F2 · Contexto para o Codex

### F2-M01

**Compilação e preview local.** [F2](ROADMAP.md#f2) · §§7–9, 15–17 · D6/D7/D10/D18 · INV-01/03/04/09.

- **Estado inicial e componentes.** C02 recupera trechos e C03 monta preview próprio. Context Compiler compartilhado, versões de estratégia/política e manifesto geral estão planejados em core, serviço e desktop.
- **Entrada e dependências.** Identidade F1-M03 e seleção local F1-M05 utilizáveis. Corpus sintético com expectativa de fontes e conflitos.
- **Aceite.** **F2-M01.A1** Mesmo input seleciona as mesmas versões e âncoras, com precedência e orçamento. Obrigatório excedido e conflito material têm saída visível. O manifesto público omite metadados proibidos e o preview local apresenta destino e seleção.
- **Evidência, bloqueio e demo.** Testes determinísticos de empate, orçamento, omissões e conflito. Bloqueiam substituição silenciosa de fonte e exposição indevida. Demonstrar preview e recomposição com orçamento menor.

### F2-M02

**Autorização e canais de leitura.** [F2](ROADMAP.md#f2) · §§8–9, 11, 16–17 · D1/D7/D9/D14/D17/D20 · INV-01/03/07/09/10.

- **Estado inicial e componentes.** Grants do C03 são específicos da consulta existente. Gateway MCP, referência opaca, pacote versionado e política por destino estão planejados no serviço, contratos e launcher.
- **Entrada e dependências.** [F2-M01](#f2-m01), formato de cliente/pacote e política do destino definidos. Fixture sintética com A e B.
- **Aceite.** **F2-M02.A1** MCP e pacote usam a mesma seleção aprovada. Buscar, paginar, ler e entregar revalidam sessão, versão e destino. Escopo cruzado, expiração, revogação, destino alterado e importação de pacote sem permissão falham sem revelar conteúdo. Handoff preserva seleção e pendências e requer nova avaliação para uso.
- **Evidência, bloqueio e demo.** Matriz de testes positivos/negativos e envelopes de exemplo. Destino desconhecido bloqueia envio e mantém preview. Demonstrar acesso autorizado e revogação durante consulta.

### F2-M03

**Primeira consulta real auditada.** [F2](ROADMAP.md#f2) · §§9, 15, 17 · D1/D3/D7/D14/D19 · INV-01/03/07.

- **Estado inicial e componentes.** C03 tem Mock/Workspace Dev e histórico local. Aderência real do novo gateway, pacote e sessão ainda sem medição.
- **Entrada e dependências.** [F2-M02](#f2-m02), CLI e destino aprovados e versão anotada, corpus e resposta esperada.
- **Aceite.** **F2-M03.A1** Mesmo objetivo é comparado em MCP e pacote. Uma consulta legítima retorna prova verificável e o conjunto negativo entrega zero conteúdo indevido. Registrar tentativa, material entregue, consulta observada, citação declarada e revisão. Se MCP não for usado pelo cliente, registrar a falha e pilotar o pacote autorizado com limite visível.
- **Evidência, bloqueio e demo.** Rodadas pareadas, logs redigidos, acerto, recusas, duração e tokens quando disponíveis. Sem autorização ou sem canal aprovado, piloto real fica bloqueado. Demonstrar a resposta e abertura da revisão correta. LPAC condiciona apenas a modalidade que promete confinamento.

## F3 · Memória durável e histórico

### F3-M01

**Temporalidade e primeira projeção do KGRAPH.** [F3](ROADMAP.md#f3) · §§7, 12, 15–17 · D6/D8/D11/D15 · INV-04/08/11/14.

- **Estado inicial e componentes.** Planejado sobre as revisões de F1. Core, SQLite e timeline no desktop.
- **Entrada e dependências.** [F1-M04](#f1-m04). Revisões, relações, intervalos e sequência transacional exercitados com fixture.
- **Aceite.** **F3-M01.A1** Correção parcial afeta somente alcance e intervalo atribuídos, preserva segmentos residuais e responde corretamente para dois K. Conflito material segue visível. A timeline filtra projeto/data conhecida/tipo e abre prova ou lacuna. Deriva objetiva, inferência e verificador têm tipos distintos.
- **Evidência, bloqueio e demo.** Teste do exemplo §7, recomposição da projeção e roteiro comparando dois K. Bloqueiam reescrita de histórico e fusão de tipos de sinal.

### F3-M02

**Pin, retenção e expurgo recuperável.** [F3](ROADMAP.md#f3) · §§10–11, 15–17 · D5/D13/D17 · INV-04/06/14.

- **Estado inicial e componentes.** C01/G01 guardam bytes selecionados em SQLite. CAS administrado com pin e política de retenção, supressão e recuperação está planejado no serviço.
- **Entrada e dependências.** Vínculo de evidência [F1-M04](#f1-m04), fixture descartável e política de espaço para o piloto de pins. Pode avançar em paralelo a F2 e F3-M01.
- **Aceite.** **F3-M02.A1** Depois de perder a fonte Git descartável, pin verifica bytes/digest e referência simples mostra lacuna. Falha de gravação não publica manifesto pendente. Expurgo revoga acesso, retoma após falha e reindexação/restauração reconciliada não ressuscita payload. A última prova arquivada de decisão ativa fica protegida antes de ligar a coleta.
- **Evidência, bloqueio e demo.** Oráculo de bytes, interrupção/retomada, prova perdida versus pin e relatório de cota. Bloqueiam corrupção, dependentes sem inventário e restauração sem reconciliação.

### F3-M03

**Inbox e portabilidade de memória elegível.** [F3](ROADMAP.md#f3) · §§7, 9, 11, 13, 15–16 · D4/D6/D9/D17/D20 · INV-03/06/09/10/11.

- **Estado inicial e componentes.** Histórico e revisões legadas existem. Inbox, feedback mínimo e governança de exportação projetados no core, serviço e desktop.
- **Entrada e dependências.** [F3-M01](#f3-m01) fornece revisões/autoridade. Para transferir a outro destino, aplicar controles de [F2-M02](#f2-m02) e expurgo dos derivados pertinentes de [F3-M02](#f3-m02).
- **Aceite.** **F3-M03.A1** Proposta agrupa duplicatas, expira ou é rejeitada sem promoção. Revisão humana gera autoridade e origem. **F3-M03.A2 (exportação)** Somente elegível passa por preview/scanner e política, DB-only é recusado, exceção escopada perde validade se digest ou destino muda.
- **Evidência, bloqueio e demo.** Trilha de revisão/feedback redigida e matriz de exportação. Falta de política ou scanner bloqueia exportação. Demonstrar promoção humana e recusa de um payload DB-only.

### F3-M04

**Overlay fiel, trilha condicionada.** [F3](ROADMAP.md#f3) · §§10, 16–18 · D13 · INV-02/04.

- **Estado inicial e componentes.** C01/G01 parciais para esta garantia. Manifesto fiel e leitor/arquivo de overlay propostos no serviço.
- **Entrada e dependências.** Identidades [F1-M03](#f1-m03) e publicação/recuperação verificável de bytes [F3-M02](#f3-m02). Iniciar quando uma experiência exigir reconstrução fiel.
- **Aceite.** **F3-M04.A1** Fixture §17 cobre HEAD ausente, múltiplos estágios, CRLF, deleção, links, gitlink e corrida. Oráculo em repouso coincide em todos os itens declarados. Corrida observável aborta, incompatibilidade tem lacuna explícita e blob ausente impede publicação. Declara estabilidade observada e limites de OCC.
- **Evidência, bloqueio e demo.** Manifesto, digests, corrida/falha de publicação e reconstrução apenas em destino descartável. Sem paridade e controle de corrida, manter cobertura parcial ou modo quiescente identificado.

## F4 · Supervisão e Planner

### F4-M01

**Explorer, Pre-Flight e simulação Git.** [F4](ROADMAP.md#f4) · §§12, 15–17 · D8/D11/D15 · INV-02/04/08/10.

- **Estado inicial e componentes.** Inspeção e comparação G01 existentes. Planner e simulação propostos em desktop, core e serviço.
- **Entrada e dependências.** [F1-M03](#f1-m03) e leitor Git reutilizável. Sem dependência inicial de execução de agente.
- **Aceite.** **F4-M01.A1** Plano apresenta base, alvo, worktree, conflitos observados e efeitos. Mudança de HEAD/índice/destino invalida a operação. Simulação preserva o checkout de origem.
- **Evidência, bloqueio e demo.** Teste de precondição, estado Git antes/depois e preview. Sem revalidação, bloquear execução do plano. Demonstrar simulação e invalidação concorrente.

### F4-M02

**Execução observável em worktree dedicada.** [F4](ROADMAP.md#f4) · §§9, 11, 15–17 · D1/D3/D14/D15 · INV-01/07/10.

- **Estado inicial e componentes.** O02/O03 simulam execução e diff. C03 tem diagnóstico LPAC, com modo estrito bloqueado. Backend real ainda exige prova adequada ao risco.
- **Entrada e dependências.** [F4-M01](#f4-m01), consentimento por operação e backend adequado ao risco. Com entrega de contexto, [F2-M02](#f2-m02).
- **Aceite.** **F4-M02.A1** Grant delimita efeitos, tentativa real persiste base e eventos, cancelamento confirmado e interrupção recuperável preservam o original sem repetir efeito. **F4-M02.A2 (estrito)** Na mesma fronteira Windows, leitura autorizada funciona, canário externo é negado e consulta autenticada real conclui.
- **Evidência, bloqueio e demo.** Terminal, eventos, controles de fronteira e estado antes/depois. Sem prova adequada, indisponibilizar a modalidade. Demonstrar alteração e cancelamento supervisionados.

### F4-M03

**Revisão, aplicação local e verificadores condicionais.** [F4](ROADMAP.md#f4) · §§11–12, 15–17 · D1/D8/D15/D20 · INV-04/07/08/10/13.

- **Estado inicial e componentes.** G02 persiste revisão de diff simulado. Aplicação e verificadores executáveis planejados no Planner, serviço e backend.
- **Entrada e dependências.** [F4-M01](#f4-m01) e resultado verificável de [F4-M02](#f4-m02). Para uma promessa de restauração, a prova de retenção/overlay correspondente em F3.
- **Aceite.** **F4-M03.A1** Abrir diff, aceitar/recusar com proveniência e recuperar revisão após reinício. **F4-M03.A2 (aplicação)** Revalida base/índice/destino e permissões imediatamente antes do efeito e trata falha parcial sem sobrescrever alterações externas. **F4-M03.A3 (verificador)** Aprovação vincula definição, argv, cwd, ambiente, timeout e privilégio. Redefinição revoga a aprovação.
- **Evidência, bloqueio e demo.** Caso aprovado e recusado, conflito de base e recuperação. Sem consentimento/recuperação, expor só inspeção e revisão. Demonstrar decisão sobre diff como evento distinto de aplicação.

## F5 · Inteligência avançada

### F5-M01

**Parallel Hypothesis Arena.** [F5](ROADMAP.md#f5) · §§12–13, 15–17 · D8/D11 · INV-04/07/10.

- **Estado inicial e componentes.** Planejado no desktop e backend de F4, com evidência por tentativa.
- **Entrada e dependências.** [F4-M02](#f4-m02) e revisão A1 de [F4-M03](#f4-m03), critérios e base comum definidos.
- **Aceite.** **F5-M01.A1** Duas hipóteses partem de worktrees da mesma base, recebem critérios equivalentes e têm revisão pareada com resultados e fontes próprios.
- **Evidência, bloqueio e demo.** IDs, bases, eventos e resultado da comparação frente à alternativa serial. Divergência de base ou ausência de revisão invalida o ensaio. Demonstrar escolha humana fundamentada.

### F5-M02

**Replay explicável.** [F5](ROADMAP.md#f5) · §§7–8, 10, 12–13, 15–17 · D5/D8/D11 · INV-04/06/08/14.

- **Estado inicial e componentes.** Planejado sobre esquema temporal, timeline/KGRAPH, versão do compilador e evidência preservada.
- **Entrada e dependências.** [F3-M01](#f3-m01) e [F3-M02](#f3-m02). Para replay de entrega a agente, manifesto/política versionados de F2.
- **Aceite.** **F5-M02.A1** Selecionar V/K, navegar versões e evidência conhecida e declarar lacunas por expurgo/retenção. Quando disponível, recuperar a versão do manifesto/política efetivamente usada.
- **Evidência, bloqueio e demo.** Casos com expurgo, duas datas de conhecimento e projeção recomposta. Dados indisponíveis limitam reconstrução. Demonstrar como uma decisão mudou e qual prova sustentava cada versão.

### F5-M03

**Aprendizado simbólico e avaliação adaptativa.** [F5](ROADMAP.md#f5) · §§8, 13, 15–17, 22 · D4/D6/D10 · INV-01/03/06/09/11.

- **Estado inicial e componentes.** FTS5 legado reutilizável. BKM, estratégia versionada e worker opcional planejados.
- **Entrada e dependências.** Para aprendizado, feedback mínimo de [F3-M03](#f3-m03). Para reranqueamento, baseline de [F2-M01](#f2-m01) e conjunto reservado por projeto e tempo.
- **Aceite.** **F5-M03.A1** Hipóteses concorrentes deixam evidência a favor/contra, origens correlacionadas e possibilidade de reversão. **F5-M03.A2 (adaptativo)** Estratégia supera baseline na categoria escolhida, mantém explicação e invariantes e pode ser revertida.
- **Evidência, bloqueio e demo.** Recall@k, acerto temporal, obrigatórios, vazamentos, custo e avaliação da tarefa. Ganho insuficiente mantém FTS5/regras simples. Demonstrar revisão e reversão pelo usuário.

### F5-M04

**Proatividade graduada.** [F5](ROADMAP.md#f5) · §§11, 13, 15–16, 22 · D4/D10/D16 · INV-03/05/06/08/10/11.

- **Estado inicial e componentes.** Sugestões proativas e coordenação persistente planejadas no desktop/serviço. Daemon é decisão futura.
- **Entrada e dependências.** Para sugestão, sinais explicáveis de [F3-M01](#f3-m01) ou [F4-M01](#f4-m01). Para execução agendada, backend autorizado de F4, demanda observada e opt-in específico.
- **Aceite.** **F5-M04.A1** Sugestão local mostra fundamento, prioridade e reversão/dispensa, com utilidade medida ante o fluxo manual. **F5-M04.A2 (agendamento/persistência)** Janela, cancelamento, revogação, idempotência e recuperação comprovados antes de atuar com app fechado.
- **Evidência, bloqueio e demo.** Taxa de utilidade/correções, cenário de cancelamento e trilha do ciclo de vida. Sem demanda ou recuperação, manter sugestões com o app aberto. Demonstrar alerta explicável sem efeito automático.
