#Requires -Version 7.0
# Run on verified Lenovo only; change ONLY the existing Control task action.
[CmdletBinding()]
param([switch]$Apply)
$ErrorActionPreference='Stop'
Set-StrictMode -Version Latest
if ((hostname).ToUpperInvariant() -ne 'BTHWANI-DOCKER') { throw 'LENOVO_ONLY' }
$taskName='BThwani Control Next Native'
$t=Get-ScheduledTask -TaskName $taskName -ErrorAction Stop
if (@($t.Actions).Count -ne 1) { throw 'CONTROL_TASK_UNEXPECTED_ACTIONS' }
$exe=$t.Actions[0].Execute
$old=$t.Actions[0].Arguments
$expected='C:\Users\bthwa\BThwaniAppRunner\source-runtime\tools\dev\Start-App.ps1'
if ($exe -notmatch 'pwsh\.exe$' -or $old -notlike ('*'+$expected+'*') -or
    $old -notmatch '-App control-panel(\s|$)' -or $old -match '-Surface') { throw 'CONTROL_TASK_ACTION_UNEXPECTED' }
$flags=' -EnableIsolatedOperatorPasskeyPreview -EnableIsolatedRootBootstrap -UseDisposableOperatorSandbox'
if ($old.Contains('-UseDisposableOperatorSandbox')) {
  if (!$old.Contains('-EnableIsolatedOperatorPasskeyPreview') -or !$old.Contains('-EnableIsolatedRootBootstrap')) {
    throw 'CONTROL_TASK_PARTIAL_FLAGS_REFUSED'
  }
  $new=$old
} else {
  if (!$old.Trim().EndsWith('-App control-panel')) { throw 'CONTROL_TASK_PREVIEW_ALREADY_MODIFIED' }
  $new=$old+$flags
}
$identity=(docker inspect bthwani-operator-webauthn-s02-identity-1 | ConvertFrom-Json)
if ($LASTEXITCODE -ne 0 -or $identity.State.Health.Status -ne 'healthy' -or
    $identity.Config.Labels.'com.bthwani.environment' -cne 'operator-webauthn-sandbox') {
  throw 'ISOLATED_IDENTITY_NOT_VERIFIED'
}
foreach ($p in @('IDENTITY_ENABLE_ISOLATED_OPERATOR_PASSKEY_AUTH=true',
  'IDENTITY_ENABLE_ISOLATED_OPERATOR_BOOTSTRAP=true',
  'IDENTITY_OPERATOR_PASSKEY_RPID=localhost',
  'IDENTITY_OPERATOR_PASSKEY_ORIGINS=http://localhost:13000')) {
  if (@($identity.Config.Env) -cnotcontains $p) { throw 'ISOLATED_IDENTITY_CONFIG_MISMATCH' }
}
$r=Invoke-WebRequest -Uri 'http://127.0.0.1:3241/v1/operators/passkey/bootstrap/options' -SkipHttpErrorCheck -TimeoutSec 6
if ($r.StatusCode -ne 405) { throw 'ISOLATED_ROOT_BOOTSTRAP_NOT_EXPOSED' }
if (!$Apply) { Write-Output 'CONTROL_TASK_SANDBOX_PREVIEW=AVAILABLE_NO_CHANGE'; return }
$backup='C:\Users\bthwa\BThwaniAppRunner\logs\control-task-pre-operator-s02.xml'
if (!(Test-Path -LiteralPath $backup)) {
  Export-ScheduledTask -TaskName $taskName | Set-Content -LiteralPath $backup -Encoding UTF8
}
$changed=$false
try {
  if ($old -cne $new) {
    Set-ScheduledTask -TaskName $taskName -Action (New-ScheduledTaskAction -Execute $exe -Argument $new) | Out-Null
    $changed=$true
  }
  if ((Get-ScheduledTask -TaskName $taskName).State -eq 'Running') {
    Stop-ScheduledTask -TaskName $taskName -ErrorAction Stop
  }
  $freed=$false
  for ($i=0;$i -lt 12;$i++) {
    if (!(Get-NetTCPConnection -LocalPort 23010 -State Listen -ErrorAction SilentlyContinue)) { $freed=$true;break }
    Start-Sleep -Milliseconds 500
  }
  if (!$freed) {
    # Task Scheduler stopped the launcher, but Next's own child remains.
    # Terminate ONLY a verified orphan belonging to this exact control-panel Next process.
    if ((Get-ScheduledTask -TaskName $taskName).State -ne 'Ready') {
      throw 'CONTROL_TASK_NOT_STOPPED_REFUSE_ORPHAN_CLEANUP'
    }
    $listeners=@(Get-NetTCPConnection -LocalPort 23010 -State Listen -ErrorAction SilentlyContinue)
    if ($listeners.Count -ne 1) { throw 'CONTROL_LISTENER_NOT_UNIQUE' }
    $child=Get-CimInstance Win32_Process -Filter ('ProcessId='+$listeners[0].OwningProcess)
    $parent=Get-CimInstance Win32_Process -Filter ('ProcessId='+$child.ParentProcessId)
    $node='C:\Users\bthwa\BThwaniAppRunner\tools\node-v24.22.1-refoundation\node.exe'
    $control='C:\Users\bthwa\BThwaniAppRunner\source-runtime\apps\control-panel\node_modules\next\dist\bin\next'
    if (!$child -or !$parent -or $child.Name -cne 'node.exe' -or $parent.Name -cne 'node.exe' -or
        $child.ExecutablePath -cne $node -or $parent.ExecutablePath -cne $node -or
        $child.CommandLine -notlike '*\source-runtime\node_modules\.pnpm\next@*\node_modules\next\dist\server\lib\start-server.js*' -or
        $parent.CommandLine -notlike ('*'+$control+' dev -H 127.0.0.1 -p 23010*')) {
      throw 'CONTROL_ORPHAN_OWNER_UNVERIFIED_REFUSE_KILL'
    }
    Stop-Process -Id $child.ProcessId -Force -ErrorAction Stop
    if (Get-Process -Id $parent.ProcessId -ErrorAction SilentlyContinue) {
      Stop-Process -Id $parent.ProcessId -Force -ErrorAction Stop
    }
    for ($i=0;$i -lt 12;$i++) {
      if (!(Get-NetTCPConnection -LocalPort 23010 -State Listen -ErrorAction SilentlyContinue)) { $freed=$true;break }
      Start-Sleep -Milliseconds 500
    }
  }
  if (!$freed) { throw 'CONTROL_TASK_LISTENER_PERSISTED' }
  Start-ScheduledTask -TaskName $taskName -ErrorAction Stop
  $ready=$false
  for($i=0;$i -lt 100;$i++){
    try {
      $res=Invoke-WebRequest -Uri 'http://127.0.0.1:23010/health' -SkipHttpErrorCheck -TimeoutSec 2
      if ($res.StatusCode -eq 200) { $ready=$true;break }
    } catch {}
    Start-Sleep -Milliseconds 500
  }
  if (!$ready) { throw 'OPERATOR_SANDBOX_PREVIEW_AUTH_NOT_READY' }
  Write-Output 'CONTROL_TASK_SANDBOX_PREVIEW_STARTED; OPERATOR_AUTH_NOT_YET_VERIFIED'
} catch {
  $failure=$_.Exception.Message
  if($changed) {
    Set-ScheduledTask -TaskName $taskName -Action (New-ScheduledTaskAction -Execute $exe -Argument $old) | Out-Null
    Write-Output 'CONTROL_TASK_ACTION_RESTORED'
  }
  if (!(Get-NetTCPConnection -LocalPort 23010 -State Listen -ErrorAction SilentlyContinue)) {
    Start-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue
  }
  throw ('OPERATOR_PREVIEW_FAILED ' + $failure)
}
