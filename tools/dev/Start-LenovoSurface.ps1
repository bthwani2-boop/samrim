#Requires -Version 5.1
param(
  [Parameter(Mandatory=$true)]
  [ValidateSet('app-client','app-partner','app-captain','control-panel')]
  [string]$App,
  [switch]$Trial
)
$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
$runtimeRoot = 'C:\Users\bthwa\BThwaniAppRunner'
$source = Join-Path $runtimeRoot 'source'
$owners = Get-Content -Raw -LiteralPath (Join-Path $source 'infra\local\runtime-owners.json') | ConvertFrom-Json
if($env:COMPUTERNAME -ne $owners.remoteHost) { throw 'LENOVO_RUNTIME_WRONG_HOST' }
$owner = $owners.surfaces.$App.owner
if($owner -ne 'lenovo-native' -and -not $Trial) { throw "LENOVO_RUNTIME_NOT_OWNER app=$App owner=$owner" }
if($Trial) { $env:SAMRIM_REMOTE_TRIAL = '1' }
$nodeDir = Join-Path $runtimeRoot 'tools\node-v24.19.0-win-x64'
$node = Join-Path $nodeDir 'node.exe'
$launcher = Join-Path $source 'tools\dev\start-surface.mjs'
if(!(Test-Path -LiteralPath $node) -or !(Test-Path -LiteralPath $launcher)) { throw 'LENOVO_RUNTIME_DEPENDENCIES_MISSING' }
$env:PATH = "$nodeDir;$env:PATH"
$env:BTHWANI_SECRETS_ROOT = Join-Path $runtimeRoot 'private'
if($App -ne 'control-panel') {
  $file = Join-Path $env:BTHWANI_SECRETS_ROOT 'env\mobile.env'
  if(!(Test-Path -LiteralPath $file)) { throw "MOBILE_SECRET_ENV_MISSING app=$App" }
  $names = @(Get-Content -LiteralPath $file | Where-Object { $_ -match '^[A-Za-z0-9_]+=\S+' } | ForEach-Object { ($_ -split '=',2)[0] })
  $androidName = switch($App) {
    'app-client' {'GOOGLE_MAPS_ANDROID_API_KEY_APP_CLIENT'}
    'app-partner' {'GOOGLE_MAPS_ANDROID_API_KEY_APP_PARTNER'}
    'app-captain' {'GOOGLE_MAPS_ANDROID_API_KEY_APP_CAPTAIN'}
  }
  $iosName = if($App -eq 'app-captain') {'GOOGLE_MAPS_IOS_API_KEY_APP_CAPTAIN'} else {'GOOGLE_MAPS_IOS_API_KEY'}
  if($androidName -notin $names -or $iosName -notin $names) { throw "MOBILE_MAP_KEYS_MISSING app=$App" }
} else {
  $file = Join-Path $env:BTHWANI_SECRETS_ROOT 'env\control.env'
  if(!(Test-Path -LiteralPath $file)) { throw 'CONTROL_SECRET_ENV_MISSING' }
  foreach($line in Get-Content -LiteralPath $file) {
    if(!$line -or $line.Trim().StartsWith('#')) { continue }
    $parts = $line.Split('=',2)
    if($parts.Length -ne 2 -or $parts[0] -notin @('CONTROL_PANEL_DEVELOPMENT_PASSWORD','CONTROL_PANEL_SERVICE_TOKEN')) { throw 'CONTROL_SECRET_NAME_INVALID' }
    if([string]::IsNullOrWhiteSpace($parts[1])) { throw 'CONTROL_SECRET_EMPTY' }
    [Environment]::SetEnvironmentVariable($parts[0],$parts[1],'Process')
  }
}
Set-Location -LiteralPath (Join-Path $source "apps\$App")
& $node $launcher $App
exit $LASTEXITCODE
