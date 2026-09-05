#Requires -Version 7.4
[CmdletBinding()]
param(
    [Parameter(ValueFromRemainingArguments)]
    [string[]] $ScrcpyArgs
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$adb = Get-Command adb -ErrorAction SilentlyContinue
if (-not $adb) {
    throw 'adb is required and must be available on PATH.'
}

$scrcpy = Get-Command scrcpy -ErrorAction SilentlyContinue
if (-not $scrcpy) {
    throw 'scrcpy is required and must be available on PATH.'
}

$deviceLines = @(& $adb.Source devices -l)
if ($LASTEXITCODE -ne 0) {
    throw 'Unable to enumerate ADB devices.'
}

$devices = @(
    foreach ($line in $deviceLines) {
        if ($line -match '^\s*(\S+)\s+device(?:\s|$)') {
            [pscustomobject]@{
                Serial = $Matches[1]
                Wireless = (
                    $Matches[1] -match ':\d+$' -or
                    $Matches[1] -match '_adb-tls-connect\._tcp$'
                )
            }
        }
    }
)

if ($devices.Count -eq 0) {
    throw 'No online ADB device was found. Connect the phone by USB or establish ADB wireless debugging first.'
}

$requestedSerial = [string] $env:ANDROID_SERIAL
$selected = $null

if (-not [string]::IsNullOrWhiteSpace($requestedSerial)) {
    $selected = @($devices | Where-Object Serial -EQ $requestedSerial)

    if ($selected.Count -eq 0) {
        throw "ANDROID_SERIAL '$requestedSerial' is not an online ADB device."
    }

    $selected = $selected[0]
}
else {
    $usbDevices = @($devices | Where-Object { -not $_.Wireless })
    $wirelessDevices = @($devices | Where-Object Wireless)

    if ($usbDevices.Count -eq 1) {
        $selected = $usbDevices[0]
    }
    elseif ($usbDevices.Count -gt 1) {
        throw 'More than one USB ADB device is online. Set ANDROID_SERIAL to select the intended device.'
    }
    elseif ($wirelessDevices.Count -eq 1) {
        $selected = $wirelessDevices[0]
    }
    elseif ($wirelessDevices.Count -gt 1) {
        throw 'More than one wireless ADB device is online. Set ANDROID_SERIAL to select the intended device.'
    }
}

if (-not $selected) {
    throw 'Unable to select an ADB device.'
}

$transport = if ($selected.Wireless) { 'WIFI' } else { 'USB' }
Write-Host "SCRCPY_TRANSPORT=$transport"
Write-Host "SCRCPY_DEVICE=$($selected.Serial)"

& $scrcpy.Source -s $selected.Serial @ScrcpyArgs
exit $LASTEXITCODE
