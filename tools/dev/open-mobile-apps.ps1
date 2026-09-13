#Requires -Version 7.4
[CmdletBinding()]
param(
    [Parameter(Mandatory)]
    [string]$App
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$PSNativeCommandUseErrorActionPreference = $false

$RepoRoot = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
$EnvPath = Join-Path $RepoRoot 'infra\local\compose\.env'
$DevicePolicyPath = Join-Path $PSScriptRoot 'device-policy.psm1'

function Fail([string]$Message) { throw $Message }

function Read-EnvMap([string]$Path) {
    if (-not (Test-Path -LiteralPath $Path -PathType Leaf)) { Fail "RUNTIME_NOT_READY reason=missing_environment path=$Path" }
    $map = @{}
    foreach ($line in Get-Content -LiteralPath $Path) {
        $trimmed = $line.Trim()
        if (-not $trimmed -or $trimmed.StartsWith('#')) { continue }
        $parts = $trimmed.Split('=', 2)
        if ($parts.Count -ne 2) { Fail 'RUNTIME_NOT_READY reason=malformed_environment' }
        $name = $parts[0].Trim()
        if ([string]::IsNullOrWhiteSpace($name) -or $map.ContainsKey($name)) { Fail 'RUNTIME_NOT_READY reason=invalid_environment' }
        $map[$name] = $parts[1].Trim()
    }
    if ($map['BTHWANI_ENV'] -ne 'development') { Fail 'RUNTIME_NOT_READY reason=environment_must_be_development' }
    return $map
}

function Require-TcpPort([hashtable]$Map, [string]$Name) {
    if (-not $Map.ContainsKey($Name)) { Fail "RUNTIME_NOT_READY reason=missing_port name=$Name" }
    $port = 0
    if (-not [int]::TryParse([string]$Map[$Name], [ref]$port) -or $port -lt 1 -or $port -gt 65535) { Fail "RUNTIME_NOT_READY reason=invalid_port name=$Name" }
    return $port
}

function Get-RunningContainerId([string]$Service) {
    $ids = @(& docker ps -a --filter 'label=com.docker.compose.project=samrim-local' --filter "label=com.docker.compose.service=$Service" --format '{{.ID}}' | ForEach-Object { $_.Trim() } | Where-Object { $_ })
    if ($LASTEXITCODE -ne 0 -or $ids.Count -ne 1) { Fail "RUNTIME_NOT_READY reason=service_container_missing service=$Service" }
    $status = (& docker inspect --format '{{.State.Status}}' $ids[0]).Trim()
    if ($LASTEXITCODE -ne 0 -or $status -ne 'running') { Fail "RUNTIME_NOT_READY reason=service_not_running service=$Service status=$status" }
    $health = (& docker inspect --format '{{if .State.Health}}{{.State.Health.Status}}{{else}}missing{{end}}' $ids[0]).Trim()
    if ($LASTEXITCODE -ne 0 -or $health -ne 'healthy') { Fail "RUNTIME_NOT_READY reason=service_not_healthy service=$Service health=$health" }
    return $ids[0]
}

function Read-AppConfig([string]$AppName) {
    if ($AppName -notmatch '^app-[A-Za-z0-9-]+$') { Fail "APP_NOT_INSTALLED app=$AppName" }
    $configPath = Join-Path $RepoRoot ("apps\$AppName\mobile.config.json")
    if (-not (Test-Path -LiteralPath $configPath -PathType Leaf)) { Fail "APP_NOT_INSTALLED app=$AppName" }
    try { $config = Get-Content -LiteralPath $configPath -Raw | ConvertFrom-Json } catch { Fail "APP_NOT_INSTALLED app=$AppName reason=invalid_mobile_config" }
    foreach ($field in @('scheme','androidPackage')) {
        if ([string]::IsNullOrWhiteSpace([string]$config.$field)) { Fail "APP_NOT_INSTALLED app=$AppName reason=missing_$field" }
    }
    return $config
}

function Assert-PackageInstalled([string]$Serial, [string]$Package) {
    $path = ((& adb -s $Serial shell pm path $Package 2>$null | Out-String).Trim())
    if ($LASTEXITCODE -ne 0 -or [string]::IsNullOrWhiteSpace($path)) { Fail "APP_NOT_INSTALLED package=$Package" }
}

function Open-DevelopmentClient([string]$Serial, [string]$AppName, $Config, [int]$MetroPort) {
    Assert-PackageInstalled -Serial $Serial -Package ([string]$Config.androidPackage)
    $encodedUrl = [Uri]::EscapeDataString("http://127.0.0.1:$MetroPort")
    $deepLink = "{0}://expo-development-client/?url={1}" -f $Config.scheme, $encodedUrl
    $output = @(& adb -s $Serial shell am start -W -a android.intent.action.VIEW -d $deepLink 2>&1)
    $exitCode = $LASTEXITCODE
    $lines = @($output | ForEach-Object { ([string]$_).Trim() } | Where-Object { $_ })
    $explicitErrors = @($lines | Where-Object { $_ -match '^Error:|unable to resolve Intent' })
    $statusOk = @($lines | Where-Object { $_ -match '^Status:\s+ok\s*$' }).Count -eq 1
    $activityOk = @($lines | Where-Object { $_ -match "^Activity:\s+$([regex]::Escape([string]$Config.androidPackage))\/" }).Count -eq 1
    $launchStateLine = @($lines | Where-Object { $_ -match '^LaunchState:\s+' } | Select-Object -First 1)
    $launchState = if ($launchStateLine.Count -eq 1) { ($launchStateLine[0] -replace '^LaunchState:\s+', '').Trim() } else { 'UNKNOWN' }
    if ($exitCode -ne 0 -or $explicitErrors.Count -gt 0 -or -not $statusOk -or -not $activityOk) {
        $lines | ForEach-Object { Write-Host $_ }
        Fail "APP_LAUNCH_FAILED app=$AppName status_ok=$statusOk activity_ok=$activityOk"
    }
    Write-Host "MOBILE_OPEN=PASS app=$AppName launch=$launchState"
}

if (-not (Get-Command docker -ErrorAction SilentlyContinue)) { Fail 'RUNTIME_NOT_READY reason=docker_unavailable' }
& docker version *> $null
if ($LASTEXITCODE -ne 0) { Fail 'RUNTIME_NOT_READY reason=docker_daemon_unavailable' }
$envMap = Read-EnvMap -Path $EnvPath
$config = Read-AppConfig -AppName $App
$service = 'metro-' + $App.Substring(4)
$null = Get-RunningContainerId -Service $service
$null = Get-RunningContainerId -Service 'identity'
$null = Get-RunningContainerId -Service 'dsh'
$metroPort = Require-TcpPort -Map $envMap -Name ("SAMRIM_{0}_METRO_PORT" -f $App.Replace('-', '_').ToUpperInvariant())

Import-Module -Name $DevicePolicyPath -Force -WarningAction SilentlyContinue
$device = Prepare-CanonicalAdbDevice -EnvPath $EnvPath
Write-Host "MOBILE_OPEN=START app=$App serial=$($device.Serial) metro=http://127.0.0.1:$metroPort"
Open-DevelopmentClient -Serial ([string]$device.Serial) -AppName $App -Config $config -MetroPort $metroPort
