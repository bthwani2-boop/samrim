#Requires -Version 7.4
[CmdletBinding()]
param()

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$PSNativeCommandUseErrorActionPreference = $false

if (-not $IsWindows) { throw 'The canonical daily Control Panel development runtime is Windows-hosted.' }

$RepoRoot=(Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
$EnvPath=Join-Path $RepoRoot 'infra\local\.env'

function Fail([string]$Message) { throw $Message }

function Read-EnvMap {
    if (-not (Test-Path -LiteralPath $EnvPath -PathType Leaf)) { Fail 'RUNTIME_NOT_READY run=pnpm_runtime:up reason=missing_env' }
    $map=@{}
    foreach ($line in Get-Content -LiteralPath $EnvPath) {
        $trim=$line.Trim()
        if (-not $trim -or $trim.StartsWith('#')) { continue }
        $parts=$trim.Split('=',2)
        if ($parts.Count -ne 2) { Fail 'RUNTIME_NOT_READY reason=invalid_env' }
        $map[$parts[0].Trim()]=$parts[1].Trim()
    }
    return $map
}

function Require([hashtable]$Map,[string]$Name) {
    $value=[string]$Map[$Name]
    if ([string]::IsNullOrWhiteSpace($value)) { Fail "RUNTIME_NOT_READY reason=missing_$Name" }
    return $value
}

function Test-Http([string]$Url,[int]$ExpectedStatus=200) {
    $response=$null
    $client=[Net.Http.HttpClient]::new()
    $client.Timeout=[TimeSpan]::FromSeconds(1)
    try {
        $response=$client.GetAsync($Url).GetAwaiter().GetResult()
        return ([int]$response.StatusCode -eq $ExpectedStatus)
    } catch {
        return $false
    } finally {
        if ($null -ne $response) { $response.Dispose() }
        $client.Dispose()
    }
}

function Assert-BackendReady([int]$IdentityPort,[int]$DshPort) {
    if (-not (Test-Http "http://127.0.0.1:$IdentityPort/identity/health" 200)) { Fail 'RUNTIME_NOT_READY service=identity run=pnpm_runtime:up' }
    if (-not (Test-Http "http://127.0.0.1:$DshPort/dsh/health" 200)) { Fail 'RUNTIME_NOT_READY service=dsh run=pnpm_runtime:up' }
}

$map=Read-EnvMap
$port=[int](Require $map 'SAMRIM_CONTROL_PORT')
$publicOrigin=Require $map 'CONTROL_PANEL_PUBLIC_ORIGIN'
if ($publicOrigin -ne "http://localhost:$port") { Fail 'RUNTIME_NOT_READY reason=control_origin_must_be_localhost' }

if (Test-Http "http://127.0.0.1:$port/api/auth/session" 200) {
    Write-Host "CONTROL_PANEL_REUSE=PASS url=$publicOrigin"
    return
}
if (@(Get-NetTCPConnection -State Listen -LocalPort $port -ErrorAction SilentlyContinue).Count -gt 0) {
    Fail "CONTROL_PORT_IN_USE port=$port"
}

$identityPort=[int](Require $map 'SAMRIM_IDENTITY_PORT')
$dshPort=[int](Require $map 'SAMRIM_DSH_PORT')
Assert-BackendReady -IdentityPort $identityPort -DshPort $dshPort

$env:NODE_ENV='development'
$env:BTHWANI_ENV='development'
$env:NEXT_TELEMETRY_DISABLED='1'
$env:NEXT_PRIVATE_DISABLE_DEV_OVERLAY_UX='1'
$env:CONTROL_PANEL_PUBLIC_ORIGIN=$publicOrigin
$env:IDENTITY_API_BASE_URL=Require $map 'IDENTITY_API_BASE_URL'
$env:DSH_API_BASE_URL=Require $map 'DSH_API_BASE_URL'
$env:CONTROL_PANEL_SERVICE_TOKEN=Require $map 'CONTROL_PANEL_SERVICE_TOKEN'

Write-Host "CONTROL_PANEL_HOST=START url=$publicOrigin bind=127.0.0.1:$port"
Push-Location $RepoRoot
try {
    & pnpm --dir apps/control-panel exec next dev -H 127.0.0.1 -p $port
    exit $LASTEXITCODE
}
finally {
    Pop-Location
}
