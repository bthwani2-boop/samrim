#Requires -Version 7.4

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$PSNativeCommandUseErrorActionPreference = $false

function Fail([string]$Message) { throw $Message }

function Get-AdbDevices {
    return @(
        & adb devices 2>$null |
            ForEach-Object {
                if ($_ -match '^\s*(\S+)\s+device\s*$') { $Matches[1] }
            } |
            Sort-Object -Unique
    )
}

function Get-Wifi5555 {
    $devices = @(Get-AdbDevices | Where-Object { $_ -match '^\d{1,3}(?:\.\d{1,3}){3}:5555$' })
    if ($devices.Count -gt 1) { Fail "ADB_WIFI=AMBIGUOUS devices=$($devices -join ',')" }
    if ($devices.Count -eq 1) { return [string]$devices[0] }
    return $null
}

function Get-UsbDevice {
    $devices = @(
        Get-AdbDevices |
            Where-Object { $_ -notmatch '^\d{1,3}(?:\.\d{1,3}){3}:\d+$' -and $_ -notmatch '^emulator-' }
    )
    if ($devices.Count -gt 1) { Fail "ADB_USB=AMBIGUOUS devices=$($devices -join ',')" }
    if ($devices.Count -eq 1) { return [string]$devices[0] }
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
    if (-not (Get-Command $command -ErrorAction SilentlyContinue)) { Fail "$command is not available on PATH." }
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
    $usb = Get-UsbDevice
    if ($null -eq $usb) {
        Fail 'ADB_USB_REQUIRED connect Galaxy by USB, enable USB debugging, accept this computer, then rerun pnpm scr'
    }

    $ip = Get-DeviceWifiIp $usb
    if ($null -eq $ip) { Fail 'ADB_WIFI_IP=NOT_FOUND ensure Galaxy Wi-Fi is connected, then rerun pnpm scr' }

    Write-Host "ADB_USB=PASS serial=$usb"
    Write-Host "DEVICE_IP=$ip"
    Write-Host 'ADB_TCPIP=START port=5555'

    & adb -s $usb tcpip 5555
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
