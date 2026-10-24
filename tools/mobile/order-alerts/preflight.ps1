#Requires -Version 7.4
[CmdletBinding()]
param([switch]$RequireFirebase)
Set-StrictMode -Version Latest
$ErrorActionPreference="Stop"
$Root = (Resolve-Path (Join-Path $PSScriptRoot "../../..")).Path
$SecretsRoot = if($env:BTHWANI_SECRETS_ROOT){$env:BTHWANI_SECRETS_ROOT}else{"C:\BTHWANI-Secrets\samrim"}
$Apps=@("app-client","app-partner","app-captain")
foreach($App in $Apps){
  $AppRoot=Join-Path $Root ("apps/"+$App)
  $Config=Get-Content -LiteralPath (Join-Path $AppRoot "mobile.config.json") -Raw | ConvertFrom-Json
  $Eas=Get-Content -LiteralPath (Join-Path $AppRoot "eas.json") -Raw | ConvertFrom-Json
  if($Config.projectId -notmatch '^[a-f0-9-]{36}$'){throw "EAS project ID missing for $App"}
  if($Eas.build.development.android.buildType -ne "apk"){throw "Development APK profile missing for $App"}
  foreach($tone in @("classic","soft","urgent")){
    $File=Join-Path $AppRoot ("assets/sounds/order_"+$tone+".wav")
    if(!(Test-Path -LiteralPath $File)){throw "Missing notification sound for $App / $tone"}
  }
  $FirebaseFile=Join-Path $SecretsRoot ("expo/"+$App+"/google-services.json")
  if($RequireFirebase){
    if(!(Test-Path -LiteralPath $FirebaseFile)){throw "FCM_CLIENT_CONFIG_REQUIRED for $App in external vault"}
    $Google=Get-Content -LiteralPath $FirebaseFile -Raw | ConvertFrom-Json
    $Packages=@($Google.client | ForEach-Object {$_.client_info.android_client_info.package_name})
    if($Config.androidPackage -notin $Packages){throw "FCM_PACKAGE_MISMATCH for $App"}
    Write-Output "ORDER_ALERT_FIREBASE=PASS app=$App"
  }else{
    Write-Output "ORDER_ALERT_FIREBASE=$($(if(Test-Path -LiteralPath $FirebaseFile){'AVAILABLE'}else{'NOT_PRESENT'})) app=$App (credential contents not shown)"
  }
  Write-Output "ORDER_ALERT_ANDROID_SOURCE=PASS app=$App"
}
& node (Join-Path $Root "tools/mobile/verify-mobile-config.mjs")
if($LASTEXITCODE -ne 0){ throw "Mobile configuration failed" }
Write-Output "ORDER_ALERTS_PREFLIGHT=PASS requiresRemoteBuild=true submitted=false"
