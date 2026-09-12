#Requires -Version 7.4
[CmdletBinding()]
param(
    [string]$ExpectedBranch = '',
    [switch]$SkipFetch,
    [switch]$SkipRuntime
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$repo = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
$envPath = Join-Path $repo 'infra\local\compose\.env'
$composePath = Join-Path $repo 'infra\local\compose\compose.yaml'
$runtimeStarted = $false
$controlPanelProcess = $null
$controlPanelStdout = $null
$controlPanelStderr = $null

function Fail([string]$Message) {
    throw $Message
}

function Read-EnvMap([string]$Path) {
    if (-not (Test-Path -LiteralPath $Path -PathType Leaf)) {
        Fail "Canonical local runtime environment is missing: $Path"
    }

    $map = @{}
    foreach ($line in Get-Content -LiteralPath $Path) {
        $trimmed = $line.Trim()
        if (-not $trimmed -or $trimmed.StartsWith('#')) { continue }
        $parts = $trimmed.Split('=', 2)
        if ($parts.Count -ne 2) { Fail "Malformed local runtime environment line in ${Path}: $line" }
        $name = $parts[0].Trim()
        if ([string]::IsNullOrWhiteSpace($name)) { Fail "Empty local runtime environment key in $Path" }
        if ($map.ContainsKey($name)) { Fail "Duplicate local runtime environment key '$name'" }
        $map[$name] = $parts[1].Trim()
    }
    return $map
}

function Run-Step([string]$Name, [scriptblock]$Action) {
    Write-Host ''
    Write-Host "=== $Name ==="
    $global:LASTEXITCODE = 0
    & $Action
    if ($LASTEXITCODE -ne 0) { Fail "$Name failed with exit code $LASTEXITCODE" }
}

function Assert-CleanTree([string]$Context) {
    $status = @(& git status --porcelain --untracked-files=all)
    if ($LASTEXITCODE -ne 0) { Fail "Unable to inspect Git status during $Context." }
    if ($status.Count -gt 0) {
        Fail ("Repository must remain clean during ${Context}:" + [Environment]::NewLine + ($status -join [Environment]::NewLine))
    }
}

function Start-ControlPanelForVerification {
    Run-Step 'Control Panel build' { pnpm --dir apps/control-panel build }

    $envMap = Read-EnvMap -Path $envPath
    $origin = $envMap['CONTROL_PANEL_PUBLIC_ORIGIN']
    if ([string]::IsNullOrWhiteSpace($origin)) { Fail 'CONTROL_PANEL_PUBLIC_ORIGIN is required for browser verification.' }

    $tempRoot = [IO.Path]::GetTempPath()
    $nonce = [Guid]::NewGuid().ToString('N')
    $stdoutPath = Join-Path $tempRoot "samrim-control-panel-$nonce.out.log"
    $stderrPath = Join-Path $tempRoot "samrim-control-panel-$nonce.err.log"
    $pnpmCommand = Get-Command pnpm.cmd -CommandType Application -ErrorAction SilentlyContinue
    if ($null -eq $pnpmCommand) {
        $pnpmCommand = Get-Command pnpm -CommandType Application -ErrorAction Stop
    }
    $pnpm = $pnpmCommand.Source
    $process = Start-Process -FilePath $pnpm -ArgumentList @('control') -WorkingDirectory $repo -WindowStyle Hidden -PassThru -RedirectStandardOutput $stdoutPath -RedirectStandardError $stderrPath

    try {
        for ($attempt = 1; $attempt -le 60; $attempt++) {
            try {
                $response = Invoke-WebRequest -Uri $origin -UseBasicParsing -TimeoutSec 5
                if ($response.StatusCode -ge 200 -and $response.StatusCode -lt 400) {
                    Write-Host 'CONTROL_PANEL_RUNTIME=PASS'
                    return [pscustomobject]@{ Process = $process; Stdout = $stdoutPath; Stderr = $stderrPath }
                }
            }
            catch {
                # The canonical runtime may still be starting.
            }
            $process.Refresh()
            if ($process.HasExited) {
                $stdout = if (Test-Path -LiteralPath $stdoutPath) { Get-Content -Raw -LiteralPath $stdoutPath } else { '' }
                $stderr = if (Test-Path -LiteralPath $stderrPath) { Get-Content -Raw -LiteralPath $stderrPath } else { '' }
                Fail "Control Panel exited before becoming ready.`n$stdout`n$stderr"
            }
            Start-Sleep -Seconds 1
        }
        $stdout = if (Test-Path -LiteralPath $stdoutPath) { Get-Content -Raw -LiteralPath $stdoutPath } else { '' }
        $stderr = if (Test-Path -LiteralPath $stderrPath) { Get-Content -Raw -LiteralPath $stderrPath } else { '' }
        Fail "Control Panel did not become ready at $origin.`n$stdout`n$stderr"
    }
    catch {
        if (-not $process.HasExited) { & taskkill.exe /PID $process.Id /T /F *> $null }
        throw
    }
}

function Stop-ControlPanelForVerification($Handle) {
    if ($null -eq $Handle) { return }
    try {
        $Handle.Process.Refresh()
        if (-not $Handle.Process.HasExited) { & taskkill.exe /PID $Handle.Process.Id /T /F *> $null }
    }
    finally {
        foreach ($path in @($Handle.Stdout, $Handle.Stderr)) {
            if ($path -and (Test-Path -LiteralPath $path)) { Remove-Item -LiteralPath $path -Force -ErrorAction SilentlyContinue }
        }
    }
}

function Invoke-CanonicalSchemaVerify([string]$Service) {
    & docker compose --project-name samrim-local --env-file $envPath -f $composePath exec -T $Service /schema-verify
    if ($LASTEXITCODE -ne 0) { Fail "$Service exact schema verification failed." }
}

Push-Location $repo
try {
    $branch = (& git branch --show-current).Trim()
    if ($LASTEXITCODE -ne 0 -or [string]::IsNullOrWhiteSpace($branch)) { Fail 'Unable to determine current Git branch.' }
    $verificationBranch = if ([string]::IsNullOrWhiteSpace($ExpectedBranch)) { $branch } else { $ExpectedBranch }
    if (-not [string]::IsNullOrWhiteSpace($ExpectedBranch) -and $branch -ne $ExpectedBranch) {
        Fail "Expected branch '$ExpectedBranch', found '$branch'."
    }

    Assert-CleanTree 'candidate start'

    if (-not $SkipFetch) {
        Run-Step 'Fetch exact remote candidate' { git fetch origin $verificationBranch --prune }
        $localHead = (& git rev-parse HEAD).Trim()
        $remoteHead = (& git rev-parse ("origin/" + $verificationBranch)).Trim()
        if ($localHead -ne $remoteHead) { Fail "Exact candidate HEAD mismatch: local=$localHead remote=$remoteHead" }
        Write-Host "EXACT_HEAD_SHA=$localHead"
    }

    if ((& node --version).Trim() -ne 'v24.17.0') { Fail 'Node version mismatch.' }
    if ((& pnpm --version).Trim() -ne '10.34.0') { Fail 'pnpm version mismatch.' }
    if ((& go version | Out-String).Trim() -notmatch '\bgo1\.27\.1\b') { Fail 'Go version mismatch.' }
    & docker version *> $null
    if ($LASTEXITCODE -ne 0) { Fail 'Docker is unavailable.' }

    Run-Step 'Repository structure' { node tools/dev/verify-repository-structure.mjs }
    Run-Step 'Structural hygiene' { node tools/dev/verify-structural-hygiene.mjs }
    Run-Step 'Runtime ownership' { node tools/dev/verify-local-runtime-ownership.mjs }
    Run-Step 'Theme authority' { pnpm run theme:verify }
    Run-Step 'Docs parity' { pnpm run docs:verify:all }
    Run-Step 'Knowledge invariants' { pnpm run knowledge:verify:all }
    Run-Step 'PowerShell syntax' { pwsh -NoProfile -ExecutionPolicy Bypass -File tools/dev/verify-powershell-syntax.ps1 }
    Run-Step 'Frozen workspace install' { pnpm install --frozen-lockfile }
    Run-Step 'Mobile deployable identities' { pnpm run mobile:verify-config }
    Run-Step 'Workspace dependency references' { node tools/dev/verify-workspace-dependencies.mjs }
    Run-Step 'Nx project tags' { pnpm run nx:verify-tags }
    Run-Step 'Developer bootstrap' { pwsh -NoProfile -ExecutionPolicy Bypass -File tools/dev/bootstrap.ps1 }
    Assert-CleanTree 'developer bootstrap'
    Run-Step 'Canonical static verification' { node tools/dev/verify-candidate-static.mjs }

    Run-Step 'Canonical compose config' {
        docker compose --project-name samrim-local --env-file infra/local/compose/.env.example -f $composePath config --quiet
    }

    if (-not $SkipRuntime) {
        try {
            Run-Step 'Canonical runtime up' { pnpm runtime:up }
            $runtimeStarted = $true
            Run-Step 'Canonical runtime doctor' { pnpm runtime:doctor }
            $controlPanelProcess = Start-ControlPanelForVerification
            Run-Step 'Canonical runtime verification' { node tools/dev/verify-candidate-runtime.mjs "--env-file=$envPath" }
            Run-Step 'Canonical runtime status' { pnpm runtime:status }
            Write-Host 'LOCAL_CANDIDATE_RUNTIME=PASS'
        }
        finally {
            if ($runtimeStarted) {
                pnpm runtime:down
                if ($LASTEXITCODE -ne 0) { Fail 'runtime:down failed.' }
                $runtimeStarted = $false
            }
        }
    }

    Assert-CleanTree 'candidate completion'
    Write-Host 'LOCAL_CANDIDATE_WORKSPACE=PASS'
    Write-Host 'LOCAL_CANDIDATE_WINDOWS_PROOF=PASS'
}
finally {
    if ($null -ne $controlPanelProcess) {
        try { Stop-ControlPanelForVerification $controlPanelProcess } catch {}
    }
    if ($runtimeStarted) {
        try { pnpm runtime:down *> $null } catch {}
    }
    Pop-Location
}
