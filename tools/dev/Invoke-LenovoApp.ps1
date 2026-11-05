#Requires -Version 5.1
param(
  [Parameter(Mandatory=$true)]
  [ValidateSet('app-client','app-partner','app-captain','control-panel')]
  [string]$App,
  [switch]$Trial
)
$ErrorActionPreference = 'Stop'
$base = 'C:\Users\bthwa\BThwaniAppRunner'
$script = Join-Path $base 'source\tools\dev\Start-LenovoSurface.ps1'
$logDir = Join-Path $base 'logs'
New-Item -ItemType Directory -Force -Path $logDir | Out-Null
if(!(Test-Path -LiteralPath $script)) { throw 'LENOVO_LAUNCHER_NOT_FOUND' }
$argsList = @('-NoProfile','-NonInteractive','-WindowStyle','Hidden','-ExecutionPolicy','RemoteSigned','-File',$script,'-App',$App)
if($Trial){$argsList += '-Trial'}
& powershell.exe @argsList 1>> (Join-Path $logDir ($App+'.out.log')) 2>> (Join-Path $logDir ($App+'.err.log'))
exit $LASTEXITCODE
