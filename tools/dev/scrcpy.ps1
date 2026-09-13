#Requires -Version 7.4
[CmdletBinding()]
param()

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$PSNativeCommandUseErrorActionPreference = $false

$RepoRoot = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
$EnvPath = Join-Path $RepoRoot 'infra\local\compose\.env'
$DevicePolicyPath = Join-Path $PSScriptRoot 'device-policy.psm1'

function Fail([string]$Message) { throw $Message }

if (-not (Get-Command scrcpy -ErrorAction SilentlyContinue)) { Fail 'DEVICE_NOT_READY reason=scrcpy_unavailable' }
Import-Module -Name $DevicePolicyPath -Force -WarningAction SilentlyContinue

function Start-Scrcpy([string]$Serial, [string]$Transport) {
    Write-Host "SCRCPY=START transport=$Transport serial=$Serial"
    & scrcpy -s $Serial
    $code = $LASTEXITCODE
    Write-Host "SCRCPY=EXIT transport=$Transport serial=$Serial code=$code"
    return $code
}

$device = Prepare-CanonicalAdbDevice -EnvPath $EnvPath -RequireUsbPrimary -PrepareWifiFallback
$identity = [string]$device.Identity
$currentSerial = [string]$device.Serial
$currentTransport = [string]$device.Kind
Write-Host 'DEVICE_OWNER=WINDOWS'
Write-Host 'DEVICE_POLICY=CANONICAL_DEVICE_MODULE'
Write-Host 'ANDROID_DATA_PATH=ADB_REVERSE'
Write-Host 'SCRCPY_ROLE=MIRROR_ONLY'
Write-Host "CABLE_FAILOVER=ARMED serial=$currentSerial"

while ($true) {
    $code = Start-Scrcpy -Serial $currentSerial -Transport $currentTransport
    if (Test-AdbReady -Serial $currentSerial) { Write-Host "SCRCPY_SESSION=CLOSED transport=$currentTransport"; exit $code }
    if ($currentTransport -eq 'USB') {
        $fallback = @(Find-DeviceByIdentity -Identity $identity | Where-Object { $_.Kind -eq 'WIFI' } | Select-Object -First 1)
        if ($fallback.Count -ne 1) { Fail 'DEVICE_NOT_READY reason=wifi_failover_unavailable' }
        Ensure-CanonicalAdbReverse -Serial $fallback[0].Serial -Ports @(Get-CanonicalReversePorts -EnvPath $EnvPath)
        $currentSerial = [string]$fallback[0].Serial
        $currentTransport = 'WIFI'
        Write-Host "ADB_FAILOVER=PASS from=USB to=WIFI serial=$currentSerial"
        continue
    }
    $usb = @(Find-DeviceByIdentity -Identity $identity | Where-Object { $_.Kind -eq 'USB' } | Select-Object -First 1)
    if ($usb.Count -ne 1) { Fail 'DEVICE_NOT_READY reason=usb_failover_unavailable' }
    Ensure-CanonicalAdbReverse -Serial $usb[0].Serial -Ports @(Get-CanonicalReversePorts -EnvPath $EnvPath)
    $currentSerial = [string]$usb[0].Serial
    $currentTransport = 'USB'
    Write-Host "ADB_FAILOVER=PASS from=WIFI to=USB serial=$currentSerial"
}
