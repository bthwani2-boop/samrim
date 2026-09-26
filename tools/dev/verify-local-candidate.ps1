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

function Run-Step([string]$Name, [scriptblock]$Action) {
    Write-Host ''
    Write-Host "=== $Name ==="
    $clock = [Diagnostics.Stopwatch]::StartNew()
    try {
        $global:LASTEXITCODE = 0
        & $Action
        if ($LASTEXITCODE -ne 0) { Fail "$Name failed with exit code $LASTEXITCODE" }
    }
    finally {
        $clock.Stop()
        Write-Host ("VERIFY_STEP_MS name={0} ms={1}" -f ($Name -replace '\s+','_'), $clock.ElapsedMilliseconds)
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

    if (-not $BaseSha) {
        & git -C $Repo rev-parse 'HEAD^' *> $null
        $BaseSha = if ($LASTEXITCODE -eq 0) { ((Invoke-Git @('rev-parse','HEAD^')) -join '').Trim() } else { $head }
    }

    if ($BaseSha -notmatch '^[0-9a-f]{40}$') { Fail "Invalid BaseSha: $BaseSha" }
    & git -C $Repo merge-base --is-ancestor $BaseSha $head
    if ($LASTEXITCODE -ne 0) { Fail "Verification base is not an ancestor of candidate: base=$BaseSha head=$head" }

    Write-Host "VERIFY_BASE_SHA=$BaseSha"
    Write-Host "EXACT_LOCAL_CANDIDATE_SHA=$head"

    if ((& node --version).Trim() -ne 'v24.17.0') { Fail 'Node version mismatch.' }
    if ((& pnpm --version).Trim() -ne '10.34.0') { Fail 'pnpm version mismatch.' }
    if ((& go version | Out-String).Trim() -notmatch '\bgo1\.27\.1\b') { Fail 'Go version mismatch.' }

    Run-Step 'Workspace invariant targets' {
        pnpm exec nx run-many -t donor-residue repository-structure structural-hygiene runtime-ownership removed-domain-residue cache-contracts sandbox-readiness docs-command-parity docs-config-parity knowledge-system knowledge-references agent-contract workspace-dependencies nx-project-tags mobile-config brand theme-check theme-verify powershell-syntax knip --projects=workspace-tooling --outputStyle=stream --parallel=2
    }

    Run-Step 'Developer tooling lint target' {
        pnpm exec nx run workspace-tooling:lint --outputStyle=stream
    }

    Run-Step 'Execution proof system' {
        pnpm exec nx run repository-ci:execution-proof-system --outputStyle=stream
    }

    Run-Step 'Infrastructure invariant targets' {
        pnpm exec nx run infra:compose-config --outputStyle=stream
    }

    Run-Step 'Affected static targets' {
        pnpm exec nx affected -t lint format-check typecheck unit contract build vet export-smoke --base=$BaseSha --head=$head --outputStyle=stream --parallel=2
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
