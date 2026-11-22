# F1 · Plano de implementação

[Fase](ROADMAP.md#f1) · [Fonte normativa](ROADMAP.md#fonte-normativa) · [Milestones](MILESTONES.md#f1-m01) · [Tarefa ativa e resultados](STATUS.md#execução)

**História.** Depois de alguns dias, reabrir um projeto, reconhecer o checkout, recuperar a decisão humana e conferir sua evidência antes de escolher o próximo passo. Use a §24 da v2.1 como ordem de referência. Os nomes de operações marcados **a criar** são propostas de contrato. `packages/core` é um pacote proposto.

Execute uma tarefa por vez, respeitando suas dependências. Preserve o sidecar e as leituras legadas. Cada `.An` indica condição verificável. Para fechar uma tarefa, registre no [STATUS](STATUS.md#registro-de-entregas) os aceites, diff/commit, comandos, ambiente, saída e limitações. Aplique os comandos pertinentes do [AGENTS](../../AGENTS.md). A rodada de validação integrada fica em F1-T12 a F1-T14. Use dados sintéticos para migração, falha e expurgo. Transfira somente evidência redigida para o log.

**Caminho para a primeira demonstração.** T01 → T02 → T03 → T04/T05 → T06 → T09 → T10 → T11. T08 depende de T02 e fornece a composição a T09. T07 depende de T06 e fornece o expurgo a T11. T12 e T13 validam a entrega integrada. T14 valida a distribuição quando estiver no escopo.

## Auditoria e contrato

### F1-T01

**Reproduzir a base legada com uma fixture combinada.** [F1-M01](MILESTONES.md#f1-m01) · §24.1, §18 · D12/D18, INV-12.

- **Contexto e alvos.** Reutilize os builders e o harness de [IPC existente](../../apps/local-service/test/ipc.test.ts) e as fixtures [Git](../../apps/local-service/test/git.test.ts). Crie um teste/builder focado se os casos existentes não puderem ser combinados com clareza. Use o HEAD efetivo com a baseline como referência.
- **Entrada e saída.** Checkout e ferramentas conferidos, catálogo D04 sintético (schema 1 e raiz de A via `realpath.native` com caixa do disco), B distinto e Git descartável. Suba pelo sidecar atual, selecione A/B, capture C01 parcialmente com trecho retido e uma omissão intencional, indexe C02 e grave uma tentativa revisada em Mock. Reinicie e obtenha cópia consistente do catálogo legado em relação a F1, com schema de origem explícito e oráculo de IDs, seleção, contagens e digests. Use backup SQLite suportado ou cópia com conexões encerradas e estado consolidado.
- **Contratos existentes.** `workspace.list`, `workspace.addLocal`, `project.select`, `project.inspect`, `context.capture`, `context.index`, `context.search`, `context.sourcePreview`, `task.start`, `execution.result`, `result.review`, `result.reviewStatus`.
- **Dependências.** Nenhuma tarefa. Precisa de subprocessos locais de Node/Git e do runner Mock da fixture.
- **Testes e aceite.** **F1-T01.A1** A e B abrem pelo IPC com a raiz e os IDs esperados. Após reinício, a fonte e a revisão de tarefa estão em A e não resolvem em B. A omissão e o modo simulado constam no oráculo. Rode o caso via `pnpm test` ou filtro do pacote.
- **DoD e evidência.** Builder repetível em pasta descartável, teste aprovado, versão do schema e comando de reconstrução registrados junto aos recibos redigidos. **Risco.** O parecer de auditoria atual e testes legados separados não substituem a fixture combinada. Nenhum dado de usuário participa.

### F1-T02

**Definir o contrato local de leitura da retomada.** [F1-M02](MILESTONES.md#f1-m02) · §§6, 14, 16, 24.2 · D5/D10/D18/D21.

- **Contexto e alvos.** [Contratos](../../packages/contracts/src/index.ts) e [testes de protocolo](../../packages/contracts/test/protocol.test.ts). Adicione o contrato `project.resume` em módulo a criar conforme o padrão do pacote.
- **Entrada e saída.** Seleção escopada com `projectId`, `bindingId` e `worktreeId`. Resultado com esses IDs, status da disponibilidade, instante `observedAt` da observação existente, origem, branch/HEAD opcionais conforme Git e contagens. Inclua revisão, autor, vigência/registro, evidência ou lacuna, atividade anterior disponível e próxima ação rotulada como sugestão. Modele observação fresh/cached/unavailable e memória empty em dimensões que admitem coexistência. Cache conserva data da leitura original. Sem observação anterior, use lacuna e momento da tentativa distintamente.
- **Contratos.** Reaproveite envelope v2, `GitObservation`, validação de IDs, erros estruturados e limites. `project.resume` e os tipos de identidade, memória e evidência são **a criar**. Documente a opção compatível aditiva ou justifique proposta de revisão se houver incompatibilidade.
- **Dependências.** [F1-T01](#f1-t01).
- **Testes e aceite.** **F1-T02.A1** Inputs/outputs válidos para fresh, cached, unavailable e empty, inclusive HEAD nulo e fonte ausente. Recusar envelopes inválidos, escopo trocado e camadas inconsistentes. Contratos legados passam. Nenhum campo obrigatório depende de CLI ou IA.
- **DoD e evidência.** Tipo, validação de runtime e exemplos de payloads de teste vinculados. **Risco.** Exibir vazio como erro, esconder cache atrasado ou permitir que o renderer infira disponibilidade pelo caminho.

## Identidade

### F1-T03

**Migrar identidade legada de forma aditiva e reversível.** [F1-M03](MILESTONES.md#f1-m03) · §§6, 18, 24.3 · D12/D18/D21, INV-12.

- **Contexto e alvos.** [Migrações do catálogo](../../apps/local-service/src/catalog.ts), `apps/local-service/test` e fixture T01. Crie tabelas/mapeamento para `LogicalProject`, `LocalRepoBinding` e `Worktree`. Os nomes SQL concretos são **a definir**.
- **Entrada e saída.** Fixture anterior consistente, backup ensaiado e esquema de origem. Uma transação cria um projeto lógico e um binding por projeto legado e associa sua worktree conhecida. Preserve raízes, IDs legados e as FKs de capturas, seleção e tarefas. Se faltar identidade verificada, guarde o vínculo legado com estado não confirmado e sem reassociação implícita.
- **Contratos.** IDs da retomada (T02), `ProjectRecord` e contratos legados. SQLite detém a autoridade. Mapeamento estável com chaves únicas, reinício idempotente e rollback sobre falha anterior ao fechamento.
- **Dependências.** [F1-T01](#f1-t01), [F1-T02](#f1-t02).
- **Testes e aceite.** **F1-T03.A1** Contagens, relações, seleção, IDs e digests conferem antes/depois. Segunda abertura não duplica. Falha injetada conserva schema/dados anteriores e restauração isolada abre com versão compatível. Valide tanto D04 sem identidade quanto a fixture com fontes e revisão.
- **DoD e evidência.** Migração numerada e log de paridade/rollback/restauração, com versão e fixture. **Risco.** Copiar banco ativo incompleto, adicionar defaults que misturem registros ou remover estruturas legadas antes de paridade e política de suporte.

### F1-T04

**Resolver binding e worktree no cadastro e na relocalização.** [F1-M03](MILESTONES.md#f1-m03) · §§5–6, 16, 24.3 · D21, INV-12.

- **Contexto e alvos.** [Leitor Git](../../apps/local-service/src/git.ts), [catálogo](../../apps/local-service/src/catalog.ts), serviço e testes IPC/Git. Adapte as portas Git existentes. Se precisar separar identidade do repositório comum da identidade de checkout/índice, estenda a resolução Git com os localizadores apropriados. Eles entram como dados verificados da porta.
- **Entrada e saída.** IDs e localizador candidato. Resultado confirma o trio ou retorna indisponível, ambíguo ou divergente. Registrar novo checkout ou vínculo explícito conforme identidade confirmada, sem inferir fusão por remote, histórico ou caminho.
- **Contratos.** `workspace.addLocal`, `project.inspect`, `project.relocate` existentes. Resolvedor de três IDs **a criar**. Git usa raiz `realpath.native`. A relocalização preserva IDs quando checkout/diretório Git correspondem e atualiza só vínculos/caches aplicáveis.
- **Dependências.** [F1-T03](#f1-t03).
- **Testes e aceite.** **F1-T04.A1** Movimento com identidade verificada conserva o vínculo, destino incorreto é recusado, cópia com mesmo HEAD permanece separada. Worktrees vinculadas têm worktree/índice próprios. Fork, template, remote alterado ou rebase da raiz não causam fusão ou troca de projeto. Escolha ambígua requer confirmação explícita.
- **DoD e evidência.** Matriz de testes e estados, com IDs e raízes sintéticas antes/depois. **Risco.** Caso legado sem identidade ou movimento que a altera exige um vínculo verificável ou cadastrado explicitamente. Preserve a associação anterior.

## Memória mínima

### F1-T05

**Resolver evidência histórica de C01/C02.** [F1-M04](MILESTONES.md#f1-m04) · §§7, 10, 18, 24.3 · D5, INV-01/04/08.

- **Contexto e alvos.** [Context store](../../apps/local-service/src/context-store.ts), [busca C02](../../apps/local-service/src/context-search.ts), [contrato de fonte](../../packages/contracts/src/context-search.ts). Crie adaptador da evidência de decisão, reaproveitando verificação de digest e leitura existentes.
- **Entrada e saída.** Escopo confirmado, ID legado, captura, referência de caminho/digest e âncora. Retorne bytes/trecho verificado, versão, data, origem, durabilidade, cobertura, disponibilidade e omissões pertinentes, ou lacuna estruturada. Uma evidência por referência só resolve na origem autorizada e segue referenciada.
- **Contratos.** `ContextSourceRef`, `context.get`, `context.sourcePreview` e referência de evidência T02 **a criar**. Recupere por IDs e digest. Mantenha caminho como parte da âncora, sem leitura genérica de disco.
- **Dependências.** [F1-T03](#f1-t03) para o mapeamento de escopo. Pode avançar enquanto T04 integra as portas do cadastro.
- **Testes e aceite.** **F1-T05.A1** Trecho reabre com os mesmos bytes após edição ou ausência do checkout. Reindexação preserva a origem ou devolve lacuna explícita. Ref de B em A falha sem revelar dados. Digest inválido, blob indisponível e captura parcial produzem estados distintos. Comparação atual não substitui o histórico.
- **DoD e evidência.** Testes de preview/digest, âncora e proveniência, com saída de exemplo. **Risco.** C01/G01 têm cobertura por seleção e armazenamento legado. A garantia de pin ou restauração integral fica em F3.

### F1-T06

**Persistir decisão humana com revisão e vínculo.** [F1-M04](MILESTONES.md#f1-m04) · §§6–7, 11, 24.3 · D5/D6/D9, INV-01/03/04/11.

- **Contexto e alvos.** Catálogo, serviço, contratos e teste de IPC. Crie store e operações locais de leitura/gravação da decisão para F1, com nomes e validação de runtime definidos nesta tarefa. Mantenha `result.review` como histórico da tentativa.
- **Entrada e saída.** Intenção humana no escopo resolvido, conteúdo, autor local, motivo/autoridade, fonte resolvida e revisão esperada para editar. Crie ID de afirmação estável e ID/ordem de revisão, vigência, instante de registro e vínculos em transação. Nova revisão preserva as anteriores. Conteúdo sem lastro tem lacuna explícita e segue provisório quando faltar condição para promoção.
- **Contratos.** Identidade T02/T04, evidência T05, `Assertion`/`AssertionRevision` mínimos **a criar**. Por padrão, decisão fica `local_only`. A promoção para `canonical_verified` segue ato humano explícito. O mínimo de tempo e versão deixa espaço para V/K em F3.
- **Dependências.** [F1-T04](#f1-t04), [F1-T05](#f1-t05).
- **Testes e aceite.** **F1-T06.A1** Criar, revisar e reabrir preserva ID, versões, autor e fonte. Revisão esperada obsoleta, fonte cruzada e pedido sem autorização humana são recusados. Falha entre revisão e vínculo reverte ambos. Mudança na decisão preserva história e revisão da execução legada continua identificada como tal.
- **DoD e evidência.** Contrato e operações no sidecar, testes de transação, reinício e negativas. **Risco.** Usar aprovação de diff mock como decisão do projeto ou promoção automática por texto de agente.

### F1-T07

**Expurgar uma decisão e derivados introduzidos por F1.** [F1-M04](MILESTONES.md#f1-m04) · §§11, 16, 18, 24.3 · D17, INV-06/14.

- **Contexto e alvos.** Store T06, transações do catálogo, caches do cockpit e testes de IPC. Faça inventário de revisões, vínculos, payload, projeções/caches e eventual redundância em cópia administrada. Operação deliberada de exclusão/expurgo local **a criar**. Se o serviço usar transação única para DB-only, prove atomicidade. Havendo mais de uma fronteira, registre intenção redigida e retomada idempotente.
- **Entrada e saída.** Pedido humano escopado com confirmação do alcance, ID e revisão atual. Tornar a decisão inacessível, remover payloads e vínculos afetados, invalidar leituras em voo e recompor derivados aplicáveis. Preservar captura de outra origem legítima. Se houver cópia administrada, restaurar isoladamente e reaplicar a supressão antes de servir.
- **Contratos.** Decisão/evidência T05/T06, escopo e recibo de expurgo **a criar**. Registrar lacunas/disponibilidade e só concluir quando o escopo administrado estiver verificado.
- **Dependências.** [F1-T06](#f1-t06). Revalidar no fluxo do cockpit em T11/T12. Fecha a condição para retenção de decisões reais.
- **Testes e aceite.** **F1-T07.A1** Após apagar uma decisão sintética, leitura nova, leitura atrasada, restart e reindexação aplicável não retornam o payload. Segunda execução é segura e falha simulada reverte ou retoma. A captura usada por outra origem permanece válida. Se houver backup administrado com decisão, comprovar restauração sem ressurgimento.
- **DoD e evidência.** Inventário por derivado, teste de exclusão/recuperação e registro dos limites do escopo. **Risco.** Remover blob compartilhado ou guardar conteúdo sensível no registro. Pins, GC geral e expurgo de outros domínios ficam fora do incremento.

## Cockpit

### F1-T08

**Compor a retomada em domínio puro.** [F1-M05](MILESTONES.md#f1-m05) · §§7–8, 14, 24.4 · D6/D10/D18, INV-01/04/05/08/09/11.

- **Contexto e alvos.** `packages/core` **a criar** com manifest e teste seguindo o workspace. Consuma entradas explicitamente passadas pelo serviço.
- **Entrada e saída.** Escopo, instante de consulta, observação Git/cached, revisões, evidências e atividade já filtradas, com ausência explícita. Retorne decisão vigente e sua procedência, atividade anterior datada, lacunas/conflitos e próxima ação sugerida por regra simples. Use relógio como entrada e desempate estável por ID.
- **Contratos.** T02 e dados de memória/evidência normalizados, sem I/O. Se houver preferências na composição, invariante aplicável precede preferência do projeto e perfil pessoal. Conflito material suspende a sugestão dependente.
- **Dependências.** [F1-T02](#f1-t02). Pode executar com fixtures sintéticas em paralelo à identidade.
- **Testes e aceite.** **F1-T08.A1** Repetir/permudar entrada equivalente resulta na mesma resposta. Casos de vazio, HEAD nulo, cache, decisão vigente, conflito, item de outro escopo e ausência de fonte produzem saídas esperadas. Regras são testadas sem SQLite, Git, CLI ou rede.
- **DoD e evidência.** Teste puro e saída de referência explicam quais regras geram decisão, atividade e sugestão. **Risco.** Antecipar compilador multicanal, Replay ou inferência. Use a interface mínima da retomada.

### F1-T09

**Integrar `project.resume` ao sidecar e descartar resposta obsoleta.** [F1-M05](MILESTONES.md#f1-m05) · §§11, 14, 16, 24.4 · D2/D18/D19, INV-01/02/04/05.

- **Contexto e alvos.** [Dispatcher](../../apps/local-service/src/main.ts), catálogo/portas, testes IPC e composição T08. Use `project.inspect` e leituras locais existentes pelo serviço. Mantenha escrita de cache do catálogo com o escopo original.
- **Entrada e saída.** Pedido do cockpit correlacionado com a seleção ativa. Resolva trio, leia candidatos do mesmo escopo, revalide binding, estado da solicitação e validade da decisão antes de publicar. Responda com DTO de T02, observação fresh ou cache original datado, estados unavailable/empty ou descarte estruturado.
- **Contratos.** `project.resume` de T02, `project.select`, `GitObservation`, portas de identidade, decisão e fonte. Use mecanismo de correlação/geração explícito entre serviço, host e janela. A janela também invalida a sua geração ao alternar (T10).
- **Dependências.** [F1-T04](#f1-t04), [F1-T05](#f1-t05), [F1-T06](#f1-t06), [F1-T08](#f1-t08).
- **Testes e aceite.** **F1-T09.A1** Sequência A→B e A→B→A com atraso artificial não publica resposta de geração anterior. Trio inconsistente, binding alterado em voo e decisão expurgada antes de publicar não entregam payload obsoleto. Após leitura, HEAD, índice e refs permanecem iguais. Pasta ausente e HEAD nulo mantêm leitura local possível conforme estado.
- **DoD e evidência.** Testes IPC com respostas fora de ordem, erro esperado e estado Git comparado. **Risco.** Chave de cache por caminho ou projeto sozinho e corrida entre seleção, leitura e entrega.

### F1-T10

**Ligar a leitura ao host Tauri e exibir o resumo.** [F1-M05](MILESTONES.md#f1-m05) · §§14, 16, 24.4 · D2/D8, INV-01/04/05/08.

- **Contexto e alvos.** [Host](../../apps/desktop/src-tauri/src/main.rs), [IPC React](../../apps/desktop/src/ipc.ts), [App](../../apps/desktop/src/App.tsx), [workspace](../../apps/desktop/src/workspace.ts) e capacidades Tauri quando o padrão do comando exigir. Componente do cockpit **a criar** ou extrair da visão existente conforme coesão.
- **Entrada e saída.** Seleção na Home/sidebar e resposta correlacionada. Exiba checkout e Git observado, última decisão/atividade e ação sugerida. Estado da UI distingue cache com data, ausência de pasta, HEAD nulo e nenhuma memória. Troca de projeto ou navegação para Home invalida resposta pendente.
- **Contratos.** `project.resume`, bridge Tauri com lista fechada de operações e validação de resposta existente. Preserve navegação e refresh do Git.
- **Dependências.** [F1-T09](#f1-t09).
- **Testes e aceite.** **F1-T10.A1** Client IPC rejeita ID/operação/escopo incorretos. Teste de estado reproduz resposta atrasada entre A e B e volta à Home. No desktop normal, abrir, atualizar e alternar projetos exibe os rótulos e dados corretos sem CLI/rede.
- **DoD e evidência.** Testes de renderer/IPC, build web, check Rust se tocado e roteiro ou captura redigida da leitura no desktop. **Risco.** Renderizar dados anteriores enquanto o novo projeto carrega. O cache válido continua associado somente à sua origem.

### F1-T11

**Registrar uma decisão e abrir/comparar sua fonte no cockpit.** [F1-M05](MILESTONES.md#f1-m05) · §§7, 10–12, 24.4 · D5/D6/D8/D9, INV-01/04/06/08/11.

- **Contexto e alvos.** Cockpit T10, host e renderer IPC, [ContextView](../../apps/desktop/src/ContextView.tsx), [ContextSearchView](../../apps/desktop/src/ContextSearchView.tsx) e store T06. Reaproveite seleção de fonte e comparação existentes onde cumprirem o contrato.
- **Entrada e saída.** Usuário registra/revisa intenção e seleciona fonte preservada. Cockpit confirma a versão, abre âncora histórica verificada e permite compará-la ao presente, com data e origem de cada lado. Fonte indisponível mostra lacuna e mantém ação de registro manual visível. Para exclusão deliberada, ligue a ação confirmada ao expurgo T07 e exiba seu resultado.
- **Contratos.** Operações T05/T06, `context.sourcePreview`, `context.validate` ou outra leitura comparativa existente compatível. T07 fornece revogação/expurgo. Operações novas precisam de validador e rotas explícitas na ponte.
- **Dependências.** [F1-T10](#f1-t10) para o cockpit e [F1-T05](#f1-t05), [F1-T06](#f1-t06), [F1-T07](#f1-t07) para fonte, revisão e exclusão. A abertura de fonte pode ser ligada antes de T07. O cartão fecha com os dois aceites.
- **Testes e aceite.** **F1-T11.A1** Pelo fluxo normal, gravar e editar com fonte em A, fechar/reabrir e ver a revisão correta. Alterar arquivo vivo mantém o trecho antigo e explicita diferença. Lacuna não abre caminho arbitrário. Em B, a ação e a fonte de A ficam fora da visão. **F1-T11.A2** Após T07, exclusão confirmada some do cockpit e não volta ao alternar ou reiniciar.
- **DoD e evidência.** Casos IPC/renderer e roteiro visual redigido com fonte histórica, atual e lacuna. Anote o vínculo de A2 a T07. **Risco.** Usar arquivo atual como passado ou reaproveitar a revisão de origem como ação humana de promoção.

## Validação

### F1-T12

**Validar retomada offline e medir contra Git + notas.** [F1-M06](MILESTONES.md#f1-m06) · §§15, 17–18, 24.5 · D2/D5/D12.

- **Contexto e alvos.** Fluxo normal desktop, fixture T01 migrada e [STATUS](STATUS.md#registro-de-entregas). Escreva roteiro reproduzível na própria evidência ou aponte para artefato redigido.
- **Entrada e saída.** Dois projetos reais distintos sob autorização do autor e casos sintéticos de pasta ausente, HEAD nulo, memória vazia e fonte indisponível. Após intervalo, compare o percurso com Git + notas usando casos comparáveis e expectativa da ação/fonte declarada antes da rodada. Fixe o envelope de UX antes de medir.
- **Contratos e dependências.** Toda a experiência `project.resume`, decisão, fonte e expurgo chega por [F1-T11](#f1-t11). O piloto requer autorização para usar projetos reais e participação do autor.
- **Testes e aceite.** **F1-T12.A1** Em A e B, registrar e recuperar decisão com fonte após reinício offline e sem CLI de IA, observar Git datado e apontar ação correta e lacuna. Nos cenários sintéticos, verificar degradação e separação de escopo. Medir duração até ação correta e abertura da prova, erros/correções e falhas por rodada.
- **DoD e evidência.** Vídeo ou roteiro, commit, configuração do §17 e resultados reais dos dois casos com baseline manual. **Risco.** Uma demo sintética é evidência funcional parcial. Sem piloto autorizado e realizado, A1 permanece pendente.

### F1-T13

**Executar a validação integrada local GNU.** [F1-M06](MILESTONES.md#f1-m06) · §24.6 · D12/D18/D19.

- **Contexto e alvos.** [Scripts da raiz](../../package.json), [preparação](../../apps/desktop/scripts/prepare-sidecar.mjs), Cargo e [AGENTS](../../AGENTS.md). Use o commit candidato e o ambiente declarado de Node/pnpm/GNU.
- **Entrada e saída.** Código integrado da fatia e relatório por comando contendo resultado, log, ambiente e escopo de teste.
- **Contratos e dependências.** Checks da raiz, sidecar e target GNU indicados no AGENTS. [F1-T11](#f1-t11) com expurgo integrado. Pode avançar em paralelo ao roteiro de piloto T12.
- **Testes e aceite.** **F1-T13.A1** Rodar lint, typecheck, format:check, test, build:web, prepare:sidecar, cargo fmt/check GNU. Registrar falha por comando e confirmar aprovação das alterações e testes da fatia. Resolver falhas relevantes. Para o desvio de formato preexistente, obter resolução ou exceção explícita e registrar baseline e checagem focada.
- **DoD e evidência.** Relatório aponta para commit, toolchain e resultados reais. Resultado incompleto continua pendente. **Risco.** Usar teste de baseline como resultado do candidato, confundir check Rust com build NSIS ou misturar conjuntos GNU/MSVC.

### F1-T14

**Validar distribuição Windows quando entrar no escopo.** [F1-M06](MILESTONES.md#f1-m06) · §§17–18, 24.6 · D12/D19.

- **Contexto e alvos.** [CI](../../.github/workflows/ci.yml), [smoke](../../scripts/smoke-windows.ps1) e fluxo NSIS do [AGENTS](../../AGENTS.md). Atualizar a cobertura do smoke para F1 somente se a verificação da distribuição exigir.
- **Entrada e saída.** Candidato aprovado localmente e perfil descartável sem Laplace, runtime WebView2 acompanhado e Git for Windows quando for exercitar Git. Resultado identifica binário/instalador e commit.
- **Contratos e dependências.** IPC instalado e catálogo reaberto. [F1-T13](#f1-t13). Para CI, gatilho de branch/PR autorizado ou execução legítima que cubra o candidato. Smoke não implica homologação completa da GUI em máquina limpa.
- **Testes e aceite.** **F1-T14.A1** Build NSIS e smoke do sidecar instalado passam no perfil descartável. Quando o fluxo da entrega exigir, verificar cockpit instalado com reinício e fixture F1. Evidência MSVC hospedada identifica commit/merge, workflow e resultado. GNU e MSVC têm registros separados.
- **DoD e evidência.** Logs de instalação/smoke, alvo e referência ao run hospedado. **Risco.** Branch atual fora dos filtros diretos de push, instalador sem assinatura e comportamento de bootstrapper WebView2 dependente da máquina. Smoke e CI pendentes mantêm distribuição pendente.
