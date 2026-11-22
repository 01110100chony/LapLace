# LapLace

Desktop Windows x64 para retomar projetos Git com memória e evidência verificáveis e supervisionar agentes. A janela usa React/Vite e Tauri/Rust. O sidecar Node/TypeScript integra Git e mantém o catálogo local em SQLite/FTS5.

## Fontes de autoridade

- As instruções específicas da tarefa definem escopo, ações autorizadas e entregáveis. Instruções locais em subdiretórios, quando existirem, detalham seu próprio escopo.
- A [arquitetura consolidada v2.1](docs/planning/ROADMAP.md#fonte-normativa) define o contrato do produto. Registre incompatibilidade demonstrada e proposta de decisão antes de mudar o contrato.
- Consulte o [ROADMAP](docs/planning/ROADMAP.md) para a fase e o [MILESTONES](docs/planning/MILESTONES.md) para dependências e aceites. Em F1, execute a tarefa descrita em [F1_IMPLEMENTATION_PLAN](docs/planning/F1_IMPLEMENTATION_PLAN.md).
- Abra o [STATUS](docs/planning/STATUS.md#execução) para identificar o milestone e a tarefa ativos, o HEAD validado e os bloqueios. Use o código, os manifests e os resultados registrados para verificar o estado efetivo.

## Estrutura

- `apps/desktop` contém a UI, a ponte IPC Tauri em `src-tauri` e o empacotamento Windows.
- `apps/local-service` contém o sidecar, Git, catálogo, migrações, captura, busca e persistência de tarefas/revisões.
- `packages/contracts` contém DTOs, validação e versões do IPC. `packages/agents` contém o adaptador Codex e o Mock.
- `scripts` contém o smoke de instalação e a sonda Codex. `.github/workflows` contém a validação Windows hospedada.
- `packages/core` é o destino proposto para regras puras a partir de F1. Compilador multicanal, gateway MCP, KGRAPH e Planner seguem seus milestones.

## Workflow

1. Confira branch, HEAD, mudanças locais e instruções do escopo antes de editar. Preserve o trabalho existente.
2. Para trabalho de produto, identifique milestone, tarefa, dependências e aceites. Execute somente a tarefa autorizada. Reutilize contratos e componentes quando já atenderem ao comportamento pedido.
3. Valide no ponto de entrada real da capacidade e em fixtures descartáveis quando envolver Git, banco, migração ou instalação. Separe resultado local, teste com mock, demonstração do desktop e execução real.
4. Atualize o [registro de entregas](docs/planning/STATUS.md#registro-de-entregas) com evidência e resultado por aceite. Se houver incompatibilidade com a v2.1, registre a proposta e a evidência no STATUS.

## Comandos essenciais

Use PowerShell na raiz, Node de [`.node-version`](.node-version) e pnpm do campo `packageManager` em [`package.json`](package.json). Confira as versões e os pré-requisitos de [desenvolvimento](README.md#desenvolvimento-no-windows-x64) antes de instalar dependências ou compilar.

```powershell
pnpm install --frozen-lockfile
pnpm dev
```

`pnpm dev` usa o alvo Windows padrão com MSVC. Para GNU, confira o runtime WebView2 instalado, Git for Windows, GCC e `windres` do MinGW-w64 no PATH. Selecione o toolchain GNU e instale-o quando necessário e autorizado.

```powershell
rustup toolchain install stable-x86_64-pc-windows-gnu --profile minimal --component rustfmt
$env:RUSTUP_TOOLCHAIN = 'stable-x86_64-pc-windows-gnu'
pnpm dev --target x86_64-pc-windows-gnu
```

Selecione as verificações pertinentes. Para validação integrada em GNU, use o mesmo `RUSTUP_TOOLCHAIN`.

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

Para validar distribuição GNU, use um perfil descartável sem LapLace instalado. O preparo pode buscar artefatos de dependências quando o cache estiver ausente.

```powershell
Push-Location apps/desktop
node node_modules/@tauri-apps/cli/tauri.js build --ci --no-sign --target x86_64-pc-windows-gnu -- --locked
Pop-Location
$bundle = 'apps/desktop/src-tauri/target/x86_64-pc-windows-gnu/release/bundle/nsis'
$installer = @(Get-ChildItem -LiteralPath $bundle -Filter '*-setup.exe' -File)
if ($installer.Count -ne 1) { throw 'Esperado um único instalador NSIS.' }
.\scripts\smoke-windows.ps1 -Installer $installer[0].FullName
```

Para MSVC, use o toolchain e os comandos do [workflow Windows](.github/workflows/ci.yml). Confira seus filtros de execução. Registre GNU local, smoke e MSVC hospedado separadamente, sempre com alvo e revisão.

## Contratos e invariantes

- Resolva escopo e autorização no serviço. Vincule respostas e caches ao projeto e, quando aplicável, a binding, worktree, sessão e destino. Descarte respostas atrasadas depois de trocar a seleção.
- SQLite governa o binding e registra interpretação/proveniência. Git governa o histórico commitado. CAS preserva bytes quando a capacidade o implementar. Declare data, origem, digest, cobertura e lacunas conforme a evidência efetivamente disponível.
- Observe Git sem modificar HEAD, índice ou refs. Em fixtures D04, use a raiz canônica de `realpath.native`, incluindo a capitalização do disco. `project.inspect` exige a raiz cadastrada. Relocalização exige identidade verificada do checkout e do diretório Git; caminho, remote e HEAD são insuficientes para reassociar.
- Mantenha dados locais por padrão e separe permissão de leitura, divulgação e execução. Promoção canônica exige decisão humana. Separe política de memória, operações Git e confinamento de processo. Mock e Workspace Dev conservam seus rótulos e limites.

## Restrições operacionais

- Faça ensaios de migração em cópia consistente e verifique recuperação. Preserve catálogo, referências e formatos legados até validação e decisão de suporte. Evite copiar apenas o arquivo principal de uma base ativa em WAL.
- Ações destrutivas, publicação/push e comandos com efeito externo exigem autorização no escopo. Operações Git ou de banco do usuário precisam de alvo conferido. Use cópias descartáveis para ensaios de escrita, cancelamento e falha.
- Mantenha credenciais, texto privado e canários sensíveis fora de logs, fixtures versionadas e destinos não autorizados. Use dados sintéticos ou evidência redigida.

## Definition of Done

Feche uma tarefa quando a entrega passar pelos aceites aplicáveis e houver evidência no STATUS com IDs, revisão ou diff, comandos, ambiente e resultados. Identifique verificações falhas, pendentes ou fora do escopo. Mantenha aberto qualquer aceite obrigatório sem prova e indique a próxima tarefa executável ou a condição de desbloqueio.
