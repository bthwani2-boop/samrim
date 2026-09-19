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

function Get-SameAppMetroState([int]$Port,[string]$AppName) {
    $listeners=@(Get-NetTCPConnection -State Listen -LocalPort $Port -ErrorAction SilentlyContinue)
    if ($listeners.Count -eq 0) { return [pscustomobject]@{ State='FREE'; ProcessIds=@() } }

    $expectedAppPath=Join-Path $RepoRoot "apps\$AppName"
    $processIds=[System.Collections.Generic.HashSet[int]]::new()

    foreach ($listener in $listeners) {
        $ownerProcessId=[int]$listener.OwningProcess
        $process=Get-CimInstance Win32_Process -Filter "ProcessId=$ownerProcessId" -ErrorAction SilentlyContinue
        if ($null -eq $process) { Fail "METRO_PORT_IN_USE app=$AppName port=$Port reason=unknown_owner pid=$ownerProcessId" }

        $command=[string]$process.CommandLine
        $sameAppExpo=(
            $process.Name -match '^node(?:\.exe)?$' -and
            $command.Contains($expectedAppPath,[StringComparison]::OrdinalIgnoreCase) -and
            $command.Contains('expo',[StringComparison]::OrdinalIgnoreCase) -and
            $command.Contains('--port',[StringComparison]::OrdinalIgnoreCase) -and
            $command.Contains([string]$Port,[StringComparison]::Ordinal)
        )
        if (-not $sameAppExpo) {
            Fail "METRO_PORT_IN_USE app=$AppName port=$Port address=$($listener.LocalAddress) pid=$ownerProcessId name=$($process.Name)"
        }
        $null=$processIds.Add($ownerProcessId)
    }

    if ($listeners.Count -eq 1 -and $listeners[0].LocalAddress -eq '127.0.0.1') {
        $client=[Net.Http.HttpClient]::new()
        $client.Timeout=[TimeSpan]::FromSeconds(1)
        $response=$null
        try {
            $response=$client.GetAsync("http://127.0.0.1:$Port/status").GetAwaiter().GetResult()
            $body=$response.Content.ReadAsStringAsync().GetAwaiter().GetResult()
            if ([int]$response.StatusCode -eq 200 -and $body.Trim() -eq 'packager-status:running') {
                return [pscustomobject]@{ State='HEALTHY'; ProcessIds=@($processIds) }
            }
        } catch {
        } finally {
            if ($null -ne $response) { $response.Dispose() }
            $client.Dispose()
        }
    }

    return [pscustomobject]@{ State='STALE'; ProcessIds=@($processIds) }
}

function Remove-SameAppMetroProcesses([int]$Port,[string]$AppName,[int[]]$ProcessIds) {
    foreach ($ownerProcessId in @($ProcessIds | Sort-Object -Unique)) {
        Stop-Process -Id $ownerProcessId -Force -ErrorAction SilentlyContinue
        Write-Host "METRO_STALE_PROCESS=REMOVED app=$AppName port=$Port pid=$ownerProcessId"
    }

    $deadline=[DateTime]::UtcNow.AddSeconds(5)
    while ([DateTime]::UtcNow -lt $deadline) {
        if (@(Get-NetTCPConnection -State Listen -LocalPort $Port -ErrorAction SilentlyContinue).Count -eq 0) { return }
        Start-Sleep -Milliseconds 100
    }
    Fail "METRO_PORT_IN_USE app=$AppName port=$Port reason=stale_process_not_released"
}

function Test-AdbReversePort([string]$Serial,[int]$Port) {
    $rows=@(& adb -s $Serial reverse --list 2>&1)
    if ($LASTEXITCODE -ne 0) { return $false }
    return @($rows | Where-Object { $_ -match "(^|\s)tcp:$Port\s+tcp:$Port($|\s)" }).Count -eq 1
}

function Open-ExistingDevelopmentClient([string]$Serial,$Config,[int]$Port,[string]$AppName) {
    $serverUrl="http://127.0.0.1:$Port"
    $encoded=[Uri]::EscapeDataString($serverUrl)
    $launchUrl="$([string]$Config.scheme)://expo-development-client/?url=$encoded"
    & adb -s $Serial shell am start -a android.intent.action.VIEW -d $launchUrl -p ([string]$Config.androidPackage) *> $null
    if ($LASTEXITCODE -ne 0) { Fail "MOBILE_OPEN_FAILED app=$AppName mode=reuse" }
    Write-Host "MOBILE_OPEN=PASS app=$AppName mode=reuse metro=$serverUrl"
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

$metroState=Get-SameAppMetroState -Port $metroPort -AppName $App
if ($metroState.State -eq 'HEALTHY') {
    if (Test-AdbReversePort -Serial ([string]$device.Serial) -Port $metroPort) {
        Write-Host "METRO_REUSE=PASS app=$App port=$metroPort pid=$($metroState.ProcessIds -join ',')"
        Open-ExistingDevelopmentClient -Serial ([string]$device.Serial) -Config $config -Port $metroPort -AppName $App
        return
    }
    $metroState=[pscustomobject]@{ State='STALE'; ProcessIds=$metroState.ProcessIds }
}
if ($metroState.State -eq 'STALE') {
    Remove-SameAppMetroProcesses -Port $metroPort -AppName $App -ProcessIds $metroState.ProcessIds
    & adb -s ([string]$device.Serial) reverse --remove "tcp:$metroPort" 2>$null
}

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
