#Requires -Version 7.4
[CmdletBinding()]
param([switch]$RequireInstalled, [string]$Serial = "")
Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"
$adb = (Get-Command adb -ErrorAction Stop).Source
$lines = @(& $adb devices)
$devices = @($lines | Select-Object -Skip 1 | Where-Object {$_ -match '^\S+\s+device$'} | ForEach-Object { ($_ -split '\s+')[0] })
if ($Serial) { if ($Serial -notin $devices) { throw "ANDROID_DEVICE_NOT_CONNECTED" } }
elseif ($devices.Count -ne 1) {throw "Specify -Serial; connected devices=$($devices.Count)"}
else { $Serial = $devices[0] }
function Invoke-Adb([string[]]$Arguments) {
  $result = & $adb -s $Serial @Arguments 2>&1
  if($LASTEXITCODE -ne 0){throw "ADB_ERROR action=$($Arguments[0])"}
  return ($result | Out-String).Trim()
}
$version=Invoke-Adb @("shell","getprop","ro.build.version.release")
$model=Invoke-Adb @("shell","getprop","ro.product.model")
"ANDROID_DEVICE=PASS android=$version model=$model"
foreach($package in @("com.bthwani.client","com.bthwani.partner","com.bthwani.captain")) {
  $installed = @( & $adb -s $Serial shell pm path $package 2>$null )
  $found = $LASTEXITCODE -eq 0 -and ($installed | Select-String -Pattern '^package:')
  if($RequireInstalled -and -not $found){throw "ANDROID_APK_MISSING package=$package"}
  $status=if($found){"INSTALLED"}else{"NOT_INSTALLED"}
  "ORDER_ALERT_APK=$status package=$package"
}
$maestro = Get-Command maestro -ErrorAction SilentlyContinue
"MAESTRO_AVAILABLE=$([bool]$maestro)"
"ORDER_ALERT_DEVICE_PREFLIGHT=PASS apkEvidenceRequired=$RequireInstalled"
