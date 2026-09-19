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
    $shapeChanged = @(& git -C $Repo diff --diff-filter=ADRCT --name-only $BaseSha $head | ForEach-Object { $_.Trim().Replace('\','/') } | Where-Object { $_ })
    if ($LASTEXITCODE -ne 0) { Fail 'Unable to determine structural candidate delta.' }

    function Changed-Matches([string]$Pattern) {
        return @($changed | Where-Object { $_ -match $Pattern }).Count -gt 0
    }

    Write-Host "AFFECTED_CHANGED_FILES=$($changed.Count)"
    Write-Host "STRUCTURAL_PATH_MUTATIONS=$($shapeChanged.Count)"

    $topologyRelevant = (
        $shapeChanged.Count -gt 0 -or
        (Changed-Matches '^(REPOSITORY-STRUCTURE\.md|pnpm-workspace\.yaml|pnpm-lock\.yaml|go\.work|go\.work\.sum)$') -or
        (Changed-Matches '(^|/)project\.json$')
    )

    if ($topologyRelevant) {
        Run-Step 'Repository structure' { node tools/dev/verify-repository-structure.mjs }
    }

    if ($topologyRelevant -or (Changed-Matches '(^|/)package\.json$|^\.gitattributes$')) {
        Run-Step 'Structural hygiene' { node tools/dev/verify-structural-hygiene.mjs }
    }

    if (Changed-Matches '(^|/)package\.json$|^apps/.*\.(ts|tsx|js|mjs|cjs)$|^services/dsh/.*\.(go|ts|tsx|js|mjs|cjs)$') {
        Run-Step 'Workspace dependency references' { node tools/dev/verify-workspace-dependencies.mjs }
    }

    if (Changed-Matches '(^|/)project\.json$') {
        Run-Step 'Nx project tags' { node tools/dev/verify-nx-project-tags.mjs }
    }

    if (Changed-Matches '^(AGENTS\.md|REPOSITORY-STRUCTURE\.md|CLAUDE\.md|GEMINI\.md|\.github/copilot-instructions\.md|\.github/pull_request_template\.md|\.github/workflows/pr-policy\.yml|knowledge\.sources\.json|package\.json|tools/dev/(verify-local-candidate\.ps1|safe-push\.ps1|verify-agent-knowledge-contract\.mjs|verify-repository-structure\.mjs))$') {
        Run-Step 'Agent execution contract' { node tools/dev/verify-agent-knowledge-contract.mjs }
    }

    if (Changed-Matches '^(AGENTS\.md|knowledge\.sources\.json|package\.json|README\.md|CONTRIBUTING\.md|SECURITY\.md|tools/README\.md|infra/local/compose/README\.md|\.github/pull_request_template\.md|\.github/workflows/pr-policy\.yml|tools/dev/(knowledge-|query-knowledge|verify-(knowledge|doc|agent)))') {
        Run-Step 'Knowledge invariants' { node tools/dev/verify-knowledge-system.mjs }
        Run-Step 'Knowledge references' { node tools/dev/verify-knowledge-references.mjs }
        Run-Step 'Docs command parity' { node tools/dev/verify-doc-command-parity.mjs }
        Run-Step 'Docs configuration parity' { node tools/dev/verify-doc-config-parity.mjs }
    }

    if (Changed-Matches '^(AGENTS\.md|README\.md|infra/local/(?:compose/|\.env\.example$)|tools/dev/(dev\.ps1|start-surface\.mjs|verify-local-runtime-ownership\.mjs)|package\.json|apps/(?:app-(?:client|partner|captain|field)|control-panel)/package\.json) {
        Run-Step 'Runtime ownership' { node tools/dev/verify-local-runtime-ownership.mjs }
        Run-Step 'Canonical compose config' {
            docker compose --project-name samrim-local --env-file infra/local/.env.example -f infra/local/compose/compose.yaml config --quiet
        }
    }

    if (Changed-Matches '^apps/app-(client|partner|captain|field)/(mobile\.config\.json|app\.config\.ts|eas\.json|fingerprint\.config\.js|package\.json)$|^tools/mobile/verify-mobile-config\.mjs$') {
        Run-Step 'Mobile deployable identities' { pnpm run mobile:verify-config }
    }

    if (Changed-Matches '^(packages/design-system/|apps/.*\.(css|tsx|ts)$|services/identity/clients/presentation/ManagedIdentityFlow\.tsx$|tools/dev/(ts-resolver|generate-theme-css|verify-theme-authority))') {
        Run-Step 'Theme authority' { pnpm run theme:verify }
    }

    if (Changed-Matches '\.ps1$|\.psm1$') {
        Run-Step 'PowerShell syntax' { pwsh -NoProfile -ExecutionPolicy Bypass -File tools/dev/verify-powershell-syntax.ps1 }
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
        pnpm exec nx affected -t typecheck test build export-smoke vet --base=$BaseSha --head=$head --outputStyle=stream --parallel=1
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
) {
        Run-Step 'Runtime ownership' { node tools/dev/verify-local-runtime-ownership.mjs }
        Run-Step 'Canonical compose config' {
            docker compose --project-name samrim-local --env-file infra/local/.env.example -f infra/local/compose/compose.yaml config --quiet
        }
    }

    if (Changed-Matches '^apps/app-(client|partner|captain|field)/(mobile\.config\.json|app\.config\.ts|eas\.json|fingerprint\.config\.js|package\.json)$|^tools/mobile/verify-mobile-config\.mjs$') {
        Run-Step 'Mobile deployable identities' { pnpm run mobile:verify-config }
    }

    if (Changed-Matches '^(packages/design-system/|apps/.*\.(css|tsx|ts)$|services/identity/clients/presentation/ManagedIdentityFlow\.tsx$|tools/dev/(ts-resolver|generate-theme-css|verify-theme-authority))') {
        Run-Step 'Theme authority' { pnpm run theme:verify }
    }

    if (Changed-Matches '\.ps1$|\.psm1$') {
        Run-Step 'PowerShell syntax' { pwsh -NoProfile -ExecutionPolicy Bypass -File tools/dev/verify-powershell-syntax.ps1 }
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
        pnpm exec nx affected -t typecheck test build export-smoke vet --base=$BaseSha --head=$head --outputStyle=stream --parallel=1
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
