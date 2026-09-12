#Requires -Version 7.4

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$PSNativeCommandUseErrorActionPreference = $false

function Fail([string]$Message) { throw $Message }

function Get-AdbRows {
    return @(
        & adb devices -l 2>$null |
            Select-Object -Skip 1 |
            ForEach-Object {
                if ($_ -match '^\s*(\S+)\s+(\S+)(?:\s+.*)?$') {
                    [pscustomobject]@{
                        Serial = $Matches[1]
                        State  = $Matches[2]
                    }
                }
            }
    )
}

function Get-Wifi5555 {
    $rows = @(
        Get-AdbRows |
            Where-Object {
                $_.State -eq 'device' -and
                $_.Serial -match '^\d{1,3}(?:\.\d{1,3}){3}:5555$'
            }
    )

    if ($rows.Count -gt 1) { Fail "ADB_WIFI=AMBIGUOUS devices=$($rows.Serial -join ',')" }
    if ($rows.Count -eq 1) { return [string]$rows[0].Serial }
    return $null
}

function Get-UsbRow {
    $rows = @(
        Get-AdbRows |
            Where-Object {
                $_.Serial -notmatch '^\d{1,3}(?:\.\d{1,3}){3}:\d+$' -and
                $_.Serial -notmatch '^emulator-'
            }
    )

    if ($rows.Count -gt 1) { Fail "ADB_USB=AMBIGUOUS devices=$($rows.Serial -join ',')" }
    if ($rows.Count -eq 1) { return $rows[0] }
    return $null
}

function Get-DeviceWifiIp([string]$Serial) {
    $text = (& adb -s $Serial shell ip -4 addr show wlan0 2>$null) -join "`n"
    if ($text -match '\binet\s+(\d{1,3}(?:\.\d{1,3}){3})/') { return $Matches[1] }

    $text = (& adb -s $Serial shell ip route 2>$null) -join "`n"
    if ($text -match '\bsrc\s+(\d{1,3}(?:\.\d{1,3}){3})\b') { return $Matches[1] }

    return $null
}

foreach ($command in @('adb', 'scrcpy')) {
    if (-not (Get-Command $command -ErrorAction SilentlyContinue)) {
        Fail "$command is not available on PATH."
    }
}

Write-Host 'DEVICE_OWNER=WINDOWS'
Write-Host 'DEVICE_TRANSPORT=USB_BOOTSTRAP_WIFI_TCPIP'
Write-Host 'ADB_TCP_PORT=5555'
Write-Host 'DOCKER_DEPENDENCY=0'
Write-Host 'ADB_REVERSE_DEPENDENCY=0'

& adb start-server *> $null
if ($LASTEXITCODE -ne 0) { Fail 'ADB_SERVER=FAIL' }

$serial = Get-Wifi5555

if ($null -eq $serial) {
    $usb = Get-UsbRow

    if ($null -eq $usb) {
        Write-Host ''
        Write-Host 'ADB_DEVICES:'
        & adb devices -l | Out-Host
        Write-Host ''
        Fail 'ADB_USB=NOT_VISIBLE Windows/MTP can see the phone while ADB cannot. Enable Developer options > USB debugging, unlock Galaxy, reconnect USB, and accept Allow USB debugging. If adb devices stays empty, check the Samsung Android ADB Interface driver/cable/USB port.'
    }

    if ($usb.State -eq 'unauthorized') {
        Write-Host ''
        & adb devices -l | Out-Host
        Write-Host ''
        Fail 'ADB_USB=UNAUTHORIZED unlock Galaxy and accept the Allow USB debugging RSA prompt for this computer, then rerun pnpm scr'
    }

    if ($usb.State -ne 'device') {
        Write-Host ''
        & adb devices -l | Out-Host
        Write-Host ''
        Fail "ADB_USB=$($usb.State.ToUpper()) reconnect USB and rerun pnpm scr"
    }

    $ip = Get-DeviceWifiIp $usb.Serial
    if ($null -eq $ip) {
        Fail 'ADB_WIFI_IP=NOT_FOUND ensure Galaxy Wi-Fi is connected, then rerun pnpm scr'
    }

    Write-Host "ADB_USB=PASS serial=$($usb.Serial)"
    Write-Host "DEVICE_IP=$ip"
    Write-Host 'ADB_TCPIP=START port=5555'

    & adb -s $usb.Serial tcpip 5555
    if ($LASTEXITCODE -ne 0) { Fail 'ADB_TCPIP=FAIL' }

    $target = "${ip}:5555"
    $serial = $null

    for ($attempt = 1; $attempt -le 5; $attempt++) {
        Start-Sleep -Milliseconds 500
        & adb connect $target | Out-Host
        $state = (& adb -s $target get-state 2>$null | Select-Object -First 1)
        if ($LASTEXITCODE -eq 0 -and $state -eq 'device') {
            $serial = $target
            break
        }
    }

    if ($null -eq $serial) { Fail "ADB_WIFI_CONNECT=FAIL target=$target" }
}

Write-Host "ADB_WIFI=PASS serial=$serial"
Write-Host 'SCRCPY=START'
& scrcpy -s $serial
if ($LASTEXITCODE -ne 0) { Fail "SCRCPY=FAIL exit=$LASTEXITCODE" }
Write-Host 'SCRCPY=PASS'
