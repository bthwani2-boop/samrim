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
$wasRunningBefore = $false
$startedByThisVerifier = $false
$cleanupFailure = $null

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

function Test-CanonicalRuntimeRunning {
    $ids = @(& docker ps --filter 'label=com.docker.compose.project=samrim-local' --format '{{.ID}}' | Where-Object { $_ })
    if ($LASTEXITCODE -ne 0) { Fail 'Unable to inspect canonical runtime ownership.' }
    return $ids.Count -gt 0
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
            $wasRunningBefore = Test-CanonicalRuntimeRunning
            Write-Host "WAS_RUNNING_BEFORE=$([int]$wasRunningBefore)"
            if (-not $wasRunningBefore) {
                $startedByThisVerifier = $true
                Run-Step 'Canonical runtime up' { pnpm runtime:up }
            }
            else { Write-Host 'CANONICAL_RUNTIME_START=SKIPPED reason=pre_existing_runtime' }
            Write-Host "STARTED_BY_THIS_VERIFIER=$([int]$startedByThisVerifier)"
            Run-Step 'Canonical runtime doctor' { pnpm runtime:doctor }
            $runtimeVerificationArgs = @("--env-file=$envPath")
            if ($wasRunningBefore) { $runtimeVerificationArgs += '--preexisting-runtime' }
            Run-Step 'Canonical runtime verification' { node tools/dev/verify-candidate-runtime.mjs @runtimeVerificationArgs }
            Run-Step 'Canonical runtime status' { pnpm runtime:status }
            Write-Host 'LOCAL_CANDIDATE_RUNTIME=PASS'
        }
        finally {
            if ($startedByThisVerifier) {
                try {
                    pnpm runtime:down
                    if ($LASTEXITCODE -ne 0) { throw 'runtime:down failed.' }
                    Write-Host 'CANDIDATE_RUNTIME_CLEANUP=PASS'
                }
                catch {
                    $cleanupFailure = $_.Exception.Message
                    Write-Host "CANDIDATE_RUNTIME_CLEANUP=FAIL reason=$cleanupFailure"
                }
            }
        }
    }

    Assert-CleanTree 'candidate completion'
    Write-Host 'LOCAL_CANDIDATE_WORKSPACE=PASS'
    Write-Host 'LOCAL_CANDIDATE_WINDOWS_PROOF=PASS'
}
finally {
    Pop-Location
    if ($startedByThisVerifier -and $null -ne $cleanupFailure) { throw "CANDIDATE_RUNTIME_CLEANUP=FAIL reason=$cleanupFailure" }
}
