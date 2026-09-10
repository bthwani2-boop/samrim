#Requires -Version 7.4
[CmdletBinding()]
param(
    [Parameter(Mandatory)]
    [ValidateSet('app-client', 'app-partner', 'app-captain', 'app-field')]
    [string]$App,

    [string]$DeviceSerial = $env:BTHWANI_ADB_SERIAL,

    [switch]$ClearCache
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$RepoRoot = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
$AppRoot = Join-Path $RepoRoot ("apps\" + $App)
$PackageJson = Join-Path $AppRoot 'package.json'
$ProjectJson = Join-Path $AppRoot 'project.json'
$MobileConfig = Join-Path $AppRoot 'mobile.config.json'
$EnvPath = Join-Path $RepoRoot 'infra\local\compose\.env'
$EnsureLocalEnv = Join-Path $RepoRoot 'tools\dev\ensure-local-env.ps1'
$AssertDailyHostRuntime = Join-Path $RepoRoot 'tools\dev\assert-daily-host-runtime.ps1'

foreach ($required in @(
    $PackageJson,
    $ProjectJson,
    $MobileConfig,
    $EnsureLocalEnv,
    $AssertDailyHostRuntime
)) {
    if (-not (Test-Path -LiteralPath $required -PathType Leaf)) {
        throw "Mobile runtime prerequisite is missing: $required"
    }
}

$project = Get-Content -LiteralPath $ProjectJson -Raw | ConvertFrom-Json
if (@($project.tags) -notcontains 'type:app') {
    throw "$App is not tagged as type:app."
}
if ([string]$project.root -ne ("apps/" + $App)) {
    throw "$App project.root does not match apps/$App."
}

$package = Get-Content -LiteralPath $PackageJson -Raw | ConvertFrom-Json
if ($null -ne $package.scripts.start) {
    throw "$App package.json exposes a forbidden secondary local start authority. Use the repository root command only."
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

& $EnsureLocalEnv
if ($LASTEXITCODE -ne 0 -or -not (Test-Path -LiteralPath $EnvPath -PathType Leaf)) {
    throw "Canonical local runtime environment reconciliation failed."
}

function Read-EnvMap([string]$Path) {
    $map = @{}
    foreach ($line in Get-Content -LiteralPath $Path) {
        $trimmed = $line.Trim()
        if (-not $trimmed -or $trimmed.StartsWith('#')) { continue }
        $parts = $trimmed.Split('=', 2)
        if ($parts.Count -ne 2) {
            throw "Malformed local runtime environment line in ${Path}: $line"
        }
        $name = $parts[0].Trim()
        if ($map.ContainsKey($name)) {
            throw "Duplicate local runtime environment key '$name' in ${Path}."
        }
        $map[$name] = $parts[1].Trim()
    }
    return $map
}

function Require-EnvValue([hashtable]$Map, [string]$Name) {
    if (-not $Map.ContainsKey($Name) -or [string]::IsNullOrWhiteSpace([string]$Map[$Name])) {
        throw "Required mobile runtime setting is missing: $Name"
    }
    return [string]$Map[$Name]
}

function Require-TcpPort([hashtable]$Map, [string]$Name) {
    $raw = Require-EnvValue -Map $Map -Name $Name
    $value = 0
    if (-not [int]::TryParse($raw, [ref]$value) -or $value -lt 1 -or $value -gt 65535) {
        throw "Invalid TCP port in $Name: $raw"
    }
    return $value
}

$envMap = Read-EnvMap -Path $EnvPath
if ((Require-EnvValue -Map $envMap -Name 'BTHWANI_ENV') -ne 'development') {
    throw 'Mobile DAILY_DEV runtime requires BTHWANI_ENV=development.'
}

$appToken = ($App -replace '[^A-Za-z0-9]', '_').ToUpperInvariant()
$metroPortKey = "SAMRIM_${appToken}_METRO_PORT"
$metroPort = Require-TcpPort -Map $envMap -Name $metroPortKey
$identityPort = Require-TcpPort -Map $envMap -Name 'SAMRIM_IDENTITY_PORT'
$dshPort = Require-TcpPort -Map $envMap -Name 'SAMRIM_DSH_PORT'

if (@($metroPort, $identityPort, $dshPort) | Group-Object | Where-Object Count -gt 1) {
    throw "Mobile runtime ports must be distinct: $metroPortKey=$metroPort SAMRIM_IDENTITY_PORT=$identityPort SAMRIM_DSH_PORT=$dshPort"
}

& $AssertDailyHostRuntime -Component $App
if ($LASTEXITCODE -ne 0) {
    throw "DAILY_DEV host ownership proof failed for $App."
}

function Resolve-AdbTargetSerial {
    param([string]$RequestedSerial)

    if (-not (Get-Command adb -ErrorAction SilentlyContinue)) {
        return ''
    }

    $serials = @(
        & adb devices |
            Where-Object { $_ -match '\tdevice$' } |
            ForEach-Object { ($_ -split '\t', 2)[0].Trim() } |
            Where-Object { -not [string]::IsNullOrWhiteSpace($_) }
    )

    if (-not [string]::IsNullOrWhiteSpace($RequestedSerial)) {
        if ($RequestedSerial -notin $serials) {
            throw "ADB target mismatch: requested '$RequestedSerial' is not an attached device."
        }
        return $RequestedSerial
    }

    if ($serials.Count -eq 0) { return '' }
    if ($serials.Count -gt 1) {
        throw ("Multiple ADB devices are attached; set BTHWANI_ADB_SERIAL or -DeviceSerial explicitly. Devices: " + ($serials -join ', '))
    }
    return $serials[0]
}

function Get-PortOwnerSummary([object[]]$Listeners) {
    $ownerPids = @($Listeners | Select-Object -ExpandProperty OwningProcess -Unique)
    $owners = foreach ($ownerPid in $ownerPids) {
        $process = Get-Process -Id ([int]$ownerPid) -ErrorAction SilentlyContinue
        if ($null -eq $process) { "PID=$ownerPid (exited)" }
        else { "PID=$ownerPid $($process.ProcessName)" }
    }
    if ($owners.Count -eq 0) { return 'unknown process' }
    return ($owners -join ', ')
}

function Assert-MetroPortAvailable {
    $listeners = @(
        Get-NetTCPConnection -State Listen -LocalPort $metroPort -ErrorAction SilentlyContinue |
            Where-Object { $_.LocalAddress -in @('127.0.0.1', '0.0.0.0', '::') }
    )
    if ($listeners.Count -eq 0) { return }

    $owners = Get-PortOwnerSummary -Listeners $listeners
    throw "RUNTIME_OWNERSHIP_CONFLICT=FAIL app=$App port=$metroPort owner=$owners. The canonical mobile launcher requires exclusive Metro ownership."
}

Assert-MetroPortAvailable

$adbSerial = Resolve-AdbTargetSerial -RequestedSerial $DeviceSerial
if (-not [string]::IsNullOrWhiteSpace($adbSerial)) {
    foreach ($port in @($metroPort, $identityPort, $dshPort)) {
        & adb -s $adbSerial reverse "tcp:$port" "tcp:$port" *> $null
        if ($LASTEXITCODE -ne 0) {
            throw "ADB reverse failed for $adbSerial port $port."
        }
    }

    Write-Host "ADB_TARGET=PASS serial=$adbSerial app=$App"
    Write-Host "ADB_REVERSE=READY serial=$adbSerial ports=$metroPort,$identityPort,$dshPort source=canonical-env"
}

$nodeOptions = [Environment]::GetEnvironmentVariable('NODE_OPTIONS', 'Process')
if ([string]::IsNullOrWhiteSpace($nodeOptions)) {
    $nodeOptions = '--dns-result-order=ipv4first'
}
elseif ($nodeOptions -match '(?i)(^|\s)--dns-result-order=\S+') {
    $nodeOptions = [regex]::Replace(
        $nodeOptions,
        '(?i)(^|\s)--dns-result-order=\S+',
        '$1--dns-result-order=ipv4first'
    )
}
else {
    $nodeOptions = "$nodeOptions --dns-result-order=ipv4first"
}
[Environment]::SetEnvironmentVariable('NODE_OPTIONS', $nodeOptions, 'Process')
Write-Host 'NODE_DNS_ORDER=ipv4first'

$expoArgs = @(
    '--dir', $AppRoot,
    'exec', 'expo',
    'start',
    '--dev-client',
    '--localhost',
    '--port', [string]$metroPort
)
if ($ClearCache) {
    $expoArgs += '--clear'
}

Write-Host "MOBILE_RUNTIME_AUTHORITY=PASS app=$App metro_port=$metroPort source=infra/local/compose/.env"
Write-Host "Starting $App from $AppRoot"
& pnpm @expoArgs
exit $LASTEXITCODE
