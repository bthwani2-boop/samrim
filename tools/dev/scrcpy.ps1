#Requires -Version 7.4

[CmdletBinding()]
param()

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$PSNativeCommandUseErrorActionPreference = $false

# ============================================================
# Canonical local Galaxy Wireless ADB configuration
# ============================================================

$DeviceIp  = '192.168.137.156'
$StateDir  = Join-Path $env:LOCALAPPDATA 'BThwani'
$StateFile = Join-Path $StateDir 'scrcpy-wireless.json'

function Fail {
    param(
        [Parameter(Mandatory)]
        [string]$Message
    )

    throw $Message
}

function Test-Port {
    param(
        [Parameter(Mandatory)]
        [string]$Value
    )

    if ($Value -notmatch '^\d{1,5}$') {
        return $false
    }

    $port = [int]$Value

    return $port -ge 1 -and $port -le 65535
}

function Get-ConnectedDevice {
    $devices = @()

    foreach ($line in @(& adb devices -l 2>$null)) {
        if (
            $line -match
            ('^\s*(' + [regex]::Escape($DeviceIp) + ':\d+)\s+device(?:\s|$)')
        ) {
            $devices += $Matches[1]
        }
    }

    $devices = @($devices | Sort-Object -Unique)

    if ($devices.Count -gt 1) {
        Fail "ADB_DEVICE=AMBIGUOUS devices=$($devices -join ',')"
    }

    if ($devices.Count -eq 1) {
        return [string]$devices[0]
    }

    return $null
}

function Get-MdnsConnectTargets {
    $targets = @()

    foreach ($line in @(& adb mdns services 2>$null)) {
        if (
            $line -match
            '_adb-tls-connect\._tcp\.?\s+(\d{1,3}(?:\.\d{1,3}){3}):(\d+)'
        ) {
            $ip   = $Matches[1]
            $port = $Matches[2]

            if ($ip -eq $DeviceIp) {
                $targets += "${ip}:${port}"
            }
        }
    }

    return @($targets | Sort-Object -Unique)
}

function Get-SavedConnectionPort {
    if (-not (Test-Path -LiteralPath $StateFile)) {
        return $null
    }

    try {
        $state = Get-Content -LiteralPath $StateFile -Raw |
            ConvertFrom-Json

        $port = [string]$state.connectionPort

        if (Test-Port $port) {
            return $port
        }
    }
    catch {
        return $null
    }

    return $null
}

function Save-ConnectionPort {
    param(
        [Parameter(Mandatory)]
        [string]$Port
    )

    if (-not (Test-Port $Port)) {
        return
    }

    New-Item `
        -ItemType Directory `
        -Path $StateDir `
        -Force |
        Out-Null

    @{
        deviceIp       = $DeviceIp
        connectionPort = [int]$Port
    } |
        ConvertTo-Json |
        Set-Content `
            -LiteralPath $StateFile `
            -Encoding utf8
}

function Try-Connect {
    param(
        [Parameter(Mandatory)]
        [string]$Target
    )

    Write-Host "ADB_CONNECT_TARGET=$Target"

    $output = @(
        & adb connect $Target 2>&1
    )

    if ($output.Count -gt 0) {
        Write-Host ($output -join "`n")
    }

    Start-Sleep -Milliseconds 400

    return Get-ConnectedDevice
}

function Try-SavedConnection {
    $port = Get-SavedConnectionPort

    if ($null -eq $port) {
        return $null
    }

    return Try-Connect -Target "${DeviceIp}:${port}"
}

function Try-MdnsConnection {
    foreach ($target in @(Get-MdnsConnectTargets)) {
        $serial = Try-Connect -Target $target

        if ($null -ne $serial) {
            $port = ($serial -split ':')[-1]
            Save-ConnectionPort -Port $port
            return $serial
        }
    }

    return $null
}

function Invoke-Pairing {
    Write-Host ''
    Write-Host 'ADB_PAIRING_REQUIRED=1'
    Write-Host ''
    Write-Host 'On Galaxy:'
    Write-Host 'Developer options'
    Write-Host '-> Wireless debugging'
    Write-Host '-> Pair device with pairing code'
    Write-Host ''
    Write-Host "Device IP: $DeviceIp"
    Write-Host ''

    $pairingPort = (
        Read-Host 'Pairing port'
    ).Trim()

    if (-not (Test-Port $pairingPort)) {
        Fail 'ADB_PAIRING_PORT=INVALID'
    }

    $pairingCode = (
        Read-Host '6-digit pairing code'
    ).Trim()

    if ($pairingCode -notmatch '^\d{6}$') {
        Fail 'ADB_PAIRING_CODE=INVALID expected=6-digits'
    }

    $pairAddress = "${DeviceIp}:${pairingPort}"

    Write-Host "ADB_PAIR_TARGET=$pairAddress"

    $pairOutput = @(
        & adb pair $pairAddress $pairingCode 2>&1
    )

    $pairExitCode = $LASTEXITCODE
    $pairText = $pairOutput -join "`n"

    if ($pairOutput.Count -gt 0) {
        Write-Host $pairText
    }

    if (
        $pairExitCode -ne 0 -or
        $pairText -notmatch 'Successfully paired'
    ) {
        Fail 'ADB_PAIRING=FAIL'
    }

    Write-Host 'ADB_PAIRING=PASS'
}

function Get-ManualConnection {
    Write-Host ''
    Write-Host 'CONNECTION_PORT_REQUIRED=1'
    Write-Host ''
    Write-Host 'Galaxy is paired, but the normal connection port'
    Write-Host 'could not be discovered automatically.'
    Write-Host ''
    Write-Host 'Open the MAIN Wireless debugging screen.'
    Write-Host "IP is already fixed: $DeviceIp"
    Write-Host ''

    $connectionPort = (
        Read-Host 'Connection port'
    ).Trim()

    if (-not (Test-Port $connectionPort)) {
        Fail 'ADB_CONNECTION_PORT=INVALID'
    }

    $serial = Try-Connect -Target "${DeviceIp}:${connectionPort}"

    if ($null -ne $serial) {
        Save-ConnectionPort -Port $connectionPort
    }

    return $serial
}

# ============================================================
# Preconditions
# ============================================================

foreach ($command in @('adb', 'scrcpy')) {
    if (-not (Get-Command $command -ErrorAction SilentlyContinue)) {
        Fail "$command is not available on PATH."
    }
}

Write-Host 'DEVICE_OWNER=WINDOWS'
Write-Host 'DEVICE_TRANSPORT=WIFI_LAN'
Write-Host "DEVICE_IP=$DeviceIp"
Write-Host 'DOCKER_DEPENDENCY=0'
Write-Host 'ADB_REVERSE_DEPENDENCY=0'

& adb start-server *> $null

if ($LASTEXITCODE -ne 0) {
    Fail 'ADB_SERVER=FAIL'
}

# ============================================================
# 1. Already connected
# ============================================================

$serial = Get-ConnectedDevice

if ($null -ne $serial) {
    Write-Host "ADB_ALREADY_CONNECTED=1 serial=$serial"
}

# ============================================================
# 2. Try last successful connection port
# ============================================================

if ($null -eq $serial) {
    $serial = Try-SavedConnection
}

# ============================================================
# 3. Try mDNS connection discovery
# ============================================================

if ($null -eq $serial) {
    $serial = Try-MdnsConnection
}

# ============================================================
# 4. Decide: known paired connection port OR pairing
# ============================================================

if ($null -eq $serial) {
    Write-Host ''
    Write-Host 'ADB_AUTO_CONNECT=NOT_FOUND'
    Write-Host ''
    Write-Host 'If Galaxy is already paired:'
    Write-Host '  enter its CONNECTION PORT.'
    Write-Host ''
    Write-Host 'If Galaxy is NOT paired:'
    Write-Host '  press ENTER.'
    Write-Host ''

    $answer = (
        Read-Host 'Connection port or ENTER to pair'
    ).Trim()

    if ([string]::IsNullOrWhiteSpace($answer)) {
        Invoke-Pairing

        # Android may expose/connect the normal ADB service
        # immediately after pairing.
        Start-Sleep -Milliseconds 500

        $serial = Get-ConnectedDevice

        if ($null -eq $serial) {
            for ($attempt = 1; $attempt -le 4; $attempt++) {
                $serial = Try-MdnsConnection

                if ($null -ne $serial) {
                    break
                }

                Start-Sleep -Milliseconds 500
            }
        }

        if ($null -eq $serial) {
            $serial = Get-ManualConnection
        }
    }
    else {
        if (-not (Test-Port $answer)) {
            Fail 'ADB_CONNECTION_PORT=INVALID'
        }

        $serial = Try-Connect -Target "${DeviceIp}:${answer}"

        if ($null -ne $serial) {
            Save-ConnectionPort -Port $answer
        }
    }
}

if ($null -eq $serial) {
    Fail 'ADB_CONNECT=FAIL'
}

# ============================================================
# Persist successful connection port
# ============================================================

$connectedPort = ($serial -split ':')[-1]

if (Test-Port $connectedPort) {
    Save-ConnectionPort -Port $connectedPort
}

# ============================================================
# scrcpy
# ============================================================

Write-Host ''
Write-Host "ADB_CONNECT=PASS serial=$serial"
Write-Host 'SCRCPY=START'
Write-Host ''

& scrcpy -s $serial

$scrcpyExitCode = $LASTEXITCODE

if ($scrcpyExitCode -ne 0) {
    Write-Host "SCRCPY_RECOVERY=START exit=$scrcpyExitCode"

    $recoveredSerial = Try-SavedConnection

    if ($null -eq $recoveredSerial) {
        $recoveredSerial = Try-MdnsConnection
    }

    if ($null -eq $recoveredSerial) {
        Fail 'SCRCPY_RECOVERY=FAIL'
    }

    $serial = $recoveredSerial
    Write-Host "SCRCPY_RECOVERY=RECONNECTED serial=$serial"
    & scrcpy -s $serial
    $scrcpyExitCode = $LASTEXITCODE

    if ($scrcpyExitCode -ne 0) {
        Fail "SCRCPY=FAIL exit=$scrcpyExitCode"
    }

    Write-Host 'SCRCPY_RECOVERY=PASS'
}

Write-Host 'SCRCPY=PASS'
