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
    $global:LASTEXITCODE = 0
    & $Action
    if ($LASTEXITCODE -ne 0) { Fail "$Name failed with exit code $LASTEXITCODE" }
}

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

    Run-Step 'Repository structure' { node tools/dev/verify-repository-structure.mjs }
    Run-Step 'Structural hygiene' { node tools/dev/verify-structural-hygiene.mjs }
    Run-Step 'Workspace dependency references' { node tools/dev/verify-workspace-dependencies.mjs }
    Run-Step 'Nx project tags' { node tools/dev/verify-nx-project-tags.mjs }
    Run-Step 'Agent execution contract' { node tools/dev/verify-agent-knowledge-contract.mjs }

    if ($changed | Where-Object { $_ -match '^(AGENTS\.md|knowledge\.sources\.json|README\.md|CONTRIBUTING\.md|SECURITY\.md|tools/README\.md|\.github/|tools/dev/(knowledge-|query-knowledge|verify-(knowledge|doc|agent)))' }) {
        Run-Step 'Knowledge invariants' { node tools/dev/verify-knowledge-system.mjs }
        Run-Step 'Knowledge references' { node tools/dev/verify-knowledge-references.mjs }
        Run-Step 'Docs command parity' { node tools/dev/verify-doc-command-parity.mjs }
        Run-Step 'Docs configuration parity' { node tools/dev/verify-doc-config-parity.mjs }
    }

    if ($changed | Where-Object { $_ -match '^(infra/local/compose/|tools/dev/runtime\.ps1|tools/dev/open-mobile-apps\.ps1|package\.json$)' }) {
        Run-Step 'Runtime ownership' { node tools/dev/verify-local-runtime-ownership.mjs }
        Run-Step 'Canonical compose config' {
            docker compose --project-name samrim-local --env-file infra/local/compose/.env.example -f infra/local/compose/compose.yaml config --quiet
        }
    }

    if ($changed | Where-Object { $_ -match '^(apps/app-(client|partner|captain|field)/|tools/mobile/|packages/design-system/)' }) {
        Run-Step 'Mobile deployable identities' { pnpm run mobile:verify-config }
    }

    if ($changed | Where-Object { $_ -match '^(packages/design-system/|apps/.*\.(css|tsx|ts)$|tools/dev/(ts-resolver|generate-theme-css|verify-theme-authority))' }) {
        Run-Step 'Theme authority' { pnpm run theme:verify }
    }

    if ($changed | Where-Object { $_ -match '\.ps1$|\.psm1$' }) {
        Run-Step 'PowerShell syntax' { pwsh -NoProfile -ExecutionPolicy Bypass -File tools/dev/verify-powershell-syntax.ps1 }
    }

    if ($changed | Where-Object { $_ -match '^(apps/|packages/|services/|tools/).+\.(ts|tsx|js|mjs|cjs|json)$' }) {
        Run-Step 'Changed-source lint' {
            pnpm exec biome lint apps packages services tools --changed --since=$BaseSha --diagnostic-level=error
        }
    }

    if ($changed.Count -gt 0) {
        Run-Step 'Affected workspace targets' {
            pnpm exec nx affected -t typecheck,test,build,export-smoke,vet --base=$BaseSha --head=$head --outputStyle=stream
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
    Pop-Location
}
