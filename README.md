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
```

O host expõe seis comandos para a janela principal. Importação e relocalização obtêm o caminho com o diálogo nativo. O sidecar lista o catálogo, grava a seleção e resolve os IDs dos projetos para inspeção. A comunicação usa JSON delimitado por linha em stdio, com protocolo v2, IDs, limite de 192 KiB por mensagem e prazo de 18 segundos no host. A leitura Git tem prazo próprio de 7 segundos. O seletor aguarda a decisão do usuário antes de iniciar a inspeção. O serviço inicia na primeira solicitação, é encerrado com a janela e pode ser recriado na próxima solicitação após falha de transporte.

O leitor executa o Git por argumentos separados, com locks opcionais desativados e sem executar hooks de FSMonitor ou filtros externos configurados. As contagens vêm de `status --porcelain=v2 --branch -z`. Um arquivo preparado e posteriormente editado aparece nas duas contagens. Conflitos têm contagem própria. O estado interno de submódulos fica fora da inspeção; alterações da referência rastreada continuam visíveis. O diagnóstico de desenvolvimento sai pelo stderr e identifica a operação, o pedido e a classe de falha sem registrar caminhos privados. [Formato e leitura em segundo plano do Git status](https://git-scm.com/docs/git-status)

## Catálogo local

No Windows, o banco fica em `%LOCALAPPDATA%\br.laplace.desktop\catalog.sqlite3`. O host Tauri resolve o diretório com `app_local_data_dir()` e passa o caminho ao processo Node na inicialização. O sidecar usa `node:sqlite`, aplica a migração versionada na abertura e grava o cadastro e a seleção em transações. A raiz Git canônica tem uma restrição de unicidade e a última seleção referencia o ID persistido do projeto. A política permanece em rollback journal padrão (`DELETE`), compatível com os catálogos anteriores. [Diretórios do Tauri](https://docs.rs/tauri/latest/tauri/path/struct.PathResolver.html#method.app_local_data_dir) · [Modos de journal SQLite](https://sqlite.org/pragma.html#pragma_journal_mode)

A migração D06 preserva o nome, a raiz, o ID e a seleção dos registros D04. Uma leitura bem-sucedida grava a identidade da raiz e do diretório de metadados da worktree, além do resumo Git versionado e datado. Ao abrir ou atualizar um projeto, o Laplace mostra o cache válido enquanto consulta o Git. Quando a consulta falha, a última leitura permanece com a indicação de cache. As respostas do Git ficam vinculadas ao projeto consultado e a navegação invalida respostas da visão anterior.

Se a pasta ficar indisponível, clique em **Relocalizar pasta** e escolha o checkout movido. O Laplace compara as identidades do sistema de arquivos da raiz e dos metadados Git, distintas das de outras cópias com o mesmo HEAD. O registro, a seleção e o cache permanecem disponíveis em caso de falha. A relocalização cobre movimentos que preservam essas identidades, como renomear a pasta no mesmo volume. Para um registro D04 já movido antes da primeira leitura na versão D06, restaure a pasta no caminho cadastrado e use **Atualizar** para registrar a identidade antes de movê-la.

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
