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

function Fail([string]$Message) {
    throw $Message
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
    Run-Step 'Workspace verification' { pnpm run workspace:verify }

    Run-Step 'Canonical compose config' {
        docker compose --project-name samrim-local --env-file infra/local/compose/.env.example -f $composePath config --quiet
    }

    if (-not $SkipRuntime) {
        try {
            Run-Step 'Canonical runtime up' { pnpm runtime:up }
            $runtimeStarted = $true
            Run-Step 'Canonical runtime doctor' { pnpm runtime:doctor }
            Run-Step 'Identity exact schema' { Invoke-CanonicalSchemaVerify -Service 'identity' }
            Run-Step 'DSH exact schema' { Invoke-CanonicalSchemaVerify -Service 'dsh' }
            Run-Step 'Identity migration upgrade proof' { node tools/dev/verify-migration-v13-to-v15.mjs "--env-file=$envPath" }
            Run-Step 'Identity runtime semantics' { node tools/dev/verify-identity-runtime.mjs "--env-file=$envPath" }
            Run-Step 'DSH managed-access runtime' { node tools/dev/verify-dsh-runtime.mjs "--env-file=$envPath" }
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
    if ($runtimeStarted) {
        try { pnpm runtime:down *> $null } catch {}
    }
    Pop-Location
}
