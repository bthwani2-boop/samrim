#Requires -Version 7.4
[CmdletBinding()]
param(
    [Parameter(Mandatory)]
    [ValidateSet('Up','Down','Status','Doctor','Control','Client','Partner','Captain','Field','Scrcpy')]
    [string]$Action
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$PSNativeCommandUseErrorActionPreference = $false

$Root = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
$EnvPath = Join-Path $Root 'infra\local\.env'
$ComposePath = Join-Path $Root 'infra\local\compose\compose.yaml'
$Project = 'samrim-local'

function Fail([string]$Message) { throw $Message }

function Read-Env {
    if (-not (Test-Path -LiteralPath $EnvPath -PathType Leaf)) {
        Fail 'LOCAL_ENV_MISSING copy=infra/local/.env.example->infra/local/.env'
    }

    $map = @{}
    foreach ($line in Get-Content -LiteralPath $EnvPath) {
        $trim = $line.Trim()
        if (-not $trim -or $trim.StartsWith('#')) { continue }

        $parts = $trim.Split('=', 2)
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

function Compose([string[]]$Arguments) {
    if (-not (Test-Path -LiteralPath $EnvPath -PathType Leaf)) {
        Fail 'LOCAL_ENV_MISSING copy=infra/local/.env.example->infra/local/.env'
    }

    & docker compose --ansi never --project-name $Project --env-file $EnvPath -f $ComposePath @Arguments
    if ($LASTEXITCODE -ne 0) { Fail "DOCKER_COMPOSE_FAILED args=$($Arguments -join ' ')" }
}

function Http([string]$Url) {
    $response = $null
    $client = [Net.Http.HttpClient]::new()
    $client.Timeout = [TimeSpan]::FromSeconds(1)

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
    foreach ($port in @($Ports | Sort-Object -Unique)) {
        & adb reverse "tcp:$port" "tcp:$port"
        if ($LASTEXITCODE -ne 0) { Fail "ANDROID_NOT_READY adb_reverse_port=$port" }
    }
}

function Clear-Node-Port([int]$Port) {
    $listeners = @(Get-NetTCPConnection -State Listen -LocalPort $Port -ErrorAction SilentlyContinue)

    foreach ($listener in $listeners) {
        $ownerProcessId = [int]$listener.OwningProcess
        $process = Get-Process -Id $ownerProcessId -ErrorAction SilentlyContinue

        if ($null -eq $process -or $process.ProcessName -ne 'node') {
            Fail "PORT_IN_USE port=$Port pid=$ownerProcessId"
        }

        Stop-Process -Id $ownerProcessId -Force -ErrorAction SilentlyContinue
    }

    if ($listeners.Count -gt 0) { Start-Sleep -Milliseconds 300 }

    if (@(Get-NetTCPConnection -State Listen -LocalPort $Port -ErrorAction SilentlyContinue).Count -gt 0) {
        Fail "PORT_STILL_IN_USE port=$Port"
    }
}

function Mobile([string]$Name) {
    $map = Read-Env
    $app = "app-$Name"
    $config = Get-Content -LiteralPath (Join-Path $Root "apps\$app\mobile.config.json") -Raw | ConvertFrom-Json

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
        Write-Host "APP_REUSE=PASS app=$app metro=$url"
        return
    }

    if (@(Get-NetTCPConnection -State Listen -LocalPort $metro -ErrorAction SilentlyContinue).Count -gt 0) {
        Clear-Node-Port $metro
    }

    Reverse @($identity, $dsh)

    $env:NODE_ENV = 'development'
    $env:BTHWANI_ENV = 'development'
    $env:EXPO_NO_TELEMETRY = '1'
    $env:EXPO_NO_TYPESCRIPT_SETUP = '1'
    $env:EXPO_PUBLIC_IDENTITY_API_URL = Need $map 'EXPO_PUBLIC_IDENTITY_API_URL'
    $env:EXPO_PUBLIC_DSH_API_URL = Need $map 'EXPO_PUBLIC_DSH_API_URL'

    if ([string]$env:NODE_OPTIONS -notmatch '(?:^|\s)--dns-result-order=ipv4first(?:\s|$)') {
        $env:NODE_OPTIONS = ((([string]$env:NODE_OPTIONS) + ' --dns-result-order=ipv4first').Trim())
    }

    Write-Host "APP_START app=$app metro=http://127.0.0.1:$metro"
    & pnpm --dir "apps/$app" exec expo start --dev-client --localhost --android --scheme ([string]$config.scheme) --port $metro
    exit $LASTEXITCODE
}

switch ($Action) {
    'Up' {
        Compose @('up','-d','--wait','--wait-timeout','300','--remove-orphans')
        Write-Host 'RUNTIME_UP=PASS'
    }
    'Down' {
        Compose @('down','--remove-orphans')
    }
    'Status' {
        Compose @('ps','-a')
    }
    'Doctor' {
        $map = Read-Env
        Compose @('ps','-a')

        $identity = Port $map 'SAMRIM_IDENTITY_PORT'
        $dsh = Port $map 'SAMRIM_DSH_PORT'
        $mailpit = Port $map 'SAMRIM_MAILPIT_WEB_PORT'

        if (-not (Http "http://127.0.0.1:$identity/identity/health").Ok) { Fail 'RUNTIME_NOT_READY service=identity' }
        if (-not (Http "http://127.0.0.1:$dsh/dsh/health").Ok) { Fail 'RUNTIME_NOT_READY service=dsh' }
        if (-not (Http "http://127.0.0.1:$mailpit/").Ok) { Fail 'RUNTIME_NOT_READY service=mailpit' }

        Write-Host 'RUNTIME_DOCTOR=PASS'
    }
    'Control' {
        $map = Read-Env
        $port = Port $map 'SAMRIM_CONTROL_PORT'
        $origin = Need $map 'CONTROL_PANEL_PUBLIC_ORIGIN'

        if ((Http "http://127.0.0.1:$port/api/auth/session").Ok) {
            Write-Host "CONTROL_REUSE=PASS url=$origin"
            return
        }

        if (@(Get-NetTCPConnection -State Listen -LocalPort $port -ErrorAction SilentlyContinue).Count -gt 0) {
            Clear-Node-Port $port
        }

        $env:NODE_ENV = 'development'
        $env:BTHWANI_ENV = 'development'
        $env:NEXT_TELEMETRY_DISABLED = '1'
        $env:CONTROL_PANEL_PUBLIC_ORIGIN = $origin
        $env:IDENTITY_API_BASE_URL = Need $map 'IDENTITY_API_BASE_URL'
        $env:DSH_API_BASE_URL = Need $map 'DSH_API_BASE_URL'
        $env:CONTROL_PANEL_SERVICE_TOKEN = Need $map 'CONTROL_PANEL_SERVICE_TOKEN'

        Write-Host "CONTROL_START url=$origin"
        & pnpm --dir apps/control-panel exec next dev -H 127.0.0.1 -p $port
        exit $LASTEXITCODE
    }
    'Client'  { Mobile 'client' }
    'Partner' { Mobile 'partner' }
    'Captain' { Mobile 'captain' }
    'Field'   { Mobile 'field' }
    'Scrcpy' {
        & scrcpy --max-size=1280 --max-fps=30 --video-bit-rate=4M --no-audio
        exit $LASTEXITCODE
    }
}
