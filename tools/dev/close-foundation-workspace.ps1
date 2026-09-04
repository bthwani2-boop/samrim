#Requires -Version 7.4
[CmdletBinding()]
param(
    [string] $ExpectedBranch = "a",
    [switch] $SkipInstall,
    [switch] $SkipDockerConfig,
    [switch] $SkipWorkspaceVerify
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$repo = (Resolve-Path (Join-Path $PSScriptRoot "..\..")).Path

function Fail([string]$Message) {
    Write-Error $Message
    exit 1
}

function Run-NativeStep([string]$Name, [scriptblock]$Action) {
    Write-Host ""
    Write-Host "=== $Name ==="
    $global:LASTEXITCODE = 0
    & $Action
    if ($LASTEXITCODE -ne 0) {
        Fail "$Name failed with exit code $LASTEXITCODE"
    }
}

function Get-StatusLines {
    $lines = @(& git status --porcelain)
    if ($LASTEXITCODE -ne 0) {
        Fail "Unable to inspect Git working-tree status."
    }
    return $lines
}

Push-Location $repo
try {
    Write-Host "Repository: $repo"

    $branch = (& git branch --show-current).Trim()
    if ($LASTEXITCODE -ne 0 -or [string]::IsNullOrWhiteSpace($branch)) {
        Fail "Unable to determine current Git branch."
    }

    Write-Host "Branch: $branch"
    if ($branch -ne $ExpectedBranch) {
        Fail "Expected branch '$ExpectedBranch', found '$branch'."
    }

    $unmerged = @(& git diff --name-only --diff-filter=U)
    if ($LASTEXITCODE -ne 0) {
        Fail "Unable to inspect merge state."
    }
    if ($unmerged.Count -gt 0) {
        Fail ("Unresolved merge paths exist: " + ($unmerged -join ", "))
    }

    $initialStatus = @(Get-StatusLines)
    $unexpectedInitial = @(
        $initialStatus | Where-Object {
            $_ -notmatch '^(\?\?| M|M |A |AM|MM) pnpm-lock\.yaml$'
        }
    )

    if ($unexpectedInitial.Count -gt 0) {
        Fail ("Working tree contains changes other than resumable pnpm-lock.yaml:" +
            [Environment]::NewLine +
            ($unexpectedInitial -join [Environment]::NewLine))
    }

    if ($initialStatus.Count -gt 0) {
        Write-Host "RESUME_MODE=pnpm-lock.yaml"
    }

    $nodeVersion = (& node --version).Trim()
    if ($LASTEXITCODE -ne 0) {
        Fail "Node.js is required."
    }
    if ($nodeVersion -ne "v24.17.0") {
        Fail "Expected Node v24.17.0, found $nodeVersion."
    }

    $pnpmVersion = (& pnpm --version).Trim()
    if ($LASTEXITCODE -ne 0) {
        Fail "pnpm is required."
    }
    if ($pnpmVersion -ne "10.34.0") {
        Fail "Expected pnpm 10.34.0, found $pnpmVersion."
    }

    Run-NativeStep "Verify mobile deployable identities" {
        pnpm run mobile:verify-config
    }

    Run-NativeStep "Verify workspace dependency references" {
        node tools/dev/verify-workspace-dependencies.mjs
    }

    Write-Host ""
    Write-Host "=== Generate canonical pnpm-lock.yaml ==="
    pnpm install --lockfile-only --ignore-scripts
    if ($LASTEXITCODE -ne 0) {
        Fail "Lockfile generation failed."
    }
    if (-not (Test-Path "pnpm-lock.yaml" -PathType Leaf)) {
        Fail "pnpm-lock.yaml was not created."
    }
    Write-Host "PNPM_LOCKFILE=PASS"

    if (-not $SkipInstall) {
        Run-NativeStep "Frozen workspace install" {
            pnpm install --frozen-lockfile
        }
    }

    Run-NativeStep "Verify Go workspace declaration" {
        go work edit -json *> $null
    }

    Run-NativeStep "Nx project discovery" {
        pnpm run nx:projects
    }

    if (-not $SkipWorkspaceVerify) {
        Run-NativeStep "Workspace verification" {
            pnpm run workspace:verify
        }
    }

    if (-not $SkipDockerConfig) {
        Run-NativeStep "Foundation Docker compose config" {
            docker compose --env-file infra/local/compose/.env.example -f infra/local/compose/compose.yaml --profile foundation config *> $null
        }
    }

    $finalStatus = @(Get-StatusLines)
    $unexpectedFinal = @(
        $finalStatus | Where-Object {
            $_ -notmatch '^(\?\?| M|M |A |AM|MM) pnpm-lock\.yaml$'
        }
    )

    if ($unexpectedFinal.Count -gt 0) {
        Fail ("Verification changed tracked/untracked files other than pnpm-lock.yaml:" +
            [Environment]::NewLine +
            ($unexpectedFinal -join [Environment]::NewLine))
    }

    Write-Host ""
    Write-Host "FOUNDATION_WORKSPACE_CLOSURE=PASS"
    Write-Host "PNPM_LOCKFILE=PASS"
    Write-Host "FROZEN_INSTALL=PASS"
    Write-Host "WORKSPACE_VERIFY=PASS"
    Write-Host "GO_WORKSPACE_DECLARATION=PASS"
    Write-Host "FOUNDATION_DOCKER_CONFIG=PASS"
    Write-Host ""
    Write-Host "Next:"
    Write-Host "  git status --short"
    Write-Host "  git diff -- pnpm-lock.yaml"
    Write-Host "  git add pnpm-lock.yaml"
    Write-Host '  git commit -m "chore(workspace): establish canonical foundation lockfile"'
    Write-Host "  git push origin $branch"
}
finally {
    Pop-Location
}
