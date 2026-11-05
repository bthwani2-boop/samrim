#Requires -Version 5.1
# Registers on-demand native Windows trials; no app is started or cut over here.
$ErrorActionPreference='Stop'
Set-StrictMode -Version Latest
if($env:COMPUTERNAME -ne 'BTHWANI-DOCKER') { throw 'LENOVO_ONLY' }
$root='C:\Users\bthwa\BThwaniAppRunner'
$owners=Get-Content -Raw -LiteralPath (Join-Path $root 'source\infra\local\runtime-owners.json') | ConvertFrom-Json
if(([string]$owners.remoteRuntimeRoot).Replace('/',[char]92).TrimEnd([char]92) -ine $root.TrimEnd([char]92)) { throw 'LENOVO_RUNTIME_ROOT_MISMATCH' }
$entry=Join-Path $root 'source\tools\dev\Invoke-LenovoApp.ps1'
if(!(Test-Path -LiteralPath $entry)) { throw 'NATIVE_APP_RUNNER_MISSING' }
$mapping=[ordered]@{
  'app-client'='BThwani Client Metro Native'
  'app-partner'='BThwani Partner Metro Native'
  'control-panel'='BThwani Control Next Native'
}
$principal=New-ScheduledTaskPrincipal -UserId ($env:USERDOMAIN+'\'+$env:USERNAME) -LogonType Interactive -RunLevel Limited
$settings=New-ScheduledTaskSettingsSet -MultipleInstances IgnoreNew -ExecutionTimeLimit ([TimeSpan]::Zero) -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries
foreach($app in $mapping.Keys) {
  $name=$mapping[$app]
  if(Get-ScheduledTask -TaskName $name -ErrorAction SilentlyContinue) {
    Write-Output ('APP_TASK_ALREADY_EXISTS='+$name)
    continue
  }
  $argsList='-NoProfile -NonInteractive -ExecutionPolicy RemoteSigned -File "'+$entry+'" -App '+$app+' -Trial'
  $action=New-ScheduledTaskAction -Execute 'powershell.exe' -Argument $argsList -WorkingDirectory (Join-Path $root 'source\apps')
  Register-ScheduledTask -TaskName $name -Action $action -Principal $principal -Settings $settings -Description ('On-demand Windows Native trial for '+$app+'; promote to login trigger only after verified cutover') | Out-Null
  Write-Output ('APP_TRIAL_TASK_REGISTERED='+$app)
}
