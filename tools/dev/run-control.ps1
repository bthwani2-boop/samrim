#Requires -Version 7.4
[CmdletBinding()]
param()

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$PSNativeCommandUseErrorActionPreference = $false

if (-not $IsWindows) { throw 'The canonical daily Control Panel development runtime is Windows-hosted.' }

$RepoRoot = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
$EnvPath = Join-Path $RepoRoot 'infra\local\.env'
$RuntimePath = Join-Path $PSScriptRoot 'runtime.ps1'

function Read-EnvMap([string]$Path) {
    if (-not (Test-Path -LiteralPath $Path -PathType Leaf)) { throw "RUNTIME_NOT_READY reason=missing_environment path=$Path run=pnpm_runtime:up" }
    $map=@{}
    foreach ($line in Get-Content -LiteralPath $Path) {
        $trim=$line.Trim()
        if (-not $trim -or $trim.StartsWith('#')) { continue }
        $parts=$trim.Split('=',2)
        if ($parts.Count -ne 2 -or $map.ContainsKey($parts[0].Trim())) { throw 'RUNTIME_NOT_READY reason=invalid_environment' }
        $map[$parts[0].Trim()]=$parts[1].Trim()
    }
    if ($map['BTHWANI_ENV'] -ne 'development') { throw 'RUNTIME_NOT_READY reason=environment_must_be_development' }
    return $map
}

function Require([hashtable]$Map,[string]$Name) {
    $value=[string]$Map[$Name]
    if ([string]::IsNullOrWhiteSpace($value)) { throw "RUNTIME_NOT_READY reason=missing_environment_value name=$Name" }
    return $value
}

function Ready([int]$Port) {
    $r=$null
    $client=[Net.Http.HttpClient]::new(); $client.Timeout=[TimeSpan]::FromSeconds(1)
    try { $r=$client.GetAsync("http://127.0.0.1:$Port/").GetAwaiter().GetResult(); return ([int]$r.StatusCode -ge 200 -and [int]$r.StatusCode -lt 500) }
    catch { return $false }
    finally { if ($null -ne $r) { $r.Dispose() }; $client.Dispose() }
}

& pwsh -NoProfile -ExecutionPolicy Bypass -File $RuntimePath -Action Doctor
if ($LASTEXITCODE -ne 0) { throw 'RUNTIME_NOT_READY reason=backend_doctor_failed run=pnpm_runtime:up' }

$map=Read-EnvMap $EnvPath
$port=0
if (-not [int]::TryParse((Require $map 'SAMRIM_CONTROL_PORT'),[ref]$port)) { throw 'RUNTIME_NOT_READY reason=invalid_control_port' }
$publicOrigin=Require $map 'CONTROL_PANEL_PUBLIC_ORIGIN'
$publicUri=$null
if (-not [Uri]::TryCreate($publicOrigin,[UriKind]::Absolute,[ref]$publicUri) -or $publicUri.Scheme -ne 'http' -or $publicUri.Host -ne 'localhost' -or $publicUri.Port -ne $port) { throw 'RUNTIME_NOT_READY reason=invalid_control_public_origin expected=http://localhost:<control-port>' }
if (Ready $port) { Write-Host "CONTROL_PANEL_REUSE=PASS url=$publicOrigin"; return }

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
} finally { Pop-Location }
