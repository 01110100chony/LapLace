# Run in a disposable Windows profile or in GitHub Actions.
param(
    [Parameter(Mandatory)]
    [string] $Installer
)

$ErrorActionPreference = 'Stop'
$installer = (Resolve-Path -LiteralPath $Installer).Path
$catalog = Join-Path ([System.IO.Path]::GetTempPath()) ('laplace-smoke-' + [Guid]::NewGuid())
$app = Join-Path $catalog 'app'
$data = Join-Path $catalog 'data'
$sidecar = Join-Path $app 'laplace-node.exe'
$service = Join-Path $app 'sidecar/service.cjs'
$uninstaller = Join-Path $app 'uninstall.exe'
$version = (Get-Content -Raw (Join-Path $PSScriptRoot '../.node-version')).Trim()
$systemPath = "$env:SystemRoot\System32;$env:SystemRoot"

function Assert-Smoke($Condition, [string] $Message) {
    if (!$Condition) { throw $Message }
}

function Invoke-Sidecar([hashtable[]] $Requests, [string] $SearchPath = $systemPath) {
    $start = [System.Diagnostics.ProcessStartInfo]::new()
    $start.FileName = $sidecar
    $start.Arguments = '--preserve-symlinks-main "{0}" "{1}"' -f $service, $data
    $start.UseShellExecute = $false
    $start.CreateNoWindow = $true
    $start.RedirectStandardInput = $true
    $start.RedirectStandardOutput = $true
    $start.RedirectStandardError = $true
    $start.StandardOutputEncoding = [System.Text.UTF8Encoding]::new($false)
    $start.EnvironmentVariables['Path'] = $SearchPath
    foreach ($name in 'NODE_OPTIONS', 'NODE_PATH', 'NODE_V8_COVERAGE') {
        $start.EnvironmentVariables.Remove($name)
    }
    $child = [System.Diagnostics.Process]::Start($start)
    try {
        $diagnostics = $child.StandardError.ReadToEndAsync()
        $sequence = 0
        foreach ($request in $Requests) {
            $id = 'smoke-' + (++$sequence)
            $packet = @{ version = 2; id = $id } + $request | ConvertTo-Json -Compress
            $bytes = [System.Text.Encoding]::UTF8.GetBytes($packet + "`n")
            $child.StandardInput.BaseStream.Write($bytes, 0, $bytes.Length)
            $child.StandardInput.BaseStream.Flush()
            $read = $child.StandardOutput.ReadLineAsync()
            Assert-Smoke ($read.Wait(20000) -and $read.Result) "No IPC response to $id."
            $reply = $read.Result | ConvertFrom-Json -ErrorAction Stop
            Assert-Smoke ($reply.id -eq $id -and $reply.version -eq 2 -and
                (!$reply.ok -or $reply.operation -eq $request.operation)) "Unexpected IPC envelope for $id."
            $reply
        }
        $child.StandardInput.Close()
        Assert-Smoke ($child.WaitForExit(5000) -and $child.ExitCode -eq 0) 'Sidecar did not exit cleanly after EOF.'
        Assert-Smoke (!$child.StandardOutput.ReadToEnd()) 'Extra output broke the stdout IPC channel.'
        Assert-Smoke ($diagnostics.Result -match '\[laplace:service\]') 'Expected diagnostics on stderr.'
    } finally {
        if (!$child.HasExited) { $child.Kill() }
        $child.Dispose()
    }
}

foreach ($scope in 'HKCU:', 'HKLM:') {
    $registered = Join-Path $scope 'Software/Microsoft/Windows/CurrentVersion/Uninstall/Laplace'
    Assert-Smoke (!(Test-Path -LiteralPath $registered)) 'Use a disposable profile without Laplace installed.'
}
New-Item -ItemType Directory -Path $catalog | Out-Null
try {
    $install = Start-Process -FilePath $installer -ArgumentList "/S /D=$app" -WindowStyle Hidden -Wait -PassThru
    Assert-Smoke ($install.ExitCode -eq 0) "NSIS install returned $($install.ExitCode)."
    foreach ($file in 'laplace.exe', 'laplace-node.exe', 'sidecar/service.cjs', 'licenses/NODE-LICENSE.txt', 'licenses/THIRD-PARTY-NOTICES.txt', 'uninstall.exe') {
        Assert-Smoke (Test-Path -LiteralPath (Join-Path $app $file) -PathType Leaf) "Missing installed file $file."
    }

    $repo = New-Item -ItemType Directory -Path (Join-Path $catalog 'Repo with spaces')
    $health, $empty, $missing = Invoke-Sidecar @(
        @{ operation = 'health' },
        @{ operation = 'workspace.list' },
        @{ operation = 'workspace.addLocal'; path = $repo.FullName }
    )
    Assert-Smoke ($health.ok -and $health.data.nodeVersion -eq $version) 'Unexpected installed Node.js runtime.'
    Assert-Smoke ($empty.ok -and $empty.data.projects.Count -eq 0) 'New catalog is not empty.'
    Assert-Smoke (!$missing.ok -and $missing.error.code -eq 'git_missing') 'Missing Git was not reported.'

    $git = (Get-Command git.exe -CommandType Application | Select-Object -First 1).Source
    $gitPath = "$(Split-Path -Parent $git);$systemPath"
    & $git -C $repo.FullName init --quiet -b smoke
    Assert-Smoke ($LASTEXITCODE -eq 0) 'git init failed.'
    & $git -C $repo.FullName -c user.name=Laplace -c user.email=smoke@example.invalid -c commit.gpgSign=false -c core.hooksPath=NUL commit --quiet --allow-empty -m 'Smoke fixture'
    Assert-Smoke ($LASTEXITCODE -eq 0) 'git commit failed.'
    $head = & $git -C $repo.FullName rev-parse HEAD
    Set-Content -LiteralPath (Join-Path $repo.FullName 'untracked.txt') -Value 'fixture'

    $added = Invoke-Sidecar @(@{ operation = 'workspace.addLocal'; path = $repo.FullName }) $gitPath
    Assert-Smoke ($added.ok -and $added.data.branch -eq 'smoke' -and
        $added.data.head -eq $head -and $added.data.changes.untracked -eq 1) 'Git summary differs from the fixture.'
    $id = $added.data.id
    $selected, $restored = Invoke-Sidecar @(
        @{ operation = 'project.select'; projectId = $id },
        @{ operation = 'workspace.list' }
    )
    Assert-Smoke ($selected.ok -and $selected.data.cached.head -eq $head -and
        $restored.ok -and $restored.data.projects.Count -eq 1 -and $restored.data.selectedProjectId -eq $id) 'Catalog or selection was lost between processes.'
    $browse, $capture = Invoke-Sidecar @(
        @{ operation = 'context.browse'; projectId = $id; folder = ''; prefix = '' },
        @{ operation = 'context.capture'; projectId = $id; paths = @('untracked.txt') }
    ) $gitPath
    $fileHash = (Get-FileHash -LiteralPath (Join-Path $repo.FullName 'untracked.txt')).Hash.ToLowerInvariant()
    Assert-Smoke ($browse.ok -and $browse.data.items[0].path -eq 'untracked.txt' -and
        $capture.ok -and $capture.data.status -eq 'complete' -and $capture.data.head -eq $head -and
        $capture.data.entries[0].sha256 -eq $fileHash) 'Installed sidecar could not capture the selected file.'
    $contextId = $capture.data.contextId
    $indexed = Invoke-Sidecar @(
        @{ operation = 'context.index'; projectId = $id; contextId = $contextId; force = $false }
    ) $gitPath
    Assert-Smoke ($indexed.ok -and $indexed.data.files -eq 1 -and $indexed.data.chunks -eq 1) 'Installed sidecar could not index the capture.'
    Rename-Item -LiteralPath $repo.FullName -NewName 'Moved repo'
    $unavailable, $saved, $history, $context, $search, $preview = Invoke-Sidecar @(
        @{ operation = 'project.inspect'; projectId = $id },
        @{ operation = 'workspace.list' },
        @{ operation = 'context.list'; projectId = $id; before = $null },
        @{ operation = 'context.get'; projectId = $id; contextId = $contextId },
        @{ operation = 'context.search'; projectId = $id; scope = 'latest'; contextId = $null; query = 'fixture'; offset = 0 },
        @{ operation = 'context.sourcePreview'; projectId = $id; contextId = $contextId; path = 'untracked.txt'; sha256 = $fileHash; chunk = 0 }
    ) $gitPath
    Assert-Smoke (!$unavailable.ok -and $unavailable.error.code -eq 'project_unavailable' -and
        $saved.ok -and $saved.data.selectedProjectId -eq $id) 'Unavailable repository damaged persisted state.'
    Assert-Smoke ($history.ok -and $history.data.items[0].contextId -eq $contextId -and
        $context.ok -and $context.data.digest -eq $capture.data.digest -and
        $context.data.entries[0].sha256 -eq $fileHash) 'Context history was lost between processes.'
    Assert-Smoke ($search.ok -and $search.data.items.Count -eq 1 -and
        $search.data.items[0].contextId -eq $contextId -and $search.data.items[0].sha256 -eq $fileHash -and
        $preview.ok -and $preview.data.firstLine -eq 1 -and $preview.data.text.Trim() -eq 'fixture') 'FTS5 or the preserved preview failed after restart.'

    $db = Join-Path $data 'catalog.sqlite3'
    Assert-Smoke (Test-Path -LiteralPath $db -PathType Leaf) 'SQLite catalog was not created.'
    $sqlite = & $sidecar -e 'const {DatabaseSync} = require(''node:sqlite''); const db = new DatabaseSync(process.argv[1], { readOnly: true }); process.stdout.write(JSON.stringify({ version: process.versions.sqlite, journal: db.prepare(''PRAGMA journal_mode'').get().journal_mode, integrity: db.prepare(''PRAGMA integrity_check'').get().integrity_check })); db.close();' $db | ConvertFrom-Json
    Assert-Smoke ($LASTEXITCODE -eq 0 -and $sqlite.journal -eq 'delete' -and $sqlite.integrity -eq 'ok') 'Unexpected SQLite journal mode or integrity result.'
    Write-Output "Smoke passed. Node.js $version, SQLite $($sqlite.version) ($($sqlite.journal)). IPC, Git, context capture, FTS5, restart, recovery and EOF verified."
} finally {
    if (Test-Path -LiteralPath $uninstaller -PathType Leaf) {
        $uninstall = Start-Process -FilePath $uninstaller -ArgumentList '/S' -WindowStyle Hidden -Wait -PassThru
        Assert-Smoke ($uninstall.ExitCode -eq 0 -and !(Test-Path -LiteralPath $sidecar)) 'Silent uninstall failed.'
    }
    $resolved = (Resolve-Path -LiteralPath $catalog).Path
    Assert-Smoke ($resolved -eq $catalog -and (Split-Path -Leaf $resolved) -match '^laplace-smoke-[0-9a-f-]+$') 'Unexpected smoke directory.'
    Remove-Item -LiteralPath $resolved -Recurse -Force
}
