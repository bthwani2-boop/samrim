#Requires -Version 7.0
# Single admission boundary for the existing development Scheduled Tasks.
# This code verifies identity only; it never changes task configuration.
function Assert-CanonicalTask(
  $Task,[string]$Name,[string]$Executable,[string]$Arguments,[string]$Directory,
  [string[]]$AllowedFlags=@()
) {
  $actions=@($Task.Actions)
  if($Task.TaskName -cne $Name -or $Task.TaskPath -cne '\' -or $actions.Count -ne 1){
    throw ('TASK_OWNER_CHANGED '+$Name)
  }
  $action=$actions[0]
  if([string]$action.Execute -ine $Executable -or [string]$action.WorkingDirectory -ine $Directory){
    throw ('TASK_OWNER_CHANGED '+$Name)
  }
  $actual=[string]$action.Arguments
  if($actual -ceq $Arguments){return $Task}
  # Compare the complete fixed argument prefix and only explicitly allowed
  # switch tokens. There is no regex/end-of-line or substring admission.
  if(!$AllowedFlags.Count -or !$actual.StartsWith($Arguments+' ',[StringComparison]::Ordinal)){
    throw ('TASK_OWNER_CHANGED '+$Name)
  }
  $seen=[Collections.Generic.HashSet[string]]::new([StringComparer]::Ordinal)
  foreach($flag in $actual.Substring($Arguments.Length+1).Split(' ')){
    if($AllowedFlags -cnotcontains $flag -or !$seen.Add($flag)){
      throw ('TASK_OWNER_CHANGED '+$Name)
    }
  }
  if(($seen.Contains('-EnableIsolatedRootBootstrap') -or $seen.Contains('-UseDisposableOperatorSandbox')) -and
      !$seen.Contains('-EnableIsolatedOperatorPasskeyPreview')){
    throw ('TASK_INCOMPLETE_PREVIEW '+$Name)
  }
  return $Task
}
function Get-VerifiedAppTask($Spec) {
  $root='C:\Users\bthwa\BThwaniAppRunner\source-runtime'
  $exe='C:\Program Files\PowerShell\7\pwsh.exe'
  $app=[string]$Spec.A
  $prefix='-NoProfile -NonInteractive -WindowStyle Hidden -File "'+(Join-Path $root 'tools\dev\Start-App.ps1')+'" -App '+$app
  $flags=@(switch -CaseSensitive ($app) {
    'customer' {'-EnableDockerWalletWebPreview';'-EnableDockerCartWebPreview';'-EnableDockerCustomerAndroidIdentityPreview'}
    'control-panel' {'-EnableIsolatedOperatorPasskeyPreview';'-EnableIsolatedRootBootstrap';'-UseDisposableOperatorSandbox'}
    'merchant' {}
    'captain' {}
    default {throw 'APP_NOT_ALLOWED'}
  })
  return Assert-CanonicalTask (Get-ScheduledTask -TaskPath '\' -TaskName $Spec.N -ErrorAction Stop) $Spec.N $exe $prefix '' $flags
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
