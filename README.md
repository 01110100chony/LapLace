# Laplace

Workspace desktop para abrir e inspecionar projetos Git locais. O catálogo local mantém os projetos cadastrados e reabre o último projeto selecionado ao iniciar o aplicativo.

## Executar no Windows

Instale o Node.js 24, Git for Windows e os pré-requisitos do Tauri. Para o caminho padrão, use Rust estável com o toolchain MSVC, Microsoft C++ Build Tools com a carga de trabalho **Desenvolvimento para desktop com C++** e Microsoft Edge WebView2. Abra uma nova janela do PowerShell para que Git, Node e Rust estejam no PATH. [Pré-requisitos Windows do Tauri](https://v2.tauri.app/start/prerequisites/#windows)

Execute os comandos na raiz do checkout.

```powershell
node --version
git --version
rustup default stable-x86_64-pc-windows-msvc
npm install --global pnpm@11.19.0
pnpm install --frozen-lockfile
pnpm dev
```

Na janela Laplace, clique em **Adicionar projeto**, depois em **Selecionar pasta** e escolha a raiz ou uma subpasta de um repositório. A visão do projeto mostra caminho, branch, HEAD e contagens de alterações. Use **Atualizar** para consultar o Git depois de mudanças externas. A barra lateral e o breadcrumb dão acesso à Área de trabalho. Na barra lateral, use **Tab** e **Shift+Tab** para mover o foco e **Enter** ou **Espaço** para abrir o projeto em foco.

O comando abaixo gera o executável local de produção. Abra `laplace.exe` no diretório de build, onde o Tauri coloca o runtime Node, o script do sidecar e as DLLs necessárias. A distribuição em instalador está prevista no D07.

```powershell
pnpm build
```

Em uma máquina Windows x64 que já tenha GCC e windres do MinGW-w64 no PATH, pode-se selecionar o toolchain GNU para a validação local.

```powershell
rustup toolchain install stable-x86_64-pc-windows-gnu
$env:RUSTUP_TOOLCHAIN = 'stable-x86_64-pc-windows-gnu'
pnpm dev --target x86_64-pc-windows-gnu
pnpm build --target x86_64-pc-windows-gnu
```

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

No Windows, o banco fica em `%LOCALAPPDATA%\br.laplace.desktop\catalog.sqlite3`. O host Tauri resolve o diretório com `app_local_data_dir()` e passa o caminho ao processo Node na inicialização. O sidecar usa `node:sqlite`, aplica a migração versionada na abertura e grava o cadastro e a seleção em transações. A raiz Git canônica tem uma restrição de unicidade e a última seleção referencia o ID persistido do projeto. O SQLite usa seu journal padrão de rollback, compatível com a versão embarcada no runtime validado. [Diretórios do Tauri](https://docs.rs/tauri/latest/tauri/path/struct.PathResolver.html#method.app_local_data_dir) · [SQLite e a falha de WAL](https://sqlite.org/wal.html#the_wal_reset_bug)

A migração D06 preserva o nome, a raiz, o ID e a seleção dos registros D04. Uma leitura bem-sucedida grava a identidade da raiz e do diretório de metadados da worktree, além do resumo Git versionado e datado. Ao abrir ou atualizar um projeto, o Laplace mostra o cache válido enquanto consulta o Git. Quando a consulta falha, a última leitura permanece com a indicação de cache. As respostas do Git ficam vinculadas ao projeto consultado e a navegação invalida respostas da visão anterior.

Se a pasta ficar indisponível, clique em **Relocalizar pasta** e escolha o checkout movido. O Laplace compara as identidades do sistema de arquivos da raiz e dos metadados Git, distintas das de outras cópias com o mesmo HEAD. O registro, a seleção e o cache permanecem disponíveis em caso de falha. A relocalização cobre movimentos que preservam essas identidades, como renomear a pasta no mesmo volume. Para um registro D04 já movido antes da primeira leitura na versão D06, restaure a pasta no caminho cadastrado e use **Atualizar** para registrar a identidade antes de movê-la.

## Verificação

```powershell
pnpm test
pnpm typecheck
pnpm lint
pnpm format:check
pnpm build:web
```

As fixtures são criadas e descartadas pelos testes, que exercitam repositórios com e sem commits, worktrees, HEAD destacado, renomeações, caminhos Unicode, alterações simultâneas no índice e na árvore de trabalho, erros Git e prazos de IPC. O teste de leitura compara os hashes e horários de modificação dos arquivos da fixture, incluindo o índice. Os testes também cobrem a migração D04, o reinício do sidecar, a troca de projeto com respostas fora de ordem, o descarte de cache inválido, a leitura após mudança externa e a relocalização com destinos válidos, incorretos e já cadastrados.

### Verificar o reinício no executável Tauri

1. Gere o executável com `pnpm build` ou use o alvo GNU descrito acima. Abra `laplace.exe` no diretório de build.
2. Crie dois repositórios locais descartáveis com `git init`. Na janela, use **Adicionar projeto** e **Selecionar pasta** para cadastrar os dois. Volte à **Área de trabalho** entre as importações.
3. Abra o primeiro projeto pela barra lateral. Feche a janela, aguarde o término de `laplace.exe` e `laplace-node.exe` e abra o mesmo executável. Confira a presença dos dois projetos e a restauração do primeiro.
4. Volte à **Área de trabalho** e importe uma subpasta do primeiro repositório. Confira que o catálogo continua com dois registros e que o primeiro projeto abre pela raiz Git.
5. Feche o aplicativo, renomeie a pasta do projeto selecionado no mesmo volume e abra o executável. Confira o aviso, o cache datado e os dois registros. Use **Relocalizar pasta** e escolha primeiro o checkout já cadastrado do outro projeto. Confira o aviso e selecione a pasta movida. Verifique se o nome, a seleção e o novo caminho persistem após fechar e abrir a janela.

### Resultado da validação D04

- Passaram os 19 testes, o lint, o typecheck, Prettier, rustfmt, `pnpm build:web` e `pnpm build --debug --target x86_64-pc-windows-gnu`.
- No executável Windows x64, o primeiro início criou o banco no diretório esperado. Após o encerramento da janela e do sidecar, o novo processo exibiu os dois projetos, restaurou a seleção e mostrou a nova branch, o novo HEAD e um arquivo não rastreado criado com o aplicativo fechado. Com a pasta selecionada movida, ambos os registros apareceram e a janela exibiu o erro com a opção **Atualizar**.
- A automação da janela leu a interface, mas falhou ao acionar seus controles. O cadastro dos dois repositórios e a deduplicação da subpasta foram verificados pelo IPC do sidecar empacotado. O seletor nativo, a troca para o projeto disponível e o clique em **Atualizar** ficaram sem confirmação na janela. Os testes de IPC confirmaram a abertura do segundo projeto e a nova leitura após devolver a pasta ao caminho original.

### Resultado da validação D05 e D06

- Passaram os 24 testes, lint, typecheck, Prettier, rustfmt, o build web e o build Tauri Windows x64 de produção com o toolchain GNU.
- Na janela Tauri com catálogo isolado, o seletor nativo cadastrou dois repositórios descartáveis. A barra lateral alternou os projetos com Tab, Shift+Tab, Enter e Espaço. Após mudanças externas, **Atualizar** exibiu a nova branch, o novo HEAD e as três contagens Git conferidas nas fixtures.
- Após mover uma pasta e reiniciar o executável, a janela mostrou o resumo em cache. A relocalização rejeitou o destino já cadastrado e aceitou o checkout movido. Um novo encerramento da janela e do sidecar seguido de reinício restaurou a seleção, o mesmo ID e o novo caminho.
- A suíte automatizada também verificou respostas assíncronas fora de ordem, cache inválido e rejeição de uma pasta sem Git e de uma cópia com o mesmo HEAD.

## Limites e próximos itens

| Item | Pendência                                                                                                                                         |
| ---- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| D07  | Configurar CI e teste de inicialização no Windows, validar instalação em máquina limpa e preparar o instalador e os avisos de licença do runtime. |

O resumo observa branch, HEAD e contagens no momento da consulta. Alterações externas aparecem ao atualizar ou reabrir o projeto. A UI inicial usa o tema grafite do protótipo.
