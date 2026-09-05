[CmdletBinding()]
param(
    [Parameter(Mandatory)]
    [string] $App,

    [switch] $ClearCache
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$RepoRoot = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
$AppRoot = Join-Path $RepoRoot ("apps\" + $App)
$PackageJson = Join-Path $AppRoot 'package.json'
$ProjectJson = Join-Path $AppRoot 'project.json'
$MobileConfig = Join-Path $AppRoot 'mobile.config.json'

foreach ($required in @($PackageJson, $ProjectJson, $MobileConfig)) {
    if (-not (Test-Path -LiteralPath $required -PathType Leaf)) {
        throw "Requested mobile host is not a discovered materialized mobile app: $required"
    }
}

$project = Get-Content -LiteralPath $ProjectJson -Raw | ConvertFrom-Json
if (@($project.tags) -notcontains 'type:app') {
    throw "$App is not tagged as type:app."
}

$package = Get-Content -LiteralPath $PackageJson -Raw | ConvertFrom-Json
$startScript = [string] $package.scripts.start
if ([string]::IsNullOrWhiteSpace($startScript)) {
    throw "$App package.json does not define scripts.start."
}

if (-not (Get-Command pnpm -ErrorAction SilentlyContinue)) {
    throw 'pnpm is required.'
}

$Unmerged = @(& git -C $RepoRoot diff --name-only --diff-filter=U)
if ($LASTEXITCODE -ne 0) {
    throw 'Unable to verify git merge state.'
}
if ($Unmerged.Count -gt 0) {
    throw ("Repository contains unresolved merge paths: " + ($Unmerged -join ', '))
}

$Args = @(
    '--dir', $AppRoot,
    'run', 'start'
)
if ($ClearCache) {
    $Args += @('--', '--clear')
}

Write-Host ("Starting " + $App + " from " + $AppRoot)
Write-Host ("Invocation source: " + $PackageJson + " scripts.start")
& pnpm @Args
exit $LASTEXITCODE
