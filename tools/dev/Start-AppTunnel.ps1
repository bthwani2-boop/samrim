#Requires -Version 5.1
<#
Canonical Surface -> Lenovo development SSH tunnels.
Source of local ports: infra/local/.env; remote ports: the Lenovo native
development launch ports. Run under one Windows Scheduled Task per App.
No shell window is required, and no port is exposed beyond loopback.
#>
[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)]
  [ValidateSet('customer', 'merchant', 'app-captain', 'control-panel')]
  [string]$App,
  [switch]$ValidateOnly
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

$root = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot '..\..')).Path
if ($env:COMPUTERNAME -ne 'BTHWANI') { throw 'APP_TUNNEL_SOURCE_HOST_REQUIRED' }

$ports = @{
  'customer' = @{ EnvKey = 'SAMRIM_APP_CUSTOMER_METRO_PORT'; Local = 18101; Remote = 28111 }
  'merchant' = @{ EnvKey = 'SAMRIM_APP_MERCHANT_METRO_PORT'; Local = 18102; Remote = 28112 }
  'app-captain' = @{ EnvKey = 'SAMRIM_APP_CAPTAIN_METRO_PORT'; Local = $null; Remote = 28113 }
  'control-panel' = @{ EnvKey = 'SAMRIM_CONTROL_PORT'; Local = $null; Remote = 23010 }
}
$spec = $ports[$App]
$envPath = Join-Path $root 'infra\local\.env'
if (-not (Test-Path -LiteralPath $envPath)) { throw 'APP_TUNNEL_LOCAL_ENV_MISSING' }

$localPort = $spec.Local
foreach ($line in [System.IO.File]::ReadLines($envPath)) {
  if ($line -match ('^' + [regex]::Escape($spec.EnvKey) + '=(\d+)\s*$')) {
    $localPort = [int]$Matches[1]
    break
  }
}
$remotePort = [int]$spec.Remote
if ($null -eq $localPort -or $localPort -lt 1024 -or $localPort -gt 65535 -or
    $remotePort -lt 1024 -or $remotePort -gt 65535 -or $localPort -eq $remotePort) {
  throw 'APP_TUNNEL_INVALID_PORT_CONFIG'
}

$ssh = Join-Path $env:WINDIR 'System32\OpenSSH\ssh.exe'
if (-not (Test-Path -LiteralPath $ssh)) { throw 'APP_TUNNEL_SSH_MISSING' }
$target = 'bthwani-docker'
$argsList = @(
  '-N', '-T',
  '-o', 'BatchMode=yes',
  '-o', 'StrictHostKeyChecking=yes',
  '-o', 'ExitOnForwardFailure=yes',
  '-o', 'ConnectTimeout=8',
  '-o', 'ConnectionAttempts=1',
  '-o', 'ServerAliveInterval=15',
  '-o', 'ServerAliveCountMax=3',
  '-L', ('127.0.0.1:' + $localPort + ':127.0.0.1:' + $remotePort),
  $target
)
if ($ValidateOnly) {
  Write-Output ('TUNNEL_CONFIG_PASS app=' + $App + ' localPort=' + $localPort + ' remotePort=' + $remotePort)
  return
}

$logDir = Join-Path $env:LOCALAPPDATA 'BThwani\Operations\Tunnels\logs'
New-Item -ItemType Directory -Path $logDir -Force | Out-Null
$logPath = Join-Path $logDir ($App + '.log')
function Write-TunnelLog([string]$message) {
  # Keep a bounded diagnostic log without logging secrets or SSH output.
  if ((Test-Path -LiteralPath $logPath) -and (Get-Item -LiteralPath $logPath).Length -gt 1048576) {
    Move-Item -LiteralPath $logPath -Destination ($logPath + '.previous') -Force
  }
  Add-Content -LiteralPath $logPath -Value ((Get-Date -Format o) + ' ' + $message) -Encoding UTF8
}
# Task Scheduler can stop the PowerShell parent while its SSH child stays
# alive. Reclaim only a matching loopback SSH listener with no live owner.
$existing = Get-NetTCPConnection -State Listen -LocalPort $localPort -ErrorAction SilentlyContinue |
  Where-Object { $_.LocalAddress -eq '127.0.0.1' } |
  Select-Object -First 1
if ($existing) {
  $ownerProcess = Get-CimInstance Win32_Process -Filter ('ProcessId=' + $existing.OwningProcess)
  $expectedForward = '127.0.0.1:' + $localPort + ':127.0.0.1:' + $remotePort
  if (-not $ownerProcess -or $ownerProcess.Name -ne 'ssh.exe' -or
      -not $ownerProcess.CommandLine.Contains($expectedForward) -or
      -not $ownerProcess.CommandLine.Contains($target)) {
    throw 'APP_TUNNEL_PORT_OWNED_BY_OTHER_PROCESS'
  }
  $parentProcess = Get-CimInstance Win32_Process -Filter ('ProcessId=' + $ownerProcess.ParentProcessId)
  if ($parentProcess -and $parentProcess.Name -eq 'powershell.exe' -and
      $parentProcess.CommandLine -match 'Start-AppTunnel\.ps1') {
    throw 'APP_TUNNEL_DUPLICATE_OWNER'
  }
  Stop-Process -Id $ownerProcess.ProcessId -ErrorAction Stop
  Write-TunnelLog ('CLEARED_STALE_SSH app=' + $App + ' port=' + $localPort)
}
Write-TunnelLog ('START app=' + $App + ' local=' + $localPort + ' remote=' + $remotePort)
while ($true) {
  # Windows PowerShell 5.1 reports native SSH stderr as NativeCommandError.
  # A dropped network connection must not terminate the reconnect loop.
  $ErrorActionPreference = 'Continue'
  & $ssh @argsList 2>> $logPath
  $exitCode = $LASTEXITCODE
  $ErrorActionPreference = 'Stop'
  Write-TunnelLog ('SSH_EXIT app=' + $App + ' code=' + $exitCode + ' retry_seconds=6')
  Start-Sleep -Seconds 6
}
