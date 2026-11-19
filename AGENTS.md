# Laplace

O Laplace é um aplicativo desktop Windows x64. Use `apps/desktop` para a interface React/Tauri e o empacotamento, `apps/local-service` para Git e o catálogo SQLite, e `packages/contracts` para o protocolo IPC compartilhado.

## Desenvolvimento local com GNU

Em um Windows sem MSVC, use PowerShell com Git for Windows, WebView2, GCC e `windres` do MinGW-w64 no PATH. Use o Node.js de `.node-version` e o pnpm declarado em `package.json`. Instale o toolchain GNU com `rustup toolchain install stable-x86_64-pc-windows-gnu --profile minimal --component rustfmt` se necessário.

```powershell
Set-Location 'C:\projetos2026\LapLace'
$env:RUSTUP_TOOLCHAIN = 'stable-x86_64-pc-windows-gnu'
pnpm install --frozen-lockfile
pnpm dev --target x86_64-pc-windows-gnu
```

## Verificações

Execute na raiz com o mesmo `RUSTUP_TOOLCHAIN`.

```powershell
pnpm lint
pnpm typecheck
pnpm format:check
pnpm test
pnpm build:web
pnpm --filter @laplace/desktop prepare:sidecar
cargo fmt --manifest-path apps/desktop/src-tauri/Cargo.toml --all -- --check
cargo check --manifest-path apps/desktop/src-tauri/Cargo.toml --locked --target x86_64-pc-windows-gnu --features custom-protocol
```

Para empacotar e executar o smoke de instalação em um perfil descartável sem Laplace instalado, use os comandos abaixo.

```powershell
Push-Location apps/desktop
node node_modules/@tauri-apps/cli/tauri.js build --ci --no-sign --target x86_64-pc-windows-gnu -- --locked
Pop-Location
$bundle = 'apps/desktop/src-tauri/target/x86_64-pc-windows-gnu/release/bundle/nsis'
$installer = @(Get-ChildItem -LiteralPath $bundle -Filter '*-setup.exe' -File)
if ($installer.Count -ne 1) { throw 'Esperado um único instalador NSIS.' }
.\scripts\smoke-windows.ps1 -Installer $installer[0].FullName
```

O workflow `.github/workflows/ci.yml` valida o alvo MSVC no runner Windows. Registre os resultados locais GNU e os resultados hospedados MSVC separadamente.

## Catálogo e IPC

Ao montar fixtures de migração D04, grave a raiz canônica do checkout conforme `realpath.native`, incluindo a capitalização do disco. O `project.inspect` exige que a raiz Git coincida com a raiz cadastrada. A relocalização exige a identidade do checkout e do diretório Git verificada na raiz cadastrada.
