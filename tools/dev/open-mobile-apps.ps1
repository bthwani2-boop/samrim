#Requires -Version 7.4
[CmdletBinding()]
param(
    [Parameter(Mandatory)]
    [ValidateSet('app-client','app-partner','app-captain','app-field')]
    [string]$App
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$PSNativeCommandUseErrorActionPreference = $false

if (-not $IsWindows) { throw 'The canonical daily Expo/Metro development runtime is Windows-hosted.' }

$RepoRoot = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
$EnvPath = Join-Path $RepoRoot 'infra\local\.env'
$RuntimePath = Join-Path $PSScriptRoot 'runtime.ps1'
$DevicePolicyPath = Join-Path $PSScriptRoot 'device-policy.psm1'

function Fail([string]$Message) { throw $Message }

function Read-EnvMap([string]$Path) {
    if (-not (Test-Path -LiteralPath $Path -PathType Leaf)) { Fail "RUNTIME_NOT_READY reason=missing_environment path=$Path run=pnpm_runtime:up" }
    $map=@{}
    foreach ($line in Get-Content -LiteralPath $Path) {
        $trim=$line.Trim()
        if (-not $trim -or $trim.StartsWith('#')) { continue }
        $parts=$trim.Split('=',2)
        if ($parts.Count -ne 2 -or $map.ContainsKey($parts[0].Trim())) { Fail 'RUNTIME_NOT_READY reason=invalid_environment' }
        $map[$parts[0].Trim()]=$parts[1].Trim()
    }
    if ($map['BTHWANI_ENV'] -ne 'development') { Fail 'RUNTIME_NOT_READY reason=environment_must_be_development' }
    return $map
}

function Require([hashtable]$Map,[string]$Name) {
    $value=[string]$Map[$Name]
    if ([string]::IsNullOrWhiteSpace($value)) { Fail "RUNTIME_NOT_READY reason=missing_environment_value name=$Name" }
    return $value
}

function Require-Port([hashtable]$Map,[string]$Name) {
    $port=0
    if (-not [int]::TryParse((Require $Map $Name),[ref]$port) -or $port -lt 1 -or $port -gt 65535) { Fail "RUNTIME_NOT_READY reason=invalid_port name=$Name" }
    return $port
}

function Read-AppConfig([string]$AppName) {
    $path=Join-Path $RepoRoot "apps\$AppName\mobile.config.json"
    if (-not (Test-Path -LiteralPath $path -PathType Leaf)) { Fail "APP_CONFIG_MISSING app=$AppName" }
    $config=Get-Content -LiteralPath $path -Raw | ConvertFrom-Json
    if ([string]::IsNullOrWhiteSpace([string]$config.scheme) -or [string]::IsNullOrWhiteSpace([string]$config.androidPackage)) { Fail "APP_CONFIG_INVALID app=$AppName" }
    return $config
}

& pwsh -NoProfile -ExecutionPolicy Bypass -File $RuntimePath -Action Doctor
if ($LASTEXITCODE -ne 0) { Fail 'RUNTIME_NOT_READY reason=backend_doctor_failed run=pnpm_runtime:up' }

$map=Read-EnvMap $EnvPath
$config=Read-AppConfig $App
$portKey="SAMRIM_$($App.Replace('-','_').ToUpperInvariant())_METRO_PORT"
$metroPort=Require-Port $map $portKey
$identityPort=Require-Port $map 'SAMRIM_IDENTITY_PORT'
$dshPort=Require-Port $map 'SAMRIM_DSH_PORT'

Import-Module -Name $DevicePolicyPath -Force -WarningAction SilentlyContinue
$device=Prepare-CanonicalAdbDevice -EnvPath $EnvPath -Ports @($identityPort,$dshPort)

$installed=((& adb -s ([string]$device.Serial) shell pm path ([string]$config.androidPackage) 2>$null | Out-String).Trim())
if ($LASTEXITCODE -ne 0 -or -not $installed) { Fail "APP_NOT_INSTALLED package=$($config.androidPackage)" }

$env:NODE_ENV='development'
$env:BTHWANI_ENV='development'
$env:EXPO_NO_TELEMETRY='1'
$existingNodeOptions=[string]$env:NODE_OPTIONS
if ($existingNodeOptions -notmatch '(?:^|\s)--dns-result-order=ipv4first(?:\s|$)') {
    $env:NODE_OPTIONS=(($existingNodeOptions + ' --dns-result-order=ipv4first').Trim())
}
$env:EXPO_PUBLIC_IDENTITY_API_URL=Require $map 'EXPO_PUBLIC_IDENTITY_API_URL'
$env:EXPO_PUBLIC_DSH_API_URL=Require $map 'EXPO_PUBLIC_DSH_API_URL'
$env:ANDROID_SERIAL=[string]$device.Serial

Write-Host "MOBILE_RUNTIME=EXPO_DIRECT app=$App device=$($device.Serial) metro=http://127.0.0.1:$metroPort"
Push-Location $RepoRoot
try {
    & pnpm --dir "apps/$App" exec expo start --dev-client --localhost --android --scheme ([string]$config.scheme) --port $metroPort
    exit $LASTEXITCODE
}
finally {
    Pop-Location
}
