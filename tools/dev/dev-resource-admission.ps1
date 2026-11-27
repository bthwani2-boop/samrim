#Requires -Version 7.0
# One Surface-local admission owner for actual development resource writers.
# The native named mutexes span Windows sessions; they are not Git reservations.
function Get-DevOperationResources(
  [string]$Action,[string]$Command='help',[bool]$Apply=$false,
  [string]$RecoveryKey='',[string]$Mode='All'
) {
  $docker='Global\BThwaniDevDockerV1'
  $apps='Global\BThwaniDevAppsV1'
  $browser='Global\BThwaniDevBrowserV1'
  $android='Global\BThwaniDevAndroidV1'
  $surfaces=@(switch ($Mode) {
    'Browser' {$browser}
    'Android' {$android}
    'All' {$browser;$android}
    default {throw 'DEV_RESOURCE_MODE_INVALID'}
  })
  switch ($Action) {
    'Docker' {
      if($Command -eq 'build' -or ($Command -eq 'reconcile' -and ($Apply -or $RecoveryKey)) -or ($Command -eq 'seed' -and $Apply)){$docker}
    }
    'Apps' {
      if($Command -eq 'recover'){$android}
      elseif($Command -eq 'open'){$surfaces}
      elseif($Apply -and $Command -in @('start','restart','reconcile')){$apps}
    }
    'Launch' {$apps;$surfaces}
    'Up' {$docker;$apps;$surfaces}
    'Warm' {$docker;$apps;$surfaces}
    'Down' {$docker;$apps;$browser;$android}
    'ProvisionWlt' {$docker}
    'Status' {}
    'Verify' {}
    'Migrations' {}
    default {throw 'DEV_RESOURCE_ACTION_INVALID'}
  }
}
function Exit-DevResources([Threading.Mutex[]]$Leases=@()) {
  $releaseError=$null
  for($i=$Leases.Count-1;$i -ge 0;$i--){
    try{$Leases[$i].ReleaseMutex()}
    catch{if($null -eq $releaseError){$releaseError=$_}}
    finally{$Leases[$i].Dispose()}
  }
  if($null -ne $releaseError){throw $releaseError}
}
function Enter-DevResources([string[]]$Names=@()) {
  $unique=[Collections.Generic.HashSet[string]]::new([StringComparer]::Ordinal)
  foreach($name in $Names){
    if([string]::IsNullOrWhiteSpace($name) -or !$unique.Add($name)){throw 'DEV_RESOURCE_NAME_INVALID'}
  }
  [string[]]$ordered=@($Names)
  [Array]::Sort($ordered,[StringComparer]::Ordinal)
  $leases=[Collections.Generic.List[Threading.Mutex]]::new()
  try {
    foreach($name in $ordered){
      $lock=[Threading.Mutex]::new($false,$name)
      $held=$false
      try{
        try{$held=$lock.WaitOne(0)}
        catch [Threading.AbandonedMutexException]{
          $held=$true
          throw ('DEV_RESOURCE_RECOVERY_REQUIRED '+$name)
        }
        if(!$held){throw ('DEV_RESOURCE_BUSY '+$name)}
        $leases.Add($lock)
        $lock=$null
      }finally{
        if($null -ne $lock){
          try{if($held){$lock.ReleaseMutex()}}finally{$lock.Dispose()}
        }
      }
    }
    return $leases.ToArray()
  }catch{
    Exit-DevResources $leases.ToArray()
    throw
  }
}
