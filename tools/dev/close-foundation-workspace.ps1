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

function Run-Step([string]$Name, [scriptblock]$Action) {
    Write-Host ""
    Write-Host "=== $Name ==="
    & $Action
    if ($LASTEXITCODE -ne 0) {
        Fail "$Name failed with exit code $LASTEXITCODE"
    }
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

    $initialStatus = @(& git status --porcelain)
    if ($LASTEXITCODE -ne 0) {
        Fail "Unable to inspect Git working-tree status."
    }
    if ($initialStatus.Count -gt 0) {
        Fail ("Working tree must be clean before Foundation workspace closure:" +
            [Environment]::NewLine +
            ($initialStatus -join [Environment]::NewLine))
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

    Run-Step "Verify mobile deployable identities" {
        pnpm run mobile:verify-config
    }

    Run-Step "Verify workspace dependency references" {
        node -e @'
const fs = require("fs");
const path = require("path");

const roots = ["apps", "services", "packages"];
const manifests = [];

for (const root of roots) {
  if (!fs.existsSync(root)) continue;
  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const manifest = path.join(root, entry.name, "package.json");
    if (fs.existsSync(manifest)) manifests.push(manifest);
  }
}

const contractsManifest = path.join("contracts", "package.json");
if (fs.existsSync(contractsManifest)) manifests.push(contractsManifest);

const packages = new Map();
for (const manifest of manifests) {
  const json = JSON.parse(fs.readFileSync(manifest, "utf8"));
  if (json.name) packages.set(json.name, manifest);
}

const missing = [];
for (const manifest of manifests) {
  const json = JSON.parse(fs.readFileSync(manifest, "utf8"));
  for (const section of ["dependencies", "devDependencies", "peerDependencies", "optionalDependencies"]) {
    for (const [name, spec] of Object.entries(json[section] || {})) {
      if (typeof spec === "string" && spec.startsWith("workspace:") && !packages.has(name)) {
        missing.push(`${manifest}: ${section} -> ${name} (${spec})`);
      }
    }
  }
}

if (missing.length > 0) {
  console.error("NONEXISTENT_WORKSPACE_DEPENDENCIES:");
  for (const item of missing) console.error("  " + item);
  process.exit(1);
}

console.log("NONEXISTENT_WORKSPACE_DEPENDENCIES=0");
'@
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
        Run-Step "Frozen workspace install" {
            pnpm install --frozen-lockfile
        }
    }

    Run-Step "Go workspace sync" {
        go work sync
    }

    Run-Step "Nx project discovery" {
        pnpm run nx:projects
    }

    if (-not $SkipWorkspaceVerify) {
        Run-Step "Workspace verification" {
            pnpm run workspace:verify
        }
    }

    if (-not $SkipDockerConfig) {
        if (-not (Test-Path "infra/local/compose/.env" -PathType Leaf)) {
            Write-Host "infra/local/compose/.env is missing; running repository bootstrap prerequisites."
            & pwsh -NoProfile -ExecutionPolicy Bypass -File tools/dev/bootstrap.ps1
            if ($LASTEXITCODE -ne 0) {
                Fail "Bootstrap failed."
            }
        }

        Run-Step "Foundation Docker compose config" {
            pnpm run runtime:foundation:config
        }
    }

    $finalStatus = @(& git status --porcelain)
    if ($LASTEXITCODE -ne 0) {
        Fail "Unable to inspect final Git working-tree status."
    }

    $unexpected = @(
        $finalStatus | Where-Object {
            $_ -notmatch '^(\?\?| M|M |A |AM|MM) pnpm-lock\.yaml$'
        }
    )

    if ($unexpected.Count -gt 0) {
        Fail ("Verification changed files other than pnpm-lock.yaml:" +
            [Environment]::NewLine +
            ($unexpected -join [Environment]::NewLine))
    }

    Write-Host ""
    Write-Host "FOUNDATION_WORKSPACE_CLOSURE=PASS"
    Write-Host "pnpm-lock.yaml is generated and verified locally."
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
