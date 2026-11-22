# Código aberto, Brasil e distribuição

O desktop local nasce em PT-BR, com catálogo de strings, formatos de dados e contratos preparados para inglês. A primeira experiência é abrir um repositório no Windows sem conta da plataforma. Usar um modelo remoto ou um serviço Git privado requer as credenciais próprias desses serviços.

## O que os dados brasileiros permitem dizer

O GitHub reportou 10,2 milhões de desenvolvedores na plataforma no Brasil em setembro de 2026. Isso permite escolher o GitHub como canal para distribuir exemplos e recrutar mantenedores. O dado conta a comunidade de uma plataforma e inclui pessoas com perfis de uso muito diferentes. Ele não mede o público que usa agentes semanalmente, troca de projeto e instalaria uma ferramenta complementar. [GitHub Octoverse 2026, publicado em 28/10, atualizado em 06/11](https://github.blog/news-insights/octoverse/octoverse-commits-pushes-reach-new-highs-in-2026-as-developers-build-with-agents/)

A TIC Empresas 2025 reporta uso de alguma tecnologia de IA em 17% das empresas do universo pesquisado, 15% entre as com 10–49 pessoas e 49% em informação e comunicação. A pergunta foi feita a empresas com especialistas, área ou departamento de TI, e o indicador é divulgado sobre o total. A pesquisa cobre empresas a partir de dez pessoas ocupadas. Quase todo o nosso público individual e parte das equipes-piloto ficam fora desse recorte. O dado justifica investigar diferenças por contexto. Extrapolá-lo para receita endereçável de DevTools produziria uma estimativa sem base. [Cetic.br/NIC.br, TIC Empresas 2025, tabela H9, divulgada em 2026](https://cetic.br/pt/tics/pesquisa/2025/empresas/H9/expandido/)

### Quem tem motivo para instalar

| Segmento | Episódio a procurar | Obstáculo a testar | Decisão de entrada |
|---|---|---|---|
| Independente ou freelancer com dois projetos ativos | Retorna ao repo do cliente dias depois e reconstrói critérios, branch e testes manualmente | Código do cliente, custo em dólar, acesso só por computador administrado | **Primeiro público**. Usar a alpha em um clone autorizado e acompanhar uma tarefa real |
| Estudante com extensão, laboratório ou OSS | Entrega tarefa a colega entre aulas ou semestres | Baixa frequência de retomada, orçamento próprio e máquina compartilhada | Recrutar estudantes que já usam agentes e Git em projeto contínuo |
| Software house com 2–10 devs | Revisor precisa saber o que o agente e o autor verificaram antes da troca de turno | Permissão do cliente, mistura de projetos, política de IA | **Público da alpha de equipe**. Começar em um único repo autorizado |
| Startup com revisão assíncrona | Duas pessoas continuam a mesma issue em dias distintos | Já possui solução nativa adequada ou regras maduras de revisão | Convidar para as releases com revisão e coordenação de sessões |
| TI interna de PME | Manutenção depende de conhecimento concentrado numa pessoa | Máquinas bloqueadas, instalação, compra, legado sem testes | Testar com responsável por TI e fixture pública antes de pedir acesso |
| Usuário casual de chat | Dúvida isolada sobre um trecho | Poucas ocasiões para amortizar a instalação | Excluir da primeira coorte e registrar a razão |

## Licença e governança

| Opção | Efeito principal | Consequência para esta ferramenta |
|---|---|---|
| [Apache-2.0](https://www.apache.org/licenses/LICENSE-2.0) | Uso e redistribuição permissivos, concessão expressa de certas patentes de contribuidores, obrigações de avisos e marcação de arquivos modificados na redistribuição | **Escolhida** para núcleo, CLI, interface e SDK próprios. Permite integrar o leitor de pacotes em ferramentas comerciais. Aceitamos o risco de forks fechados |
| [MIT](https://opensource.org/license/mit) | Permissão ampla e texto curto, exigindo preservar aviso de copyright e permissão | Simples para uma biblioteca pequena. Apache explicita o tratamento de patentes, questão relevante para integrações de terceiros |
| [MPL-2.0](https://www.mozilla.org/en-US/MPL/2.0/FAQ/) | Copyleft no nível dos arquivos cobertos quando há distribuição, admitindo combinação com outros arquivos | Boa opção se a prioridade passar a ser garantir acesso a alterações dos arquivos centrais. Acrescenta trabalho para integrar e distribuir modificações |
| [AGPL-3.0](https://opensource.org/license/agpl-3.0) | A seção 13 obriga quem modifica o programa e permite interação remota a oferecer o código-fonte correspondente aos usuários remotos daquela versão | Adequada quando reciprocidade de serviço hospedado é objetivo central. A maior parte da utilidade inicial ocorre no computador do usuário |
| Open core | Modelo de produto com componentes sob licenças distintas | Postergar. Criaria duas superfícies de suporte e discussão sobre quais controles seriam pagos antes de saber o que alguém adotaria |

Contribuições entram sob a mesma licença das partes correspondentes. Incluir LICENSE, avisos aplicáveis de terceiros e inventário de componentes por release. Manter esquema e exemplos do pacote públicos e versionados. Definir proprietário de decisões, prazo indicativo de triagem semanal e um canal privado para falhas que exponham conteúdo. O mantenedor publica decisões de compatibilidade e depreciações. Um segundo revisor externo pode assumir a área do adaptador após duas entregas acompanhadas. A licença do app cobre o que o projeto pode licenciar. Fixtures precisam de origem e direitos próprios, e os modelos/CLIs mantêm seus termos.

## Oferta e manutenção

Community inclui desktop, leitura local, integração com Codex e formato aberto. BYOK ou autenticação já suportada pela CLI evita operar um proxy obrigatório. Usar o cofre do sistema para credenciais que o próprio aplicativo administra. Um modelo local futuro tem custo de hardware e compatibilidade próprios. Linux e macOS começam com smoke tests de build, indicadores explícitos de compatibilidade e empacotamento progressivo. Cloud hospedada e self-hosting tornam-se úteis quando várias pessoas precisarem do mesmo histórico; antes disso, o armazenamento no dispositivo basta.

### Quanto pode custar

**Unidade de simulação, em dólares.** Uma sessão curta ilustrativa consome, por hipótese, 12.000 tokens de entrada faturável e 2.000 de saída no agregado de todas as chamadas do modelo. Para permitir reprodução, usar a tarifa pública de referência do GPT-5.4 mini de US$ 0,75 e US$ 4,50 por milhão, respectivamente, sem cache ou batch. O custo unitário ilustrativo é US$ 0,018. O adaptador real pode usar outro modelo, outra tabela e muito mais contexto. Trocar o modelo ou executar chamadas de longa duração exige novo cálculo. [Modelo e tabela de preços](https://developers.openai.com/api/docs/models/gpt-5.4-mini) · [Descrição de preços em português](https://openai.com/pt-BR/index/introducing-gpt-5-4-mini-and-nano/)

**Infraestrutura de referência.** US$ 7/mês de serviço web e US$ 6/mês de PostgreSQL são pisos públicos de computação citados pela Render. No exercício gerenciado, somamos US$ 7–47/mês de reserva **estimada** para armazenamento, backup, tráfego e logs. A faixa total de US$ 20–60/mês é um orçamento experimental com um único ambiente pequeno, sem alta disponibilidade ou garantia de capacidade. Reprecificar com região, workspace e volume reais. [Pisos publicados pela Render](https://render.com/articles/best-netlify-alternatives-in-2026) · [Página de preços](https://render.com/pricing)

| Uso mensal hipotético | Infra incremental de serviço | Modelo API a US$ 0,018 por sessão curta | Total direto ilustrativo | Total em BRL a R$ 5,50/US$ |
|---|---:|---:|---:|---:|
| Local, compilação e conferência sem inferência externa | US$ 0 | US$ 0 | US$ 0 | R$ 0 |
| Individual, 80 sessões curtas com inferência | US$ 0 | US$ 1,44 | US$ 1,44 | R$ 7,92 |
| Equipe local, 400 sessões curtas distribuídas | US$ 0 | US$ 7,20 | US$ 7,20 | R$ 39,60 |
| Piloto gerenciado compartilhado, quatro equipes, 1.600 sessões curtas totais | US$ 20–60 | US$ 28,80 | US$ 48,80–88,80 | R$ 268,40–488,40 |

R$ 5,50 é uma premissa aritmética para comparação, não uma cotação. Os totais excluem impostos, assinatura existente, câmbio efetivo, eletricidade, hardware, mão de obra, assinatura de binários e eventual cobrança separada de ferramentas. Com BYOK, a coluna de modelos recai no orçamento dos usuários. Com acesso por assinatura, medir tokens e limites quando disponíveis, sem imputar uma fatura API. Se as trajetórias usarem 5 vezes os tokens de entrada **e** saída, o custo dos modelos no último cenário sobe de US$ 28,80 para US$ 144,00. Repetições, raciocínio faturável e ferramentas precisam entrar no uso observado. Se faltarem dados de faturamento, sinalizar custo desconhecido.

**Trabalho humano costuma dominar o piloto.** A título de premissa, seis horas mensais de suporte a R$ 80/h somam R$ 480. Para quatro equipes com BYOK e infra de R$ 110–330, o custo direto médio ilustrativo é (480 + 110 a 330) / 4 = **R$ 147,50–202,50 por equipe/mês**, antes de tributos, aquisição, produto e margem. Com apenas uma equipe ociosa no mesmo ambiente, a divisão deixa de funcionar. Orçar suporte separadamente e medir horas reais é uma defesa mais eficaz que apostar numa margem sobre tokens. Essa conta não é uma proposta comercial nem receita esperada.

## Confiança, LGPD e operação no Brasil

Nomes e e-mails dos autores, conteúdo de issues, prompts e contratos de clientes podem identificar pessoas. O controlador deve mapear finalidades e bases legais aplicáveis e definir com prestadores os papéis efetivos de controlador e operador. Necessidade, transparência, direitos dos titulares e segurança têm consequências operacionais. Se ocorrer transferência internacional de dados pessoais, identificar o mecanismo aplicável, inclusive cláusulas-padrão quando cabíveis. Uma chave própria do cliente muda quem paga e, por si só, não resolve essas obrigações. [LGPD, arts. 5º–7º, 15–18, 33 e 46](https://www.planalto.gov.br/ccivil_03/_ato2015-2018/2018/lei/l13709compilado.htm) · [ANPD, Resolução 19/2024](https://www.gov.br/anpd/pt-br/acesso-a-informacao/institucional/atos-normativos/regulamentacoes_anpd/resolucao-cd-anpd-no-19-de-23-de-agosto-de-2024)

| Fluxo | Escolha de produto e validação antes do piloto |
|---|---|
| Importar e compilar localmente | Oferecer fixture sem login. Listar fontes, exclusões e destino. Validar que a compilação offline conclui sem rede. Exibir todas as referências incluídas e permitir remoção antes da exportação |
| Entregar a um agente | Exibir qual provedor receberá quais arquivos e se o próprio agente pode ler outros arquivos. No piloto privado, executar sobre uma área de acesso restrito e testar o limite. Separar permissão de leitura local de envio externo. Sem escopo verificável, usar fixture pública |
| Coletar métricas | Desligadas por padrão. Alternativa de diário sem rede. Para quem aderir, limitar a contagens, durações e identificador de coorte pseudônimo. Excluir código, prompts, URLs de clone, paths, SHA do cliente e segredos. Definir acesso, finalidade e retirada |
| Retenção | Proposta para piloto: apagar dados individuais de pesquisa em até 90 dias após encerramento, publicar só agregados e documentar exceções de conservação cabíveis. Separar gravação opcional e contato de recrutamento. Permitir limpar cache e histórico local. Informar que cópias exportadas ficam com quem as recebeu |
| Provedor e empresa | Registrar lista de operadores, países e políticas do endpoint escolhido. Permitir recusa sem perder comparação local. Na API OpenAI, retenção para monitoramento e estado de aplicação têm regras próprias. Conferir endpoint, contrato e exceções antes do piloto. [Política da API](https://developers.openai.com/api/docs/guides/your-data) |
| Expansão para comunicação e vagas | Manter fora do piloto. Para WhatsApp, demonstrar demanda e verificar requisitos de autorização, modelos e cancelamento vigentes. Para vagas, começar por texto fornecido pelo usuário ou API licenciada. Validar termos antes de automatizar coleta ou contato. [WhatsApp Business](https://business.whatsapp.com/policy) · [Contrato do LinkedIn](https://www.linkedin.com/legal/user-agreement) |

No Iuris e no JabotiOS, uma cópia sanitizada ou um repositório sintético pode exercitar o mesmo problema sem expor documentos jurídicos, contatos de clientes ou mensagens. No NexTM, reproduzir um episódio com artefatos públicos ou com autorização específica. Um depoimento da Karsten ou o nome de qualquer parceiro requer anuência para publicação. Nenhum dos três projetos constitui validação externa.

## Distribuir e aprender após cada release

| Release | Público e canal | Evidência de uso que informa o próximo incremento |
|---|---|---|
| Build S1 | Autor e colaboradores usando clones autorizados no Windows | Tempo de instalação, pastas recusadas, projetos reabertos e problemas com Git/WSL |
| Alpha S3 | Desenvolvedores independentes, freelancers e colegas que já usam coding agents | Sessões iniciadas e concluídas, resultado inspecionado, cancelamentos e motivos de falha |
| MVP S4 | Pequenas equipes e software houses com repositório permitido | Dias com ciclo útil, retorno a um segundo projeto, diferenças entre índice e disco compreendidas e custo de suporte |
| Beta S6 | Comunidades brasileiras, mantenedores OSS e grupos universitários; README PT e EN, instalador, showcase de 90 s e fixture licenciada | Instalações que chegam à primeira tarefa revisada, uso semanal por coorte e contribuições externas que passam os testes |
| Após beta | Artigos com erros reais e benchmarks; apresentação em DevParaná/UTFPR ou fóruns de devtools quando houver convite ou canal apropriado | Reprodução por terceiros, adaptadores mantidos externamente e equipes que solicitam suporte profissional |

Oferecer diário manual ou exportação dos contadores locais. Publicar denominadores e janelas; separar usuários do time de usuários externos. A rotina de lançamento inclui changelog, política de segurança, guia de instalação e remoção, matriz de versões, issues de entrada (fixture Unicode, tradução, leitor de manifesto) e triagem com prioridade em integridade de dados. Não se projeta crescimento nem receita. Serviços de implantação e suporte são caminhos comerciais opcionais; uma futura oferta gerenciada precisa cobrir custos de operação, suporte e obrigações sobre dados.

[Plano central](MASTER-PLAN.md) · [O que medir em cada sprint](06-ROADMAP-AND-EXECUTION.md)
