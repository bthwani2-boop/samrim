#Requires -Version 5.1
<# One loopback-only Surface -> Lenovo development tunnel; one scheduled owner. #>
[CmdletBinding()]
param([switch]$ValidateOnly)
$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
if ([Environment]::MachineName -ne 'BTHWANI') { throw 'APP_TUNNEL_SOURCE_HOST_REQUIRED' }
$layout = Get-Content -LiteralPath (Join-Path $PSScriptRoot 'ports.json') -Raw | ConvertFrom-Json
$forwards = @(
  foreach($app in $layout.apps.PSObject.Properties){
    @{Name=$app.Name;Local=[int]$app.Value.surface;Remote=[int]$app.Value.lenovo}
  }
  foreach($owner in $layout.ownerForwards.PSObject.Properties){
    @{Name=$owner.Name;Local=[int]$owner.Value;Remote=[int]$owner.Value}
  }
)
if($forwards.Count -ne 6 -or @($forwards.Local|Sort-Object -Unique).Count -ne $forwards.Count){throw 'APP_TUNNEL_PORT_COLLISION'}
foreach($f in $forwards){
  if($f.Local -lt 1024 -or $f.Local -gt 65535 -or $f.Remote -lt 1024 -or $f.Remote -gt 65535){throw 'APP_TUNNEL_INVALID_PORT_CONFIG'}
}
$ssh = Join-Path $env:WINDIR 'System32\OpenSSH\ssh.exe'
if (-not (Test-Path -LiteralPath $ssh)) { throw 'APP_TUNNEL_SSH_MISSING' }
$target = 'bthwani-docker'
$argsList = @('-N','-T','-o','BatchMode=yes','-o','StrictHostKeyChecking=yes','-o','ExitOnForwardFailure=yes','-o','ConnectTimeout=8','-o','ConnectionAttempts=1','-o','ServerAliveInterval=15','-o','ServerAliveCountMax=3')
$expectedForwards = @(foreach($f in $forwards){ '127.0.0.1:'+$f.Local+':127.0.0.1:'+$f.Remote })
foreach($forward in $expectedForwards){ $argsList += @('-L',$forward) }
$argsList += $target
if ($ValidateOnly) {
  Write-Output ('TUNNEL_CONFIG_PASS forwards='+$forwards.Count+' '+($expectedForwards -join ' '))
  return
}
$logDir = Join-Path $env:LOCALAPPDATA 'BThwani\Operations\Tunnels\logs'
New-Item -ItemType Directory -Path $logDir -Force | Out-Null
$logPath = Join-Path $logDir 'lenovo.log'
function Write-TunnelLog([string]$message) {
  # Keep a bounded diagnostic log without logging secrets or SSH output.
  if ((Test-Path -LiteralPath $logPath) -and (Get-Item -LiteralPath $logPath).Length -gt 1048576) {
    Move-Item -LiteralPath $logPath -Destination ($logPath + '.previous') -Force
  }
  Add-Content -LiteralPath $logPath -Value ((Get-Date -Format o) + ' ' + $message) -Encoding UTF8
}
# Recover only an orphan of this exact unified tunnel, never a foreign listener.
$existing = @(Get-NetTCPConnection -State Listen -LocalPort $forwards.Local -ErrorAction SilentlyContinue)
if($existing.Count){
  $owners=@($existing.OwningProcess|Sort-Object -Unique)
  if($owners.Count -ne 1 -or @($existing|Where-Object LocalAddress -ne '127.0.0.1').Count){throw 'APP_TUNNEL_PORT_OWNED_BY_OTHER_PROCESS'}
  $ownerProcess=Get-CimInstance Win32_Process -Filter ('ProcessId='+$owners[0])
  if(!$ownerProcess -or $ownerProcess.ExecutablePath -ine $ssh -or !$ownerProcess.CommandLine.Contains($target)){throw 'APP_TUNNEL_PORT_OWNED_BY_OTHER_PROCESS'}
  foreach($forward in $expectedForwards){if(!$ownerProcess.CommandLine.Contains($forward)){throw 'APP_TUNNEL_PORT_OWNED_BY_OTHER_PROCESS'}}
  $parentProcess=Get-CimInstance Win32_Process -Filter ('ProcessId='+$ownerProcess.ParentProcessId)
  if($parentProcess -and $parentProcess.Name -in @('powershell.exe','pwsh.exe') -and $parentProcess.CommandLine -match 'Start-AppTunnel\.ps1'){throw 'APP_TUNNEL_DUPLICATE_OWNER'}
  Stop-Process -Id $ownerProcess.ProcessId -ErrorAction Stop
  Write-TunnelLog 'CLEARED_STALE_UNIFIED_SSH'
}
Write-TunnelLog ('START forwards='+$forwards.Count)
while ($true) {
  # Windows PowerShell 5.1 reports native SSH stderr as NativeCommandError.
  # A dropped network connection must not terminate the reconnect loop.
  $ErrorActionPreference = 'Continue'
  & $ssh @argsList 2>> $logPath
  $exitCode = $LASTEXITCODE
  $ErrorActionPreference = 'Stop'
  Write-TunnelLog ('SSH_EXIT code=' + $exitCode + ' retry_seconds=6')
  Start-Sleep -Seconds 6
}
