#Requires -Version 7.4

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$PSNativeCommandUseErrorActionPreference = $false

function Fail([string]$Message) { throw $Message }

function Test-Ip([string]$Value) {
    return $Value -match '^\d{1,3}(?:\.\d{1,3}){3}$'
}

function Test-Port([string]$Value) {
    if ($Value -notmatch '^\d{1,5}$') { return $false }
    $port = [int]$Value
    return $port -ge 1 -and $port -le 65535
}

function Test-Target([string]$Value) {
    if ($Value -notmatch '^(\d{1,3}(?:\.\d{1,3}){3}):(\d{1,5})$') { return $false }
    return (Test-Ip $Matches[1]) -and (Test-Port $Matches[2])
}

function Get-ConnectedWireless {
    $devices = @(
        & adb devices 2>$null |
            ForEach-Object {
                if ($_ -match '^\s*(\d{1,3}(?:\.\d{1,3}){3}:\d+)\s+device\s*$') { $Matches[1] }
            } |
            Sort-Object -Unique
    )

    if ($devices.Count -gt 1) { Fail "ADB_DEVICE=AMBIGUOUS devices=$($devices -join ',')" }
    if ($devices.Count -eq 1) { return [string]$devices[0] }
    return $null
}

function Get-MdnsTargets {
    return @(
        & adb mdns services 2>$null |
            ForEach-Object {
                if ($_ -match '_adb-tls-connect\._tcp\.?\s+(\d{1,3}(?:\.\d{1,3}){3}:\d+)') { $Matches[1] }
            } |
            Sort-Object -Unique
    )
}

function Get-KnownIps {
    return @(
        @(& adb devices 2>$null) + @(& adb mdns services 2>$null) |
            ForEach-Object {
                if ($_ -match '(\d{1,3}(?:\.\d{1,3}){3})(?::\d+)?') { $Matches[1] }
            } |
            Sort-Object -Unique
    )
}

function Resolve-Target([string]$Value) {
    $Value = $Value.Trim()
    if (Test-Target $Value) { return $Value }
    if (-not (Test-Port $Value)) { Fail 'ADB_TARGET=INVALID expected=PORT or IP:PORT' }

    $ips = @(Get-KnownIps)
    if ($ips.Count -eq 1) { return "$($ips[0]):$Value" }

    $ip = (Read-Host 'Device IP').Trim()
    if (-not (Test-Ip $ip)) { Fail 'ADB_IP=INVALID' }
    return "${ip}:$Value"
}

function Connect-Target([string]$Target) {
    $Target = Resolve-Target $Target
    Write-Host "ADB_CONNECT_TARGET=$Target"
    & adb connect $Target
    Start-Sleep -Milliseconds 300

    $state = (& adb -s $Target get-state 2>$null | Select-Object -First 1)
    if ($LASTEXITCODE -eq 0 -and $state -eq 'device') { return $Target }
    return $null
}

function Resolve-Wireless {
    $serial = Get-ConnectedWireless
    if ($null -ne $serial) { return $serial }

    $targets = @(Get-MdnsTargets)
    if ($targets.Count -eq 1) { return Connect-Target $targets[0] }
    if ($targets.Count -gt 1) { Write-Host "ADB_MDNS=AMBIGUOUS targets=$($targets -join ',')" }
    return $null
}

foreach ($command in @('adb', 'scrcpy')) {
    if (-not (Get-Command $command -ErrorAction SilentlyContinue)) { Fail "$command is not available on PATH." }
}

Write-Host 'DEVICE_OWNER=WINDOWS'
Write-Host 'DEVICE_TRANSPORT=WIFI_LAN'
Write-Host 'DOCKER_DEPENDENCY=0'
Write-Host 'ADB_REVERSE_DEPENDENCY=0'

& adb start-server *> $null
if ($LASTEXITCODE -ne 0) { Fail 'ADB_SERVER=FAIL' }

$serial = Resolve-Wireless

if ($null -eq $serial) {
    Write-Host ''
    Write-Host 'Galaxy > Developer options > Wireless debugging'
    Write-Host 'Enter the MAIN screen connection PORT, or IP:PORT.'
    Write-Host 'Enter P only if this computer is not paired.'
    Write-Host ''

    $answer = (Read-Host 'Connection PORT / IP:PORT / P').Trim()

    if ($answer -ieq 'P') {
        Write-Host ''
        Write-Host 'Galaxy > Wireless debugging > Pair device with pairing code'
        $pairTarget = Resolve-Target (Read-Host 'Pairing PORT or IP:PORT')
        $pairCode = (Read-Host '6-digit pairing code').Trim()
        if ($pairCode -notmatch '^\d{6}$') { Fail 'ADB_PAIR_CODE=INVALID expected=6-digits' }

        & adb pair $pairTarget $pairCode
        if ($LASTEXITCODE -ne 0) { Fail 'ADB_PAIRING=FAIL' }

        Start-Sleep -Seconds 1
        $serial = Resolve-Wireless
        if ($null -eq $serial) {
            $serial = Connect-Target (Read-Host 'MAIN screen connection PORT or IP:PORT')
        }
    }
    else {
        $serial = Connect-Target $answer
    }
}

if ($null -eq $serial) { Fail 'ADB_CONNECT=FAIL' }

Write-Host "ADB_CONNECT=PASS serial=$serial"
Write-Host 'SCRCPY=START'
& scrcpy -s $serial
if ($LASTEXITCODE -ne 0) { Fail "SCRCPY=FAIL exit=$LASTEXITCODE" }
Write-Host 'SCRCPY=PASS'
