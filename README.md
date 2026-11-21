# Laplace

Workspace desktop para abrir e inspecionar projetos Git locais. O catálogo local mantém os projetos cadastrados e reabre o último projeto selecionado ao iniciar o aplicativo.

## Desenvolvimento no Windows x64

Instale a versão do Node.js registrada em `.node-version`, Git for Windows e os pré-requisitos do Tauri. Para o alvo padrão, use Rust MSVC, Microsoft C++ Build Tools com a carga de trabalho **Desenvolvimento para desktop com C++** e Microsoft Edge WebView2. O preparo usa também `curl.exe` e `tar.exe`, disponíveis nas versões atuais do Windows 10/11. Abra uma nova janela do PowerShell para carregar as ferramentas no PATH. [Pré-requisitos Windows do Tauri](https://v2.tauri.app/start/prerequisites/#windows)

Execute os comandos na raiz do checkout.

```powershell
node --version
git --version
rustup toolchain install 1.95.0-x86_64-pc-windows-msvc --profile minimal --component rustfmt
$env:RUSTUP_TOOLCHAIN = '1.95.0-x86_64-pc-windows-msvc'
npm install --global pnpm@11.19.0
pnpm install --frozen-lockfile
pnpm dev
```

Na janela Laplace, clique em **Adicionar projeto**, depois em **Selecionar pasta** e escolha a raiz ou uma subpasta de um repositório. A visão do projeto mostra caminho, branch, HEAD e contagens de alterações. Use **Atualizar** para consultar o Git depois de mudanças externas. A barra lateral e o breadcrumb dão acesso à Área de trabalho. Na barra lateral, use **Tab** e **Shift+Tab** para mover o foco e **Enter** ou **Espaço** para abrir o projeto em foco.

## Gerar e instalar a versão Windows

```powershell
Push-Location apps/desktop
node node_modules/@tauri-apps/cli/tauri.js build --ci --no-sign --target x86_64-pc-windows-msvc -- --locked
Pop-Location
```

O instalador fica em `apps/desktop/src-tauri/target/x86_64-pc-windows-msvc/release/bundle/nsis/Laplace_0.1.0_x64-setup.exe`. O compilador também gera `laplace.exe` no diretório `release`. GitHub Actions usa Windows Server 2025 com MSVC x64 e disponibiliza o instalador como artefato `laplace-windows-x64-nsis` por 14 dias, após o smoke automatizado. O workflow roda em pushes e pull requests para `main` e `feat/desktop-foundation`, com cache do store pnpm e dos downloads do Cargo. [Imagem do runner Windows](https://github.com/actions/runner-images/blob/main/README.md)

O alvo GNU é uma opção de validação local quando GCC e windres do MinGW-w64 estão no PATH. Seu instalador fica no mesmo caminho sob `target/x86_64-pc-windows-gnu`. O Tauri inclui `WebView2Loader.dll` no bundle GNU e o binding utiliza o loader estático no MSVC. Os resultados dos dois alvos devem ser registrados separadamente. [Binding WebView2 e diferenças de link](https://github.com/wravery/webview2-rs#cross-compilation)

```powershell
rustup toolchain install stable-x86_64-pc-windows-gnu
$env:RUSTUP_TOOLCHAIN = 'stable-x86_64-pc-windows-gnu'
pnpm dev --target x86_64-pc-windows-gnu
Push-Location apps/desktop
node node_modules/@tauri-apps/cli/tauri.js build --ci --no-sign --target x86_64-pc-windows-gnu -- --locked
Pop-Location
```

Execute o `-setup.exe` e abra **Laplace** no menu Iniciar. O NSIS instala para o usuário atual em `%LOCALAPPDATA%\Laplace` por padrão, sem elevação para os arquivos do aplicativo. Se o WebView2 Evergreen estiver ausente, o instalador baixa o bootstrapper da Microsoft. Esse caso requer internet e pode depender de políticas da máquina. Depois que o WebView2 está disponível, a inspeção Git e o catálogo funcionam offline. O instalador Laplace está **sem assinatura Authenticode**, portanto o Windows pode exibir um alerta ou bloquear a execução conforme a política do dispositivo. [Instalador Windows do Tauri](https://v2.tauri.app/distribute/windows-installer/)

Node.js, pnpm, Rust e ferramentas de compilação ficam fora dos pré-requisitos de instalação. **Git for Windows no PATH** é necessário para adicionar, atualizar ou relocalizar repositórios. Sem Git, o catálogo abre e a tentativa de inspeção explica como disponibilizá-lo. Para remover o Laplace, use **Configurações → Aplicativos → Laplace → Desinstalar**. Feche a janela antes de reinstalar ou desinstalar. O catálogo fica separado dos arquivos do aplicativo e é preservado na reinstalação e na desinstalação padrão. A desinstalação interativa oferece exclusão de dados mediante marcação explícita.

### Runtime e avisos de terceiros

O build verifica o SHA-256 do ZIP oficial x64 do Node **24.22.3** e extrai `node.exe` e a licença da distribuição. Em CI, a versão do Node que executa os testes vem do mesmo arquivo `.node-version`. O Tauri recebe o binário com o sufixo do alvo em `externalBin` e o instala como `laplace-node.exe`. O esbuild gera `sidecar/service.cjs` com o serviço e seus módulos TypeScript de produção, incluindo os contratos. O pacote usa `node:sqlite` do runtime oficial, com SQLite **3.54.1**. Git, gerenciadores de pacotes e módulos npm do ZIP oficial ficam fora do instalador. [Sidecars no Tauri](https://v2.tauri.app/develop/sidecar/) · [Binários e hashes do Node](https://nodejs.org/en/blog/release/v24.22.3/)

O host resolve ambos os arquivos a partir dos recursos do Tauri. O supervisor mantém o stdio e o encerramento por EOF, com prazo antes do encerramento forçado. Diagnósticos ficam no stderr. A distribuição usa o executável oficial ao lado do script, o que permite atualizar o runtime sem alterar o launcher ou o IPC. O custo é distribuir dois arquivos e cerca de 90 MiB de runtime descompactado. Para atualizar o Node, altere `.node-version` e o hash do ZIP em `prepare-sidecar.mjs`, confirme a versão SQLite e execute novamente o smoke de instalação.

Em `%LOCALAPPDATA%\Laplace\licenses`, `NODE-LICENSE.txt` reúne a licença MIT do Node e os avisos dos componentes internos, incluindo SQLite, que é de domínio público. `THIRD-PARTY-NOTICES.txt` inclui os textos e referências da árvore Rust do alvo, inclusive para obter o código de crates MPL-2.0, os avisos dos pacotes JavaScript de produção e as referências do NSIS e do WebView2. Os textos ausentes de alguns arquivos Cargo são obtidos das cópias em `apps/desktop/licenses` ou da licença correspondente no workspace upstream. Ao atualizar lockfiles, revise os avisos, as referências upstream e os termos de redistribuição do WebView2 Loader. [Código distribuído sob MPL-2.0](https://www.mozilla.org/en-US/MPL/2.0/FAQ/#q8) · [Distribuição do WebView2](https://learn.microsoft.com/microsoft-edge/webview2/concepts/distribution) · [Licença NSIS](https://nsis.sourceforge.io/License)

### Barra de título

No Windows, a marca, o breadcrumb e os controles de janela ficam na mesma barra. Arraste pela área livre ou dê um duplo clique nela para maximizar ou restaurar. As bordas continuam sob controle do sistema. O botão personalizado maximiza e restaura com clique. Para abrir o menu de Snap Layouts no Windows 11, use **Win+Z** com o Snap habilitado. O menu ao passar o mouse depende de um teste de área nativo do Windows no botão de maximizar. [Snap Layouts no Windows 11](https://learn.microsoft.com/en-us/windows/apps/desktop/modernize/ui/apply-snap-layout-menu)

O override do Tauri ativa a janela sem moldura no Windows. Em futuros builds para Linux e macOS, a configuração base preserva a decoração do sistema.

## Estrutura

```text
apps/
  desktop/              React, Vite, testes do renderer e preparação do sidecar
    src-tauri/          Janela, diálogo nativo, permissões e supervisor de IPC
  local-service/        Serviço Node, catálogo SQLite, inspeção Git e testes
packages/
  contracts/            Tipos e validação do protocolo compartilhados em TypeScript
  agents/               Detecção e adaptador não interativo do Codex
```

O host expõe comandos específicos para a janela principal. Importação e relocalização obtêm o caminho com o diálogo nativo. O sidecar lista o catálogo, grava a seleção e resolve os IDs dos projetos para inspeção e captura. A comunicação usa JSON delimitado por linha em stdio, com protocolo v2, IDs, limite de 192 KiB por mensagem e prazo de 18 segundos no host. O resumo Git tem prazo próprio de 7 segundos. O seletor aguarda a decisão do usuário antes de iniciar a inspeção. O serviço inicia na primeira solicitação, é encerrado com a janela e pode ser recriado na próxima solicitação após falha de transporte.

O leitor executa o Git por argumentos separados, com locks opcionais desativados e sem executar hooks de FSMonitor ou filtros externos configurados. As contagens vêm de `status --porcelain=v2 --branch -z`. Um arquivo preparado e posteriormente editado aparece nas duas contagens. Conflitos têm contagem própria. O estado interno de submódulos fica fora da inspeção; alterações da referência rastreada continuam visíveis. O diagnóstico de desenvolvimento sai pelo stderr e identifica a operação, o pedido e a classe de falha sem registrar caminhos privados. [Formato e leitura em segundo plano do Git status](https://git-scm.com/docs/git-status)

## Catálogo local

No Windows, o banco fica em `%LOCALAPPDATA%\br.laplace.desktop\catalog.sqlite3`. O host Tauri resolve o diretório com `app_local_data_dir()` e passa o caminho ao processo Node na inicialização. O sidecar usa `node:sqlite`, aplica a migração versionada na abertura e grava o cadastro e a seleção em transações. A raiz Git canônica tem uma restrição de unicidade e a última seleção referencia o ID persistido do projeto. A política permanece em rollback journal padrão (`DELETE`), compatível com os catálogos anteriores. [Diretórios do Tauri](https://docs.rs/tauri/latest/tauri/path/struct.PathResolver.html#method.app_local_data_dir) · [Modos de journal SQLite](https://sqlite.org/pragma.html#pragma_journal_mode)

A migração D06 preserva o nome, a raiz, o ID e a seleção dos registros D04. Uma leitura bem-sucedida grava a identidade da raiz e do diretório de metadados da worktree, além do resumo Git versionado e datado. Ao abrir ou atualizar um projeto, o Laplace mostra o cache válido enquanto consulta o Git. Quando a consulta falha, a última leitura permanece com a indicação de cache. As respostas do Git ficam vinculadas ao projeto consultado e a navegação invalida respostas da visão anterior.

Se a pasta ficar indisponível, clique em **Relocalizar pasta** e escolha o checkout movido. O Laplace compara as identidades do sistema de arquivos da raiz e dos metadados Git, distintas das de outras cópias com o mesmo HEAD. O registro, a seleção e o cache permanecem disponíveis em caso de falha. A relocalização cobre movimentos que preservam essas identidades, como renomear a pasta no mesmo volume. Para um registro D04 já movido antes da primeira leitura na versão D06, restaure a pasta no caminho cadastrado e use **Atualizar** para registrar a identidade antes de movê-la.

## Capturas de contexto (C01)

Em um projeto cadastrado, abra **Contexto**, navegue pelas pastas e selecione os arquivos. O campo de caminho relativo também aceita uma seleção explícita com separador `/`. Clique em **Capturar contexto**. A captura exibe o HEAD completo, a branch observada, a data, os hashes, os tamanhos e as omissões. Ao reabrir o Laplace, selecione uma captura no **Histórico de capturas**. Use **Comparar com estado atual** para observar novamente a seleção e o Git. A comparação mantém intacta a captura histórica.

O manifesto v1 fixa raiz, identidade do checkout, HEAD, branch informativa e caminhos selecionados em ordem lexical. As inclusões preservam exatamente os bytes da árvore de trabalho com SHA-256 e referência `sha256:<hex>`. Os estágios, modos e OIDs do índice são metadados separados. Um caminho sem entrada no índice exige a mesma seleção explícita. O SHA-256 do manifesto usa JSON UTF-8 compacto com chaves ordenadas e exclui o próprio digest, o ID opaco e os horários do recibo. Repetir a mesma observação e seleção produz o mesmo digest com outro ID de captura. O digest do índice selecionado inclui caminhos e estágios observados.

A captura confere caminhos, identidade do handle e metadados de cada arquivo antes e depois da leitura. Uma segunda leitura compara o SHA-256. Mudanças detectadas nas fontes ou na identidade, HEAD, branch ou índice durante a captura invalidam a geração e descartam todos os bytes dela. Omissões de política, formato ou limite geram uma captura parcial. A verificação observa intervalos de leitura individuais e estados Git nos extremos. Alterações que aparecem e somem entre observações podem passar despercebidas. A reprodução usa os bytes preservados e o manifesto.

A migração SQLite **3** cria `context_snapshots`, `context_entries` e `context_blobs`. Uma transação do catálogo confirma manifesto, entradas e blobs. Cada hash tem um único blob, com verificação de tamanho e SHA-256 na recuperação interna por projeto, captura e caminho. Permanecem disponíveis metadados históricos de projetos com a raiz indisponível. O IPC v2 acrescenta `context.browse`, `context.capture`, `context.list`, `context.get` e `context.validate`. O renderer recebe exclusivamente metadados. O armazenamento permanece local e usa o mesmo journal do catálogo.

A política padrão bloqueia `.git`, dependências (`node_modules`, `vendor`, `.venv`), caches e saídas de build, além de checkouts aninhados, redirecionamentos, links simbólicos e hard links. Exclui nomes sensíveis conhecidos, incluindo `.env*`, chaves SSH, extensões de chaves, arquivos de credenciais e pastas como `.aws` e `.ssh`. Para acrescentar exclusões, defina `LAPLACE_CONTEXT_EXCLUDES` antes de iniciar o Laplace, com caminhos relativos normalizados separados por ponto e vírgula (por exemplo, `generated/reports;private-config.json`). As regras cobrem os descendentes. A navegação lista candidatos por pasta. Extensões binárias conhecidas são excluídas e a leitura aceita texto UTF-8 sem controles binários. A política verifica nomes e codificação. Segredos podem existir em texto com outros nomes.

Os limites padrão são **32 arquivos**, **256 KiB por fonte**, **2 MiB por captura**, **10 s por operação de leitura**, **384 bytes UTF-8 por caminho**, **2.048 entradas examinadas por pasta**, **100 candidatos por resposta** e **20 capturas por página**. O limite IPC permanece em **192 KiB** por mensagem. O prazo é conferido entre operações de leitura. O supervisor do host encerra o sidecar se uma operação pendente ultrapassar o prazo de transporte. Trocar de projeto descarta as respostas da tela anterior e a operação mantém o ID de origem.

## Busca nas capturas (C02)

Abra **Contexto** e selecione arquivos em **Fontes da árvore de trabalho**. Após **Capturar contexto**, clique em **Indexar captura** em **Buscar nas capturas**. Digite um nome de arquivo, caminho ou termo do código e clique em **Pesquisar**. Abra o intervalo de linhas de um resultado para conferir o trecho, o ID completo da captura, o HEAD observado e o SHA-256 da fonte. **Reindexar captura** reconstrói o índice da captura selecionada.

- **Captura selecionada** pesquisa a captura aberta no histórico ou recém-criada.
- **Captura mais recente** pesquisa a última captura válida ou parcial que contém fontes preservadas. Caso ela ainda precise ser indexada, o aplicativo informa o estado dessa captura.
- **Histórico do projeto** pesquisa as capturas elegíveis já indexadas e informa a cobertura. Cada resultado tem sua captura identificada. Uma captura parcial inclui somente as fontes que conseguiu preservar.

O C02 depende do C01, commit `479a3e5` de `feat/context-snapshot`. A migração **4** do catálogo adiciona as tabelas `context_search_indexes`, `context_search_documents`, `context_search_chunks` e o índice virtual `context_fts`. A criação do esquema preserva os recibos e blobs C01 existentes. A primeira indexação é sob demanda. Capturas subsequentes reaproveitam os trechos e as entradas FTS para o mesmo projeto, caminho e SHA-256. A gravação e a reindexação são transacionais. Se uma falha interrompe a primeira gravação, ela fica disponível para nova tentativa. Se uma reindexação falha, o índice confirmado anterior permanece disponível.

O FTS5 guarda termos de nome, caminho e texto. Listagem e prévia reabrem os bytes do C01 e verificam o manifesto, a referência e o SHA-256. A árvore de trabalho pode mudar ou ficar indisponível após a captura. Os trechos têm até 24 linhas e 1.024 bytes UTF-8, preservam LF e CRLF e indicam quando contêm parte de uma linha longa. Uma linha longa é indexada em segmentos contíguos. Termos que cruzam o limite entre dois trechos podem exigir uma consulta menor.

O ranking usa BM25 com maior peso para o nome do arquivo, seguido do caminho e do conteúdo. Nome e caminho são indexados no trecho inicial para evitar resultados repetidos quando o termo aparece apenas no nome. A consulta combina até 12 termos literais em um mesmo trecho, com comparação insensível a caixa e a acentos latinos. O limite é de 256 bytes UTF-8. Cada página tem até 20 trechos, com até 200 resultados navegáveis. Novas indexações podem alterar as páginas de uma consulta histórica. O FTS5 compartilha as estatísticas de ranking do catálogo, enquanto os termos do projeto e os vínculos SQLite restringem os resultados ao projeto solicitado. [Referência do SQLite FTS5](https://www.sqlite.org/fts5.html)

| Operação IPC v2         | Entrada além do ID do projeto                                  | Resposta                                                                      |
| ----------------------- | -------------------------------------------------------------- | ----------------------------------------------------------------------------- |
| `context.indexStatus`   | ID da captura ou `null` para a mais recente elegível           | Elegibilidade, data da indexação e contagens                                  |
| `context.index`         | ID da captura e opção `force`                                  | Estado confirmado do índice                                                   |
| `context.search`        | Consulta, escopo, ID quando o escopo é uma captura, offset     | Página de trechos com caminho, linhas, SHA-256, captura e indicação de origem |
| `context.sourcePreview` | ID da captura, caminho preservado, SHA-256 e ordinal do trecho | Trecho verificado dentro do orçamento de IPC                                  |

O esquema e as validações de IPC estão em `packages/contracts/src/context-search.ts`. O serviço usa `context-search.ts` e `context-chunks.ts`, a janela usa `ContextSearchView.tsx` e o host Tauri expõe os quatro comandos no IPC existente. As operações são assíncronas na janela. A escrita é serializada no sidecar e tem orçamento de 10 s, além do prazo de transporte do host. O teste do instalador também pesquisa e abre uma captura após reiniciar o sidecar com o checkout indisponível.

### Roteiro de validação C02

1. Cadastre um repositório descartável com dois arquivos, como `calculo.ts` com `calcularTotal` e `config.ts`. Selecione os dois, capture e indexe.
2. Pesquise `calcularTotal`, abra o intervalo de linhas e confira a versão preservada.
3. Edite o retorno de `calcularTotal` no repositório descartável. Repita a busca na captura anterior. A prévia deve mostrar o retorno original.
4. Capture e indexe novamente. Pesquise `calcularTotal` em **Histórico do projeto** e confira os dois retornos com IDs distintos. Em **Captura mais recente**, confira apenas a nova revisão.
5. Feche e abra o Laplace, entre em **Contexto** e repita a consulta.

Na janela Tauri GNU x64, o roteiro foi executado com o catálogo separado `br.laplace.desktop.c02smoke`. A busca por `calcularTotal` abriu `calculo.ts` nas linhas 1–3. Após editar a fixture, a prévia antiga permaneceu idêntica. O histórico mostrou as duas revisões e, após fechar e reabrir o Laplace, a busca padrão mostrou a revisão mais recente. Na mesma sessão, o sidecar registrou 18–22 ms para indexar as duas fontes, 1–5 ms para buscar e 1–2 ms para abrir uma prévia. As medições correspondem à fixture de dois arquivos.

Os testes de IPC cobrem a migração de um catálogo C01, deduplicação, isolamento entre projetos, ranking, CRLF, acentos, paginação, capturas parciais e invalidadas, omissões, recuperação da transação e perda ou corrupção da fonte. O renderer testa o descarte de respostas atrasadas na troca de projeto. O build e o smoke locais GNU x64 passaram com o Node 24.22.3 e o SQLite 3.54.1. O CI hospedado MSVC ainda não foi executado para C02.

## Verificação

```powershell
pnpm test
pnpm typecheck
pnpm lint
pnpm format:check
pnpm build:web
pnpm --filter @laplace/desktop prepare:sidecar
cargo fmt --manifest-path apps/desktop/src-tauri/Cargo.toml --all -- --check
cargo check --manifest-path apps/desktop/src-tauri/Cargo.toml --locked --target x86_64-pc-windows-msvc --features custom-protocol
```

As fixtures são criadas e descartadas pelos testes, que exercitam repositórios com e sem commits, worktrees, HEAD destacado, renomeações, caminhos Unicode, alterações simultâneas no índice e na árvore de trabalho, erros Git e prazos de IPC. O teste de leitura compara os hashes e horários de modificação dos arquivos da fixture, incluindo o índice. Os testes também cobrem a migração D04, o reinício do sidecar, a troca de projeto com respostas fora de ordem, o descarte de cache inválido, a leitura após mudança externa e a relocalização com destinos válidos, incorretos e já cadastrados.

### Smoke em um Windows limpo

1. Use uma VM limpa Windows x64 ou uma sessão nova do Windows Sandbox. Copie o instalador para lá e registre o hash com `Get-FileHash .\Laplace_0.1.0_x64-setup.exe`. Confirme que `Get-Command node,pnpm,rustc,cargo,git -ErrorAction SilentlyContinue` retorna vazio.
2. Instale para o usuário atual e abra **Laplace** pelo menu Iniciar. Confirme a janela λ, a área de trabalho vazia, o processo `laplace-node` em `Get-Process laplace,laplace-node` e o banco em `%LOCALAPPDATA%\br.laplace.desktop\catalog.sqlite3`.
3. Antes de colocar Git no PATH, tente adicionar uma pasta local. Confira a orientação sobre Git e feche a janela. Instale Git for Windows ou extraia MinGit x64 para um diretório descartável e adicione apenas seu subdiretório `cmd` ao PATH da sessão. Reinicie o Laplace em um ambiente que carregue esse PATH.
4. Crie dois repositórios descartáveis usando a fixture abaixo. Compare os resultados de `git status --porcelain=v2 --branch` com o branch, HEAD e contagens mostrados na visão de cada projeto.
5. Use **Adicionar projeto → Selecionar pasta** para cadastrar os dois. Volte à **Área de trabalho** entre as importações e alterne entre eles pela barra lateral. Deixe o primeiro selecionado.
6. Feche a janela e confirme que `Get-Process laplace,laplace-node -ErrorAction SilentlyContinue` retorna vazio. Abra o Laplace e confirme os dois registros, a seleção do primeiro e o resumo Git.
7. Renomeie a pasta do primeiro projeto no mesmo volume. Use **Atualizar** e verifique o aviso, o cache datado e a possibilidade de abrir o segundo projeto. Volte ao primeiro e use **Relocalizar pasta** para apontar para a pasta renomeada. Confira o novo caminho e o mesmo registro após fechar e abrir.
8. Com a janela fechada, rode o instalador novamente, reabra e verifique a seleção. Desinstale mantendo desmarcada a exclusão de dados. Confira que o banco continua no caminho esperado. Registre versão do Windows, toolchain, hash, resultados e etapas não verificadas.

```powershell
$repos = Join-Path $env:TEMP ('Laplace-fixtures-' + [guid]::NewGuid())
foreach ($name in 'Primeiro', 'Segundo') {
    $repo = (New-Item -ItemType Directory -Path (Join-Path $repos $name) -Force).FullName
    git -C $repo init -b "smoke-$($name.ToLowerInvariant())"
    Set-Content "$repo/arquivo.txt" 'base'
    git -C $repo add arquivo.txt
    git -C $repo -c user.name=Laplace -c user.email=smoke@example.invalid commit -m fixture
}
$first = Join-Path $repos 'Primeiro'
Set-Content "$first/arquivo.txt" 'staged'
git -C $first add arquivo.txt
Add-Content "$first/arquivo.txt" 'unstaged'
Set-Content "$first/novo.txt" 'untracked'
git -C $first status --porcelain=v2 --branch
git -C (Join-Path $repos 'Segundo') status --porcelain=v2 --branch
```

O procedimento abaixo reproduz o smoke que o CI executa em um perfil descartável, com Git disponível para a fixture. Ele instala o NSIS em um caminho temporário, valida IPC e stderr, simula a falta de Git no PATH do sidecar, testa SQLite e persistência após reinício do processo e desinstala. A homologação da janela e do seletor nativo é feita pelo roteiro limpo acima.

```powershell
.\scripts\smoke-windows.ps1 -Installer 'C:\caminho\Laplace_0.1.0_x64-setup.exe'
```

### Resultado da validação D04

- Passaram os 19 testes, o lint, o typecheck, Prettier, rustfmt, `pnpm build:web` e `pnpm build --debug --target x86_64-pc-windows-gnu`.
- No executável Windows x64, o primeiro início criou o banco no diretório esperado. Após o encerramento da janela e do sidecar, o novo processo exibiu os dois projetos, restaurou a seleção e mostrou a nova branch, o novo HEAD e um arquivo não rastreado criado com o aplicativo fechado. Com a pasta selecionada movida, ambos os registros apareceram e a janela exibiu o erro com a opção **Atualizar**.
- A automação da janela leu a interface, mas falhou ao acionar seus controles. O cadastro dos dois repositórios e a deduplicação da subpasta foram verificados pelo IPC do sidecar empacotado. O seletor nativo, a troca para o projeto disponível e o clique em **Atualizar** ficaram sem confirmação na janela. Os testes de IPC confirmaram a abertura do segundo projeto e a nova leitura após devolver a pasta ao caminho original.

### Resultado da validação D05 e D06

- Passaram os 24 testes, lint, typecheck, Prettier, rustfmt, o build web e o build Tauri Windows x64 de produção com o toolchain GNU.
- Na janela Tauri com catálogo isolado, o seletor nativo cadastrou dois repositórios descartáveis. A barra lateral alternou os projetos com Tab, Shift+Tab, Enter e Espaço. Após mudanças externas, **Atualizar** exibiu a nova branch, o novo HEAD e as três contagens Git conferidas nas fixtures.
- Após mover uma pasta e reiniciar o executável, a janela mostrou o resumo em cache. A relocalização rejeitou o destino já cadastrado e aceitou o checkout movido. Um novo encerramento da janela e do sidecar seguido de reinício restaurou a seleção, o mesmo ID e o novo caminho.
- A suíte automatizada também verificou respostas assíncronas fora de ordem, cache inválido e rejeição de uma pasta sem Git e de uma cópia com o mesmo HEAD.

### Resultado da validação D07

- No Windows 10 22H2, passaram 26 testes, lint, typecheck, Prettier, rustfmt, `cargo check` em release GNU x64 e o build web. O build Tauri de produção GNU x64 gerou o NSIS. O workflow passou na validação estática do `actionlint`.
- O smoke instalou e desinstalou o NSIS em um diretório temporário no Windows de desenvolvimento. O Node.js empacotado abriu o catálogo com SQLite 3.54.1, journal `delete` e `integrity_check` igual a `ok`. Passaram o IPC com diagnóstico em stderr, a ausência de Git no PATH, a inspeção da fixture, a seleção após reiniciar o sidecar e o erro de repositório indisponível. O catálogo preexistente manteve o mesmo SHA-256.
- O Windows Sandbox do host ficou bloqueado antes do logon por falta do serviço `hvhost`. Ficaram pendentes a instalação em uma VM limpa, o bootstrapper em máquina sem WebView2, a abertura do aplicativo instalado, a importação de dois projetos pelo seletor, a alternância e a relocalização na janela, a restauração ao reabrir a janela, o encerramento pelo host e a reinstalação com o catálogo da VM. O ambiente local também carece de `link.exe`, portanto a execução MSVC fica para o runner Windows do GitHub.

## Limites e próximos itens

O primeiro resultado do CI hospedado depende do envio autorizado da branch. A distribuição inicial é Windows x64. Assinatura digital e publicação de beta pertencem a uma entrega futura. O incremento previsto para a Sprint 2 é C01–C04 do roadmap, com captura de contexto, sessões, adaptador local de leitura e conversa com citações.

O resumo observa branch, HEAD e contagens no momento da consulta. Alterações externas aparecem ao atualizar ou reabrir o projeto. A UI inicial usa o tema grafite do protótipo.

## Consultar com Codex (C03)

Em **Contexto**, abra uma captura preservada e selecione arquivos em **Consultar com Codex**. Para escolher um trecho, abra a prévia de um resultado da busca e clique em **Disponibilizar trecho para consulta**. Marque o trecho no painel, escreva a pergunta e clique em **Preparar prévia**. A prévia mostra o modo, o destino, a captura, os caminhos, os digests, os intervalos e as omissões. A autorização fica vinculada à pergunta, à seleção, ao modo e ao digest mostrado. As consultas reais exigem confirmação em diálogo nativo a cada envio.

### Modos de consulta e desenvolvimento

Os modos de desenvolvimento permitem exercitar o fluxo de consulta, incluindo histórico e citações.

| Modo                               | Execução e garantias                                                                                                                                                                                                                                                                                 |
| ---------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `verified_isolated`                | Padrão no desenvolvimento e na distribuição. Exige uma fronteira de leitura verificada e bloqueia a consulta enquanto ela estiver indisponível. Captura, pesquisa e prévia seguem disponíveis.                                                                                                       |
| `mock_development`                 | Modo local recomendado para desenvolvimento. Usa dados fictícios e os eventos do C03, dispensa CLI, rede e sandbox, e marca a resposta e a sessão como simuladas.                                                                                                                                    |
| `unconfined_workspace_development` | Consulta real ao OpenAI Codex com consentimento por execução. Usa uma área temporária com as fontes autorizadas e o sandbox nativo da CLI em modo somente leitura, sem escalonamento. O processo pode ter acesso de leitura a outros arquivos do host. Use somente dados fictícios ou não sensíveis. |

Para habilitar o Mock, no PowerShell usado para iniciar o aplicativo, com o toolchain já configurado conforme a seção de desenvolvimento local, execute:

```powershell
$env:LAPLACE_CODEX_DEV = 'mock'
pnpm dev --target x86_64-pc-windows-gnu
```

O cenário padrão é `fragmented`. Antes de iniciar, escolha outro com `$env:LAPLACE_CODEX_MOCK_SCENARIO` se quiser exercitar `completed`, `cancel`, `timeout`, `malformed_jsonl`, `authentication_error`, `interrupted`, `preparation_failure` ou `late_after_cancel`. Nos dois cenários de cancelamento, inicie a consulta e clique em **Cancelar consulta**. O C04 pode usar o cliente IPC existente com esse modo e importar `runMockCodex` de `@laplace/agents/mock` em testes. O adaptador usa os formatos de sessão, mensagem e estado terminal do C03 sem acessar um provedor.

Para habilitar o Workspace Dev, use uma instalação autenticada da CLI **0.157.0**. Se houver mais de uma CLI, coloque a pasta do `codex.exe` compatível no início do `PATH` da sessão de desenvolvimento. Abra um repositório descartável com dados fictícios. Revise a captura, os arquivos, o volume e o destino no diálogo antes de autorizar cada envio.

```powershell
$env:LAPLACE_CODEX_DEV = 'workspace'
pnpm dev --target x86_64-pc-windows-gnu
```

Para desativar, encerre o aplicativo, limpe a configuração da sessão e reinicie.

```powershell
Remove-Item Env:LAPLACE_CODEX_DEV, Env:LAPLACE_CODEX_MOCK_SCENARIO -ErrorAction SilentlyContinue
pnpm dev --target x86_64-pc-windows-gnu
```

O host lê a configuração de desenvolvimento na inicialização do sidecar. Um build de distribuição ignora as variáveis e o sidecar empacotado ignora os argumentos de desenvolvimento. Nenhuma preferência é gravada no catálogo.

### Contratos e limites

- No Workspace Dev, `codex.status` detecta o executável, valida a versão e os parâmetros pelo help e consulta `login status`. Esse modo usa o perfil **0.157.0** com controles adicionais de ferramentas. A CLI usa sua própria autenticação. O perfil estrito é **0.141.0** e informa `confinement_unverified` enquanto o host não dispuser de uma fronteira para a CLI.
- `codex.prepare` resolve o projeto e a captura pelo catálogo, confere o digest do manifesto C01 e verifica o SHA-256 dos blobs. Seleções C02 usam as coordenadas de bytes registradas no índice e os bytes preservados no C01. A prévia inclui um SHA-256 por trecho, o digest da entrada UTF-8 e um token de autorização efêmero. A autorização expira em cinco minutos ou ao preparar outra prévia.
- `codex.start` consome uma autorização vinculada ao projeto, à captura, ao modo e ao digest da seleção. Para consultas reais, o sidecar cria uma área descartável com o manifesto local e as fontes selecionadas em seus caminhos relativos. A CLI inicia num diretório vazio separado das fontes e recebe pergunta e conteúdo por stdin. O manifesto local registra os caminhos omitidos e os bytes fora dos trechos. Esses metadados de omissão ficam no Laplace.
- `codex.events` pagina até quatro eventos por sequência. `codex.cancel` solicita o encerramento da tentativa ativa. O adaptador mantém uma tentativa ativa em memória, com até oito fontes, um arquivo inteiro ou um trecho por caminho, 64 KiB de fontes, 128 KiB de entrada, 24 KiB por linha JSONL, 512 KiB de saída por fluxo e 120 s por consulta. Uma seleção acima do limite é recusada. O IPC tem limite de 192 KiB por mensagem.
- O adaptador exibe o texto do provedor e entrega estados terminais de conclusão, falha, interrupção, timeout ou cancelamento. Os diagnósticos omitem a saída bruta da CLI.

O perfil usa `exec --json --sandbox read-only --ephemeral --ignore-user-config --ignore-rules` com `approval_policy="never"`, sessões novas e ferramentas de shell, navegação e integrações de usuário desativadas na configuração. Ao iniciar o Workspace Dev, o build de desenvolvimento compila um auxiliar Windows que coloca a CLI em um Job Object com limite de memória de 768 MiB para a árvore de processos e encerramento no cancelamento, no timeout ou na perda do sidecar. A fronteira `VerifiedCodexBoundary` continua sendo o requisito do modo estrito. Consulte o [modo não interativo oficial](https://developers.openai.com/codex/noninteractive/) e o [sandbox Windows](https://developers.openai.com/codex/windows/).

### Sonda offline de confinamento (C03)

Com o ambiente GNU configurado conforme o `AGENTS.md`, execute no PowerShell da conta de desenvolvimento:

```powershell
cargo run --locked --release --manifest-path apps/desktop/src-tauri/codex-job/Cargo.toml --target x86_64-pc-windows-gnu --target-dir apps/desktop/src-tauri/generated/codex-job -- --laplace-codex-boundary-probe
```

A sonda cria dois arquivos fictícios e um perfil descartável de AppContainer de privilégio reduzido (LPAC). A conta que inicia a sonda deve ler ambos. O processo LPAC deve ler a fonte autorizada e receber `ERROR_ACCESS_DENIED` ao abrir o canário externo, mesmo com a permissão de leitura do grupo `ALL APPLICATION PACKAGES` no canário. Falha de inicialização, arquivo ausente ou timeout fazem a sonda falhar. Passe o caminho absoluto de um `codex.exe` após `--laplace-codex-boundary-probe` para rodar `--version` e `login status` sobre uma cópia da CLI com um `CODEX_HOME` vazio, sem rede e sem credenciais.

No Windows 10 x64 22H2 com GNU e Codex CLI 0.157.0, a fonte autorizada foi lida e o canário externo recebeu `ERROR_ACCESS_DENIED`. Dentro do mesmo perfil, os metadados e a abertura do diretório funcionaram. `GetFinalPathNameByHandleW` retornou erro 5 ao resolver o nome DOS (normalizado e aberto), enquanto o nome de volume NT foi resolvido. O resolvedor da CLI chama `canonicalize()` e falhou antes da leitura do estado de autenticação. [Código do resolvedor](https://github.com/openai/codex/blob/rust-v0.157.0/codex-rs/utils/home-dir/src/lib.rs)

O modo `verified_isolated` permanece bloqueado. O aceite exige autenticação em um perfil dedicado, confirmação nativa do envio e uma resposta inspecionável com a fonte fictícia sob a mesma política que nega o acesso ao canário. [Fluxo de autenticação da CLI](https://developers.openai.com/codex/auth)

A sonda original da CLI pode ser executada separadamente. Ela usa um `CODEX_HOME` descartável e dados fictícios.

```powershell
$cli = (Get-Command codex.exe -CommandType Application | Select-Object -First 1).Source
node scripts/probe-codex-read.mjs $cli
```

`pnpm test` usa processos fictícios para o fluxo de autorização, materialização, JSONL e encerramento. O smoke do NSIS também valida a preparação de um trecho histórico pelo sidecar instalado. Esses testes funcionam sem conta Codex e sem envio ao provedor.

## Histórico de consultas e citações (C04)

Em **Contexto**, abra uma captura e expanda **Histórico da captura** em **Consultar com Codex**. As consultas que chegam a um estado terminal são gravadas no catálogo SQLite local (migração v5), com a pergunta, o manifesto autorizado e os eventos da execução. O histórico reabre offline e conserva a identificação de consultas simuladas. Se o processo for encerrado abruptamente durante uma consulta, a tentativa em andamento pode ser perdida.

Quando uma resposta contém uma referência como `[source-1]`, o Laplace procura o ID na seleção daquela execução e confere os hashes da captura e dos bytes preservados. **Abrir fonte verificada** mostra o arquivo histórico ou apenas o intervalo de bytes autorizado. A interface sinaliza IDs ausentes da seleção, fontes indisponíveis e respostas sem citações. A verificação identifica a origem dos bytes citados.

## Tarefas do projeto (O01)

Abra **Tarefas** no projeto, escreva um título e salve. O objetivo é opcional na interface e começa com o título quando fica vazio. Uma tarefa salva pode ser reaberta e editada. A migração 6 do catálogo guarda as tarefas por projeto, com revisão para detectar edições concorrentes.

Em uma consulta concluída no histórico, **Criar tarefa desta consulta** abre o rascunho com a pergunta no objetivo. O Laplace mantém o vínculo à consulta e à captura de origem no catálogo. Os arquivos preservados são compartilhados com o histórico existente.

## Execuções de tarefas (O02)

No modo Mock de desenvolvimento, abra uma tarefa salva e selecione **Executar simulação**. O supervisor grava a tentativa e a revisão da tarefa antes de começar, permite uma tentativa ativa por catálogo e salva os eventos em ordem. Sair da aba ou trocar de projeto preserva o acompanhamento. **Cancelar execução** registra o pedido e aguarda o encerramento pelo supervisor.

A migração 7 guarda as tentativas e seus eventos. A mesma chave de solicitação recupera a tentativa original. Se o sidecar cair, a próxima leitura registra a interrupção e conserva os eventos recebidos. O histórico fica acessível no catálogo local. Novas execuções nesta etapa usam o Mock de desenvolvimento.

## Resultado da simulação (O03)

Uma simulação concluída grava um arquivo fictício em uma pasta temporária, captura as versões antes e depois e descarta a pasta. Abra **Resultado da simulação** na execução para inspecionar o diff ou expandir **Ver conteúdo completo**. A migração 8 preserva o resultado e o encerramento na mesma transação. O Laplace verifica os hashes ao reabrir o diff offline. Tentativas canceladas, interrompidas ou anteriores à migração podem aparecer sem diff.

O clone cadastrado permanece intacto. O aceite com uma alteração real do agente depende da integração confinada do C03.

## Alterações Git (G01)

Em **Alterações Git**, selecione os caminhos que deseja preservar, incluindo arquivos novos do disco. **Capturar alterações** guarda os bytes de texto selecionados do HEAD, do índice e do disco (migração 9). As comparações **HEAD → Índice** e **Índice → Disco** usam a última captura preservada, inclusive após reiniciar. Uma exclusão mantém o conteúdo anterior, um renome identifica o caminho de origem e um conflito mostra os estágios do índice. Binários, submódulos e arquivos acima do limite aparecem como metadados quando disponíveis.

A captura verifica se a base Git e os bytes selecionados continuam consistentes antes de salvar. Ela usa a política de caminhos da captura de contexto e lê objetos Git sem filtros externos. Cada comparação textual aceita até 12 KiB por versão.

## Revisão do diff simulado (G02)

Em uma execução concluída, **Aprovar diff** ou **Recusar diff** registra uma decisão vinculada ao digest do artefato de simulação e aos bytes preservados. A migração 10 conserva as decisões por revisão. A decisão reaparece após reiniciar. A aplicação de uma alteração real ao checkout continua pendente de um resultado confinado e de validação do mecanismo de aplicação e recuperação.

## Clonar do GitHub

Na Área de trabalho, escolha **Clonar do GitHub** e informe a URL HTTPS do repositório. O seletor nativo escolhe a pasta-pai e a confirmação exibe o endereço e a nova pasta antes de iniciar o Git. O clone usa o Git for Windows e o Git Credential Manager, quando disponível. Para um repositório privado, a credencial precisa estar disponível para o Git antes da operação.

O Git baixa em uma pasta temporária sob a pasta confirmada. **Cancelar clone** encerra a árvore do Git e aguarda a saída antes de limpar esse estágio. Quando o download termina, o serviço verifica o checkout, publica a pasta sem substituir um destino existente e cadastra o projeto no catálogo local. Se o checkout já estiver no destino e o cadastro falhar, o caminho fica disponível para importação local.

## Estado do roadmap

| Marco            | Entrega atual                                                                      | Aceite pendente                                                                    |
| ---------------- | ---------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| D01–D07, C01–C02 | Fundação desktop, catálogo, contexto preservado e busca FTS5                       | —                                                                                  |
| C03              | Modos de desenvolvimento, autorização, JSONL e diagnóstico de `CODEX_HOME` no LPAC | Consulta real autenticada no perfil confinado                                      |
| C04, O01         | Histórico e citações verificáveis. Tarefas diretas ou vinculadas à consulta        | —                                                                                  |
| O02–O03          | Supervisor persistente, cancelamento e diff reaberto offline em modo Mock          | Executar e inspecionar uma edição real em confinamento                             |
| G01              | Captura e comparação de HEAD, índice e disco                                       | —                                                                                  |
| G02              | Evidência do diff simulado e decisão versionada                                    | Revalidar base, aplicar com consentimento e reconciliar uma aplicação interrompida |
| G03              | Clone HTTPS real, cadastro e cancelamento verificados no sidecar GNU               | Validação do fluxo na janela Tauri e MSVC hospedado                                |
| M01, B01         | Planejados                                                                         | Fila e worktrees, resumo e validação da beta em ambiente limpo                     |
