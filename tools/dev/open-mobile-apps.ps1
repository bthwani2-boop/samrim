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
    if (-not (Test-Path -LiteralPath $path -PathType Leaf)) { Fail "APP_NOT_INSTALLED app=$AppName" }
    $config=Get-Content -LiteralPath $path -Raw | ConvertFrom-Json
    if ([string]::IsNullOrWhiteSpace([string]$config.scheme) -or [string]::IsNullOrWhiteSpace([string]$config.androidPackage)) { Fail "APP_CONFIG_INVALID app=$AppName" }
    return $config
}
function Metro-Ready([int]$Port) {
    $client=[Net.Http.HttpClient]::new(); $client.Timeout=[TimeSpan]::FromSeconds(1); $response=$null
    try { $response=$client.GetAsync("http://127.0.0.1:$Port/status").GetAwaiter().GetResult(); return ($response.IsSuccessStatusCode -and ($response.Content.ReadAsStringAsync().GetAwaiter().GetResult()).Contains('packager-status:running')) }
    catch { return $false }
    finally { if ($null -ne $response) { $response.Dispose() }; $client.Dispose() }
}
function Open-Client([string]$Serial,$Config,[int]$Port) {
    $installed=((& adb -s $Serial shell pm path ([string]$Config.androidPackage) 2>$null | Out-String).Trim())
    if ($LASTEXITCODE -ne 0 -or -not $installed) { Fail "APP_NOT_INSTALLED package=$($Config.androidPackage)" }
    $url=[Uri]::EscapeDataString("http://127.0.0.1:$Port")
    $link="$($Config.scheme)://expo-development-client/?url=$url"
    $out=@(& adb -s $Serial shell am start -W -a android.intent.action.VIEW -d $link 2>&1)
    if ($LASTEXITCODE -ne 0 -or @($out | Where-Object { $_ -match '^Error:|unable to resolve Intent' }).Count -gt 0) { $out | ForEach-Object { Write-Host $_ }; Fail "APP_LAUNCH_FAILED app=$App" }
    Write-Host "MOBILE_OPEN=PASS app=$App metro=http://127.0.0.1:$Port"
}
function Stop-ProcessTree([Diagnostics.Process]$Process) {
    if ($null -eq $Process -or $Process.HasExited) { return }
    & taskkill /PID $Process.Id /T /F *> $null
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
$device=Prepare-CanonicalAdbDevice -EnvPath $EnvPath -Ports @($identityPort,$dshPort,$metroPort)

if (Metro-Ready $metroPort) {
    Write-Host "METRO_REUSE=PASS app=$App port=$metroPort"
    Open-Client ([string]$device.Serial) $config $metroPort
    return
}

$env:NODE_ENV='development'
$env:BTHWANI_ENV='development'
$env:EXPO_NO_TELEMETRY='1'
$env:EXPO_PUBLIC_IDENTITY_API_URL=Require $map 'EXPO_PUBLIC_IDENTITY_API_URL'
$env:EXPO_PUBLIC_DSH_API_URL=Require $map 'EXPO_PUBLIC_DSH_API_URL'
$env:EXPO_PACKAGER_PROXY_URL="http://127.0.0.1:$metroPort"

$pnpm=(Get-Command pnpm.cmd -ErrorAction Stop).Source
$process=$null
try {
    Write-Host "METRO_HOST=START app=$App port=$metroPort"
    $process=Start-Process -FilePath $pnpm -ArgumentList @('--dir',"apps/$App",'exec','expo','start','--dev-client','--host','localhost','--port',"$metroPort") -WorkingDirectory $RepoRoot -NoNewWindow -PassThru
    $deadline=[DateTime]::UtcNow.AddSeconds(60)
    while (-not (Metro-Ready $metroPort)) {
        if ($process.HasExited) { Fail "METRO_START_FAILED app=$App exit=$($process.ExitCode)" }
        if ([DateTime]::UtcNow -ge $deadline) { Fail "METRO_START_TIMEOUT app=$App port=$metroPort" }
        Start-Sleep -Milliseconds 250
    }
    Write-Host "METRO_HOST=READY app=$App port=$metroPort"
    Open-Client ([string]$device.Serial) $config $metroPort
    $process.WaitForExit()
    exit $process.ExitCode
} finally {
    if ($null -ne $process -and -not $process.HasExited) { Stop-ProcessTree $process }
}
