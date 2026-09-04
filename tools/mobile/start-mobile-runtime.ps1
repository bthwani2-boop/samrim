[CmdletBinding()]
param(
    [Parameter(Mandatory)]
    [ValidateSet('app-client', 'app-partner', 'app-captain', 'app-field')]
    [string] $App,

    [switch] $ClearCache
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$RepoRoot = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
$AppRoot = Join-Path $RepoRoot ("apps\" + $App)
$PackageJson = Join-Path $AppRoot 'package.json'

if (-not (Test-Path -LiteralPath $PackageJson -PathType Leaf)) {
    throw "Mobile host is not materialized yet: $PackageJson"
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

$Ports = @{
    'app-client' = 18101
    'app-partner' = 18102
    'app-captain' = 18103
    'app-field' = 18104
}

$env:BTHWANI_IDENTITY_API_HOST_PORT = '18082'
$env:IDENTITY_API_BASE_URL = 'http://127.0.0.1:18082'

$Args = @(
    '--dir', $AppRoot,
    'exec', 'expo', 'start',
    '--dev-client',
    '--port', [string]$Ports[$App]
)
if ($ClearCache) {
    $Args += '--clear'
}

Write-Host ("Starting " + $App + " from " + $AppRoot)
Write-Host ("Metro port: " + [string]$Ports[$App])
& pnpm @Args
exit $LASTEXITCODE
