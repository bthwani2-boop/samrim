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

    $changed = @(& git -C $Repo diff --name-only $BaseSha $head | ForEach-Object { $_.Trim().Replace('\','/') } | Where-Object { $_ })
    if ($LASTEXITCODE -ne 0) { Fail 'Unable to determine candidate delta.' }
    Write-Host "AFFECTED_CHANGED_FILES=$($changed.Count)"

    if ($changed.Count -gt 0) {
        Run-Step 'Workspace invariant targets' {
            pnpm exec nx run-many -t donor-residue repository-structure structural-hygiene runtime-ownership removed-domain-residue docs-command-parity docs-config-parity knowledge-system knowledge-references agent-contract workspace-dependencies nx-project-tags mobile-config brand theme-check theme-verify powershell-syntax knip --projects=workspace-tooling --outputStyle=stream --parallel=2
        }
        Run-Step 'Infrastructure invariant targets' {
            pnpm exec nx run infra:compose-config --outputStyle=stream
        }
    } else {
        Write-Host 'WORKSPACE_INVARIANT_TARGETS=SKIPPED reason=no_changes'
    }

    $changedGo = @($changed | Where-Object {
        $_ -match '\.go$' -and (Test-Path -LiteralPath (Join-Path $Repo $_) -PathType Leaf)
    })
    if ($changedGo.Count -gt 0) {
        Run-Step 'Changed Go formatting' {
            $unformatted = @(& gofmt -l @changedGo)
            if ($LASTEXITCODE -ne 0) { Fail 'gofmt inspection failed.' }
            if ($unformatted.Count -gt 0) { Fail ("Unformatted Go files:" + [Environment]::NewLine + ($unformatted -join [Environment]::NewLine)) }
        }
    }

    $changedBiome = @($changed | Where-Object {
        $_ -match '^(apps/|packages/|services/|tools/).+\.(ts|tsx|js|jsx|mjs)$' -and
        (Test-Path -LiteralPath (Join-Path $Repo $_) -PathType Leaf)
    })
    if ($changedBiome.Count -gt 0) {
        Run-Step 'Changed-source lint' {
            pnpm exec biome lint apps packages services tools --changed --since=$BaseSha --diagnostic-level=error
        }
    }

    if ($changed.Count -gt 0) {
        Run-Step 'Affected workspace targets' {
            pnpm exec nx affected -t typecheck unit contract build vet export-smoke --base=$BaseSha --head=$head --outputStyle=stream --parallel=2
        }
    } else {
        Write-Host 'AFFECTED_WORKSPACE_TARGETS=SKIPPED reason=no_changes'
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
