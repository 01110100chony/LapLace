# Laplace

Workspace desktop para abrir e inspecionar projetos Git locais. A implementação 001 cobre a fundação Tauri, o serviço local e a primeira navegação entre a Área de trabalho e a visão do projeto.

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

Na janela Laplace, clique em **Adicionar projeto**, depois em **Selecionar pasta** e escolha a raiz ou uma subpasta de um repositório. A visão do projeto mostra caminho, branch, HEAD e contagens de alterações. **Atualizar** consulta o Git novamente. Volte pela barra lateral ou pelo breadcrumb para abrir outro projeto.

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

## Estrutura

```text
apps/
  desktop/              React, Vite, testes do renderer e preparação do sidecar
    src-tauri/          Janela, diálogo nativo, permissões e supervisor de IPC
  local-service/        Serviço Node, inspeção Git e testes com fixtures temporárias
packages/
  contracts/            Tipos e validação do protocolo compartilhados em TypeScript
```

O host expõe três comandos para a janela principal. A importação obtém o caminho com o diálogo do Windows. A visão de projeto consulta somente os IDs registrados pelo host a partir de importações bem-sucedidas. O sidecar usa JSON delimitado por linha em stdio, com versão, IDs, limite de 192 KiB por mensagem e prazo de 18 segundos no host; a leitura Git tem prazo próprio de 7 segundos. O seletor aguarda a decisão do usuário antes de iniciar a inspeção. O serviço inicia na primeira solicitação, é encerrado com a janela e pode ser recriado na próxima solicitação após falha de transporte.

O leitor executa o Git por argumentos separados, com locks opcionais desativados e sem executar hooks de FSMonitor ou filtros externos configurados. As contagens vêm de `status --porcelain=v2 --branch -z`. Um arquivo preparado e posteriormente editado aparece nas duas contagens. Conflitos têm contagem própria. O estado interno de submódulos fica fora da inspeção; alterações da referência rastreada continuam visíveis. O diagnóstico de desenvolvimento sai pelo stderr e identifica a operação, o pedido e a classe de falha sem registrar caminhos privados. [Formato e leitura em segundo plano do Git status](https://git-scm.com/docs/git-status)

## Verificação

```powershell
pnpm test
pnpm typecheck
pnpm lint
pnpm format:check
pnpm build:web
```

As fixtures são criadas e descartadas pelos testes, que exercitam repositórios com e sem commits, worktrees, HEAD destacado, renomeações, caminhos Unicode, alterações simultâneas no índice e na árvore de trabalho, erros Git e prazos de IPC. O teste de leitura compara os hashes e horários de modificação dos arquivos da fixture, incluindo o índice. O build web serve para checar o renderer. A importação e o health check completos exigem a janela Tauri.

Nesta entrega, os 15 testes passaram. Também passaram o lint, o typecheck, a checagem de formatação, o build web e o build nativo `pnpm build --debug --target x86_64-pc-windows-gnu`. No Windows x64, a janela Tauri em desenvolvimento reportou conexão com o sidecar Node 24.14.1. O toolchain GNU foi usado porque o linker MSVC está ausente na máquina de validação.

## Limites e próximos itens

| Item | Pendência                                                                                                                                         |
| ---- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| D04  | Catálogo SQLite e restauração da seleção. Os projetos atuais duram até fechar a janela.                                                           |
| D05  | Completar a experiência do workspace com os dados persistidos e a atividade local.                                                                |
| D06  | Adicionar cache persistente e fluxo de relocalização de pasta. A implementação atual já descarta respostas de seleções anteriores.                |
| D07  | Configurar CI e teste de inicialização no Windows, validar instalação em máquina limpa e preparar o instalador e os avisos de licença do runtime. |

O resumo observa branch, HEAD e contagens no momento da consulta. Alterações externas aparecem ao atualizar ou reabrir o projeto. A UI inicial usa o tema grafite do protótipo.
