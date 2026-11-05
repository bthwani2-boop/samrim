#Requires -Version 5.1
# Stop exactly one Lenovo-owned development app and its validated Node descendants.
param(
  [Parameter(Mandatory=$true)]
  [ValidateSet('app-client','app-partner','app-captain','control-panel')]
  [string]$App
)
$ErrorActionPreference='Stop'
Set-StrictMode -Version Latest

if($env:COMPUTERNAME -ne 'BTHWANI-DOCKER') { throw 'LENOVO_ONLY' }
$root='C:\Users\bthwa\BThwaniAppRunner'
$owners=Get-Content -Raw -LiteralPath (Join-Path $root 'source\infra\local\runtime-owners.json') | ConvertFrom-Json
if($env:COMPUTERNAME -ne $owners.remoteHost -or
   ([string]$owners.remoteRuntimeRoot).Replace('/',[char]92).TrimEnd([char]92) -ine $root.TrimEnd([char]92)) {
  throw 'LENOVO_RUNTIME_ROOT_MISMATCH'
}
$entry=$owners.surfaces.$App
if(!$entry -or $entry.owner -ne 'lenovo-native') { throw 'LENOVO_RUNTIME_NOT_OWNER' }
$port=[int]$entry.remotePort
if($port -lt 1024 -or $port -gt 65535) { throw 'LENOVO_PORT_INVALID' }
$names=@{
  'app-client'='BThwani Client Metro Native'
  'app-partner'='BThwani Partner Metro Native'
  'app-captain'='BThwani Captain Metro Trial'
  'control-panel'='BThwani Control Next Native'
}
$name=$names[$App]
$task=Get-ScheduledTask -TaskName $name -ErrorAction Stop
$argsText=[string]$task.Actions[0].Arguments
if($task.Actions.Count -ne 1 -or
   $argsText -notmatch 'Invoke-LenovoApp\.ps1' -or
   $argsText -notmatch ('-App\s+'+[regex]::Escape($App)+'(?:\s|$)')) {
  throw 'LENOVO_APP_TASK_OWNER_MISMATCH'
}

if($task.State -eq 'Running') {
  Stop-ScheduledTask -TaskName $name -ErrorAction Stop
} elseif($task.State -ne 'Ready') {
  throw ('LENOVO_APP_TASK_UNEXPECTED_STATE='+$task.State)
}
Start-Sleep -Milliseconds 350

function Get-AppListeners {
  @(Get-NetTCPConnection -State Listen -LocalPort $port -ErrorAction SilentlyContinue)
}
$listeners=@(Get-AppListeners)
if($listeners.Count -gt 1) { throw 'LENOVO_APP_DUPLICATE_LISTENERS_BLOCKED' }
if($listeners.Count -eq 1) {
  $listener=$listeners[0]
  if($listener.LocalAddress -notin @('127.0.0.1','::1')) {
    throw 'LENOVO_APP_NON_LOOPBACK_LISTENER_BLOCKED'
  }
  $all=@(Get-CimInstance Win32_Process -ErrorAction Stop)
  $byPid=@{}
  foreach($proc in $all) { $byPid[[int]$proc.ProcessId]=$proc }
  $current=[int]$listener.OwningProcess
  $launcher=$null
  $seen=@{}
  for($depth=0;$depth -lt 12 -and $current -gt 0;$depth++) {
    if(!$byPid.ContainsKey($current) -or $seen.ContainsKey($current)) { break }
    $seen[$current]=$true
    $proc=$byPid[$current]
    $cmd=[string]$proc.CommandLine
    if($proc.Name -eq 'node.exe' -and
       $cmd -match ('start-surface\.mjs\s+'+[regex]::Escape($App)+'(?:\s|$)')) {
      $toolsRoot=[IO.Path]::GetFullPath((Join-Path $root 'tools')).TrimEnd([char]92)+[char]92
      $actualExe=[string]$proc.ExecutablePath
      if(!$actualExe.StartsWith($toolsRoot,[StringComparison]::OrdinalIgnoreCase) -or
         [IO.Path]::GetFileName($actualExe) -ine 'node.exe' -or
         $cmd -notmatch [regex]::Escape((Join-Path $root 'source\tools\dev\start-surface.mjs'))) {
        throw 'LENOVO_APP_LAUNCHER_PROVENANCE_BLOCKED'
      }
      $launcher=$proc
      break
    }
    $current=[int]$proc.ParentProcessId
  }
  if(!$launcher) { throw 'LENOVO_APP_ORPHAN_PROVENANCE_BLOCKED' }

  # Check PID and command again before forcefully ending only this app's subtree.
  $live=Get-CimInstance Win32_Process -Filter ('ProcessId='+$launcher.ProcessId) -ErrorAction SilentlyContinue
  $portNow=@(Get-AppListeners)
  if(!$live -or $live.CreationDate -ne $launcher.CreationDate -or
     $portNow.Count -ne 1 -or $portNow[0].OwningProcess -ne $listener.OwningProcess) {
    throw 'LENOVO_APP_PROCESS_RACE_BLOCKED'
  }
  & taskkill.exe /PID $launcher.ProcessId /T /F | Out-Null
  if($LASTEXITCODE -ne 0) { throw 'LENOVO_APP_TREE_TERMINATION_FAILED' }
}
Start-Sleep -Milliseconds 400
if(@(Get-AppListeners).Count -ne 0) { throw 'LENOVO_APP_LISTENER_REMAINS' }
if((Get-ScheduledTask -TaskName $name).State -ne 'Ready') { throw 'LENOVO_APP_TASK_REMAINS_RUNNING' }
Write-Output ('LENOVO_APP_STOP=PASS app='+$App+' port='+$port)
