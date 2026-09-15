#Requires -Version 7.4
[CmdletBinding()]
param(
    [string]$ExpectedBranch = ''
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$repo = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
$envPath = Join-Path $repo 'infra\local\compose\.env'
$composePath = Join-Path $repo 'infra\local\compose\compose.yaml'
$runtimePath = Join-Path $repo 'tools\dev\runtime.ps1'
$optionalServices = @('control','metro-client','metro-partner','metro-captain','metro-field')
$runtimeSnapshot = $null
$runtimeChangedByVerifier = $false
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

function Get-RunningCanonicalServices {
    $services = @(& docker ps --filter 'label=com.docker.compose.project=samrim-local' --format '{{.Label "com.docker.compose.service"}}' | ForEach-Object { $_.Trim() } | Where-Object { $_ } | Sort-Object -Unique)
    if ($LASTEXITCODE -ne 0) { Fail 'Unable to inspect canonical runtime ownership.' }
    return $services
}

function Get-RuntimeSnapshot {
    $running = @(Get-RunningCanonicalServices)
    if ($running.Count -eq 0) { return [pscustomobject]@{ Mode='none'; Target=''; Running=$running } }
    $optionals = @($running | Where-Object { $_ -in $optionalServices })
    if ($optionals.Count -eq $optionalServices.Count) { return [pscustomobject]@{ Mode='full'; Target=''; Running=$running } }
    if ($optionals.Count -eq 1) { return [pscustomobject]@{ Mode='target'; Target=[string]$optionals[0]; Running=$running } }
    Fail "NONCANONICAL_PREEXISTING_RUNTIME optionals=$($optionals -join ',') running=$($running -join ',')"
}

function Restore-RuntimeSnapshot($Snapshot) {
    switch ([string]$Snapshot.Mode) {
        'none' {
            pnpm runtime:down
            if ($LASTEXITCODE -ne 0) { Fail 'runtime:down failed while restoring pre-verification state.' }
            Write-Host 'CANDIDATE_RUNTIME_RESTORE=PASS mode=none'
        }
        'target' {
            $target = [string]$Snapshot.Target
            if ($target -eq 'control') {
                & pwsh -NoProfile -ExecutionPolicy Bypass -File $runtimePath -Action Control
            }
            elseif ($target -match '^metro-(client|partner|captain|field)$') {
                & pwsh -NoProfile -ExecutionPolicy Bypass -File $runtimePath -Action Surface -Surface $Matches[1]
            }
            else { Fail "Unsupported runtime target snapshot: $target" }
            if ($LASTEXITCODE -ne 0) { Fail "Failed to restore runtime target: $target" }
            Write-Host "CANDIDATE_RUNTIME_RESTORE=PASS mode=target target=$target"
        }
        'full' { Write-Host 'CANDIDATE_RUNTIME_RESTORE=SKIPPED mode=full' }
        default { Fail "Unknown runtime snapshot mode: $($Snapshot.Mode)" }
    }
}

Push-Location $repo
try {
    $branch = (& git branch --show-current).Trim()
    if ($LASTEXITCODE -ne 0 -or [string]::IsNullOrWhiteSpace($branch)) { Fail 'Unable to determine current Git branch.' }
    if (-not [string]::IsNullOrWhiteSpace($ExpectedBranch) -and $branch -ne $ExpectedBranch) {
        Fail "Expected branch '$ExpectedBranch', found '$branch'."
    }

    $startHead = (& git rev-parse HEAD).Trim()
    if ($LASTEXITCODE -ne 0 -or $startHead -notmatch '^[0-9a-f]{40}$') { Fail 'Unable to determine exact local candidate HEAD.' }
    Assert-CleanTree 'candidate start'
    Write-Host "EXACT_LOCAL_CANDIDATE_SHA=$startHead"

    if ((& node --version).Trim() -ne 'v24.17.0') { Fail 'Node version mismatch.' }
    if ((& pnpm --version).Trim() -ne '10.34.0') { Fail 'pnpm version mismatch.' }
    if ((& go version | Out-String).Trim() -notmatch '\bgo1\.27\.1\b') { Fail 'Go version mismatch.' }
    & docker version *> $null
    if ($LASTEXITCODE -ne 0) { Fail 'Docker is unavailable.' }

    Run-Step 'Repository structure' { node tools/dev/verify-repository-structure.mjs }
    Run-Step 'Structural hygiene' { node tools/dev/verify-structural-hygiene.mjs }
    Run-Step 'Runtime ownership' { node tools/dev/verify-local-runtime-ownership.mjs }
    Run-Step 'Theme authority' { pnpm run theme:verify }
    Run-Step 'Docs command parity' { node tools/dev/verify-doc-command-parity.mjs }
    Run-Step 'Docs configuration parity' { node tools/dev/verify-doc-config-parity.mjs }
    Run-Step 'Knowledge invariants' { node tools/dev/verify-knowledge-system.mjs }
    Run-Step 'Knowledge references' { node tools/dev/verify-knowledge-references.mjs }
    Run-Step 'Agent knowledge contract' { node tools/dev/verify-agent-knowledge-contract.mjs }
    Run-Step 'PowerShell syntax' { pwsh -NoProfile -ExecutionPolicy Bypass -File tools/dev/verify-powershell-syntax.ps1 }
    Run-Step 'Mobile deployable identities' { pnpm run mobile:verify-config }
    Run-Step 'Workspace dependency references' { node tools/dev/verify-workspace-dependencies.mjs }
    Run-Step 'Nx project tags' { node tools/dev/verify-nx-project-tags.mjs }
    Run-Step 'Developer bootstrap' { pwsh -NoProfile -ExecutionPolicy Bypass -File tools/dev/bootstrap.ps1 }
    Assert-CleanTree 'developer bootstrap'
    Run-Step 'Canonical static verification' { node tools/dev/verify-candidate-static.mjs }

    Run-Step 'Canonical compose config' {
        docker compose --project-name samrim-local --env-file infra/local/compose/.env.example -f $composePath config --quiet
    }

    try {
        $runtimeSnapshot = Get-RuntimeSnapshot
        Write-Host "PREEXISTING_RUNTIME_MODE=$($runtimeSnapshot.Mode)"
        if ($runtimeSnapshot.Mode -eq 'target') { Write-Host "PREEXISTING_RUNTIME_TARGET=$($runtimeSnapshot.Target)" }

        if ($runtimeSnapshot.Mode -ne 'full') {
            $runtimeChangedByVerifier = $true
            Run-Step 'Canonical full runtime up' { pnpm runtime:up }
        }
        else { Write-Host 'CANONICAL_RUNTIME_START=SKIPPED reason=pre_existing_full_runtime' }

        Run-Step 'Canonical runtime doctor' { pnpm runtime:doctor }
        $runtimeVerificationArgs = @("--env-file=$envPath")
        if ($runtimeSnapshot.Mode -ne 'none') { $runtimeVerificationArgs += '--preexisting-runtime' }
        Run-Step 'Canonical runtime verification' { node tools/dev/verify-candidate-runtime.mjs @runtimeVerificationArgs }
        Run-Step 'Canonical runtime status' { pnpm runtime:status }
        Write-Host 'LOCAL_CANDIDATE_RUNTIME=PASS'
    }
    finally {
        if ($runtimeChangedByVerifier -and $null -ne $runtimeSnapshot) {
            try { Restore-RuntimeSnapshot -Snapshot $runtimeSnapshot }
            catch {
                $cleanupFailure = $_.Exception.Message
                Write-Host "CANDIDATE_RUNTIME_RESTORE=FAIL reason=$cleanupFailure"
            }
        }
    }

    Assert-CleanTree 'candidate completion'
    $endHead = (& git rev-parse HEAD).Trim()
    if ($LASTEXITCODE -ne 0 -or $endHead -ne $startHead) { Fail "Candidate HEAD changed during verification: before=$startHead after=$endHead" }
    Write-Host 'LOCAL_CANDIDATE_WORKSPACE=PASS'
    Write-Host 'LOCAL_CANDIDATE_WINDOWS_PROOF=PASS'
    Write-Host "VERIFY=PASS head=$startHead"
}
finally {
    Pop-Location
    if ($runtimeChangedByVerifier -and $null -ne $cleanupFailure) { throw "CANDIDATE_RUNTIME_RESTORE=FAIL reason=$cleanupFailure" }
}
