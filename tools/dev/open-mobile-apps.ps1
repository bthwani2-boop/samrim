#Requires -Version 7.4
[CmdletBinding()]
param(
    [string]$DeviceSerial = $env:BTHWANI_ADB_SERIAL
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$PSNativeCommandUseErrorActionPreference = $false

$RepoRoot = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
$EnvPath = Join-Path $RepoRoot 'infra\local\compose\.env'
$EnvExamplePath = Join-Path $RepoRoot 'infra\local\compose\.env.example'

function Fail([string]$Message) { throw $Message }

function Read-EnvMap([string]$Path) {
    $map = @{}
    foreach ($line in Get-Content -LiteralPath $Path) {
        $trimmed = $line.Trim()
        if (-not $trimmed -or $trimmed.StartsWith('#')) { continue }
        $parts = $trimmed.Split('=', 2)
        if ($parts.Count -ne 2) { Fail "Malformed environment line in ${Path}: $line" }
        $map[$parts[0].Trim()] = $parts[1].Trim()
    }
    return $map
}

function Require-TcpPort([hashtable]$Map, [string]$Name) {
    if (-not $Map.ContainsKey($Name)) { Fail "Required local runtime setting is missing: $Name" }
    $port = 0
    if (-not [int]::TryParse([string]$Map[$Name], [ref]$port) -or $port -lt 1 -or $port -gt 65535) {
        Fail "Invalid TCP port in ${Name}: $($Map[$Name])"
    }
    return $port
}

function Get-ReadyAdbRecords {
    $records = @()
    foreach ($row in @(& adb devices -l 2>&1)) {
        if ($row -notmatch '^(\S+)\s+device(?:\s+.*)?$') { continue }
        $serial = $Matches[1]
        if ($serial -match '^emulator-') { continue }
        $identity = ((& adb -s $serial shell getprop ro.serialno 2>$null | Out-String).Trim())
        if ([string]::IsNullOrWhiteSpace($identity)) {
            $identity = ((& adb -s $serial shell getprop ro.boot.serialno 2>$null | Out-String).Trim())
        }
        $kind = if ($serial -match ':\d+$') { 'WIFI' } else { 'USB' }
        $records += [pscustomobject]@{ Serial = $serial; Identity = $identity; Kind = $kind }
    }
    return @($records)
}

function Select-CanonicalAdbRecord {
    $records = @(Get-ReadyAdbRecords)
    if ($records.Count -eq 0) { Fail 'ADB_DEVICE=NOT_READY run=pnpm-scr' }

    if (-not [string]::IsNullOrWhiteSpace($DeviceSerial)) {
        $selected = @($records | Where-Object { $_.Serial -eq $DeviceSerial })
        if ($selected.Count -ne 1) { Fail "ADB target mismatch: $DeviceSerial" }
        return $selected[0]
    }

    $groups = @($records | Group-Object Identity)
    if ($groups.Count -ne 1) { Fail "ADB_DEVICE=AMBIGUOUS physical_devices=$($groups.Count)" }
    $usb = @($groups[0].Group | Where-Object { $_.Kind -eq 'USB' })
    if ($usb.Count -eq 1) { return $usb[0] }
    return @($groups[0].Group | Sort-Object Serial)[0]
}

function Assert-AdbReverseReady([string]$Serial, [int[]]$Ports) {
    $rows = @(& adb -s $Serial reverse --list 2>&1)
    if ($LASTEXITCODE -ne 0) { Fail "ADB_REVERSE=NOT_READY serial=$Serial run=pnpm-scr" }
    foreach ($port in $Ports) {
        if (@($rows | Where-Object { $_ -match "(^|\s)tcp:$port\s+tcp:$port($|\s)" }).Count -ne 1) {
            Fail "ADB_REVERSE=NOT_READY port=$port run=pnpm-scr"
        }
    }
    Write-Host "ADB_REVERSE=PASS serial=$Serial"
}

function Assert-PackageInstalled([string]$Serial, [string]$Package) {
    $path = ((& adb -s $Serial shell pm path $Package 2>$null | Out-String).Trim())
    if ($LASTEXITCODE -ne 0 -or [string]::IsNullOrWhiteSpace($path)) {
        Fail "ANDROID_APP=NOT_INSTALLED package=$Package"
    }
}

function Open-DevelopmentClient(
    [string]$Serial,
    [string]$Name,
    [string]$Package,
    [string]$Scheme,
    [int]$MetroPort
) {
    Assert-PackageInstalled -Serial $Serial -Package $Package
    $projectUrl = "http://127.0.0.1:$MetroPort"
    $encodedUrl = [Uri]::EscapeDataString($projectUrl)
    $deepLink = "${Scheme}://expo-development-client/?url=$encodedUrl"

    Write-Host "MOBILE_OPEN=START app=$Name metro=$projectUrl"
    $output = @(& adb -s $Serial shell am start -W -a android.intent.action.VIEW -d $deepLink 2>&1)
    $exitCode = $LASTEXITCODE
    $lines = @($output | ForEach-Object { ([string]$_).Trim() } | Where-Object { $_ })
    $explicitErrors = @($lines | Where-Object { $_ -match '^Error:|unable to resolve Intent' })
    $statusOk = @($lines | Where-Object { $_ -match '^Status:\s+ok\s*$' }).Count -eq 1
    $activityOk = @($lines | Where-Object { $_ -match "^Activity:\s+$([regex]::Escape($Package))/" }).Count -eq 1
    $launchStateLine = @($lines | Where-Object { $_ -match '^LaunchState:\s+' } | Select-Object -First 1)
    $launchState = if ($launchStateLine.Count -eq 1) { ($launchStateLine[0] -replace '^LaunchState:\s+', '').Trim() } else { 'UNKNOWN' }

    if ($exitCode -ne 0 -or $explicitErrors.Count -gt 0 -or -not $statusOk -or -not $activityOk) {
        $lines | ForEach-Object { Write-Host $_ }
        Fail "MOBILE_OPEN=FAIL app=$Name package=$Package exit=$exitCode status_ok=$statusOk activity_ok=$activityOk"
    }

    Write-Host "MOBILE_OPEN=PASS app=$Name metro=$projectUrl launch=$launchState"
}

if (-not (Get-Command adb -ErrorAction SilentlyContinue)) { Fail 'ADB CLI is required.' }
if (-not (Test-Path -LiteralPath $EnvPath -PathType Leaf)) { Fail "LOCAL_RUNTIME_ENV=NOT_READY reason=missing_env path=$EnvPath" }
if (-not (Test-Path -LiteralPath $EnvExamplePath -PathType Leaf)) { Fail "Missing canonical local runtime template: $EnvExamplePath" }

$envMap = Read-EnvMap -Path $EnvPath
$exampleMap = Read-EnvMap -Path $EnvExamplePath
$device = Select-CanonicalAdbRecord

$apps = @(
    [pscustomobject]@{ Name='client'; Package='com.bthwani.client.next'; Scheme='bthwani-client-next'; PortKey='SAMRIM_APP_CLIENT_METRO_PORT' },
    [pscustomobject]@{ Name='partner'; Package='com.bthwani.partner.next'; Scheme='bthwani-partner-next'; PortKey='SAMRIM_APP_PARTNER_METRO_PORT' },
    [pscustomobject]@{ Name='captain'; Package='com.bthwani.captain.next'; Scheme='bthwani-captain-next'; PortKey='SAMRIM_APP_CAPTAIN_METRO_PORT' },
    [pscustomobject]@{ Name='field'; Package='com.bthwani.field.next'; Scheme='bthwani-field-next'; PortKey='SAMRIM_APP_FIELD_METRO_PORT' }
)

$ports = @(
    Require-TcpPort -Map $envMap -Name 'SAMRIM_IDENTITY_PORT'
    Require-TcpPort -Map $envMap -Name 'SAMRIM_DSH_PORT'
)

foreach ($app in $apps) {
    $runtimePort = Require-TcpPort -Map $envMap -Name $app.PortKey
    $canonicalPort = Require-TcpPort -Map $exampleMap -Name $app.PortKey
    if ($runtimePort -ne $canonicalPort) { Fail "MOBILE_PORT_DRIFT app=$($app.Name) runtime=$runtimePort canonical=$canonicalPort" }
    $app | Add-Member -NotePropertyName MetroPort -NotePropertyValue $runtimePort
    $ports += $runtimePort
}

$ports = @($ports | Sort-Object -Unique)
Write-Host "MOBILE_LAUNCH_DEVICE=PASS serial=$($device.Serial) transport=$($device.Kind) identity=$($device.Identity)"
Assert-AdbReverseReady -Serial $device.Serial -Ports $ports

foreach ($app in $apps) {
    Open-DevelopmentClient -Serial $device.Serial -Name $app.Name -Package $app.Package -Scheme $app.Scheme -MetroPort $app.MetroPort
    Start-Sleep -Milliseconds 350
}

Write-Host 'MOBILE_ALL=PASS'
