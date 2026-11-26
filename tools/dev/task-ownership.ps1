#Requires -Version 7.0
# Canonical Task Scheduler admission for the existing development owners.
# These functions only inspect identity; they never register or start a task.
function Assert-CanonicalTask($Task,[string]$Name,[string]$Executable,[string]$ArgumentPattern,[string]$Directory) {
  $actions=@($Task.Actions)
  if($Task.TaskName -cne $Name -or $Task.TaskPath -cne '\' -or $actions.Count -ne 1){
    throw ('TASK_OWNER_CHANGED '+$Name)
  }
  $action=$actions[0]
  if([string]$action.Execute -ine $Executable -or [string]$action.Arguments -cnotmatch $ArgumentPattern -or
     [string]$action.WorkingDirectory -ine $Directory){
    throw ('TASK_OWNER_CHANGED '+$Name)
  }
  return $Task
}
function Get-VerifiedAppTask($Spec) {
  $root='C:\Users\bthwa\BThwaniAppRunner\source-runtime'
  $exe='C:\Program Files\PowerShell\7\pwsh.exe'
  $app=[string]$Spec.A
  $prefix='-NoProfile -NonInteractive -WindowStyle Hidden -File "'+(Join-Path $root 'tools\dev\Start-App.ps1')+'" -App '+$app
  $flags=switch -CaseSensitive ($app) {
    'customer' {@('EnableDockerWalletWebPreview','EnableDockerCartWebPreview','EnableDockerCustomerAndroidIdentityPreview')}
    'control-panel' {@('EnableIsolatedOperatorPasskeyPreview','EnableIsolatedRootBootstrap','UseDisposableOperatorSandbox')}
    'merchant' {@()}
    'captain' {@()}
    default {throw 'APP_NOT_ALLOWED'}
  }
  $tail=if(@($flags).Count){'(?: -(?:'+(@($flags)|ForEach-Object {[regex]::Escape($_)} | Join-String -Separator '|')+'))*'}else{''}
  $task=Assert-CanonicalTask (Get-ScheduledTask -TaskPath '\' -TaskName $Spec.N -ErrorAction Stop) $Spec.N $exe ('^'+[regex]::Escape($prefix)+$tail+'$') ''
  $suffix=([string]$task.Actions[0].Arguments).Substring($prefix.Length).Trim()
  if($suffix){
    $options=@($suffix.Split(' ',[StringSplitOptions]::RemoveEmptyEntries))
    if(@($options|Sort-Object -Unique).Count -ne $options.Count){throw ('TASK_DUPLICATE_FLAG '+$app)}
    if(($options -contains '-EnableIsolatedRootBootstrap' -or $options -contains '-UseDisposableOperatorSandbox') -and $options -notcontains '-EnableIsolatedOperatorPasskeyPreview'){
      throw ('TASK_INCOMPLETE_PREVIEW '+$app)
    }
  }
  return $task
}
function Test-AppLauncherProcess($Process,$Task) {
  $action=$Task.Actions[0]
  return ($Process.Name -ieq 'pwsh.exe' -and $Process.ExecutablePath -ieq $action.Execute -and
    $Process.CommandLine -ceq ('"'+$action.Execute+'" '+$action.Arguments))
}
function Get-VerifiedAppSpec([string]$App) {
  $matches=@($specs|Where-Object A -ceq $App)
  if($matches.Count -ne 1){throw ('APP_NOT_ALLOWED '+$App)}
  return $matches[0]
}
