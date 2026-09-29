#Requires -Version 7.4
[CmdletBinding()]
param(
    [string]$ExpectedBranch = '',
    [string]$BaseSha = ''
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$PSNativeCommandUseErrorActionPreference = $false
$Repo = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path

function Fail([string]$Message) { throw $Message }
function Invoke-Git([string[]]$Arguments) {
    $output = @(& git -C $Repo @Arguments 2>&1)
    if ($LASTEXITCODE -ne 0) { Fail ("git " + ($Arguments -join ' ') + " failed: " + ($output -join [Environment]::NewLine)) }
    return $output
}
function Test-GitRef([string]$Ref) { & git -C $Repo rev-parse --verify --quiet $Ref *> $null; return $LASTEXITCODE -eq 0 }
function Test-Ancestor([string]$Ancestor, [string]$Descendant) { & git -C $Repo merge-base --is-ancestor $Ancestor $Descendant *> $null; return $LASTEXITCODE -eq 0 }

function Resolve-VerificationBase([string]$Branch, [string]$Head) {
    $candidates = [System.Collections.Generic.List[string]]::new()
    $originBranch = "refs/remotes/origin/$Branch"
    if (Test-GitRef $originBranch) { $candidates.Add($originBranch) }
    $upstream = @(& git -C $Repo rev-parse --abbrev-ref --symbolic-full-name '@{u}' 2>$null)
    if ($LASTEXITCODE -eq 0) {
        $upstreamRef = ($upstream -join '').Trim()
        if ($upstreamRef -and -not $candidates.Contains($upstreamRef)) { $candidates.Add($upstreamRef) }
    }
    foreach ($candidateRef in $candidates) {
        $candidateSha = ((Invoke-Git @('rev-parse',$candidateRef)) -join '').Trim()
        if (Test-Ancestor $candidateSha $Head) {
            return [pscustomobject]@{
                Sha = $candidateSha
                SourceKind = 'REMOTE_TRACKING'
                Ref = $candidateRef
            }
        }
    }
    $mainRef = 'refs/remotes/origin/main'
    if (-not (Test-GitRef $mainRef)) { Fail "No usable remote-tracking base exists for '$Branch' and origin/main is unavailable. Fetch origin before verification." }
    $mergeBase = ((Invoke-Git @('merge-base',$Head,$mainRef)) -join '').Trim()
    if (-not $mergeBase) { Fail "Unable to resolve merge-base with $mainRef." }
    return [pscustomobject]@{
        Sha = $mergeBase
        SourceKind = 'MAIN_MERGE_BASE'
        Ref = $mainRef
    }
}

function Invoke-RecordedProof([string]$Name, [string[]]$Command) {
    & node (Join-Path $Repo 'tools/dev/run-ci-command.mjs') $Name '--' @Command | Out-Host
    return $LASTEXITCODE
}

$verifyClock = [Diagnostics.Stopwatch]::StartNew()
$diagnosticWork = $null
$profileWork = $null
$verificationSucceeded = $false
$verificationFailure = $null
$cleanupFailures = [System.Collections.Generic.List[string]]::new()
Push-Location $Repo
try {
    $branch = ((Invoke-Git @('branch','--show-current')) -join '').Trim()
    if ([string]::IsNullOrWhiteSpace($branch)) { Fail 'Detached HEAD is not a verifiable working branch.' }
    if ($ExpectedBranch -and $branch -ne $ExpectedBranch) { Fail "Expected branch '$ExpectedBranch', found '$branch'." }
    $head = ((Invoke-Git @('rev-parse','HEAD')) -join '').Trim()
    $status = @(Invoke-Git @('status','--porcelain=v1','--untracked-files=all'))
    if ($status.Count -gt 0) { Fail ("Candidate must be clean:" + [Environment]::NewLine + ($status -join [Environment]::NewLine)) }
    if (-not $BaseSha) {
        $resolvedBase = Resolve-VerificationBase $branch $head
        $BaseSha = $resolvedBase.Sha
        Write-Host "VERIFY_BASE_SOURCE=$($resolvedBase.SourceKind) ref=$($resolvedBase.Ref) sha=$BaseSha"
    }
    if ($BaseSha -notmatch '^[0-9a-f]{40}$') { Fail "Invalid BaseSha: $BaseSha" }
    if (-not (Test-Ancestor $BaseSha $head)) { Fail "Verification base is not an ancestor of candidate: base=$BaseSha head=$head" }

    Write-Host "VERIFY_BASE_SHA=$BaseSha"
    Write-Host "EXACT_LOCAL_CANDIDATE_SHA=$head"
    Write-Host 'VERIFY_SCOPE_AUTHORITY=NX_TASK_INPUTS_AND_AFFECTED_GRAPH'
    Write-Host 'VERIFY_OUTPUT_MODE=CAUSAL_MACHINE_DIAGNOSTIC_ON_FAILURE'

    if ((& node --version).Trim() -ne 'v24.17.0') { Fail 'Node version mismatch.' }
    if ((& pnpm --version).Trim() -ne '10.34.0') { Fail 'pnpm version mismatch.' }
    if ((& go version | Out-String).Trim() -notmatch '\bgo1\.27\.1\b') { Fail 'Go version mismatch.' }

    $diagnosticWork = Join-Path ([IO.Path]::GetTempPath()) ("samrim-local-proof-{0}" -f [guid]::NewGuid().ToString('N'))
    $profileWork = Join-Path $Repo (".nx/cache/samrim-local-proof-profiles-{0}" -f [guid]::NewGuid().ToString('N'))
    New-Item -ItemType Directory -Path $diagnosticWork -Force | Out-Null
    New-Item -ItemType Directory -Path $profileWork -Force | Out-Null
    $env:SAMRIM_CI_METRICS_PATH = Join-Path $diagnosticWork 'metrics.jsonl'
    $env:SAMRIM_CI_LOG_DIR = Join-Path $diagnosticWork 'logs'
    $env:SAMRIM_CI_PROFILE_DIR = $profileWork
    $env:CANDIDATE_SHA = $head
    $env:NX_BASE = $BaseSha
    $env:NX_HEAD = $head

    $steps = @(
        @{ Name = 'local-invariants'; Command = @('pnpm','exec','nx','run-many','-t','donor-residue','repository-structure','structural-hygiene','runtime-ownership','removed-domain-residue','cache-contracts','docs-command-parity','docs-config-parity','knowledge-system','knowledge-references','agent-contract','workspace-dependencies','go-workspace-sync','nx-project-tags','mobile-config','brand','theme-check','theme-verify','powershell-syntax','knip','compose-config','--outputStyle=static','--parallel=2','--nxBail=false') },
        @{ Name = 'local-execution-proof'; Command = @('pnpm','exec','nx','run','repository-ci:execution-proof-system','--outputStyle=static') },
        @{ Name = 'local-affected-static'; Command = @('pnpm','exec','nx','affected','-t','lint','format-check','typecheck','unit','contract','build','vet',"--base=$BaseSha","--head=$head",'--outputStyle=static','--parallel=2','--nxBail=false') }
    )

    foreach ($step in $steps) {
        $exitCode = Invoke-RecordedProof $step.Name $step.Command
        if ($exitCode -ne 0) {
            & node (Join-Path $Repo 'tools/dev/capture-ci-failure.mjs') '--kind=local-static'
            Fail "Required local proof failed: $($step.Name). Consume closure-diagnostic.json, collapse the highest provable causal roots, repair them, and rerun only invalidated evidence before unrelated material work."
        }
    }

    $endHead = ((Invoke-Git @('rev-parse','HEAD')) -join '').Trim()
    if ($endHead -ne $head) { Fail "Candidate HEAD changed during verification: before=$head after=$endHead" }
    $endStatus = @(Invoke-Git @('status','--porcelain=v1','--untracked-files=all'))
    if ($endStatus.Count -gt 0) { Fail 'Verification mutated repository state.' }
    $verificationSucceeded = $true
}
catch {
    $verificationFailure = $_
}
finally {
    $verifyClock.Stop()
    Write-Host "VERIFY_TOTAL_MS=$($verifyClock.ElapsedMilliseconds)"
    if ($diagnosticWork) {
        try {
            if (Test-Path -LiteralPath $diagnosticWork) {
                Remove-Item -LiteralPath $diagnosticWork -Recurse -Force -ErrorAction Stop
                if (Test-Path -LiteralPath $diagnosticWork) { throw "Temporary diagnostic directory remains: $diagnosticWork" }
            }
        }
        catch { $cleanupFailures.Add("diagnostic cleanup failed: $($_.Exception.Message)") }
    }
    if ($profileWork) {
        try {
            if (Test-Path -LiteralPath $profileWork) {
                Remove-Item -LiteralPath $profileWork -Recurse -Force -ErrorAction Stop
                if (Test-Path -LiteralPath $profileWork) { throw "Nx profile directory remains: $profileWork" }
            }
        }
        catch { $cleanupFailures.Add("Nx profile cleanup failed: $($_.Exception.Message)") }
    }
    try { Pop-Location }
    catch { $cleanupFailures.Add("location cleanup failed: $($_.Exception.Message)") }
}

if ($cleanupFailures.Count -gt 0) {
    $cleanupSummary = $cleanupFailures -join '; '
    if ($verificationFailure) { Fail "Verification failed: $($verificationFailure.Exception.Message); $cleanupSummary" }
    Fail $cleanupSummary
}
if ($verificationFailure) { throw $verificationFailure }
if ($verificationSucceeded) { Write-Host "VERIFY=PASS base=$BaseSha head=$head" }
