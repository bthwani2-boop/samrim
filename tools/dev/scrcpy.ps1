#Requires -Version 7.4

[CmdletBinding()]
param()

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$PSNativeCommandUseErrorActionPreference = $false

function Fail {
    param(
        [Parameter(Mandatory)]
        [string]$Message
    )

    throw $Message
}

function New-Token {
    param(
        [Parameter(Mandatory)]
        [ValidateRange(1, 128)]
        [int]$Length
    )

    $alphabet =
        'ABCDEFGHIJKLMNOPQRSTUVWXYZ' +
        'abcdefghijklmnopqrstuvwxyz' +
        '0123456789'

    $bytes = [byte[]]::new($Length)
    [System.Security.Cryptography.RandomNumberGenerator]::Fill($bytes)

    $chars = foreach ($byte in $bytes) {
        $alphabet[$byte % $alphabet.Length]
    }

    return -join $chars
}

function Get-MdnsServices {
    $output = @(
        & adb mdns services 2>$null
    )

    if ($LASTEXITCODE -ne 0) {
        return @()
    }

    return $output
}

function Get-PairAddress {
    param(
        [Parameter(Mandatory)]
        [string]$ServiceName
    )

    foreach ($line in @(Get-MdnsServices)) {
        if (
            $line -match
            '^\s*(\S+)\s+_adb-tls-pairing\._tcp\s+(\d{1,3}(?:\.\d{1,3}){3}:\d+)\s*$'
        ) {
            $name = $Matches[1]
            $address = $Matches[2]

            if ($name -eq $ServiceName) {
                return $address
            }
        }
    }

    return $null
}

function Get-ConnectAddress {
    param(
        [Parameter(Mandatory)]
        [string]$IpAddress
    )

    foreach ($line in @(Get-MdnsServices)) {
        if (
            $line -match
            '^\s*(\S+)\s+_adb-tls-connect\._tcp\s+(\d{1,3}(?:\.\d{1,3}){3}:\d+)\s*$'
        ) {
            $address = $Matches[2]

            if ($address.StartsWith("${IpAddress}:")) {
                return $address
            }
        }
    }

    return $null
}

function Get-ConnectedWirelessSerial {
    param(
        [Parameter(Mandatory)]
        [string]$IpAddress
    )

    $pattern =
        '^(' +
        [regex]::Escape($IpAddress) +
        ':\d+)\s+device(?:\s|$)'

    foreach ($line in @(& adb devices -l 2>$null)) {
        if ($line -match $pattern) {
            return $Matches[1]
        }
    }

    return $null
}

# -------------------------------------------------------------------
# Preconditions
# -------------------------------------------------------------------

foreach ($command in @('adb', 'scrcpy', 'pnpm')) {
    if (-not (Get-Command $command -ErrorAction SilentlyContinue)) {
        Fail "$command is not available on PATH."
    }
}

Write-Host 'DEVICE_OWNER=WINDOWS'
Write-Host 'DEVICE_TRANSPORT=WIFI_LAN'
Write-Host 'DOCKER_DEPENDENCY=0'
Write-Host 'ADB_REVERSE_DEPENDENCY=0'

& adb start-server *> $null

if ($LASTEXITCODE -ne 0) {
    Fail 'ADB_SERVER=FAIL'
}

# -------------------------------------------------------------------
# Create one exact Wireless ADB QR pairing session
# -------------------------------------------------------------------

$serviceName =
    "ADB_WIFI_$(New-Token -Length 14)-$(New-Token -Length 6)"

$password =
    New-Token -Length 21

$payload =
    "WIFI:T:ADB;S:$serviceName;P:$password;;"

Write-Host ''
Write-Host 'ADB_PAIRING=QR'
Write-Host "ADB_PAIR_SERVICE=$serviceName"
Write-Host ''
Write-Host 'On Galaxy:'
Write-Host 'Developer options'
Write-Host '-> Wireless debugging'
Write-Host '-> Pair device with QR code'
Write-Host ''

# qrcode-terminal is used only to render the QR.
# It does NOT perform pairing or device discovery.
& pnpm dlx qrcode-terminal@0.12.0 "$payload"

if ($LASTEXITCODE -ne 0) {
    Fail 'QR_RENDER=FAIL'
}

Write-Host ''
Write-Host 'WAITING_FOR_QR_SCAN=1'

# -------------------------------------------------------------------
# Wait ONLY for the pairing service created by this QR
# -------------------------------------------------------------------

$pairAddress = $null
$pairDeadline = [DateTime]::UtcNow.AddSeconds(120)

while (
    $null -eq $pairAddress -and
    [DateTime]::UtcNow -lt $pairDeadline
) {
    $pairAddress =
        Get-PairAddress -ServiceName $serviceName

    if ($null -eq $pairAddress) {
        Start-Sleep -Milliseconds 500
    }
}

if ($null -eq $pairAddress) {
    Fail "ADB_PAIR_SERVICE=TIMEOUT service=$serviceName"
}

Write-Host "ADB_PAIR_SERVICE=FOUND address=$pairAddress"

$separator = $pairAddress.LastIndexOf(':')

if ($separator -le 0) {
    Fail "ADB_PAIR_ADDRESS=INVALID address=$pairAddress"
}

$deviceIp =
    $pairAddress.Substring(0, $separator)

# -------------------------------------------------------------------
# Pair
# -------------------------------------------------------------------

$paired = $false
$lastPairResult = ''

for ($attempt = 1; $attempt -le 3; $attempt++) {
    Write-Host "ADB_PAIR_ATTEMPT=$attempt"

    $pairOutput = @(
        & adb pair $pairAddress $password 2>&1
    )

    $pairExitCode = $LASTEXITCODE
    $lastPairResult = $pairOutput -join "`n"

    if (
        $pairExitCode -eq 0 -and
        $lastPairResult -match 'Successfully paired'
    ) {
        $paired = $true
        break
    }

    if ($attempt -lt 3) {
        Start-Sleep -Milliseconds 750

        $freshPairAddress =
            Get-PairAddress -ServiceName $serviceName

        if ($null -ne $freshPairAddress) {
            $pairAddress = $freshPairAddress
        }
    }
}

if (-not $paired) {
    Write-Host ''
    Write-Host $lastPairResult
    Fail 'ADB_PAIRING=FAIL'
}

Write-Host 'ADB_PAIRING=PASS'

# -------------------------------------------------------------------
# Discover normal Wireless ADB connection port and connect
# -------------------------------------------------------------------

$serial = $null
$connectDeadline = [DateTime]::UtcNow.AddSeconds(30)

while (
    $null -eq $serial -and
    [DateTime]::UtcNow -lt $connectDeadline
) {
    # It may already be connected automatically.
    $serial =
        Get-ConnectedWirelessSerial -IpAddress $deviceIp

    if ($null -ne $serial) {
        break
    }

    $connectAddress =
        Get-ConnectAddress -IpAddress $deviceIp

    if ($null -ne $connectAddress) {
        Write-Host "ADB_CONNECT_TARGET=$connectAddress"

        $connectOutput = @(
            & adb connect $connectAddress 2>&1
        )

        if ($connectOutput.Count -gt 0) {
            Write-Host ($connectOutput -join "`n")
        }

        Start-Sleep -Milliseconds 500

        $serial =
            Get-ConnectedWirelessSerial -IpAddress $deviceIp
    }

    if ($null -eq $serial) {
        Start-Sleep -Milliseconds 500
    }
}

if ($null -eq $serial) {
    Fail "ADB_CONNECT=FAIL ip=$deviceIp"
}

Write-Host "ADB_CONNECT=PASS serial=$serial"

# -------------------------------------------------------------------
# scrcpy
# -------------------------------------------------------------------

Write-Host ''
Write-Host 'SCRCPY=START'
Write-Host "SCRCPY_DEVICE=$serial"
Write-Host ''

& scrcpy -s $serial

if ($LASTEXITCODE -ne 0) {
    Fail "SCRCPY=FAIL exit=$LASTEXITCODE"
}

Write-Host 'SCRCPY=PASS'
