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

$RepoRoot=(Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
$EnvPath=Join-Path $RepoRoot 'infra\local\.env'
$DevicePath=Join-Path $PSScriptRoot 'device-policy.psm1'

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

function Require-Port([hashtable]$Map,[string]$Name) {
    $port=0
    if (-not [int]::TryParse((Require $Map $Name),[ref]$port) -or $port -lt 1 -or $port -gt 65535) {
        Fail "RUNTIME_NOT_READY reason=invalid_$Name"
    }
    return $port
}

function Test-Http([string]$Url) {
    $response=$null
    $client=[Net.Http.HttpClient]::new()
    $client.Timeout=[TimeSpan]::FromSeconds(1)
    try {
        $response=$client.GetAsync($Url).GetAwaiter().GetResult()
        return ([int]$response.StatusCode -ge 200 -and [int]$response.StatusCode -lt 300)
    } catch {
        return $false
    } finally {
        if ($null -ne $response) { $response.Dispose() }
        $client.Dispose()
    }
}

function Assert-BackendReady([int]$IdentityPort,[int]$DshPort) {
    if (-not (Test-Http "http://127.0.0.1:$IdentityPort/identity/health")) { Fail 'RUNTIME_NOT_READY service=identity run=pnpm_runtime:up' }
    if (-not (Test-Http "http://127.0.0.1:$DshPort/dsh/health")) { Fail 'RUNTIME_NOT_READY service=dsh run=pnpm_runtime:up' }
}

function Read-AppConfig {
    $path=Join-Path $RepoRoot "apps\$App\mobile.config.json"
    if (-not (Test-Path -LiteralPath $path -PathType Leaf)) { Fail "APP_CONFIG_MISSING app=$App" }
    return Get-Content -LiteralPath $path -Raw | ConvertFrom-Json
}

function Get-MetroState([int]$Port) {
    $listeners=@(Get-NetTCPConnection -State Listen -LocalPort $Port -ErrorAction SilentlyContinue)
    if ($listeners.Count -eq 0) { return [pscustomobject]@{ State='FREE'; ProcessIds=@() } }

    $appRoot=Join-Path $RepoRoot "apps\$App"
    $ids=[System.Collections.Generic.HashSet[int]]::new()
    foreach ($listener in $listeners) {
        $ownerProcessId=[int]$listener.OwningProcess
        $process=Get-CimInstance Win32_Process -Filter "ProcessId=$ownerProcessId" -ErrorAction SilentlyContinue
        if ($null -eq $process) { Fail "METRO_PORT_IN_USE app=$App port=$Port reason=unknown_owner" }
        $command=[string]$process.CommandLine
        $sameApp=(
            $process.Name -match '^node(?:\.exe)?$' -and
            $command.Contains($appRoot,[StringComparison]::OrdinalIgnoreCase) -and
            $command.Contains('expo',[StringComparison]::OrdinalIgnoreCase) -and
            $command.Contains('start',[StringComparison]::OrdinalIgnoreCase) -and
            $command.Contains([string]$Port,[StringComparison]::Ordinal)
        )
        if (-not $sameApp) { Fail "METRO_PORT_IN_USE app=$App port=$Port pid=$ownerProcessId" }
        $null=$ids.Add($ownerProcessId)
    }

    if (
        $listeners.Count -eq 1 -and
        $listeners[0].LocalAddress -eq '127.0.0.1' -and
        (Test-Http "http://127.0.0.1:$Port/status")
    ) {
        return [pscustomobject]@{ State='HEALTHY'; ProcessIds=@($ids) }
    }
    return [pscustomobject]@{ State='STALE'; ProcessIds=@($ids) }
}

function Remove-StaleMetro([int]$Port,[int[]]$ProcessIds) {
    foreach ($ownerProcessId in @($ProcessIds | Sort-Object -Unique)) {
        Stop-Process -Id $ownerProcessId -Force -ErrorAction SilentlyContinue
        Write-Host "METRO_STALE_PROCESS=REMOVED app=$App port=$Port pid=$ownerProcessId"
    }
    $deadline=[DateTime]::UtcNow.AddSeconds(5)
    while ([DateTime]::UtcNow -lt $deadline) {
        if (@(Get-NetTCPConnection -State Listen -LocalPort $Port -ErrorAction SilentlyContinue).Count -eq 0) { return }
        Start-Sleep -Milliseconds 100
    }
    Fail "METRO_PORT_IN_USE app=$App port=$Port reason=stale_process_not_released"
}

function Open-DevelopmentClient([string]$Serial,$Config,[int]$Port) {
    $serverUrl="http://127.0.0.1:$Port"
    $launchUrl="$([string]$Config.scheme)://expo-development-client/?url=$([Uri]::EscapeDataString($serverUrl))"
    & adb -s $Serial shell am start -a android.intent.action.VIEW -d $launchUrl -p ([string]$Config.androidPackage) *> $null
    if ($LASTEXITCODE -ne 0) { Fail "APP_NOT_READY app=$App reason=development_build_missing_or_unopenable" }
    Write-Host "MOBILE_OPEN=PASS app=$App metro=$serverUrl"
}

$map=Read-EnvMap
$config=Read-AppConfig
$metroPort=Require-Port $map "SAMRIM_$($App.Replace('-','_').ToUpperInvariant())_METRO_PORT"
$identityPort=Require-Port $map 'SAMRIM_IDENTITY_PORT'
$dshPort=Require-Port $map 'SAMRIM_DSH_PORT'
$metro=Get-MetroState -Port $metroPort

Import-Module -Name $DevicePath -Force -WarningAction SilentlyContinue

if ($metro.State -eq 'HEALTHY') {
    $device=Get-UsbAdbDevice
    Ensure-AdbReverse -Serial ([string]$device.Serial) -Ports @($identityPort,$dshPort,$metroPort)
    Write-Host "METRO_REUSE=PASS app=$App port=$metroPort"
    Open-DevelopmentClient -Serial ([string]$device.Serial) -Config $config -Port $metroPort
    return
}
if ($metro.State -eq 'STALE') {
    Remove-StaleMetro -Port $metroPort -ProcessIds $metro.ProcessIds
}

Assert-BackendReady -IdentityPort $identityPort -DshPort $dshPort
$device=Get-UsbAdbDevice
Ensure-AdbReverse -Serial ([string]$device.Serial) -Ports @($identityPort,$dshPort)

$env:NODE_ENV='development'
$env:BTHWANI_ENV='development'
$env:EXPO_NO_TELEMETRY='1'
$env:EXPO_NO_TYPESCRIPT_SETUP='1'
$existingNodeOptions=[string]$env:NODE_OPTIONS
if ($existingNodeOptions -notmatch '(?:^|\s)--dns-result-order=ipv4first(?:\s|$)') {
    $env:NODE_OPTIONS=(($existingNodeOptions + ' --dns-result-order=ipv4first').Trim())
}
$env:EXPO_PUBLIC_IDENTITY_API_URL=Require $map 'EXPO_PUBLIC_IDENTITY_API_URL'
$env:EXPO_PUBLIC_DSH_API_URL=Require $map 'EXPO_PUBLIC_DSH_API_URL'
$env:ANDROID_SERIAL=[string]$device.Serial

Write-Host "MOBILE_RUNTIME=EXPO_DIRECT app=$App metro=http://127.0.0.1:$metroPort"
Push-Location $RepoRoot
try {
    & pnpm --dir "apps/$App" exec expo start --dev-client --localhost --android --scheme ([string]$config.scheme) --port $metroPort
    exit $LASTEXITCODE
}
finally {
    Pop-Location
}
