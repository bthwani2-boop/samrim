#Requires -Version 7.4
[CmdletBinding()]
param(
    [switch]$Candidate,
    [string]$BaseSha = ''
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$Repo = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
Push-Location $Repo
try {
    $governanceOnlyPattern = '^(AGENTS\.md|README\.md|REPOSITORY-STRUCTURE\.md|SECURITY\.md|CONTRIBUTING\.md|CLAUDE\.md|GEMINI\.md|knowledge\.sources\.json|\.github/pull_request_template\.md|apps/control-panel/(DESIGN|UX-CONTRACT)\.md|packages/design-system/README\.md|docs/(governance|reference/competitors)/.*|tools/governance/.*)$'
    if ($Candidate) {
        $branch = (git branch --show-current).Trim()
        if ($LASTEXITCODE -ne 0 -or -not $branch) { throw 'Candidate verification requires a named branch.' }
        $status = @(git status --porcelain=v1 --untracked-files=all)
        if ($LASTEXITCODE -ne 0 -or $status.Count -gt 0) { throw "Candidate must be clean.`n$($status -join [Environment]::NewLine)" }
        $head = (git rev-parse HEAD).Trim()
        if ($LASTEXITCODE -ne 0) { throw 'Unable to resolve candidate HEAD.' }
        if (-not $BaseSha) {
            git rev-parse --verify --quiet "refs/remotes/origin/$branch" *> $null
            if ($LASTEXITCODE -eq 0) {
                $BaseSha = (git rev-parse "refs/remotes/origin/$branch").Trim()
                git merge-base --is-ancestor $BaseSha $head *> $null
                if ($LASTEXITCODE -ne 0) { throw 'Remote branch is not an ancestor of candidate HEAD.' }
            }
            else {
                git rev-parse --verify --quiet refs/remotes/origin/main *> $null
                if ($LASTEXITCODE -ne 0) { throw 'Fetch origin/main before verifying this candidate.' }
                $BaseSha = (git merge-base $head refs/remotes/origin/main).Trim()
            }
        }
        $env:NX_HEAD = $head
        $env:NX_NO_CLOUD = 'true'
        $governanceBase = $BaseSha
        if ($governanceBase -eq $head) {
            git rev-parse --verify --quiet refs/remotes/origin/main *> $null
            if ($LASTEXITCODE -eq 0) {
                $governanceBase = (git merge-base $head refs/remotes/origin/main).Trim()
                if ($LASTEXITCODE -ne 0) { throw 'Unable to resolve governance candidate comparison base.' }
            }
        }
        $env:NX_BASE = $governanceBase
        Write-Host "VERIFY_SCOPE base=$governanceBase head=$head runtime=off cloud=off"
        $candidateFiles = @(git diff --name-only $governanceBase $head -- | ForEach-Object { ([string]$_).Trim().Replace('\','/') } | Where-Object { $_ })
        if ($LASTEXITCODE -ne 0) { throw 'Unable to inspect candidate governance scope.' }
        node tools/dev/check-encoding.mjs --base $governanceBase
        if ($LASTEXITCODE -ne 0) { throw 'Candidate UTF-8 integrity check failed.' }
        node tools/dev/check-typescript-ast-tests.mjs
        if ($LASTEXITCODE -ne 0) { throw 'Candidate TypeScript AST regression tests failed.' }
        node --test packages/push-device/src/push-device.test.mjs packages/push-device/src/alert-tone.test.mjs
        if ($LASTEXITCODE -ne 0) { throw 'Candidate native notification regression tests failed.' }
        node --test tools/governance/check-service-import-boundaries.test.mjs
        if ($LASTEXITCODE -ne 0) { throw 'Candidate service import boundary tests failed.' }
        node tools/governance/check-service-import-boundaries.mjs
        if ($LASTEXITCODE -ne 0) { throw 'Candidate service import boundaries failed.' }
        node --test apps/control-panel/tests/finance-operator-recovery-scope.test.mjs
        if ($LASTEXITCODE -ne 0) { throw 'Candidate finance operator recovery isolation failed.' }
        node --test tools/mobile/check-actor-scoped-navigation.test.mjs
        if ($LASTEXITCODE -ne 0) { throw 'Candidate mobile actor-scoped navigation failed.' }
        node --test apps/app-client/src/features/cart-checkout/fulfillment-choice-session.test.mjs
        if ($LASTEXITCODE -ne 0) { throw 'Candidate customer fulfillment actor isolation failed.' }
        node --test tools/mobile/check-client-partner-native-contract.test.mjs
        if ($LASTEXITCODE -ne 0) { throw 'Candidate client/partner native contract check failed.' }
        node --test tools/mobile/check-captain-field-native-scope.test.mjs
        if ($LASTEXITCODE -ne 0) { throw 'Candidate captain/field native permission scope failed.' }
        node --test tools/mobile/check-eas-offline-plan.test.mjs
        if ($LASTEXITCODE -ne 0) { throw 'Candidate EAS offline plan contract failed.' }
        if (@($candidateFiles | Where-Object { $_ -notmatch $governanceOnlyPattern }).Count -gt 0) {
            pnpm exec nx affected -t lint format-check typecheck contract build vet export-smoke --base=$governanceBase --head=$head --outputStyle=static --parallel=2 --nxBail=true
            if ($LASTEXITCODE -ne 0) { throw "VERIFY=FAIL exit=$LASTEXITCODE" }
        }
        else { Write-Host 'VERIFY_SCOPE=governance-only; Nx implementation checks not affected' }
        if (@($candidateFiles | Where-Object { $_ -match $governanceOnlyPattern }).Count -gt 0) {
            node tools/governance/verify-governance.mjs
            if ($LASTEXITCODE -ne 0) { throw 'Candidate governance integrity check failed.' }
        }
        if ((git rev-parse HEAD).Trim() -ne $head -or @(git status --porcelain=v1 --untracked-files=all).Count -gt 0) {
            throw 'Candidate changed during verification.'
        }
        Write-Host "VERIFY=PASS base=$governanceBase head=$head"
        return
    }

    $files = @(
        @(
            git diff --name-only HEAD --
            git ls-files --others --exclude-standard --
        ) | ForEach-Object { ([string]$_).Trim().Replace('\','/') } | Where-Object { $_ } | Sort-Object -Unique
    )

    if ($files.Count -eq 0) {
        Write-Host 'LOCAL_CHECK=PASS scope=no-working-tree-changes'
        return
    }

    node tools/dev/check-encoding.mjs
    if ($LASTEXITCODE -ne 0) { throw 'Local UTF-8 integrity check failed.' }
    node tools/dev/check-typescript-ast-tests.mjs
    if ($LASTEXITCODE -ne 0) { throw 'Local TypeScript AST regression tests failed.' }
    node --test packages/push-device/src/push-device.test.mjs packages/push-device/src/alert-tone.test.mjs
    if ($LASTEXITCODE -ne 0) { throw 'Local native notification regression tests failed.' }
    node --test tools/governance/check-service-import-boundaries.test.mjs
    if ($LASTEXITCODE -ne 0) { throw 'Local service import boundary tests failed.' }
    node tools/governance/check-service-import-boundaries.mjs
    if ($LASTEXITCODE -ne 0) { throw 'Local service import boundaries failed.' }
    node --test apps/control-panel/tests/finance-operator-recovery-scope.test.mjs
    if ($LASTEXITCODE -ne 0) { throw 'Local finance operator recovery isolation failed.' }
    node --test tools/mobile/check-actor-scoped-navigation.test.mjs
    if ($LASTEXITCODE -ne 0) { throw 'Local mobile actor-scoped navigation failed.' }
    node --test apps/app-client/src/features/cart-checkout/fulfillment-choice-session.test.mjs
    if ($LASTEXITCODE -ne 0) { throw 'Local customer fulfillment actor isolation failed.' }
    node --test tools/mobile/check-client-partner-native-contract.test.mjs
    if ($LASTEXITCODE -ne 0) { throw 'Local client/partner native contract check failed.' }
    node --test tools/mobile/check-captain-field-native-scope.test.mjs
    if ($LASTEXITCODE -ne 0) { throw 'Local captain/field native permission scope failed.' }
    node --test tools/mobile/check-eas-offline-plan.test.mjs
    if ($LASTEXITCODE -ne 0) { throw 'Local EAS offline plan contract failed.' }

    $env:NX_NO_CLOUD = 'true'

    if (@($files | Where-Object { $_ -match '^(tools/(dev|governance)/|biome\.jsonc?$)' }).Count -gt 0) {
        pnpm exec biome lint tools/dev tools/governance --diagnostic-level=error
        if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
    }

    if (@($files | Where-Object { $_ -match '\.(ps1|psm1|psd1)$' }).Count -gt 0) {
        pwsh -NoProfile -ExecutionPolicy Bypass -File tools/powershell/verify-syntax.ps1
        if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
    }

    $governanceChanged = @($files | Where-Object { $_ -match $governanceOnlyPattern }).Count -gt 0
    if ($governanceChanged) {
        node tools/governance/verify-governance.mjs
        if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
    }

    if (@($files | Where-Object { $_ -notmatch $governanceOnlyPattern }).Count -eq 0) {
        Write-Host "LOCAL_CHECK=PASS scope=governance-only files=$($files.Count)"
        return
    }

    $affectedProjectJson = pnpm exec nx show projects --affected --base=HEAD --json
    if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
    $affectedProjects = @($affectedProjectJson | ConvertFrom-Json)
    if ($affectedProjects.Count -eq 0) {
        Write-Host "LOCAL_CHECK=PASS files=$($files.Count) projects=0"
        return
    }
    $projectsArg = $affectedProjects -join ','
    pnpm exec nx run-many -t lint format-check typecheck contract vet --projects=$projectsArg --outputStyle=static --parallel=2 --nxBail=true
    if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
    Write-Host "LOCAL_CHECK=PASS files=$($files.Count)"
}
finally {
    Pop-Location
}
