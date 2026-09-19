#Requires -Version 7.4
param(
    [Parameter(Mandatory, Position=0)]
    [ValidateSet('client','partner','captain','field','control')]
    [string]$Target
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$PSNativeCommandUseErrorActionPreference = $false

$Root = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
$EnvPath = Join-Path $Root 'infra\local\.env'

function Fail([string]$Message) { throw $Message }

function Read-Env {
    if (-not (Test-Path -LiteralPath $EnvPath -PathType Leaf)) {
        Fail 'LOCAL_ENV_MISSING run=pnpm_bootstrap'
    }

    $map = @{}
    foreach ($line in Get-Content -LiteralPath $EnvPath) {
        $line = $line.Trim()
        if (-not $line -or $line.StartsWith('#')) { continue }
        $parts = $line.Split('=', 2)
        if ($parts.Count -ne 2) { Fail 'LOCAL_ENV_INVALID' }
        $map[$parts[0].Trim()] = $parts[1].Trim()
    }
    return $map
}

function Need([hashtable]$Map, [string]$Name) {
    $value = [string]$Map[$Name]
    if ([string]::IsNullOrWhiteSpace($value)) { Fail "LOCAL_ENV_MISSING_VALUE name=$Name" }
    return $value
}

function Port([hashtable]$Map, [string]$Name) {
    $value = 0
    if (-not [int]::TryParse((Need $Map $Name), [ref]$value)) { Fail "LOCAL_ENV_INVALID_PORT name=$Name" }
    return $value
}

function Http([string]$Url) {
    $response = $null
    $client = [Net.Http.HttpClient]::new()
    $client.Timeout = [TimeSpan]::FromMilliseconds(500)

    try {
        $response = $client.GetAsync($Url).GetAwaiter().GetResult()
        return [pscustomobject]@{
            Ok = ([int]$response.StatusCode -ge 200 -and [int]$response.StatusCode -lt 300)
            Body = $response.Content.ReadAsStringAsync().GetAwaiter().GetResult()
        }
    }
    catch {
        return [pscustomobject]@{ Ok = $false; Body = '' }
    }
    finally {
        if ($null -ne $response) { $response.Dispose() }
        $client.Dispose()
    }
}

function Reverse([int[]]$Ports) {
    $existing = @(& adb reverse --list 2>&1)
    if ($LASTEXITCODE -ne 0) { Fail 'ANDROID_NOT_READY' }

    foreach ($port in @($Ports | Sort-Object -Unique)) {
        if (@($existing | Where-Object { $_ -match "(^|\s)tcp:$port\s+tcp:$port($|\s)" }).Count -gt 0) { continue }

        & adb reverse "tcp:$port" "tcp:$port"
        if ($LASTEXITCODE -ne 0) { Fail "ANDROID_NOT_READY port=$port" }
    }
}

function Port-Busy([int]$Port) {
    return @(
        [Net.NetworkInformation.IPGlobalProperties]::GetIPGlobalProperties().GetActiveTcpListeners() |
        Where-Object { $_.Port -eq $Port }
    ).Count -gt 0
}

function Clear-Node-Port([int]$Port) {
    foreach ($listener in @(Get-NetTCPConnection -State Listen -LocalPort $Port -ErrorAction SilentlyContinue)) {
        $ownerProcessId = [int]$listener.OwningProcess
        $process = Get-Process -Id $ownerProcessId -ErrorAction SilentlyContinue

        if ($null -eq $process -or $process.ProcessName -ne 'node') {
            Fail "PORT_IN_USE port=$Port pid=$ownerProcessId"
        }

        Stop-Process -Id $ownerProcessId -Force -ErrorAction SilentlyContinue
    }

    Start-Sleep -Milliseconds 150

    if (Port-Busy $Port) { Fail "PORT_STILL_IN_USE port=$Port" }
}

function Mobile([string]$Name) {
    $map = Read-Env
    $app = "app-$Name"
    $appRoot = Join-Path $Root "apps\$app"
    $config = Get-Content -LiteralPath (Join-Path $appRoot 'mobile.config.json') -Raw | ConvertFrom-Json
    $metro = Port $map "SAMRIM_$($app.Replace('-','_').ToUpperInvariant())_METRO_PORT"
    $identity = Port $map 'SAMRIM_IDENTITY_PORT'
    $dsh = Port $map 'SAMRIM_DSH_PORT'
    $status = Http "http://127.0.0.1:$metro/status"

    if ($status.Ok -and $status.Body.Trim() -eq 'packager-status:running') {
        Reverse @($identity, $dsh, $metro)

        $url = "http://127.0.0.1:$metro"
        $deep = "$([string]$config.scheme)://expo-development-client/?url=$([Uri]::EscapeDataString($url))"
        & adb shell am start -a android.intent.action.VIEW -d $deep -p ([string]$config.androidPackage)

        if ($LASTEXITCODE -ne 0) { Fail "APP_OPEN_FAILED app=$app" }
        Write-Host "APP_REUSE=PASS app=$app"
        return
    }

    if (Port-Busy $metro) { Clear-Node-Port $metro }

    Reverse @($identity, $dsh)

    $env:BTHWANI_ENV = 'development'
    $env:EXPO_OFFLINE = '1'
    $env:EXPO_NO_QR_CODE = '1'
    $env:EXPO_NO_TYPESCRIPT_SETUP = '1'
    $env:EXPO_PUBLIC_IDENTITY_API_URL = Need $map 'EXPO_PUBLIC_IDENTITY_API_URL'
    $env:EXPO_PUBLIC_DSH_API_URL = Need $map 'EXPO_PUBLIC_DSH_API_URL'

    if ([string]$env:NODE_OPTIONS -notmatch '(?:^|\s)--dns-result-order=ipv4first(?:\s|$)') {
        $env:NODE_OPTIONS = ((([string]$env:NODE_OPTIONS) + ' --dns-result-order=ipv4first').Trim())
    }

    $expo = Join-Path $appRoot 'node_modules\expo\bin\cli'
    if (-not (Test-Path -LiteralPath $expo -PathType Leaf)) { Fail 'EXPO_NOT_INSTALLED run=pnpm_install' }

    Write-Host "APP_START app=$app"

    Set-Location $appRoot
    & node $expo start --dev-client --localhost --android --scheme ([string]$config.scheme) --port $metro
    exit $LASTEXITCODE
}

if ($Target -ne 'control') {
    Mobile $Target
    exit
}

$map = Read-Env
$port = Port $map 'SAMRIM_CONTROL_PORT'
$origin = Need $map 'CONTROL_PANEL_PUBLIC_ORIGIN'

if ((Http "http://127.0.0.1:$port/api/auth/session").Ok) {
    Write-Host "CONTROL_REUSE=PASS url=$origin"
    exit 0
}

if (Port-Busy $port) { Clear-Node-Port $port }

$env:BTHWANI_ENV = 'development'
$env:NEXT_TELEMETRY_DISABLED = '1'
$env:CONTROL_PANEL_PUBLIC_ORIGIN = $origin
$env:IDENTITY_API_BASE_URL = Need $map 'IDENTITY_API_BASE_URL'
$env:DSH_API_BASE_URL = Need $map 'DSH_API_BASE_URL'
$env:CONTROL_PANEL_SERVICE_TOKEN = Need $map 'CONTROL_PANEL_SERVICE_TOKEN'

$controlRoot = Join-Path $Root 'apps\control-panel'
$next = Join-Path $controlRoot 'node_modules\next\dist\bin\next'
if (-not (Test-Path -LiteralPath $next -PathType Leaf)) { Fail 'NEXT_NOT_INSTALLED run=pnpm_install' }

Write-Host "CONTROL_START url=$origin"

Set-Location $controlRoot
& node $next dev -H 127.0.0.1 -p $port
exit $LASTEXITCODE
