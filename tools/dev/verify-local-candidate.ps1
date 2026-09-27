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

function Test-GitRef([string]$Ref) {
    & git -C $Repo rev-parse --verify --quiet $Ref *> $null
    return $LASTEXITCODE -eq 0
}

function Test-Ancestor([string]$Ancestor, [string]$Descendant) {
    & git -C $Repo merge-base --is-ancestor $Ancestor $Descendant *> $null
    return $LASTEXITCODE -eq 0
}

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
            Write-Host "VERIFY_BASE_SOURCE=REMOTE_TRACKING ref=$candidateRef sha=$candidateSha"
            return $candidateSha
        }
    }

    $mainRef = 'refs/remotes/origin/main'
    if (-not (Test-GitRef $mainRef)) {
        Fail "No usable remote-tracking base exists for '$Branch' and origin/main is unavailable. Fetch origin before verification."
    }

    $mergeBase = ((Invoke-Git @('merge-base',$Head,$mainRef)) -join '').Trim()
    if (-not $mergeBase) { Fail "Unable to resolve merge-base with $mainRef." }
    Write-Host "VERIFY_BASE_SOURCE=MAIN_MERGE_BASE ref=$mainRef sha=$mergeBase"
    return $mergeBase
}

function Run-QuietStep([string]$Name, [scriptblock]$Action) {
    Write-Host ''
    $clock = [Diagnostics.Stopwatch]::StartNew()
    $logPath = Join-Path ([IO.Path]::GetTempPath()) ("samrim-verify-{0}.log" -f [guid]::NewGuid().ToString('N'))
    $logPrinted = $false
    try {
        $global:LASTEXITCODE = 0
        & $Action *> $logPath
        $exitCode = $LASTEXITCODE
        if ($exitCode -ne 0) {
            $clock.Stop()
            Write-Host "=== $Name FAILED ==="
            if (Test-Path $logPath) { Get-Content -Path $logPath | ForEach-Object { Write-Host $_ } }
            $logPrinted = $true
            Fail "$Name failed with exit code $exitCode"
        }

        $clock.Stop()
        $lineCount = if (Test-Path $logPath) { @(Get-Content -Path $logPath).Count } else { 0 }
        Write-Host ("VERIFY_STEP=PASS name={0} ms={1} output_lines={2}" -f ($Name -replace '\s+','_'), $clock.ElapsedMilliseconds, $lineCount)
    }
    catch {
        if ($clock.IsRunning) { $clock.Stop() }
        if (-not $logPrinted -and (Test-Path $logPath)) {
            Write-Host "=== $Name FAILED ==="
            Get-Content -Path $logPath | ForEach-Object { Write-Host $_ }
        }
        throw
    }
    finally {
        Remove-Item -Force -ErrorAction SilentlyContinue $logPath
    }
}

$verifyClock = [Diagnostics.Stopwatch]::StartNew()

Push-Location $Repo
try {
    $branch = ((Invoke-Git @('branch','--show-current')) -join '').Trim()
    if ([string]::IsNullOrWhiteSpace($branch)) { Fail 'Detached HEAD is not a verifiable working branch.' }
    if ($ExpectedBranch -and $branch -ne $ExpectedBranch) { Fail "Expected branch '$ExpectedBranch', found '$branch'." }

    $head = ((Invoke-Git @('rev-parse','HEAD')) -join '').Trim()
    $status = @(Invoke-Git @('status','--porcelain=v1','--untracked-files=all'))
    if ($status.Count -gt 0) { Fail ("Candidate must be clean:" + [Environment]::NewLine + ($status -join [Environment]::NewLine)) }

    if (-not $BaseSha) { $BaseSha = Resolve-VerificationBase $branch $head }

    if ($BaseSha -notmatch '^[0-9a-f]{40}$') { Fail "Invalid BaseSha: $BaseSha" }
    if (-not (Test-Ancestor $BaseSha $head)) { Fail "Verification base is not an ancestor of candidate: base=$BaseSha head=$head" }

    Write-Host "VERIFY_BASE_SHA=$BaseSha"
    Write-Host "EXACT_LOCAL_CANDIDATE_SHA=$head"
    Write-Host 'VERIFY_SCOPE_AUTHORITY=NX_TASK_INPUTS_AND_AFFECTED_GRAPH'
    Write-Host 'VERIFY_OUTPUT_MODE=QUIET_SUCCESS_VERBOSE_FAILURE'

    if ((& node --version).Trim() -ne 'v24.17.0') { Fail 'Node version mismatch.' }
    if ((& pnpm --version).Trim() -ne '10.34.0') { Fail 'pnpm version mismatch.' }
    if ((& go version | Out-String).Trim() -notmatch '\bgo1\.27\.1\b') { Fail 'Go version mismatch.' }

    Run-QuietStep 'Reusable workspace invariant targets' {
        pnpm exec nx run-many -t donor-residue repository-structure structural-hygiene runtime-ownership removed-domain-residue cache-contracts docs-command-parity docs-config-parity knowledge-system knowledge-references agent-contract workspace-dependencies go-workspace-sync nx-project-tags mobile-config brand theme-check theme-verify powershell-syntax knip compose-config --outputStyle=static --parallel=2
    }

    Run-QuietStep 'Execution proof system' {
        pnpm exec nx run repository-ci:execution-proof-system --outputStyle=static
    }

    Run-QuietStep 'Affected static targets' {
        pnpm exec nx affected -t lint format-check typecheck unit contract build vet --base=$BaseSha --head=$head --outputStyle=static --parallel=2
    }

    $endHead = ((Invoke-Git @('rev-parse','HEAD')) -join '').Trim()
    if ($endHead -ne $head) { Fail "Candidate HEAD changed during verification: before=$head after=$endHead" }
    $endStatus = @(Invoke-Git @('status','--porcelain=v1','--untracked-files=all'))
    if ($endStatus.Count -gt 0) { Fail 'Verification mutated repository state.' }

    Write-Host "VERIFY=PASS base=$BaseSha head=$head"
}
finally {
    $verifyClock.Stop()
    Write-Host "VERIFY_TOTAL_MS=$($verifyClock.ElapsedMilliseconds)"
    Pop-Location
}
