# LapLace

**Retome projetos Git com o contexto à mão.** Um workspace local para Windows x64 que reúne seus repositórios e mostra a branch, o HEAD e as alterações no índice e no disco.

![Tela de Retomada do LapLace em tema Noir, com navegação lateral, decisão vigente e evidências](https://github.com/user-attachments/assets/5cd05d12-c25d-4ac1-bb7f-184c61a30cc5)

_Prévia da interface [Living Systems](https://github.com/01110100chony/LapLace/tree/codex/living-systems-2) no Tauri, com dados de teste._

A `main` oferece catálogo local, inspeção Git e relocalização de checkouts.

## Desenvolvimento no Windows x64

Use PowerShell com [Node.js](.node-version) 24.22.3, [pnpm](package.json) 11.19.0, Git for Windows no PATH, rustup, WebView2 e Microsoft C++ Build Tools com **Desenvolvimento para desktop com C++**.

```powershell
rustup toolchain install 1.95.0-x86_64-pc-windows-msvc --profile minimal --component rustfmt
$env:RUSTUP_TOOLCHAIN = '1.95.0-x86_64-pc-windows-msvc'
pnpm install --frozen-lockfile
pnpm dev
```

Na janela, escolha **Adicionar projeto** e selecione uma pasta dentro do repositório.

## Arquitetura

- [`apps/desktop`](apps/desktop) — React + Vite na janela Tauri/Rust.
- [`apps/local-service`](apps/local-service) — sidecar Node/TypeScript para leitura do Git e catálogo SQLite em `%LOCALAPPDATA%\br.laplace.desktop\catalog.sqlite3`.
- [`packages/contracts`](packages/contracts) — contratos do IPC via JSONL em stdio.

`pnpm test` executa os testes. O [workflow Windows](.github/workflows/ci.yml) compila, testa e disponibiliza o instalador NSIS x64 sem assinatura.

[Roadmap](https://github.com/01110100chony/LapLace/blob/codex/living-systems-2/docs/planning/ROADMAP.md) · [Status técnico](https://github.com/01110100chony/LapLace/blob/codex/living-systems-2/docs/planning/STATUS.md)
