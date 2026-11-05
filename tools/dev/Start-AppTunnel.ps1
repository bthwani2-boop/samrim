#Requires -Version 5.1
param(
  [Parameter(Mandatory=$true)]
  [ValidateSet('app-client','app-partner','app-captain','control-panel')]
  [string]$App
)
$ErrorActionPreference='Stop'
Set-StrictMode -Version Latest
$root=(Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
$owners=Get-Content -Raw -LiteralPath (Join-Path $root 'infra\local\runtime-owners.json') | ConvertFrom-Json
if($env:COMPUTERNAME -ne $owners.sourceHost){throw 'APP_TUNNEL_SOURCE_HOST_REQUIRED'}
$target=$owners.sshTarget
$entry=$owners.surfaces.$App
if($entry.owner -ne 'lenovo-native'){throw "APP_TUNNEL_OWNER_MISMATCH app=$App"}
$envName=switch($App){
  'app-client' {'SAMRIM_APP_CLIENT_METRO_PORT'}
  'app-partner' {'SAMRIM_APP_PARTNER_METRO_PORT'}
  'app-captain' {'SAMRIM_APP_CAPTAIN_METRO_PORT'}
  'control-panel' {'SAMRIM_CONTROL_PORT'}
}
$values=@{}
foreach($line in Get-Content -LiteralPath (Join-Path $root 'infra\local\.env')){
  if($line -match '^([A-Z0-9_]+)=(.*)$') {$values[$Matches[1]]=$Matches[2]}
}
$localPort=[int]$values[$envName]
$remotePort=[int]$entry.remotePort
if($localPort -lt 1024 -or $remotePort -lt 1024 -or $localPort -eq $remotePort){throw 'APP_TUNNEL_INVALID_PORT_CONFIG'}
$ssh=Join-Path $env:WINDIR 'System32\OpenSSH\ssh.exe'
if(!(Test-Path -LiteralPath $ssh)){throw 'APP_TUNNEL_SSH_MISSING'}
$argsList=@(
  '-N','-o','BatchMode=yes','-o','StrictHostKeyChecking=yes','-o','ExitOnForwardFailure=yes',
  '-o','ConnectTimeout=8','-o','ServerAliveInterval=15','-o','ServerAliveCountMax=3',
  '-L',("127.0.0.1:"+$localPort+":127.0.0.1:"+$remotePort),$target
)
while($true){
  & $ssh @argsList
  Start-Sleep -Seconds 6
}
