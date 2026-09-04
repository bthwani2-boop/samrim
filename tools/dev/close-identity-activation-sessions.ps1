#Requires -Version 7.4
[CmdletBinding()]
param(
    [string] $ExpectedBranch = "stage-b/identity-activation-sessions",
    [switch] $SkipRuntime
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$repo = (Resolve-Path (Join-Path $PSScriptRoot "..\..")).Path
$lockfile = "pnpm-lock.yaml"

function Fail([string] $Message) {
    Write-Error $Message
    exit 1
}

function Run-Step([string] $Name, [scriptblock] $Action) {
    Write-Host ""
    Write-Host "=== $Name ==="
    $global:LASTEXITCODE = 0
    & $Action
    if ($LASTEXITCODE -ne 0) {
        Fail "$Name failed with exit code $LASTEXITCODE"
    }
}

function Get-Status {
    $status = @(& git status --porcelain --untracked-files=all)
    if ($LASTEXITCODE -ne 0) {
        Fail "Unable to inspect Git status."
    }
    return $status
}

function Assert-Clean([string] $Context) {
    $status = @(Get-Status)
    if ($status.Count -gt 0) {
        Fail (
            "$Context requires a clean repository:" +
            [Environment]::NewLine +
            ($status -join [Environment]::NewLine)
        )
    }
}

function Assert-LockfileCanonicalMutation([string] $Context) {
    $status = @(Get-Status)
    $unexpected = @()

    foreach ($line in $status) {
        if ($line.Length -lt 4) {
            $unexpected += $line
            continue
        }

        $path = $line.Substring(3).Trim()
        if ($path -ne $lockfile) {
            $unexpected += $line
        }
    }

    if ($unexpected.Count -gt 0) {
        Fail (
            "$Context mutated files other than $($lockfile):" +
            [Environment]::NewLine +
            ($unexpected -join [Environment]::NewLine)
        )
    }

    if ($status.Count -eq 0) {
        Write-Host "IDENTITY_LOCKFILE_ALREADY_CURRENT=PASS"
        return
    }

    Write-Host "IDENTITY_LOCKFILE_ONLY_MUTATION=PASS"
}

function Assert-Toolchain {
    $nodeVersion = (& node --version).Trim()
    if ($LASTEXITCODE -ne 0 -or $nodeVersion -ne "v24.17.0") {
        Fail "Expected Node v24.17.0, found '$nodeVersion'."
    }

    $pnpmVersion = (& pnpm --version).Trim()
    if ($LASTEXITCODE -ne 0 -or $pnpmVersion -ne "10.34.0") {
        Fail "Expected pnpm 10.34.0, found '$pnpmVersion'."
    }

    $goVersion = (& go version | Out-String).Trim()
    if ($LASTEXITCODE -ne 0 -or $goVersion -notmatch "\bgo1\.27\.1\b") {
        Fail "Expected Go 1.27.1, found '$goVersion'."
    }

    Write-Host "IDENTITY_LOCAL_TOOLCHAIN=PASS"
}

Push-Location $repo
try {
    $branch = (& git branch --show-current).Trim()
    if ($LASTEXITCODE -ne 0 -or [string]::IsNullOrWhiteSpace($branch)) {
        Fail "Unable to determine current Git branch."
    }

    Write-Host "Repository: $repo"
    Write-Host "Branch: $branch"

    if ($branch -ne $ExpectedBranch) {
        Fail "Expected branch '$ExpectedBranch', found '$branch'."
    }

    Assert-Clean "Identity closure start"

    Run-Step "Fetch exact remote Identity candidate" {
        git fetch origin $ExpectedBranch --prune
    }

    $localHead = (& git rev-parse HEAD).Trim()
    $remoteHead = (& git rev-parse ("origin/" + $ExpectedBranch)).Trim()
    if ($LASTEXITCODE -ne 0) {
        Fail "Unable to resolve local/remote Identity candidate."
    }
    if ($localHead -ne $remoteHead) {
        Fail "Local HEAD $localHead does not match origin/$ExpectedBranch $remoteHead."
    }
    Write-Host "IDENTITY_EXACT_HEAD_SHA=$localHead"

    Assert-Toolchain

    Run-Step "Repository structure" {
        node tools/dev/verify-repository-structure.mjs
    }

    Run-Step "Structural hygiene" {
        node tools/dev/verify-structural-hygiene.mjs
    }

    Run-Step "Removed human-domain residue" {
        node tools/dev/verify-removed-human-domain-residue.mjs
    }

    Run-Step "Docs command parity" {
        node tools/dev/verify-doc-command-parity.mjs
    }

    Run-Step "Knowledge-system invariants" {
        node tools/dev/verify-knowledge-system.mjs
    }

    Run-Step "Generated Identity type provenance" {
        node tools/dev/generate-identity-types.mjs --check
    }

    Run-Step "Identity vertical boundaries" {
        node tools/dev/verify-identity-boundaries.mjs
    }

    Run-Step "Go workspace synchronization" {
        go work sync
    }
    Assert-Clean "Go workspace synchronization"

    if (-not $SkipRuntime) {
        Run-Step "Repository runtime proof before lockfile mutation" {
            pwsh -NoProfile -ExecutionPolicy Bypass -File tools/dev/close-foundation-runtime.ps1 -ExpectedBranch $ExpectedBranch -KeepRunning
        }
        Assert-Clean "Repository runtime substrate proof"

        Write-Host ""
        Write-Host "=== Identity adversarial runtime semantic proof ==="
        & node tools/dev/verify-identity-runtime.mjs --env-file=infra/local/compose/.env
        $semanticCode = $LASTEXITCODE
        if ($semanticCode -ne 0) {
            Fail "Identity runtime semantic proof failed. The compose stack was left running for diagnosis."
        }

        Run-Step "Stop repository runtime after semantic proof" {
            docker compose --env-file infra/local/compose/.env -f infra/local/compose/compose.yaml --profile foundation down
        }

        Assert-Clean "Identity runtime semantic proof"
        Write-Host "IDENTITY_RUNTIME_SUBSTRATE=PASS"
        Write-Host "IDENTITY_RUNTIME_SEMANTICS=PASS"
    }

    Run-Step "Generate canonical workspace lockfile" {
        pnpm install --lockfile-only
    }

    Assert-LockfileCanonicalMutation "Lockfile generation"

    Run-Step "Frozen workspace install against generated lockfile" {
        pnpm install --frozen-lockfile
    }

    Assert-LockfileCanonicalMutation "Frozen workspace install"

    Run-Step "Mobile deployable identity configuration" {
        pnpm run mobile:verify-config
    }

    Run-Step "Workspace dependency references" {
        node tools/dev/verify-workspace-dependencies.mjs
    }

    Run-Step "Nx project tags" {
        pnpm run nx:verify-tags
    }

    Run-Step "Generated Identity type drift after install" {
        node tools/dev/generate-identity-types.mjs --check
    }

    Run-Step "Identity vertical boundaries after install" {
        node tools/dev/verify-identity-boundaries.mjs
    }

    foreach ($app in @("app-client", "app-partner", "app-captain", "app-field")) {
        Run-Step "Resolve Expo config: $app" {
            pnpm --dir (Join-Path $repo ("apps\" + $app)) exec expo config --type public --json *> $null
        }
    }

    Run-Step "Workspace verification" {
        pnpm run workspace:verify
    }

    Run-Step "Repository compose configuration" {
        docker compose --env-file infra/local/compose/.env.example -f infra/local/compose/compose.yaml --profile foundation config *> $null
    }

    Assert-LockfileCanonicalMutation "Identity closure completion"

    Write-Host ""
    Write-Host "IDENTITY_LOCAL_PRECOMMIT=PASS"
    Write-Host "IDENTITY_GENERATED_TYPES=PASS"
    Write-Host "IDENTITY_BOUNDARY_VERIFY=PASS"
    Write-Host "IDENTITY_GO_WORKSPACE=PASS"
    Write-Host "IDENTITY_FROZEN_INSTALL=PASS"
    Write-Host "IDENTITY_WORKSPACE_VERIFY=PASS"
    if (-not $SkipRuntime) {
        Write-Host "IDENTITY_RUNTIME_SUBSTRATE=PASS"
    }
    Write-Host "IDENTITY_LOCKFILE_READY=PASS"
    Write-Host ""
    $finalStatus = @(Get-Status)
    if ($finalStatus.Count -eq 0) {
        Write-Host "Repository is clean; no lockfile commit is required."
    }
    else {
        Write-Host "Only pnpm-lock.yaml is dirty. Commit and push that file only."
    }
}
finally {
    Pop-Location
}
