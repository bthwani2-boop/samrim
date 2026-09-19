#Requires -Version 7.4
[CmdletBinding()]
param()

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$PSNativeCommandUseErrorActionPreference = $false

$DevicePath=Join-Path $PSScriptRoot 'device-policy.psm1'
if (-not (Get-Command scrcpy -ErrorAction SilentlyContinue)) { throw 'DEVICE_NOT_READY reason=scrcpy_unavailable' }

Import-Module -Name $DevicePath -Force -WarningAction SilentlyContinue
$device=Get-UsbAdbDevice
Write-Host "SCRCPY=START serial=$($device.Serial) transport=USB"
& scrcpy -s ([string]$device.Serial) --max-size=1280 --max-fps=30 --video-bit-rate=4M --no-audio
exit $LASTEXITCODE
