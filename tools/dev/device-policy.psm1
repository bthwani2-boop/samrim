#Requires -Version 7.4
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$PSNativeCommandUseErrorActionPreference = $false

function Fail([string]$Message) { throw $Message }

function Get-UsbAdbDevice {
    if (-not (Get-Command adb -ErrorAction SilentlyContinue)) { Fail 'DEVICE_NOT_READY reason=adb_unavailable' }
    & adb start-server *> $null
    if ($LASTEXITCODE -ne 0) { Fail 'DEVICE_NOT_READY reason=adb_server' }

    $rows=@(& adb devices -l 2>&1)
    if ($LASTEXITCODE -ne 0) { Fail 'DEVICE_NOT_READY reason=adb_devices' }

    $devices=@()
    foreach ($row in $rows) {
        if ([string]$row -notmatch '^(?<serial>\S+)\s+device\b') { continue }
        $serial=[string]$Matches.serial
        $isNetwork=($serial -match ':\d+$' -or $serial -match '_adb-tls-connect\._tcp')
        $isEmulator=$serial.StartsWith('emulator-',[StringComparison]::OrdinalIgnoreCase)
        if (-not $isNetwork -and -not $isEmulator) {
            $devices += [pscustomobject]@{ Serial=$serial }
        }
    }

    if ($devices.Count -ne 1) { Fail "DEVICE_NOT_READY reason=single_usb_required observed=$($devices.Count)" }
    Write-Host "ADB_DEVICE=PASS serial=$($devices[0].Serial) transport=USB"
    return $devices[0]
}

function Ensure-AdbReverse([string]$Serial,[int[]]$Ports) {
    $unique=@($Ports | Sort-Object -Unique)
    foreach ($port in $unique) {
        & adb -s $Serial reverse "tcp:$port" "tcp:$port" *> $null
        if ($LASTEXITCODE -ne 0) { Fail "ADB_REVERSE=FAIL serial=$Serial port=$port" }
    }
    Write-Host "ADB_REVERSE=PASS serial=$Serial ports=$($unique -join ',')"
}

Export-ModuleMember -Function Get-UsbAdbDevice,Ensure-AdbReverse
