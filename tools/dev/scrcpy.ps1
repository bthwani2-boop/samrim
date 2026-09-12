#Requires -Version 7.4

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$PSNativeCommandUseErrorActionPreference = $false

function Fail([string]$Message) { throw $Message }

function Test-Target([string]$Value) {
    return $Value -match '^\d{1,3}(?:\.\d{1,3}){3}:\d{1,5}$'
}

function Get-ConnectedWireless {
    $devices = @(
        & adb devices 2>$null |
            ForEach-Object {
                if ($_ -match '^\s*(\d{1,3}(?:\.\d{1,3}){3}:\d+)\s+device\s*$') {
                    $Matches[1]
                }
            } |
            Sort-Object -Unique
    )

    if ($devices.Count -gt 1) {
        Fail "ADB_DEVICE=AMBIGUOUS devices=$($devices -join ',')"
    }

    if ($devices.Count -eq 1) { return [string]$devices[0] }
    return $null
}

function Get-MdnsTargets {
    return @(
        & adb mdns services 2>$null |
            ForEach-Object {
                if ($_ -match '_adb-tls-connect\._tcp\.?\s+(\d{1,3}(?:\.\d{1,3}){3}:\d+)') {
                    $Matches[1]
                }
            } |
            Sort-Object -Unique
    )
}

function Connect-Target([string]$Target) {
    if (-not (Test-Target $Target)) { Fail 'ADB_TARGET=INVALID expected=IP:PORT' }

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

    if ($targets.Count -gt 1) {
        Write-Host "ADB_MDNS=AMBIGUOUS targets=$($targets -join ',')"
    }

    return $null
}

foreach ($command in @('adb', 'scrcpy')) {
    if (-not (Get-Command $command -ErrorAction SilentlyContinue)) {
        Fail "$command is not available on PATH."
    }
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
    Write-Host 'Open Galaxy > Developer options > Wireless debugging.'
    Write-Host 'Enter the IP address & Port shown on the MAIN screen.'
    Write-Host 'Enter P only if this computer is not paired.'
    Write-Host ''

    $answer = (Read-Host 'Connection target IP:PORT or P to pair').Trim()

    if ($answer -ieq 'P') {
        Write-Host ''
        Write-Host 'Galaxy > Wireless debugging > Pair device with pairing code'
        $pairTarget = (Read-Host 'Pairing target IP:PORT').Trim()
        $pairCode = (Read-Host '6-digit pairing code').Trim()

        if (-not (Test-Target $pairTarget)) { Fail 'ADB_PAIR_TARGET=INVALID expected=IP:PORT' }
        if ($pairCode -notmatch '^\d{6}$') { Fail 'ADB_PAIR_CODE=INVALID expected=6-digits' }

        & adb pair $pairTarget $pairCode
        if ($LASTEXITCODE -ne 0) { Fail 'ADB_PAIRING=FAIL' }

        Start-Sleep -Seconds 1
        $serial = Resolve-Wireless

        if ($null -eq $serial) {
            Write-Host ''
            Write-Host 'Pairing succeeded. Now use the IP address & Port from the MAIN Wireless debugging screen.'
            $answer = (Read-Host 'Connection target IP:PORT').Trim()
            $serial = Connect-Target $answer
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
