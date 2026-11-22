# Riscos de execução e decisões reversíveis

A construção começa na Sprint 1. Um risco técnico bloqueia apenas a capacidade que expõe o usuário. Escolhas de navegação, provedor adicional, modelo de negócio e profundidade do grafo podem evoluir com o produto em uso.

## Fronteiras que precisam funcionar antes de liberar a respectiva ação

| Condição | Como detectar | Resposta e teste de recuperação |
|---|---|---|
| Acesso a arquivo de outro projeto ou fora da seleção | Canários sintéticos, symlink/junction e teste sobre escopo efetivo | Bloquear o perfil de execução afetado; manter gestão local e testar novamente em máquina limpa |
| Envio ao provedor fora do grant exibido | Revalidar digest, destino e capacidade imediatamente antes do envio | Descartar grant e oferecer prévia atualizada; testar troca de projeto enquanto confirmação está aberta |
| Credencial em log, exportação ou renderer | Testar saídas de erro e de sucesso com um segredo simulado | Expurgar origem e destinos controlados; expor apenas referência ao cofre e metadados |
| Código do repositório tenta instruir o agente a ampliar permissões | Separar dados do repo, instruções da plataforma e autorização verificada pelo host | Recusar operação não autorizada, registrar o evento e preservar contexto original |
| Alteração externa entre prévia e aplicação | Hash esperado por arquivo, journal e verificação no alvo | Parar aplicação, identificar itens alterados, recuperar sem sobrescrever mudanças alheias |
| Execução possivelmente ativa após interrupção | Identidade de processo, lease, tentativas sem terminal e reconciliação na abertura | Mostrar estado desconhecido, bloquear nova escrita na mesma área, preservar resultado parcial e nova tentativa manual |
| Prova desatualizada aparece como atual | Caso com mesmo arquivo, nova dependência e teste antigo ainda verde | Manter estado/ambiente originais, retirar o rótulo enganoso e oferecer nova verificação |
| Falha de migração ou atualização | Cópia consistente anterior, versão de esquema e pacote assinado | Reabrir a cópia suportada ou guiar recuperação local. Testar falta de espaço e interrupção |

## Escolhas que podem mudar sem paralisar as sprints

| Escolha inicial | Por que começar assim | Evidência para ajustar |
|---|---|---|
| Desktop Tauri + sidecar TS | Entrega uma janela nativa, reaproveita TypeScript e permite testar núcleo fora da UI | Medir falhas de empacotamento, RSS e latência. Considerar mover função específica para Rust antes de trocar todo o shell |
| S1 com pasta local; clone GitHub na S4 | Entrega dados reais cedo e serve GitHub já clonado e outros hosts | Se usuários precisarem clonar pela janela já na alpha, antecipar G03 sem ampliar permissões do runner |
| Primeira pergunta com o próprio Codex | Reduz duplicação de integrações entre chat e tarefa | Se custo/latência prejudicarem perguntas simples, adicionar rota de resposta/modelo via adaptador |
| Home com tarefa de continuidade e fila de intervenções | Reúne os dois motivos mais frequentes para abrir a bancada | Observar qual item recebe ações úteis. Se o trabalho começar mais pelo chat, expor compositor contextual na Home |
| Um executor e depois duas worktrees | Simplifica a primeira máquina de estados | Antecipar concorrência apenas quando as duas áreas puderem ser isoladas e canceladas individualmente |
| FTS5 com vínculos estruturados | Operação local de baixo custo e baseline reproduzível | Introduzir embeddings/expansão por grafo quando faltarem referências relevantes em casos conhecidos |
| Brasil e Windows primeiro | Alinha produto e ambiente de uso do autor | Ajustar matriz por relatos e contribuições reais; publicar o que foi homologado em Linux/macOS |
| Open source permissivo e custo por usuário | Incentiva distribuição, integração e operação local | Explorar suporte, self-hosting e cloud se a colaboração exigir infraestrutura comum |

## Perguntas operacionais a responder construindo

1. **Qual ambiente Windows podemos homologar para escrita?** Executor real, credencial do usuário, área confinada, processo auxiliar empacotado e teste de sentinelas são o entregável da S3. Se WSL funcionar e modo nativo ainda não, registrar a diferença precisamente.
2. **Como o app reage a repositórios grandes ou lentos?** Medir importação por tamanho e número de caminhos. Mostrar o resumo básico antes da indexação completa; permitir restringir pastas e cancelar.
3. **O que significa “ativo” na Home?** Estado do supervisor ou tarefa aberta com evento identificado. Repo silencioso significa ausência de evento observado. Não inventar progresso.
4. **Quais ações cabem numa concessão de sessão?** Reutilizar leituras no escopo já escolhido. Mudança de destino, escrita, acesso a dado sensível, push ou envio externo relevante recebem controle específico.
5. **O que fazer se os concorrentes avançarem?** Registrar o novo padrão, escolher o que melhora o percurso local e preservar interoperabilidade. Ajustar release, experiência ou integração com base no uso.
6. **Como manter o ritmo solo?** Entregar uma demonstração por sprint e cortar primeiro extensões separáveis: segundo provedor, grafo avançado, colaboração remota e integrações de negócio. Proteger importação, sessão real, revisão e persistência.
7. **Que projetos podem virar casos públicos?** NexTM foi identificado como privado no levantamento anterior. Usar clone autorizado internamente e fixture original em demonstração pública. Iuris e JabotiOS aparecem no protótipo como nomes em dados fictícios; isso não comprova acesso, adoção ou resultado.

[Plano central](MASTER-PLAN.md) · [Regras do runner](04-SYSTEM-ARCHITECTURE.md)
