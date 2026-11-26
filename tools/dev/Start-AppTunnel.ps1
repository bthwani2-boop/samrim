#Requires -Version 7.0
<# Canonical loopback-only Surface -> Lenovo development tunnel. #>
[CmdletBinding()]
param([switch]$ValidateOnly, [switch]$VerifyOnly)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

function Get-TunnelPlan {
  param([string]$LayoutPath, [string]$SshPath)
  $layout = Get-Content -LiteralPath $LayoutPath -Raw | ConvertFrom-Json
  $forwards = @(
    foreach ($app in $layout.apps.PSObject.Properties) {
      @{ Name = $app.Name; Local = $app.Value.surface; Remote = $app.Value.lenovo }
    }
    foreach ($owner in $layout.ownerForwards.PSObject.Properties) {
      @{ Name = $owner.Name; Local = $owner.Value; Remote = $owner.Value }
    }
  )
  if (!$forwards.Count -or @($forwards.Local | Sort-Object -Unique).Count -ne $forwards.Count) {
    throw 'APP_TUNNEL_PORT_COLLISION'
  }
  foreach ($f in $forwards) {
    foreach ($port in @($f.Local, $f.Remote)) {
      if (($port -isnot [int] -and $port -isnot [long]) -or $port -lt 1024 -or $port -gt 65535) {
        throw 'APP_TUNNEL_INVALID_PORT_CONFIG'
      }
    }
  }
  if (!(Test-Path -LiteralPath $SshPath -PathType Leaf)) { throw 'APP_TUNNEL_SSH_MISSING' }
  $target = 'bthwani-docker'
  $argsList = @('-N','-T','-o','BatchMode=yes','-o','StrictHostKeyChecking=yes','-o','ExitOnForwardFailure=yes','-o','ConnectTimeout=8','-o','ConnectionAttempts=1','-o','ServerAliveInterval=15','-o','ServerAliveCountMax=3')
  $expectedForwards = @(foreach ($f in $forwards) { '127.0.0.1:' + $f.Local + ':127.0.0.1:' + $f.Remote })
  foreach($forward in $expectedForwards) { $argsList += @('-L', $forward) }
  $argsList += $target
  return @{ Ssh = $SshPath; Arguments = $argsList; Ports = @($forwards.Local); Forwards = $expectedForwards }
}

function Get-TunnelListenerState {
  param($Plan)
  # Enumerate the actual listener table; an enumeration error is not an empty port.
  $listeners = @(Get-NetTCPConnection -State Listen -ErrorAction Stop |
    Where-Object { $_.LocalPort -in $Plan.Ports })
  if (!$listeners.Count) { return @{ State = 'EMPTY'; Process = $null } }
  $owners = @($listeners.OwningProcess | Sort-Object -Unique)
  if ($owners.Count -ne 1 -or @($listeners | Where-Object LocalAddress -ne '127.0.0.1').Count) {
    throw 'APP_TUNNEL_PORT_OWNED_BY_OTHER_PROCESS'
  }
  $process = Get-CimInstance Win32_Process -Filter ('ProcessId=' + $owners[0])
  if (!$process -or $process.ExecutablePath -ine $Plan.Ssh -or !$process.CreationDate) {
    throw 'APP_TUNNEL_PORT_OWNED_BY_OTHER_PROCESS'
  }
  $command = [regex]::Match([string]$process.CommandLine, '^(?:"([^"]+)"|(\S+)) (.+)$')
  $exe = if ($command.Groups[1].Success) { $command.Groups[1].Value } else { $command.Groups[2].Value }
  if (!$command.Success -or $exe -ine $Plan.Ssh -or $command.Groups[3].Value -cne ($Plan.Arguments -join ' ')) {
    throw 'APP_TUNNEL_PORT_OWNED_BY_OTHER_PROCESS'
  }
  $complete = $listeners.Count -eq $Plan.Ports.Count -and
    !(Compare-Object @($Plan.Ports | Sort-Object) @($listeners.LocalPort | Sort-Object))
  return @{ State = $(if ($complete) { 'COMPLETE' } else { 'PARTIAL' }); Process = $process }
}

function Assert-TunnelAvailable {
  param($Plan)
  $state = Get-TunnelListenerState $Plan
  if ($state.State -eq 'EMPTY') { return $false }
  $process = $state.Process
  $parent = Get-CimInstance Win32_Process -Filter ('ProcessId=' + $process.ParentProcessId)
  if ($parent -and (!$parent.CreationDate -or $parent.CreationDate -le $process.CreationDate)) {
    if ($parent.Name -eq 'pwsh.exe' -and $parent.CommandLine -match 'Start-AppTunnel\.ps1') {
      throw 'APP_TUNNEL_DUPLICATE_OWNER'
    }
    throw 'APP_TUNNEL_PORT_OWNED_BY_OTHER_PROCESS'
  }
  # Recover only the same proven orphan; a changed process is never stopped.
  $latest = Get-TunnelListenerState $Plan
  if ($latest.State -eq 'EMPTY' -or $latest.Process.ProcessId -ne $process.ProcessId -or
      $latest.Process.CreationDate -ne $process.CreationDate -or
      $latest.Process.CommandLine -cne $process.CommandLine) {
    throw 'APP_TUNNEL_OWNER_CHANGED'
  }
  Stop-Process -Id $process.ProcessId -ErrorAction Stop
  return $true
}

function Write-TunnelLog {
  param([string]$Path, [string]$Message)
  if ((Test-Path -LiteralPath $Path) -and (Get-Item -LiteralPath $Path).Length -ge 1048576) {
    Move-Item -LiteralPath $Path -Destination ($Path + '.previous') -Force
  }
  Add-Content -LiteralPath $Path -Value ((Get-Date -Format o) + ' ' + $Message) -Encoding utf8
}

if ([Environment]::MachineName -ne 'BTHWANI') { throw 'APP_TUNNEL_SOURCE_HOST_REQUIRED' }
if ($ValidateOnly -and $VerifyOnly) { throw 'APP_TUNNEL_MODE_CONFLICT' }
$plan = Get-TunnelPlan (Join-Path $PSScriptRoot 'ports.json') (Join-Path $env:WINDIR 'System32\OpenSSH\ssh.exe')
if ($ValidateOnly) {
  Write-Output ('TUNNEL_CONFIG_PASS forwards=' + $plan.Ports.Count + ' ' + ($plan.Forwards -join ' '))
  return
}
if ($VerifyOnly) {
  if ((Get-TunnelListenerState $plan).State -ne 'COMPLETE') { throw 'APP_TUNNEL_INCOMPLETE' }
  Write-Output ('TUNNEL_LIVE_PASS forwards=' + $plan.Ports.Count)
  return
}

# Task Scheduler already uses IgnoreNew. The mutex additionally covers direct
# invocation and the gap between two SSH processes, without a second watcher.
$mutex = [Threading.Mutex]::new($false, 'Global\BThwani.Lenovo.AppTunnel')
$held = $false
try {
  try { $held = $mutex.WaitOne(0) } catch [Threading.AbandonedMutexException] { $held = $true }
  if (!$held) { throw 'APP_TUNNEL_DUPLICATE_OWNER' }
  $logDir = Join-Path $env:LOCALAPPDATA 'BThwani\Operations\Tunnels\logs'
  New-Item -ItemType Directory -Path $logDir -Force | Out-Null
  $logPath = Join-Path $logDir 'lenovo.log'
  Write-TunnelLog $logPath ('START forwards=' + $plan.Ports.Count)
  $lastExit = $null
  while ($true) {
    if (Assert-TunnelAvailable $plan) {
      Write-TunnelLog $logPath 'CLEARED_STALE_UNIFIED_SSH'
    }
    $sshArgs = $plan.Arguments
    # Native stderr may contain connection details; retain only bounded state
    # transitions and exit codes. SSH host-key and forwarding errors remain fatal
    # to each attempt, and no unrelated process is ever taken over.
    $PSNativeCommandUseErrorActionPreference = $false
    & $plan.Ssh @sshArgs 2>$null
    $exitCode = $LASTEXITCODE
    if ($exitCode -ne $lastExit) {
      Write-TunnelLog $logPath ('SSH_EXIT code=' + $exitCode + ' retry_seconds=6')
      $lastExit = $exitCode
    }
    Start-Sleep -Seconds 6
  }
} finally {
  if ($held) { $mutex.ReleaseMutex() }
  $mutex.Dispose()
}
