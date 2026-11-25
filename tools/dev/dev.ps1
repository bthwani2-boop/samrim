#Requires -Version 7.0
<#
BThwani canonical development orchestration, Surface only.
Run from D:\samrim: pnpm dev (fast app launch) or pnpm dev up (full isolated infrastructure).
This existing Surface launcher reuses Lenovo Scheduled Tasks, source sync and loopback SSH tunnels.
Never runs SQL migrations, operator bootstrap, volume deletion, branch changes,
Git commits/pushes, or credential modifications. Explicit Docker reconcile applies only
verified isolated owner image replacements under the shared lifecycle mutex.
#>
[CmdletBinding()]
param(
  [Parameter(Position=0)]
  [ValidateSet('Launch','Up','Warm','Status','Down','Verify','Migrations','Docker','Apps')]
  [string]$Action = 'Launch',
  [switch]$Apply,
  [switch]$Automatic,
  [switch]$DeepSql,
  [switch]$EnableCaptain,
  [switch]$Preview,
  [switch]$PrepareBaseline,
  [switch]$PrepareDshDatabase,
  [switch]$ResumeDshDatabase,
  [switch]$CutoverDshDatabase,
  [switch]$RelocateIdentityDatabase,
  [switch]$ResumeIdentityDatabase,
  [string]$PreparedSourceSha,
  [string]$RecoverRuntimeAttempt,
  [Parameter(Position=1)]
  [ValidateSet('help','status','ps','logs','images','volumes','networks','config','verify','reconcile','start','restart','android','open')]
  [string]$DockerAction = 'help',
  [Parameter(Position=2)]
  [ValidateSet('dsh','identity','wlt','postgres','media','mailpit','payment-mock')]
  [string]$DockerService = 'dsh',
  [ValidateSet('customer','merchant','captain','control-panel')]
  [string]$App = '',
  [ValidateSet('Browser','Android','All')]
  [string]$Mode = 'All'
)
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$PSNativeCommandUseErrorActionPreference = $false

$repo = 'D:\samrim'
$git = 'C:\Program Files\Git\cmd\git.exe'
$ssh = Join-Path $env:WINDIR 'System32\OpenSSH\ssh.exe'
$dockerContext = 'bthwani-docker'
$expectedSurface = 'BTHWANI'
$expectedLenovo = 'BTHWANI-DOCKER'
$project = 'bthwani-refoundation'
$baseEnv = Join-Path $repo 'infra\.env'
$baseCompose = Join-Path $repo 'infra\compose.yaml'
$developmentPorts = Get-Content -LiteralPath (Join-Path $repo 'tools\dev\ports.json') -Raw | ConvertFrom-Json
$ownerTasks = @(
  @{Name='BThwani Lenovo Source Sync'; Pattern='sync-lenovo-source\.mjs'},
  @{Name='BThwani Lenovo SSH Tunnel'; Pattern='Start-AppTunnel\.ps1'}
)
$nativeOwnerPorts = @($developmentPorts.ownerForwards.PSObject.Properties | ForEach-Object {[int]$_.Value})
$localPorts = @($developmentPorts.apps.PSObject.Properties | ForEach-Object {[int]$_.Value.surface}) + $nativeOwnerPorts
$device='R5CX14S4PZW'
$chrome='C:\Program Files\Google\Chrome\Application\chrome.exe'
$chromeProfile='Profile 1'
$urls=@(
  ("http://127.0.0.1:$($developmentPorts.apps.customer.surface)/"),
  ("http://127.0.0.1:$($developmentPorts.apps.merchant.surface)/"),
  'http://localhost:13000/'
)
$android=@(
  @{Name='customer'; Package='com.bthwani.customer'; Scheme='exp+customer'; Port=[int]$developmentPorts.apps.customer.surface},
  @{Name='merchant'; Package='com.bthwani.merchant'; Scheme='exp+merchant'; Port=[int]$developmentPorts.apps.merchant.surface},
  @{Name='captain'; Package='com.bthwani.captain'; Scheme='exp+app-captain'; Port=[int]$developmentPorts.apps.captain.surface}
)
$logRoot = Join-Path $env:LOCALAPPDATA 'BThwani\Operations\UnifiedDev'
$mutex = [System.Threading.Mutex]::new($false,'Local\BThwaniUnifiedDevV1')
$hasMutex = $false
$transcript = $false

function Say([string]$key,[string]$value) { Write-Output ("$key=$value") }
function Banner([string]$value) { Write-Output ("`n===== $value =====") }
function Assert-Ok([bool]$condition,[string]$message) { if (-not $condition) { throw "BLOCKED: $message" } }
function Git([string[]]$argsList) {
  $out = @(& $git -C $repo @argsList 2>&1)
  Assert-Ok ($LASTEXITCODE -eq 0) ('git failed: '+($argsList -join ' '))
  return @($out | ForEach-Object { $_.ToString() })
}
function Invoke-DockerCli([string[]]$argsList) {
  $out = @(& docker --context $dockerContext @argsList 2>&1)
  if ($LASTEXITCODE -ne 0) { throw ('DOCKER_FAIL command='+(@($argsList | Select-Object -First 3) -join ' ')+' output='+($out -join ' | ')) }
  return @($out | ForEach-Object { $_.ToString() })
}
function Assert-SurfaceIdentity([string]$message) {
  # The process environment can omit COMPUTERNAME; the Windows host itself must still match.
  Assert-Ok (([Environment]::MachineName -ieq $expectedSurface) -and
    ([string]::IsNullOrEmpty($env:COMPUTERNAME) -or $env:COMPUTERNAME -ieq $expectedSurface)) $message
}
function Check-LocalIdentity {
  Assert-SurfaceIdentity ('must run on Surface '+$expectedSurface)
  Assert-Ok (Test-Path -LiteralPath $git -PathType Leaf) 'Git executable missing'
  Assert-Ok (Test-Path -LiteralPath $ssh -PathType Leaf) 'OpenSSH client missing'
  Assert-Ok (Test-Path -LiteralPath (Join-Path $repo 'AGENTS.md')) 'canonical repo missing'
  Assert-Ok (Test-Path -LiteralPath (Join-Path $repo 'REPOSITORY-STRUCTURE.md')) 'repository policy missing'
  Assert-Ok (Test-Path -LiteralPath (Join-Path $repo 'governance\README.md')) 'governance policy missing'
  $branch = (Git -argsList @('branch','--show-current') | Select-Object -First 1).Trim()
  $head = (Git -argsList @('rev-parse','HEAD') | Select-Object -First 1).Trim()
  Assert-Ok ($branch -and $branch -notlike 'archive/*') 'archive or detached branch is read-only'
  Say 'SOURCE_BRANCH' $branch
  Say 'SOURCE_HEAD' $head
}
function Check-Ssh {
  $client = [Net.Sockets.TcpClient]::new()
  $connected = $false
  try {
    $pending = $client.ConnectAsync('bthwani-docker',22)
    $connected = $pending.Wait(2000) -and $client.Connected
  } catch { $connected = $false }
  finally { $client.Dispose() }
  Assert-Ok $connected 'Lenovo TCP/22 unreachable; existing tunnel tasks will keep retrying'
  $rows = @(& $ssh '-T' '-o' 'BatchMode=yes' '-o' 'StrictHostKeyChecking=yes' '-o' 'ConnectTimeout=8' 'bthwani-docker' 'hostname' 2>&1)
  Assert-Ok ($LASTEXITCODE -eq 0 -and @($rows | Where-Object { $_.ToString().Trim() -ieq $expectedLenovo }).Count -eq 1) 'SSH verified host or authentication unavailable'
  Say 'SSH_AUTH' 'PASS host=BTHWANI-DOCKER strictHostKey=yes'
}
function Invoke-Lenovo([string]$body) {
  $scriptText = '$ErrorActionPreference="Stop"; if($env:COMPUTERNAME -ine "BTHWANI-DOCKER"){throw "WRONG_REMOTE_HOST"}; ' + $body
  $encoded = [Convert]::ToBase64String([Text.Encoding]::Unicode.GetBytes($scriptText))
  if ($encoded.Length -gt 4500) {
    # Windows command line length is bounded. Stream one base64 line through
    # the existing authenticated SSH session; no extra remote launcher/files.
    # ReadLine terminates on the transmitted newline (ReadToEnd can stall).
    $bootstrap = '$data=[Console]::In.ReadLine(); if(!$data){throw "SSH_STDIN_EMPTY"}; $cmd=[Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($data)); & ([ScriptBlock]::Create($cmd))'
    $bootEncoded = [Convert]::ToBase64String([Text.Encoding]::Unicode.GetBytes($bootstrap))
    $payload = [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($scriptText))
    $rows = @($payload | & $ssh '-T' '-o' 'BatchMode=yes' '-o' 'StrictHostKeyChecking=yes' '-o' 'ConnectTimeout=8' 'bthwani-docker' 'pwsh.exe' '-NoLogo' '-NoProfile' '-NonInteractive' '-EncodedCommand' $bootEncoded 2>&1)
  } else {
    $rows = @(& $ssh '-T' '-o' 'BatchMode=yes' '-o' 'StrictHostKeyChecking=yes' '-o' 'ConnectTimeout=8' 'bthwani-docker' 'pwsh.exe' '-NoLogo' '-NoProfile' '-NonInteractive' '-EncodedCommand' $encoded 2>&1)
  }
  if ($LASTEXITCODE -ne 0) { throw ('LENOVO_SCRIPT_FAILED '+(($rows | ForEach-Object {$_.ToString()}) -join ' | ')) }
  foreach ($row in $rows) {
    $text = $row.ToString().Trim()
    if ($text -and $text -notlike '#< CLIXML*' -and $text -notlike '<Objs*') { Write-Output $text }
  }
}
function Check-DockerContext {
  $contexts = @(Invoke-DockerCli -argsList @('context','inspect',$dockerContext,'--format','{{json .}}'))
  $raw = ($contexts -join "`n") | ConvertFrom-Json
  $endpoint = [string]$raw.Endpoints.docker.Host
  Assert-Ok ($endpoint -match '^ssh://' -and $endpoint -match 'bthwani-docker') 'Docker context does not target verified Lenovo SSH'
  $null = Invoke-DockerCli -argsList @('info','--format','{{.ServerVersion}}')
  Say 'DOCKER_TARGET' $dockerContext
}
function Assert-Compose {
  Assert-Ok (Test-Path -LiteralPath $baseEnv -PathType Leaf) 'missing approved ignored infra/.env'
  $nameLine = Get-Content -LiteralPath $baseCompose | Where-Object { $_ -match '^name:\s*(\S+)\s*$' } | Select-Object -First 1
  Assert-Ok ($nameLine -match '^name:\s*bthwani-refoundation\s*$') 'Compose project name mismatch'
  $null = Invoke-DockerCli -argsList @('compose','--env-file',$baseEnv,'-f',$baseCompose,'config','--quiet')
}
function Task-Action([string]$name,[string]$pattern) {
  $task = Get-ScheduledTask -TaskName $name -ErrorAction Stop
  $actions = @($task.Actions | ForEach-Object { [string]$_.Execute + ' ' + [string]$_.Arguments }) -join ' '
  Assert-Ok ($actions -match $pattern) ("task action changed, refusing to manage $name")
  return $task
}
function Start-LocalTasks {
  foreach ($spec in $ownerTasks) {
    $task = Task-Action $spec.Name $spec.Pattern
    if ([string]$task.State -eq 'Running') { Say 'SURFACE_TASK' ($spec.Name+' already_running'); continue }
    if ($spec.Name -match 'SSH Tunnel') {
      $busy = @(Get-NetTCPConnection -State Listen -LocalPort $localPorts -ErrorAction SilentlyContinue)
      Assert-Ok ($busy.Count -eq 0) 'forward port occupied while tunnel task stopped; inspect owner'
    }
    Start-ScheduledTask -TaskName $spec.Name -ErrorAction Stop
    Say 'SURFACE_TASK' ($spec.Name+' start_requested')
  }
}
function Show-LocalTasks {
  foreach ($spec in $ownerTasks) {
    $task = Task-Action $spec.Name $spec.Pattern
    Say 'SURFACE_TASK' ($spec.Name+' '+$task.State)
  }
  foreach ($port in $localPorts) {
    $listener = @(Get-NetTCPConnection -State Listen -LocalPort $port -ErrorAction SilentlyContinue)
    Say 'SURFACE_PORT' ("$port="+$(if ($listener.Count -gt 0) {'LISTEN'} else {'NOT_LISTENING'}))
  }
}
function Stop-LocalTasks {
  foreach ($spec in $ownerTasks) {
    $task = Task-Action $spec.Name $spec.Pattern
    if ([string]$task.State -eq 'Running') {
      Stop-ScheduledTask -TaskName $spec.Name -ErrorAction Stop
      Say 'SURFACE_STOP' ($spec.Name+' requested')
    }
  }
  Say 'NOTICE' 'Task Scheduler stop may leave children; inspect any remaining owned listener, never kill an unknown PID.'
}
# Legacy Windows task keys are used only to find existing Task Scheduler owners.
# Canonical app names are customer, merchant, captain, control-panel.
$remoteSpecs = @(foreach($app in $developmentPorts.apps.PSObject.Properties){
  @{A=$app.Name;N=$app.Value.task;P=[int]$app.Value.lenovo;Cli=$app.Value.cli}
})
$remoteAppSpecs = '$specs=@((ConvertFrom-Json ''' + (ConvertTo-Json -InputObject $remoteSpecs -Compress).Replace("'","''") + ''') | ForEach-Object { $_ })'
$remoteTasksScript = $remoteAppSpecs + [Environment]::NewLine + @'
foreach($s in $specs){
  $task=Get-ScheduledTask -TaskName $s.N -ErrorAction Stop
  $actions=($task.Actions | ForEach-Object { [string]$_.Execute+' '+[string]$_.Arguments }) -join ' '
  if($actions -notmatch 'Start-App\.ps1' -or $actions -notmatch [regex]::Escape($s.A)) {throw ('TASK_OWNER_CHANGED '+$s.N)}
  $port=@(Get-NetTCPConnection -State Listen -LocalPort $s.P -ErrorAction SilentlyContinue).Count -gt 0
  Write-Output ('LENOVO_APP app='+$s.A+' task='+$task.State+' port='+$s.P+' listen='+$port)
}
'@
# The existing launcher task owns the entire pinned Node descendant tree.
# Snapshot before stopping Task Scheduler: afterward parent links can disappear.
$remoteAppProcessLifecycle = @'
function Get-OwnedAppProcessTree([string]$App,[object[]]$Processes,[string]$Root,[string]$PinnedNode) {
  $launcherPath=Join-Path $Root 'tools\dev\Start-App.ps1'
  $pattern='(?i)(?:^|\s)-App\s+"?'+[regex]::Escape($App)+'"?(?:\s|$)'
  $launchers=@($Processes | Where-Object {
    $_.Name -in @('pwsh.exe','powershell.exe') -and $_.CommandLine -and
    $_.CommandLine.IndexOf($launcherPath,[StringComparison]::OrdinalIgnoreCase) -ge 0 -and $_.CommandLine -match $pattern
  })
  if($launchers.Count -ne 1){throw ('APP_TREE_LAUNCHER_UNPROVEN '+$App)}
  $tree=[Collections.Generic.List[object]]::new()
  $tree.Add($launchers[0])
  for($i=0;$i -lt $tree.Count;$i++){
    $parent=$tree[$i]
    foreach($child in @($Processes | Where-Object {
      $_.ParentProcessId -eq $parent.ProcessId -and $_.ProcessId -ne $parent.ProcessId -and
      $_.CreationDate -ge $parent.CreationDate
    })){
      # The OS-owned console host is not an application worker; never terminate it.
      if($child.Name -eq 'conhost.exe' -and $child.ExecutablePath -eq (Join-Path $env:WINDIR 'System32\conhost.exe')){continue}
      if($child.Name -ne 'node.exe' -or $child.ExecutablePath -ne $PinnedNode -or
        $tree.ProcessId -contains $child.ProcessId){throw ('APP_TREE_FOREIGN '+$App+' pid='+$child.ProcessId)}
      $tree.Add($child)
    }
  }
  return $tree.ToArray()
}
function Test-SameOwnedAppProcess($Saved,$Live) {
  return ($Saved.ProcessId -eq $Live.ProcessId -and $Saved.ParentProcessId -eq $Live.ParentProcessId -and
    $Saved.CreationDate -eq $Live.CreationDate -and $Saved.Name -eq $Live.Name -and
    $Saved.ExecutablePath -eq $Live.ExecutablePath -and $Saved.CommandLine -ceq $Live.CommandLine)
}
function Assert-OwnedAppPort([string]$App,[int]$Port,[object[]]$Tree) {
  $listeners=@(Get-NetTCPConnection -State Listen -LocalPort $Port -ErrorAction SilentlyContinue)
  if($listeners.Count -gt 1 -or ($listeners.Count -eq 1 -and $Tree.ProcessId -notcontains $listeners[0].OwningProcess)){
    throw ('APP_PORT_OWNER_UNPROVEN '+$App)
  }
}
function Stop-OwnedAppTree([string]$TaskName,[string]$App,[int]$Port,[object[]]$Tree) {
  if($Tree.Count -lt 1 -or (Get-ScheduledTask -TaskName $TaskName -ErrorAction Stop).State -ne 'Running'){
    throw ('APP_TASK_STATE_CHANGED '+$App)
  }
  $liveLauncher=Get-CimInstance Win32_Process -Filter ('ProcessId='+$Tree[0].ProcessId)
  if(!$liveLauncher -or !(Test-SameOwnedAppProcess $Tree[0] $liveLauncher)){throw ('APP_TREE_CHANGED '+$App)}
  Assert-OwnedAppPort $App $Port $Tree
  # Hold verified process handles before stopping the task. WMI metadata may
  # disappear during exit, and a PID alone may be recycled after the stop.
  $handles=[Collections.Generic.List[object]]::new()
  try{
    foreach($saved in @($Tree | Where-Object Name -eq 'node.exe')){
      $live=Get-CimInstance Win32_Process -Filter ('ProcessId='+$saved.ProcessId)
      if(!$live){continue}
      if(!(Test-SameOwnedAppProcess $saved $live)){throw ('APP_TREE_PID_CHANGED '+$App)}
      $process=Get-Process -Id $saved.ProcessId -ErrorAction SilentlyContinue
      if(!$process){continue}
      try{
        $null=$process.Handle
        if([Math]::Abs(($process.StartTime.ToUniversalTime()-$saved.CreationDate.ToUniversalTime()).Ticks) -gt 10){
          throw ('APP_TREE_PID_REUSED '+$App)
        }
        $handles.Add(@{Saved=$saved;Process=$process})
      }catch{$process.Dispose();throw}
    }
    Stop-ScheduledTask -TaskName $TaskName -ErrorAction Stop
    $deadline=[DateTime]::UtcNow.AddSeconds(15)
    while((Get-ScheduledTask -TaskName $TaskName -ErrorAction Stop).State -eq 'Running'){
      if([DateTime]::UtcNow -ge $deadline){throw ('APP_TASK_STILL_RUNNING '+$App)}
      Start-Sleep -Milliseconds 250
    }
    foreach($entry in $handles){
      if(!$entry.Process.HasExited){$entry.Process.Kill()}
      if(!$entry.Process.WaitForExit(10000)){throw ('APP_TREE_EXIT_TIMEOUT '+$App)}
      Write-Output ('APP_OWNED_DESCENDANT_STOPPED '+$App+' pid='+$entry.Saved.ProcessId)
    }
    $deadline=[DateTime]::UtcNow.AddSeconds(10)
    do{
      $remaining=@(Get-CimInstance Win32_Process)
      $residual=@(foreach($saved in $Tree){
        foreach($live in @($remaining | Where-Object {
          ($_.ProcessId -eq $saved.ProcessId -and $_.CreationDate -eq $saved.CreationDate) -or
          ($_.ParentProcessId -eq $saved.ProcessId -and $_.CreationDate -ge $saved.CreationDate)
        })){
          if($live.Name -ne 'conhost.exe' -or $live.ExecutablePath -ne (Join-Path $env:WINDIR 'System32\conhost.exe')){$live}
        }
      })
      $listeners=@(Get-NetTCPConnection -State Listen -LocalPort $Port -ErrorAction SilentlyContinue)
      if($residual.Count -eq 0 -and $listeners.Count -eq 0){Write-Output ('APP_PROCESS_TREE_DRAINED '+$App);return}
      Start-Sleep -Milliseconds 250
    }while([DateTime]::UtcNow -lt $deadline)
    if($residual.Count -gt 0){throw ('APP_TREE_NOT_DRAINED '+$App+' pid='+($residual.ProcessId -join ','))}
    throw ('APP_PORT_STILL_OCCUPIED_NO_UNKNOWN_PROCESS_KILL '+$App)
  }finally{foreach($entry in $handles){$entry.Process.Dispose()}}
}
'@

function Show-LenovoTasks { Invoke-Lenovo $remoteTasksScript }
function Start-LenovoTasks {
  $start = $remoteTasksScript + @'
foreach($s in $specs){
  $task=Get-ScheduledTask -TaskName $s.N -ErrorAction Stop
  $port=@(Get-NetTCPConnection -State Listen -LocalPort $s.P -ErrorAction SilentlyContinue).Count -gt 0
  if([string]$task.State -eq 'Running') {continue}
  if($port){throw ('APP_PORT_OCCUPIED '+$s.N+' '+$s.P)}
  Start-ScheduledTask -TaskName $s.N -ErrorAction Stop
  Write-Output ('LENOVO_APP_START_REQUESTED '+$s.A)
}
'@
  Invoke-Lenovo $start
}
function Stop-LenovoTasks {
  $stop = $remoteTasksScript + [Environment]::NewLine + $remoteAppProcessLifecycle + [Environment]::NewLine + @'
$root='C:\Users\bthwa\BThwaniAppRunner\source-runtime'
$node='C:\Users\bthwa\BThwaniAppRunner\tools\node-v24.22.1-refoundation\node.exe'
$snapshot=@(Get-CimInstance Win32_Process)
$plans=@()
foreach($s in $specs){
  $task=Get-ScheduledTask -TaskName $s.N -ErrorAction Stop
  if([string]$task.State -eq 'Running') {
    $tree=@(Get-OwnedAppProcessTree $s.A $snapshot $root $node)
    Assert-OwnedAppPort $s.A $s.P $tree
    $plans+=@{Spec=$s;Tree=$tree}
  }elseif(@(Get-NetTCPConnection -State Listen -LocalPort $s.P -ErrorAction SilentlyContinue).Count -gt 0){
    throw ('APP_STOP_UNPROVEN_ORPHAN '+$s.A)
  }
}
foreach($plan in $plans){
  Stop-OwnedAppTree $plan.Spec.N $plan.Spec.A $plan.Spec.P $plan.Tree
}
'@
  Invoke-Lenovo $stop
}

function Show-AppsHelp {
  Write-Output 'APPS=canonical customer / merchant / captain / control-panel; no duplicate launchers'
  Write-Output 'pnpm dev apps status                   # read-only task, listener, process owner and mirror check'
  Write-Output 'pnpm dev apps verify                   # above plus Web and Metro HTTP, not visual Fast Refresh'
  Write-Output 'pnpm dev apps reconcile [-Apply]      # check or repair pinned Lenovo dependencies only when needed'
  Write-Output 'pnpm dev apps android                  # inspect ADB device and reverse mappings, no changes'
  Write-Output 'pnpm dev apps open                     # reuse Chrome tabs and open Samsung; no server duplication'
  Write-Output 'pnpm dev apps open -Mode Browser       # Chrome only, no Android connection needed'
  Write-Output 'pnpm dev                             # start/reuse tasks, then open available screens'
  Write-Output 'pnpm dev apps logs -App customer       # last 20 log lines, redacted'
  Write-Output 'pnpm dev apps start -App merchant      # preflight/dry run only'
  Write-Output 'pnpm dev apps start -App merchant -Apply # start only stopped and port-free task'
  Write-Output 'pnpm dev apps restart -App captain     # preflight/dry run only'
  Write-Output 'pnpm dev apps restart -App captain -Apply # only if unhealthy, scoped, fail-closed'
  Write-Output 'APPS_GUARDS=never force-stop unknown PID, healthy app, Docker, SSH tunnels, cache or source watcher'
}
# A responding dev server is not proof the task-owned source mirror is current.
function Inspect-AppSourceSync([switch]$StrictCheck) {
  $spec=$ownerTasks[0]
  $task=Task-Action $spec.Name $spec.Pattern
  $info=Get-ScheduledTaskInfo -TaskName $spec.Name -ErrorAction Stop
  $proof=@{}
  $node=Get-Command node.exe -ErrorAction SilentlyContinue
  if($node){
    $result=@(& $node.Source (Join-Path $repo 'tools\dev\sync-lenovo-source.mjs') '--verify-manifest' 2>&1)
    if($LASTEXITCODE -eq 0){
      try{$proof=$result -join "`n" | ConvertFrom-Json -AsHashtable -ErrorAction Stop}catch{}
    }
  }
  $current=$proof['current'] -eq $true
  $running=[string]$task.State -eq 'Running'
  $mirrorHead=$proof['mirrorHead'] ?? 'UNVERIFIED'
  $head=$proof['head'] ?? 'UNVERIFIED'
  $status=if($running -and $current){'PASS'}else{'FAIL'}
  Say 'APP_SOURCE_SYNC' ($status+' task='+$task.State+' lastResult='+$info.LastTaskResult+' mirrorHead='+$mirrorHead+' sourceHead='+$head)
  if($StrictCheck){Assert-Ok ($running -and $current) 'APP_SOURCE_SYNC_NOT_CURRENT (existing watcher or current source digests not verified)'}
}

$remoteDependencyLock = @'
function Get-WorkspaceLockDocument([string]$Raw) {
  $docs=@(($Raw -csplit '(?m)^---[ \t]*\r?$') | ForEach-Object {$_.Trim()} | Where-Object {$_})
  if($docs.Count -lt 1 -or $docs.Count -gt 2){throw 'APP_LOCK_DOCUMENT_COUNT_INVALID'}
  $workspace=$docs[$docs.Count-1].Replace([string][char]13+[char]10,[string][char]10)
  if($workspace -cnotmatch '(?m)^lockfileVersion:' -or $workspace -cnotmatch '(?m)^importers:'){throw 'APP_LOCK_DOCUMENT_INVALID'}
  return $workspace
}
'@

function Inspect-AppOwners([switch]$StrictCheck) {
  $lock=(Get-FileHash -LiteralPath (Join-Path $repo 'pnpm-lock.yaml') -Algorithm SHA256).Hash
  $mode=if($StrictCheck){'$true'}else{'$false'}
  $script=$remoteAppSpecs + [Environment]::NewLine + $remoteDependencyLock + [Environment]::NewLine + @'
$root='C:\Users\bthwa\BThwaniAppRunner\source-runtime'
$node='C:\Users\bthwa\BThwaniAppRunner\tools\node-v24.22.1-refoundation\node.exe'
$strict=__STRICT__
$expectedLock='__LOCK__'
if(!(Test-Path -LiteralPath $root -PathType Container)){throw 'APP_MIRROR_MISSING'}
$version=(Get-Content -LiteralPath (Join-Path $root '.node-version') -Raw).Trim()
$actualNode=if(Test-Path -LiteralPath $node -PathType Leaf){(& $node --version).Trim().TrimStart('v')}else{'MISSING'}
$lock=(Get-FileHash -LiteralPath (Join-Path $root 'pnpm-lock.yaml') -Algorithm SHA256).Hash
# pnpm 12's source lock can have a leading package-manager lock document;
# its installed virtual-store lock represents the final workspace document.
# Compare the actual installed graph, not just the mirrored lockfile bytes.
$installed=Join-Path $root 'node_modules\.pnpm\lock.yaml'
$installedMatch=$false
if(Test-Path -LiteralPath $installed -PathType Leaf){
  try{
    $wanted=Get-WorkspaceLockDocument (Get-Content -LiteralPath (Join-Path $root 'pnpm-lock.yaml') -Raw)
    $actual=Get-WorkspaceLockDocument (Get-Content -LiteralPath $installed -Raw)
    $installedMatch=$wanted -ceq $actual
  }catch{}
}
Write-Output ('APP_MIRROR nodePin='+$version+' nodeActual='+$actualNode+' lockMatch='+($lock -eq $expectedLock))
Write-Output ('APP_INSTALLED_DEPENDENCIES '+$(if($installedMatch){'PASS'}else{'FAIL'}))
if($strict -and ($version -ne '24.22.1' -or $actualNode -ne $version -or $lock -ne $expectedLock)){throw 'APP_MIRROR_TOOLCHAIN_OR_LOCK_MISMATCH'}
if($strict -and !$installedMatch){throw 'APP_INSTALLED_LOCK_MISMATCH (mirrored lock does not match installed dependencies)'}
foreach($s in $specs){
  $manifest=Get-Content -LiteralPath (Join-Path $root ('apps\'+$s.A+'\package.json')) -Raw | ConvertFrom-Json
  foreach($dep in $manifest.dependencies.PSObject.Properties){
    if([string]$dep.Value -notlike 'workspace:*'){continue}
    $dependencyPackage=Join-Path $root ('apps\'+$s.A+'\node_modules\'+$dep.Name+'\package.json')
    if(!(Test-Path -LiteralPath $dependencyPackage -PathType Leaf)){
      Write-Output ('APP_WORKSPACE_LINK_MISSING app='+$s.A+' package='+$dep.Name)
      if($strict){throw ('APP_WORKSPACE_DEPENDENCY_MISSING '+$s.A+' '+$dep.Name)}
    }
  }
  $task=Get-ScheduledTask -TaskName $s.N -ErrorAction Stop
  $actions=@($task.Actions)
  $action=($actions | ForEach-Object {[string]$_.Execute+' '+[string]$_.Arguments}) -join ' '
  if($actions.Count -ne 1 -or $action -notmatch 'Start-App\.ps1' -or
    $action -notmatch ('(?i)-App\s+'+[regex]::Escape($s.A)+'(?:\s|$)')){throw ('TASK_OWNER_CHANGED '+$s.A)}
  $listeners=@(Get-NetTCPConnection -State Listen -LocalPort $s.P -ErrorAction SilentlyContinue)
  $pidValue=if($listeners.Count -eq 1){[int]$listeners[0].OwningProcess}else{0}
  $owner=if($pidValue){Get-CimInstance Win32_Process -Filter ('ProcessId='+$pidValue)}else{$null}
  $owned=$false
  if($owner -and $owner.Name -eq 'node.exe' -and $owner.CommandLine -match $s.Cli){
    $cursor=$owner
    for($i=0;$i -lt 6 -and $cursor;$i++){
      if($cursor.Name -in @('powershell.exe','pwsh.exe') -and $cursor.CommandLine -match 'Start-App\.ps1' -and
        $cursor.CommandLine -match ('(?i)-App\s+'+[regex]::Escape($s.A)+'(?:\s|$)')){$owned=$true;break}
      if(!$cursor.ParentProcessId -or $cursor.ParentProcessId -eq $cursor.ProcessId){break}
      $cursor=Get-CimInstance Win32_Process -Filter ('ProcessId='+$cursor.ParentProcessId)
    }
  }
  $cli=if($s.Cli -eq 'expo'){Join-Path $root ('apps\'+$s.A+'\node_modules\expo\bin\cli')}else{Join-Path $root 'apps\control-panel\node_modules\next\dist\bin\next'}
  $present=Test-Path -LiteralPath $cli -PathType Leaf
  Write-Output ('APP_OWNER app='+$s.A+' task='+$task.State+' port='+$s.P+' listeners='+$listeners.Count+' pid='+$pidValue+' owned='+$owned+' cli='+$present)
  if($strict -and ($task.State -ne 'Running' -or $listeners.Count -ne 1 -or -not $owned -or -not $present)){
    throw ('APP_RUNTIME_INCOMPLETE '+$s.A)
  }
}
'@
  $script=$script.Replace('__STRICT__',$mode).Replace('__LOCK__',$lock)
  Invoke-Lenovo $script
}
function Get-AppHttpTargets {
  @(
    @{A='customer';U="http://127.0.0.1:$($developmentPorts.apps.customer.surface)/"},
    @{A='customer';U="http://127.0.0.1:$($developmentPorts.apps.customer.surface)/stores"},
    @{A='merchant';U="http://127.0.0.1:$($developmentPorts.apps.merchant.surface)/"},
    @{A='captain-metro';U="http://127.0.0.1:$($developmentPorts.apps.captain.surface)/status"},
    @{A='control-panel';U="http://127.0.0.1:$($developmentPorts.apps.'control-panel'.surface)/"}
  )
}
function Test-AppHttpTarget {
  param([hashtable]$Target,[int]$TimeoutSec=7,[int]$MaxAttempts=1,[int]$RetryDelayMs=250)
  # First Expo Web compilation can outlast a short readiness probe.
  # Retry only within a fixed budget; never turn a persistent failure into PASS.
  $timer=[Diagnostics.Stopwatch]::StartNew()
  $lastFailure='UNKNOWN'
  for($attempt=1;$attempt -le $MaxAttempts;$attempt++){
    try {
      $response=Invoke-WebRequest -UseBasicParsing -Uri $Target.U -TimeoutSec $TimeoutSec -SkipHttpErrorCheck -ErrorAction Stop
      # Expo can return an error document during SSR. A reachable listener is
      # not a healthy render; preserve this signature even if a retry recovers.
      if($Target.A -in @('customer','merchant') -and
        $response.Content -match 'Requiring unknown module' -and
        $response.Content -match 'unknownModuleError|Server Error|metroRequire'){
        return @{Success=$false;Attempts=$attempt;ElapsedMs=[int]$timer.ElapsedMilliseconds;Error='EXPO_UNKNOWN_MODULE'}
      }
      if($response.StatusCode -eq 200){
        return @{Success=$true;Attempts=$attempt;ElapsedMs=[int]$timer.ElapsedMilliseconds;Error=''}
      }
      $lastFailure='HTTP_'+$response.StatusCode
    } catch {
      $exception=$_.Exception
      $lastFailure=if($exception -is [Threading.Tasks.TaskCanceledException] -or
        $exception.InnerException -is [Threading.Tasks.TaskCanceledException]){'TIMEOUT'}else{$exception.GetType().Name}
    }
    if($attempt -lt $MaxAttempts -and $RetryDelayMs -gt 0){Start-Sleep -Milliseconds $RetryDelayMs}
  }
  return @{Success=$false;Attempts=$MaxAttempts;ElapsedMs=[int]$timer.ElapsedMilliseconds;Error=$lastFailure}
}
function Test-AppRestartHealth {
  param([hashtable]$Target)
  # A single good SSR response can hide an intermittent Metro error.
  # Only skip an Expo Web restart after three consecutive healthy probes.
  $samples=if($Target.A -in @('customer','merchant')){3}else{1}
  for($i=0;$i -lt $samples;$i++){
    if(-not (Test-AppHttpTarget -Target $Target -TimeoutSec 4 -MaxAttempts 1).Success){return $false}
    if($i -lt ($samples-1)){Start-Sleep -Milliseconds 250}
  }
  return $true
}
function Verify-AppWeb {
  $failures=0
  foreach($target in Get-AppHttpTargets){
    $result=Test-AppHttpTarget -Target $target -TimeoutSec 14 -MaxAttempts 3
    if($result.Success){
      Say 'APP_HTTP' ($target.A+' PASS status=200 path='+$target.U+' attempts='+$result.Attempts+' elapsedMs='+$result.ElapsedMs)
    } else {
      $failures++
      Say 'APP_HTTP' ($target.A+' FAIL path='+$target.U+' attempts='+$result.Attempts+' elapsedMs='+$result.ElapsedMs+' reason='+$result.Error)
    }
  }
  Say 'FAST_REFRESH_VISUAL' 'NOT_RUN (requires two observed Web and Android UI edits and restoration)'
  Assert-Ok ($failures -eq 0) ('Web/Metro readiness failed on '+$failures+' checks')
}
function Inspect-AppAndroid {
  $adb=Get-Command 'adb.exe' -ErrorAction SilentlyContinue
  if(-not $adb){ Say 'ANDROID_ADB' 'NOT_FOUND'; return }
  $devices=@(& $adb.Source 'devices' '-l' 2>&1)
  Assert-Ok ($LASTEXITCODE -eq 0) 'adb devices failed'
  $lines=@($devices | ForEach-Object {$_.ToString()})
  $devicePresent=@($lines | Where-Object {$_ -match '^R5CX14S4PZW\s+device\b'}).Count -eq 1
  Say 'ANDROID_ADB' ('SAMSUNG_DEVICE='+$devicePresent)
  $reverses=@(& $adb.Source 'reverse' '--list' 2>&1)
  Assert-Ok ($LASTEXITCODE -eq 0) 'adb reverse list failed'
  foreach($port in (@($android | ForEach-Object { [int]$_.Port }) + $nativeOwnerPorts)){
    $mapped=@($reverses | Where-Object {$_.ToString() -match ('tcp:'+$port+'\s+tcp:'+$port+'\b')}).Count -gt 0
    Say 'ANDROID_REVERSE' ('port='+$port+' configured='+$mapped)
  }
  Say 'ANDROID_VISUAL' 'NOT_RUN (device presence and reverse list do not prove UI Fast Refresh)'
}
function Show-AppLogs {
  Assert-Ok (-not [string]::IsNullOrWhiteSpace($App)) 'specify -App customer|merchant|captain|control-panel'
  $body=@'
$app='__APP__'
$base='C:\Users\bthwa\BThwaniAppRunner\logs'
function Read-BoundedAppLog([string]$path) {
  # A live log can contain a multi-megabyte line or incomplete final write.
  # Never scan backwards without a byte limit (Get-Content -Tail can stall).
  $stream=[IO.File]::Open($path,[IO.FileMode]::Open,[IO.FileAccess]::Read,([IO.FileShare]::ReadWrite -bor [IO.FileShare]::Delete))
  try {
    $length=$stream.Length
    if(!$length){return}
    $header=[byte[]]::new(2)
    $headerRead=$stream.Read($header,0,2)
    $encoding=[Text.Encoding]::UTF8
    $unit=1
    if($headerRead -eq 2 -and $header[0] -eq 255 -and $header[1] -eq 254){$encoding=[Text.Encoding]::Unicode;$unit=2}
    elseif($headerRead -eq 2 -and $header[0] -eq 254 -and $header[1] -eq 255){$encoding=[Text.Encoding]::BigEndianUnicode;$unit=2}
    $start=[Math]::Max([long]0,$length-65536)
    if($unit -eq 2 -and $start%2){$start++}
    $size=[int]($length-$start)
    $buffer=[byte[]]::new($size)
    $null=$stream.Seek($start,[IO.SeekOrigin]::Begin)
    $read=0
    while($read -lt $size){
      $n=$stream.Read($buffer,$read,$size-$read)
      if(!$n){break}
      $read+=$n
    }
    if($read -ne $size -or $stream.Length -lt $length){throw 'APP_LOG_CHANGED_DURING_READ'}
    $content=$encoding.GetString($buffer,0,$read)
  } finally { $stream.Dispose() }
  # Omit partial boundaries before redaction; never print a secret fragment.
  if($start -gt 0){
    $first=$content.IndexOf([char]10)
    if($first -lt 0){Write-Output 'APP_LOG_NO_COMPLETE_LINES';return}
    $content=$content.Substring($first+1)
  } else { $content=$content.TrimStart([char]0xFEFF) }
  $last=$content.LastIndexOf([char]10)
  if($last -lt 0){Write-Output 'APP_LOG_NO_COMPLETE_LINES';return}
  $lines=@($content.Substring(0,$last) -split '\r?\n')
  foreach($line in @($lines | Select-Object -Last 20)){
    $line=$line.TrimEnd([char]13)
    $line=$line -replace '(?i)(Bearer\s+)[A-Za-z0-9._~-]+','$1[REDACTED]'
    $line=$line -replace '(?i)(password|secret|token|api[_-]?key)\s*[=:]\s*[^,;\s]+','$1=[REDACTED]'
    if($line.Length -gt 300){$line=$line.Substring(0,300)}
    Write-Output $line
  }
}
foreach($kind in @('out','err')){
  $path=Join-Path $base ('refoundation-'+$app+'.'+$kind+'.log')
  if(!(Test-Path -LiteralPath $path -PathType Leaf)){Write-Output ('APP_LOG_MISSING '+$app+' '+$kind);continue}
  Write-Output ('APP_LOG app='+$app+' stream='+$kind)
  Read-BoundedAppLog $path
}
'@
  Invoke-Lenovo $body.Replace('__APP__',$App)
}
function Control-SingleApp([string]$operation) {
  Assert-Ok (-not [string]::IsNullOrWhiteSpace($App)) 'specify exactly one -App'
  if (-not $Apply) {
    Say 'APP_CONTROL' ('DRY_RUN operation='+$operation+' app='+$App+'; use -Apply after inspecting status')
    Inspect-AppOwners
    return
  }
  $body=@'
$app='__APP__'
$mode='__MODE__'
$s=@($specs|Where-Object A -eq $app)
if($s.Count -ne 1){throw 'APP_NOT_ALLOWED'}
$s=$s[0]
$t=Get-ScheduledTask -TaskName $s.N -ErrorAction Stop
$actions=@($t.Actions)
$action=($actions | ForEach-Object {[string]$_.Execute+' '+[string]$_.Arguments}) -join ' '
if($actions.Count -ne 1 -or $action -notmatch 'Start-App\.ps1' -or
  $action -notmatch ('(?i)-App\s+'+[regex]::Escape($app)+'(?:\s|$)')){throw ('TASK_OWNER_CHANGED '+$app)}
$source='C:\Users\bthwa\BThwaniAppRunner\source-runtime'
$node='C:\Users\bthwa\BThwaniAppRunner\tools\node-v24.22.1-refoundation\node.exe'
if((Get-FileHash -LiteralPath (Join-Path $source 'pnpm-lock.yaml') -Algorithm SHA256).Hash -ne '__LOCK__') {throw ('APP_LOCK_MIRROR_MISMATCH '+$app)}
if(!(Test-Path -LiteralPath $node -PathType Leaf) -or
  !(Test-Path -LiteralPath (Join-Path $source 'pnpm-lock.yaml') -PathType Leaf) -or
  (Get-Content -LiteralPath (Join-Path $source '.node-version') -Raw).Trim() -ne '24.22.1') {throw ('APP_RUNTIME_SOURCE_MISSING '+$app)}
$cli=if($s.Cli -eq 'expo'){Join-Path $source ('apps\'+$app+'\node_modules\expo\bin\cli')}else{Join-Path $source 'apps\control-panel\node_modules\next\dist\bin\next'}
if(!(Test-Path -LiteralPath $cli -PathType Leaf)){throw ('APP_CLI_MISSING '+$app)}
$listeners=@(Get-NetTCPConnection -State Listen -LocalPort $s.P -ErrorAction SilentlyContinue)
if($listeners.Count -gt 1){throw ('APP_PORT_AMBIGUOUS '+$app)}
if($listeners.Count -eq 1){
  $pidValue=[int]$listeners[0].OwningProcess
  $owner=Get-CimInstance Win32_Process -Filter ('ProcessId='+$pidValue)
  if(!$owner -or $owner.Name -ne 'node.exe' -or $owner.CommandLine -notmatch $s.Cli){throw ('APP_PORT_FOREIGN '+$app)}
  $owned=$false;$cursor=$owner
  for($i=0;$i -lt 6 -and $cursor;$i++){
    if($cursor.Name -in @('powershell.exe','pwsh.exe') -and $cursor.CommandLine -match 'Start-App\.ps1' -and
      $cursor.CommandLine -match ('(?i)-App\s+'+[regex]::Escape($app)+'(?:\s|$)')){$owned=$true;break}
    if(!$cursor.ParentProcessId -or $cursor.ParentProcessId -eq $cursor.ProcessId){break}
    $cursor=Get-CimInstance Win32_Process -Filter ('ProcessId='+$cursor.ParentProcessId)
  }
  if(!$owned){throw ('APP_PROCESS_OWNER_UNPROVEN '+$app)}
}
if($mode -eq 'start'){
  if($t.State -eq 'Running' -and $listeners.Count -eq 1){Write-Output ('APP_START_ALREADY_RUNNING '+$app);return}
  if($t.State -eq 'Running' -or $listeners.Count -ne 0){throw ('APP_START_BLOCKED_NOT_STOPPED '+$app)}
}else{
  if($listeners.Count -eq 1){
    $route=if($app -eq 'captain'){'/status'}else{'/'}
    $target=@{A=$app;U=('http://127.0.0.1:'+$s.P+$route)}
    if(Test-AppRestartHealth $target){Write-Output ('APP_RESTART_SKIPPED_HEALTHY '+$app);return}
  }
  if($t.State -eq 'Running'){
    $tree=@(Get-OwnedAppProcessTree $app @(Get-CimInstance Win32_Process) $source $node)
    Stop-OwnedAppTree $s.N $app $s.P $tree
  }
}
for($i=0;$i -lt 12;$i++){
  $busy=@(Get-NetTCPConnection -State Listen -LocalPort $s.P -ErrorAction SilentlyContinue)
  if($busy.Count -eq 0){break}
  Start-Sleep -Milliseconds 500
}
if(@(Get-NetTCPConnection -State Listen -LocalPort $s.P -ErrorAction SilentlyContinue).Count -ne 0){
  throw ('APP_PORT_STILL_OCCUPIED_NO_PROCESS_KILL '+$app)
}
if((Get-ScheduledTask -TaskName $s.N).State -eq 'Running'){throw ('APP_TASK_STILL_RUNNING '+$app)}
Start-ScheduledTask -TaskName $s.N -ErrorAction Stop
Write-Output ('APP_START_TASK_REQUESTED '+$app)
for($i=0;$i -lt 40;$i++){
  $listener=@(Get-NetTCPConnection -State Listen -LocalPort $s.P -ErrorAction SilentlyContinue)
  if($listener.Count -eq 1){Write-Output ('APP_LISTENER_STARTED '+$app+' port='+$s.P);return}
  Start-Sleep -Seconds 1
}
throw ('APP_LISTENER_NOT_READY '+$app)
'@
  $lockHash=(Get-FileHash -LiteralPath (Join-Path $repo 'pnpm-lock.yaml') -Algorithm SHA256).Hash
  $body=$body.Replace('__APP__',$App).Replace('__MODE__',$operation).Replace('__LOCK__',$lockHash)
  $httpProbe="function Test-AppHttpTarget {`n$((Get-Command Test-AppHttpTarget -CommandType Function).Definition)`n}`nfunction Test-AppRestartHealth {`n$((Get-Command Test-AppRestartHealth -CommandType Function).Definition)`n}"
  Invoke-Lenovo ($remoteAppSpecs + [Environment]::NewLine + $remoteAppProcessLifecycle + [Environment]::NewLine + $httpProbe + [Environment]::NewLine + $body)
}
function Probe-App([string]$url,[string]$accept='text/html',[string]$platform='') {
  $curl=Join-Path $env:WINDIR 'System32\curl.exe'
  Assert-Ok (Test-Path -LiteralPath $curl -PathType Leaf) 'WINDOWS_CURL_MISSING'
  $platformHeader=if($platform){@('--header',('Expo-Platform: '+$platform))}else{@()}
  $response=@(& $curl '--silent' '--max-time' '7' '--output' 'NUL' '--write-out' '%{http_code}|%{content_type}' '--header' ('Accept: '+$accept) @platformHeader $url 2>$null)
  $exitCode=$LASTEXITCODE
  $parts=($response -join '').Trim().Split('|')
  return @{ Code=$(if($parts.Count){$parts[0]}else{'000'}); Mime=$(if($parts.Count -gt 1){$parts[1]}else{''}); Exit=$exitCode }
}
function Get-AppChromeWindow {
  Add-Type -AssemblyName UIAutomationClient
  Add-Type -AssemblyName UIAutomationTypes
  if(-not ('BthwaniChromeWindowLocator' -as [type])){
    Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
using System.Text;
public static class BthwaniChromeWindowLocator {
  public delegate bool Callback(IntPtr handle, IntPtr param);
  [DllImport("user32.dll")] public static extern bool EnumWindows(Callback callback, IntPtr parameter);
  [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr handle);
  [DllImport("user32.dll")] public static extern int GetClassName(IntPtr handle, StringBuilder result, int size);
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr handle, out uint processId);
}
'@
  }
  $handles=[Collections.Generic.List[IntPtr]]::new()
  $callback=[BthwaniChromeWindowLocator+Callback] {
    param([IntPtr]$h,[IntPtr]$lp)
    $class=[Text.StringBuilder]::new(80)
    [void][BthwaniChromeWindowLocator]::GetClassName($h,$class,80)
    if($class.ToString() -eq 'Chrome_WidgetWin_1' -and [BthwaniChromeWindowLocator]::IsWindowVisible($h)){
      [uint32]$chromeProcessId=0
      [void][BthwaniChromeWindowLocator]::GetWindowThreadProcessId($h,[ref]$chromeProcessId)
      if((Get-Process -Id $chromeProcessId -ErrorAction SilentlyContinue).ProcessName -eq 'chrome'){$handles.Add($h)}
    }
    return $true
  }
  [void][BthwaniChromeWindowLocator]::EnumWindows($callback,[IntPtr]::Zero)
  $condition=[Windows.Automation.PropertyCondition]::new(
    [Windows.Automation.AutomationElement]::ControlTypeProperty,
    [Windows.Automation.ControlType]::TabItem
  )
  foreach($handle in $handles){
    try {
      $window=[Windows.Automation.AutomationElement]::FromHandle($handle)
      $tabs=$window.FindAll([Windows.Automation.TreeScope]::Descendants,$condition)
      if($tabs.Count -lt 3){continue}
      $names=@($tabs | ForEach-Object {[string]$_.Current.Name})
      # Expo Web can temporarily expose its local URL as the Chrome tab title.
      # Match the three expected apps regardless of tab order or extra Chrome tabs.
      $expected=@(
        '(?i)(بثواني.*(الرئيسية|العميل)|bthwani.*customer|127\.0\.0\.1:18101)',
        '(?i)(بثواني.*التاجر|bthwani.*merchant|127\.0\.0\.1:18102)',
        '(?i)(بثواني.*لوحة التحكم|bthwani.*control|localhost:13000|127\.0\.0\.1:13000)'
      )
      $matched=[Collections.Generic.HashSet[int]]::new()
      foreach($signature in $expected){
        for($i=0;$i -lt $names.Count;$i++){
          if(-not $matched.Contains($i) -and $names[$i] -match $signature){
            [void]$matched.Add($i)
            break
          }
        }
      }
      if($matched.Count -eq $expected.Count){return $handle.ToInt64()}
    } catch {}
  }
  return 0
}
function Open-Browser {
  Assert-Ok (Test-Path -LiteralPath $chrome -PathType Leaf) 'GOOGLE_CHROME_MISSING'
  $statusUrls=@(
    ("http://127.0.0.1:$($developmentPorts.apps.customer.surface)/status"),
    ("http://127.0.0.1:$($developmentPorts.apps.merchant.surface)/status"),
    'http://localhost:13000/'
  )
  for($i=0;$i -lt $statusUrls.Count;$i++){
    $state=Probe-App $statusUrls[$i]
    Assert-Ok ($state.Exit -eq 0 -and $state.Code -eq '200') ('BROWSER_APP_NOT_READY '+$urls[$i])
  }
  $localState=Join-Path $env:LOCALAPPDATA 'Google\Chrome\User Data\Local State'
  Assert-Ok (Test-Path -LiteralPath $localState -PathType Leaf) 'CHROME_PROFILE_METADATA_MISSING'
  $profiles=Get-Content -LiteralPath $localState -Raw | ConvertFrom-Json
  $selectedProfile=$profiles.profile.info_cache.PSObject.Properties[$chromeProfile]
  Assert-Ok ($null -ne $selectedProfile) 'CHROME_PROFILE_MISSING'
  # Reuse the existing three-tab app window, if present; do not create duplicates.
  $existingWindow=Get-AppChromeWindow
  if($existingWindow -ne 0){
    Say 'CHROME_APPS' ('PASS already_open window='+$existingWindow+' profile='+$chromeProfile+' tabs=customer,merchant,control-panel')
    return
  }
  # All three URLs are passed to ONE Chrome invocation: one window, three tabs.
  # Other Chrome windows and profiles are left untouched.
  $profileArg='--profile-directory="' + $chromeProfile + '"'
  $null=Start-Process -FilePath $chrome -ArgumentList (@($profileArg,'--new-window','--no-first-run')+$urls) -PassThru -ErrorAction Stop
  $actualWindow=0
  for($attempt=0;$attempt -lt 12 -and $actualWindow -eq 0;$attempt++){
    Start-Sleep -Milliseconds 500
    $actualWindow=Get-AppChromeWindow
  }
  Assert-Ok ($actualWindow -ne 0) 'CHROME_ONE_WINDOW_THREE_APP_TABS_NOT_PROVEN'
  Say 'CHROME_APPS' ('PASS opened_window='+$actualWindow+' profile='+$chromeProfile+' tabs=customer,merchant,control-panel')
  Say 'BROWSER_VISUAL' 'NOT_RUN (requires actual page inspection; HTTP 200 is not UI acceptance)'
}
function Open-Android {
  $adb=Get-Command adb.exe -ErrorAction SilentlyContinue
  Assert-Ok ([bool]$adb) 'ADB_NOT_INSTALLED'
  $devices=@(& $adb.Source 'devices' | ForEach-Object {$_.ToString()})
  Assert-Ok (@($devices|Where-Object{$_ -match ('^'+[regex]::Escape($device)+'\s+device\s*$')}).Count -eq 1) 'EXPECTED_SAMSUNG_NOT_CONNECTED'
  $existing=@(& $adb.Source '-s' $device 'reverse' '--list' | ForEach-Object{$_.ToString()})
  $nativePorts = @($android | ForEach-Object { [int]$_.Port }) + $nativeOwnerPorts
  foreach($p in $nativePorts){
    if ($p -in $nativeOwnerPorts) {
      $listeners=@(Get-NetTCPConnection -State Listen -LocalAddress '127.0.0.1' -LocalPort $p -ErrorAction SilentlyContinue)
      Assert-Ok ($listeners.Count -eq 1) ('NATIVE_OWNER_SSH_TUNNEL_NOT_LISTENING '+$p)
      $owner=Get-CimInstance Win32_Process -Filter ('ProcessId=' + $listeners[0].OwningProcess)
      $forward='127.0.0.1:'+$p+':127.0.0.1:'+$p
      Assert-Ok ($owner -and $owner.Name -eq 'ssh.exe' -and
        $owner.CommandLine.Contains($forward) -and
        $owner.CommandLine.Contains('bthwani-docker')) ('NATIVE_OWNER_SSH_TUNNEL_UNVERIFIED '+$p)
    }
    $same=@($existing|Where-Object {$_ -match ('\btcp:'+$p+'\s+tcp:'+$p+'\b')}).Count -gt 0
    $collision=@($existing|Where-Object {$_ -match ('\btcp:'+$p+'\s+') -and $_ -notmatch ('\btcp:'+$p+'\s+tcp:'+$p+'\b')}).Count -gt 0
    Assert-Ok (-not $collision) ('ADB_REVERSE_COLLISION '+$p)
    if(-not $same){
      $null=@(& $adb.Source '-s' $device 'reverse' ('tcp:'+$p) ('tcp:'+$p) 2>&1)
      Assert-Ok ($LASTEXITCODE -eq 0) ('ADB_REVERSE_SETUP_FAILED '+$p)
      Say 'ADB_REVERSE' ('CREATED port='+$p)
    } else {Say 'ADB_REVERSE' ('REUSED port='+$p)}
  }
  $blocked=0
  foreach($entry in $android){
    $name=[string]$entry.Name
    $port=[int]$entry.Port
    # Native development builds need Expo's manifest, not merely web HTML or /status.
    $manifest=Probe-App ('http://127.0.0.1:'+$port+'/') 'application/expo+json' 'android'
    if($manifest.Exit -ne 0 -or $manifest.Code -ne '200' -or $manifest.Mime -notmatch '^application/expo\+json'){
      $blocked++
      Say 'ANDROID_APP' ($name+' BLOCKED native_manifest status='+$manifest.Code+' content_type='+$manifest.Mime)
      continue
    }
    $uri=[string]$entry.Scheme+'://expo-development-client/?url=http%3A%2F%2F127.0.0.1%3A'+$port
    $resolution=@(& $adb.Source '-s' $device 'shell' 'cmd' 'package' 'query-activities' '--brief' '-a' 'android.intent.action.VIEW' '-c' 'android.intent.category.BROWSABLE' '-d' $uri '-p' $entry.Package)
    Assert-Ok ($LASTEXITCODE -eq 0 -and @($resolution|Where-Object {$_.ToString().Contains($entry.Package+'/.MainActivity')}).Count -eq 1) ('ANDROID_INTENT_UNAVAILABLE '+$name)
    $result=@(& $adb.Source '-s' $device 'shell' 'am' 'start' '-W' '-a' 'android.intent.action.VIEW' '-c' 'android.intent.category.BROWSABLE' '-d' $uri '-p' $entry.Package)
    $status=$LASTEXITCODE
    if($status -ne 0 -or -not (@($result|Where-Object{$_.ToString() -match 'Status:\s+ok'}).Count)){
      $blocked++
      Say 'ANDROID_APP' ($name+' FAIL app_launch')
      continue
    }
    Start-Sleep -Milliseconds 250
    $top=@(& $adb.Source '-s' $device 'shell' 'dumpsys' 'activity' 'activities' | Where-Object{$_.ToString() -match 'topResumedActivity'} | Select-Object -First 1)
    if(@($top|Where-Object{$_.ToString() -match 'DevLauncherErrorActivity'}).Count){
      $blocked++
      Say 'ANDROID_APP' ($name+' FAIL dev_launcher_error')
    } elseif(@($top|Where-Object {$_.ToString().Contains($entry.Package)}).Count){
      Say 'ANDROID_APP' ($name+' INTENT_ACCEPTED foreground_activity='+$entry.Package)
    } else {
      Say 'ANDROID_APP' ($name+' INTENT_ACCEPTED foreground_unverified')
    }
  }
  Say 'ANDROID_VISUAL' 'NOT_RUN (native activity launch is not proof of rendered application)'
  if($blocked -gt 0) { throw ('ANDROID_LAUNCH_INCOMPLETE blocked='+$blocked+'; inspect Expo native manifest and app logs') }
}
function Show-OperatorAuthReadiness {
  # A missing browser cookie should return 401 only when the isolated BFF is configured.
  # This check never enrolls a credential, creates a session or grants an Operator scope.
  $state = Probe-App 'http://localhost:13000/api/auth/session' 'application/json'
  if($state.Exit -ne 0) {
    Say 'OPERATOR_AUTH' 'BLOCKED control-panel tunnel or server unavailable'
  } elseif($state.Code -eq '503') {
    Say 'OPERATOR_AUTH' 'BLOCKED Identity/Passkey runtime configuration or owner unavailable'
  } elseif($state.Code -eq '401') {
    Say 'OPERATOR_AUTH' 'BFF_READY; Identity ownership, enrollment and browser session NOT_VERIFIED'
  } else {
    Say 'OPERATOR_AUTH' ('NOT_VERIFIED status='+$state.Code)
  }
}

function Open-AppSurfaces {
  Assert-SurfaceIdentity 'SURFACE_ONLY'
  $selection = $Mode
  if ($selection -eq 'All') {
    $adb = Get-Command adb.exe -ErrorAction SilentlyContinue
    $connected = $false
    if ($adb) {
      $devices = @(& $adb.Source devices 2>&1)
      $connected = $LASTEXITCODE -eq 0 -and
        @($devices | Where-Object { $_.ToString() -match '^R5CX14S4PZW\s+device\b' }).Count -eq 1
    }
    if (-not $connected) {
      $selection = 'Browser'
      Say 'SAMSUNG' 'SKIPPED (not connected; Chrome opens independently)'
    }
  }
  if($selection -in @('Browser','All')){ Open-Browser }
  if($selection -in @('Android','All')){ Open-Android }
  Say 'OPEN_DEV_SURFACES' 'DONE'
}

function Invoke-AppDependencyReconcile {
  $task=Task-Action $ownerTasks[0].Name $ownerTasks[0].Pattern
  Assert-Ok ($task.State -eq 'Running') 'DEPENDENCY_SOURCE_WATCHER_STOPPED'
  $node=Get-Command node.exe -ErrorAction Stop
  $result=@(& $node.Source (Join-Path $repo 'tools/dev/sync-lenovo-source.mjs') '--verify-dependency-inputs' 2>&1)
  Assert-Ok ($LASTEXITCODE -eq 0) 'DEPENDENCY_SOURCE_PROOF_FAILED'
  $proof=($result -join [Environment]::NewLine)|ConvertFrom-Json -AsHashtable
  Assert-Ok ($proof.current -eq $true) 'DEPENDENCY_SOURCE_NOT_CURRENT'
  $expected=[ordered]@{}
  foreach($rel in @($proof.files.Keys|Sort-Object)){$expected[$rel]=$proof.files[$rel]}
  foreach($required in @('.node-version','pnpm-lock.yaml','pnpm-workspace.yaml','package.json')){Assert-Ok ($expected.Contains($required)) ('DEPENDENCY_SOURCE_MISSING '+$required)}
  $json=$expected|ConvertTo-Json -Compress
  $key=[Convert]::ToHexString([Security.Cryptography.SHA256]::HashData([Text.Encoding]::UTF8.GetBytes($json)))
  $script=$remoteAppSpecs+[Environment]::NewLine+$remoteAppProcessLifecycle+[Environment]::NewLine+$remoteDependencyLock+[Environment]::NewLine+@'
$root='C:\Users\bthwa\BThwaniAppRunner\source-runtime'
$node='C:\Users\bthwa\BThwaniAppRunner\tools\node-v24.22.1-refoundation\node.exe'
$pnpm='C:\Users\bthwa\BThwaniAppRunner\tools\pnpm\node_modules\pnpm\node_modules\@pnpm\exe.win32-x64\pnpm.exe'
$state=Join-Path $env:LOCALAPPDATA 'BThwani\Operations\SourceSync'
$receipt=Join-Path $state 'dependency-reconcile.json'
$expected='__INPUTS__'|ConvertFrom-Json -AsHashtable
$key='__KEY__'
$apply=__APPLY__
$automatic=__AUTOMATIC__
$roots=@('')+@($expected.Keys|Where-Object {$_ -match '^(apps|services|packages)/[^/]+/package\.json$'}|ForEach-Object {Split-Path -Parent $_}|Sort-Object)
function Assert-DependencyInputs {
  foreach($rel in $expected.Keys){
    if($rel -notmatch '^(?:\.node-version|package\.json|pnpm-(?:lock|workspace)\.yaml|(?:apps|services|packages)/[a-z0-9-]+/package\.json|patches/[^/\\:]+\.patch)$' -or $expected[$rel] -notmatch '^[A-F0-9]{64}$'){throw 'DEPENDENCY_INPUT_INVALID'}
    $file=Join-Path $root $rel
    if(!(Test-Path -LiteralPath $file -PathType Leaf) -or (Get-FileHash -LiteralPath $file).Hash -cne $expected[$rel]){throw ('DEPENDENCY_INPUT_DRIFT '+$rel)}
  }
  foreach($scope in 'apps','services','packages'){
    foreach($dir in @(Get-ChildItem -LiteralPath (Join-Path $root $scope) -Directory -ErrorAction SilentlyContinue)){
      $rel=$scope+'/'+$dir.Name+'/package.json'
      if((Test-Path -LiteralPath (Join-Path $root $rel)) -and !$expected.Contains($rel)){throw ('DEPENDENCY_UNMANAGED_IMPORTER '+$rel)}
    }
  }
  foreach($patch in @(Get-ChildItem -LiteralPath (Join-Path $root 'patches') -File -Filter '*.patch' -ErrorAction SilentlyContinue)){
    if(!$expected.Contains('patches/'+$patch.Name)){throw 'DEPENDENCY_UNMANAGED_PATCH'}
  }
}
function Test-InstalledDependencies {
  try{
    $wanted=Get-WorkspaceLockDocument (Get-Content -LiteralPath (Join-Path $root 'pnpm-lock.yaml') -Raw)
    $actual=Get-WorkspaceLockDocument (Get-Content -LiteralPath (Join-Path $root 'node_modules\.pnpm\lock.yaml') -Raw)
    if($wanted -cne $actual){return $false}
    foreach($rel in $roots){
      $dir=if($rel){Join-Path $root $rel}else{$root}
      $manifest=Get-Content -LiteralPath (Join-Path $dir 'package.json') -Raw|ConvertFrom-Json -AsHashtable
      foreach($kind in 'dependencies','devDependencies'){
        foreach($name in @($manifest[$kind].Keys)){
          if(!$name){continue}
          if($name -notmatch '^(?:@[a-zA-Z0-9_.-]+/)?[a-zA-Z0-9_.-]+$' -or $name -match '(?:^|/)\.\.?(?:/|$)'){throw 'DEPENDENCY_NAME_INVALID'}
          if(!(Test-Path -LiteralPath (Join-Path $dir ('node_modules/'+$name+'/package.json')) -PathType Leaf)){return $false}
        }
      }
    }
    return $true
  }catch{return $false}
}
function Write-DependencyReceipt([string]$status,[string]$backup) {
  $pending=$receipt+'.'+$PID+'.tmp'
  [IO.File]::WriteAllText($pending,(@{version=1;key=$key;status=$status;backup=$backup}|ConvertTo-Json -Compress))
  [IO.File]::Move($pending,$receipt,$true)
}
Assert-DependencyInputs
$last=$null
if(Test-Path -LiteralPath $receipt -ErrorAction Stop){
  $last=Get-Content -LiteralPath $receipt -Raw -ErrorAction Stop|ConvertFrom-Json -AsHashtable -ErrorAction Stop
  if($last -isnot [Collections.IDictionary] -or $last.version -ne 1 -or $last.status -isnot [string] -or $last.status -cnotin @('running','pass','failed','blocked') -or $last.key -isnot [string] -or $last.key -notmatch '^[A-F0-9]{64}$'){throw 'DEPENDENCY_RECEIPT_INVALID'}
}
if($last -and $last.status -in @('running','blocked')){throw 'DEPENDENCY_PREVIOUS_ATTEMPT_REQUIRES_READBACK'}
$dependencyProcesses=@([Diagnostics.Process]::GetProcessesByName('pnpm'))
try{if($dependencyProcesses.Count){throw 'DEPENDENCY_INSTALL_ALREADY_RUNNING'}}finally{foreach($process in $dependencyProcesses){$process.Dispose()}}
if((Test-InstalledDependencies) -and (!$last -or ($last.key -ceq $key -and $last.status -eq 'pass'))){
  if($apply -and !$last){New-Item -ItemType Directory -Path $state -Force|Out-Null;Write-DependencyReceipt 'pass' ''}
  Write-Output 'APP_DEPENDENCY_CURRENT';return
}
if(!$apply){Write-Output 'APP_DEPENDENCY_INSTALL_REQUIRED';return}
if($automatic -and $last -and $last.key -ceq $key -and $last.status -eq 'failed'){throw 'DEPENDENCY_FAILED_SAME_INPUT_MANUAL_RETRY_REQUIRED'}
$env:Path=(Split-Path -Parent $node)+';'+$env:Path
$env:CI='true'
if((& $node --version).Trim() -cne ('v'+(Get-Content -LiteralPath (Join-Path $root '.node-version') -Raw).Trim()) -or $LASTEXITCODE){throw 'DEPENDENCY_NODE_PIN_MISMATCH'}
$pin=(Get-Content -LiteralPath (Join-Path $root 'package.json') -Raw|ConvertFrom-Json).packageManager
if($pin -cne ('pnpm@'+(& $pnpm --version).Trim()) -or $LASTEXITCODE){throw 'DEPENDENCY_PNPM_PIN_MISMATCH'}
$plans=@();$snapshot=@(Get-CimInstance Win32_Process)
foreach($s in $specs){
  $task=Get-ScheduledTask -TaskName $s.N
  $actions=@($task.Actions)
  $args=[string]$actions[0].Arguments
  if($actions.Count -ne 1 -or $args.IndexOf((Join-Path $root 'tools\dev\Start-App.ps1'),[StringComparison]::OrdinalIgnoreCase) -lt 0 -or
     $args -notmatch ('(?i)(?:^|\s)-App\s+"?'+[regex]::Escape($s.A)+'"?(?:\s|$)')){throw ('DEPENDENCY_TASK_OWNER_CHANGED '+$s.A)}
  if($task.State -eq 'Running'){
    $tree=@(Get-OwnedAppProcessTree $s.A $snapshot $root $node)
    Assert-OwnedAppPort $s.A $s.P $tree
    $plans+=@{Spec=$s;Tree=$tree}
  }elseif(@(Get-NetTCPConnection -State Listen -LocalPort $s.P -ErrorAction SilentlyContinue).Count){throw ('DEPENDENCY_UNPROVEN_ORPHAN '+$s.A)}
}
foreach($rel in $roots){
  $dir=if($rel){Join-Path $root $rel}else{$root}
  foreach($path in @($dir,(Join-Path $dir 'node_modules'))){
    if((Test-Path -LiteralPath $path) -and ((Get-Item -LiteralPath $path -Force).Attributes -band [IO.FileAttributes]::ReparsePoint)){throw 'DEPENDENCY_ROOT_REPARSE_POINT'}
  }
}
$backup=Join-Path (Join-Path $state 'rollbacks') ('dependencies-'+$key.Substring(0,12)+'-'+[Guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $backup|Out-Null
$oldLockPath=Join-Path $root 'node_modules\.pnpm\lock.yaml'
$oldLockHash=if(Test-Path -LiteralPath $oldLockPath){(Get-FileHash -LiteralPath $oldLockPath).Hash}else{''}
Write-DependencyReceipt 'running' $backup
$moved=@();$installStarted=$false;$safe=$false;$success=$false;$failure=''
try{
  foreach($plan in $plans){Stop-OwnedAppTree $plan.Spec.N $plan.Spec.A $plan.Spec.P $plan.Tree}
  Assert-DependencyInputs
  foreach($rel in $roots){
    $dir=if($rel){Join-Path $root $rel}else{$root}
    $modules=Join-Path $dir 'node_modules'
    $old=Join-Path (Join-Path $backup ('previous/'+$rel)) 'node_modules'
    if(Test-Path -LiteralPath $modules){
      New-Item -ItemType Directory -Path (Split-Path -Parent $old) -Force|Out-Null
      Move-Item -LiteralPath $modules -Destination $old -ErrorAction Stop
      $moved+=@{Modules=$modules;Old=$old}
    }
  }
  $installStarted=$true
  Push-Location $root
  try{& $pnpm install --frozen-lockfile --prefer-offline --reporter=append-only;if($LASTEXITCODE){throw ('PNPM_INSTALL_FAILED '+$LASTEXITCODE)}}finally{Pop-Location}
  Assert-DependencyInputs
  if(!(Test-InstalledDependencies)){throw 'DEPENDENCY_INSTALLED_GRAPH_UNVERIFIED'}
  $success=$true;$safe=$true
}catch{
  $failure=$_.Exception.Message
  try{
    if($installStarted){
      foreach($rel in $roots){
        $dir=if($rel){Join-Path $root $rel}else{$root}
        $modules=Join-Path $dir 'node_modules'
        if(Test-Path -LiteralPath $modules){
          $failed=Join-Path (Join-Path $backup ('failed/'+$rel)) 'node_modules'
          New-Item -ItemType Directory -Path (Split-Path -Parent $failed) -Force|Out-Null
          Move-Item -LiteralPath $modules -Destination $failed -ErrorAction Stop
        }
      }
    }
    foreach($entry in $moved){
      if(Test-Path -LiteralPath $entry.Modules){throw 'DEPENDENCY_ROLLBACK_TARGET_OCCUPIED'}
      Move-Item -LiteralPath $entry.Old -Destination $entry.Modules -ErrorAction Stop
      if(!(Test-Path -LiteralPath $entry.Modules -PathType Container)){throw 'DEPENDENCY_ROLLBACK_MISSING'}
    }
    $restoredHash=if(Test-Path -LiteralPath $oldLockPath){(Get-FileHash -LiteralPath $oldLockPath).Hash}else{''}
    if($restoredHash -cne $oldLockHash){throw 'DEPENDENCY_ROLLBACK_LOCK_CHANGED'}
    $safe=$true;Write-Output 'APP_DEPENDENCY_ROLLBACK_PASS'
  }catch{$failure+='; ROLLBACK '+$_.Exception.Message}
}
if($safe){
  try{
    foreach($plan in $plans){
      $s=$plan.Spec
      if((Get-ScheduledTask -TaskName $s.N).State -eq 'Running'){continue}
      if(@(Get-NetTCPConnection -State Listen -LocalPort $s.P -ErrorAction SilentlyContinue).Count){throw ('DEPENDENCY_RESTART_PORT_OCCUPIED '+$s.A)}
      Start-ScheduledTask -TaskName $s.N -ErrorAction Stop
    }
  }catch{$safe=$false;$failure+='; RESTART '+$_.Exception.Message}
}
# Prove restored app ownership after maintenance, not just a start request.
# Keep an installed candidate and rollback tree when a distinct app boot fails.
if($safe -and $success -and $plans.Count){
  $deadline=[DateTime]::UtcNow.AddSeconds(90)
  $pending=@($plans)
  do{
    $snapshot=@(Get-CimInstance Win32_Process)
    $pending=@(foreach($plan in $plans){
      $s=$plan.Spec
      try{
        if((Get-ScheduledTask -TaskName $s.N).State -ne 'Running'){throw 'TASK_NOT_RUNNING'}
        $tree=@(Get-OwnedAppProcessTree $s.A $snapshot $root $node)
        $listeners=@(Get-NetTCPConnection -State Listen -LocalPort $s.P -ErrorAction SilentlyContinue)
        if($listeners.Count -ne 1 -or $tree.ProcessId -notcontains $listeners[0].OwningProcess){throw 'LISTENER_NOT_OWNED'}
      }catch{$plan}
    })
    if(!$pending.Count){break}
    Start-Sleep -Milliseconds 500
  }while([DateTime]::UtcNow -lt $deadline)
  if($pending.Count){$safe=$false;$failure+='; APP_RESTART_UNVERIFIED '+(($pending|ForEach-Object {$_.Spec.A}) -join ',')}
  else{Write-Output 'APP_DEPENDENCY_RESTART_OWNERS_PASS'}
}
if(!$safe){Write-DependencyReceipt 'blocked' $backup;throw ('DEPENDENCY_RECOVERY_BLOCKED '+$failure)}
if(!$success){Write-DependencyReceipt 'failed' $backup;throw ('DEPENDENCY_INSTALL_ROLLED_BACK '+$failure)}
Write-DependencyReceipt 'pass' $backup
Write-Output 'APP_DEPENDENCY_RECONCILE_PASS'
'@
  $script=$script.Replace('__INPUTS__',$json.Replace("'","''")).Replace('__KEY__',$key).Replace('__APPLY__',$(if($Apply){'$true'}else{'$false'})).Replace('__AUTOMATIC__',$(if($Automatic){'$true'}else{'$false'}))
  if($Apply){
    # Share the Lenovo input-publication mutex with the existing source mirror.
    # Hold it through install, rollback, app recovery and the terminal receipt.
    $lockWrapper=@'
$dependencyInputLock=[Threading.Mutex]::new($false,'Global\BThwaniDependencyInputsV1')
$dependencyInputHeld=$false
try{
  try{$dependencyInputHeld=$dependencyInputLock.WaitOne(0)}catch [Threading.AbandonedMutexException]{$dependencyInputHeld=$true;throw 'DEPENDENCY_INPUT_RECOVERY_REQUIRED'}
  if(!$dependencyInputHeld){throw 'DEPENDENCY_INPUT_BUSY'}
  __DEPENDENCY_SCRIPT__
}finally{
  if($dependencyInputHeld){$dependencyInputLock.ReleaseMutex()}
  $dependencyInputLock.Dispose()
}
'@
    $script=$lockWrapper.Replace('__DEPENDENCY_SCRIPT__',$script)
  }
  Invoke-Lenovo $script
}
function Invoke-AppAction {
  if($DockerAction -eq 'help'){Show-AppsHelp;return}
  if($DockerAction -eq 'android'){Inspect-AppAndroid;return}
  if($DockerAction -eq 'open'){Open-AppSurfaces;Show-OperatorAuthReadiness;return}
  Check-Ssh
  switch($DockerAction.ToLowerInvariant()){
    'status' {Inspect-AppSourceSync;Inspect-AppOwners}
    'verify' {Assert-AppRuntime}
    'reconcile' {Invoke-AppDependencyReconcile}
    'logs' {Show-AppLogs}
    'start' {Control-SingleApp 'start'}
    'restart' {Control-SingleApp 'restart'}
    default {throw ('UNSUPPORTED_APP_ACTION '+$DockerAction)}
  }
}

function Assert-CompleteCompose {
  Assert-Compose
  $argsList=@('compose','--env-file',$baseEnv,'-f',$baseCompose,'--profile','implementation','--profile','identity-verifier','--profile','wlt-reader','config','--format','json')
  # Keep the resolved configuration private and report only a bounded failure.
  $raw=@(& docker --context $dockerContext @argsList 2>$null)
  Assert-Ok ($LASTEXITCODE -eq 0) 'native owner Compose configuration could not be resolved'
  try { $model=($raw -join [Environment]::NewLine) | ConvertFrom-Json -ErrorAction Stop }
  catch { throw 'native owner Compose model is invalid' }
  foreach($check in @(@('dsh','REF_POSTGRES_USER'),@('dsh','REF_POSTGRES_PASSWORD'),@('dsh','REF_POSTGRES_DB'),@('dsh','DSH_DB_SCHEMA'),@('dsh','DSH_PUBLIC_CORS_ORIGINS'),@('identity','IDENTITY_DB_SCHEMA'),@('identity','IDENTITY_TEST_DATABASE_URL'),@('wlt','WLT_TEST_DATABASE_URL'))){
    $owner=$check[0];$key=$check[1]
    Assert-Ok (![string]::IsNullOrWhiteSpace([string]$model.services.$owner.environment.$key)) ('unprovisioned owner Compose input '+$owner+'/'+$key)
  }
  Say 'COMPOSE_CONFIG' 'PASS complete owner and capability configuration; no SQL execution or secret output'
}
function Assert-OwnerRuntime {
  & node (Join-Path $repo 'tools\dev\docker\verify-runtime-provenance.mjs') '--context' $dockerContext '--include-wlt'
  Assert-Ok ($LASTEXITCODE -eq 0) 'Docker owner provenance incomplete; inspect pnpm dev docker status'
  Say 'DOCKER_PROVENANCE' 'PASS'
}
function Assert-AppRuntime {
  Inspect-AppSourceSync -StrictCheck
  Inspect-AppOwners -StrictCheck
  Verify-AppWeb
}
function Assert-EnvironmentReady {
  # Read-only checks; continue independent diagnostics after a failure.
  # No build, provisioning, capability activation, or session mutation.
  $failures=@()
  foreach($check in @('Assert-CompleteCompose','Assert-OwnerRuntime','Assert-AppRuntime')){
    try { & $check }
    catch {
      $failures+=@($check)
      Say 'READINESS_BLOCKED' ($check+' '+$_.Exception.Message)
    }
  }
  Assert-Ok ($failures.Count -eq 0) ('environment incomplete: '+($failures -join ', '))
  Say 'ENVIRONMENT_READINESS' 'PASS Compose, committed owner provenance, app source/dependencies/ownership and HTTP; authenticated journeys and visual Fast Refresh remain separate'
}
function Show-Docker {
  Banner 'DOCKER CONTAINERS'
  Invoke-DockerCli -argsList @('ps','-a','--filter','label=com.docker.compose.project=bthwani-refoundation','--format','{{.Names}} | {{.Status}} | {{.Image}}') | ForEach-Object { Write-Output $_ }
  # WLT is optional, but may run under the same Compose project. Inspect
  # its actual labels rather than relying on an obsolete placement assumption.
  $wltIdentity=@(& docker --context $dockerContext inspect 'bthwani-refoundation-wlt-1' '--format' '{{index .Config.Labels "com.docker.compose.project"}}|{{index .Config.Labels "com.docker.compose.service"}}' 2>$null)
  $wltFound=$LASTEXITCODE -eq 0
  $verifyArgs=@('--context',$dockerContext)
  if($wltFound){
    Assert-Ok (($wltIdentity -join '').Trim() -eq ($project+'|wlt')) 'unexpected WLT container ownership'
    $verifyArgs+=@('--include-wlt')
  } else {
    Say 'WLT' 'NOT_RUN (optional WLT container not present)'
  }
  if (Test-Path -LiteralPath (Join-Path $repo 'tools\dev\docker\verify-runtime-provenance.mjs')) {
    $result = @(& node (Join-Path $repo 'tools\dev\docker\verify-runtime-provenance.mjs') @verifyArgs 2>&1)
    $code = $LASTEXITCODE
    foreach ($line in $result) { Write-Output $line.ToString() }
    Say 'PROVENANCE_EXIT' $code
    if ($code -ne 0) { Say 'NOTE' 'runtime provenance incomplete; inspect stale or stopped owner images before a scoped rebuild.' }
  }
}
function Show-DockerCommands {
  Write-Output 'DOCKER_COMMANDS=READ_ONLY except explicitly authorized reconcile -Apply (Surface -> Lenovo)'
  Write-Output 'pnpm dev docker help           # command reference, no Docker changes'
  Write-Output 'pnpm dev docker status         # project containers and provenance summary'
  Write-Output 'pnpm dev docker ps             # project containers'
  Write-Output 'pnpm dev docker logs dsh       # last 50 DSH log lines'
  Write-Output 'pnpm dev docker logs identity  # last 50 Identity log lines'
  Write-Output 'pnpm dev docker logs wlt       # last 50 WLT log lines'
  Write-Output 'pnpm dev docker images         # refoundation image tags'
  Write-Output 'pnpm dev docker volumes        # project-scoped volumes'
  Write-Output 'pnpm dev docker networks       # project-scoped networks'
  Write-Output 'pnpm dev docker config         # validate the complete admitted Compose configuration safely'
  Write-Output 'pnpm dev docker verify         # strict DSH + Identity + WLT live image provenance'
  Write-Output 'pnpm dev docker reconcile      # check existing runtime and owner source drift'
  Write-Output 'pnpm dev docker reconcile -Apply # reconcile only changed isolated owners'
  Write-Output 'pnpm dev docker reconcile -Apply -EnableCaptain # explicit owner admission activation'
  Write-Output 'pnpm dev docker reconcile -Apply -Preview # isolated uncommitted Go snapshot'
  Write-Output 'pnpm dev docker reconcile -Apply -PrepareDshDatabase # one-time additive DSH candidate; no cutover'
  Write-Output 'pnpm dev (fast apps) | pnpm dev up (infra) | pnpm dev status | pnpm dev down'
  Write-Output 'pnpm dev migrations            # migration inventory only; NO SQL execution'
  Write-Output 'BUILD=use tools/dev/docker/build-owner-image.ps1 -Owner dsh|identity|wlt explicitly'
  Write-Output 'UNSUPPORTED=prune, down -v, SQL migration execution, bootstrap, protected state operations'
}
function Invoke-ScopedDocker {
  if ($DockerAction -eq 'help') { Show-DockerCommands; return }
  Check-Ssh
  Check-DockerContext
  switch ($DockerAction.ToLowerInvariant()) {
    'status' { Show-Docker }
    'ps' {
      Invoke-DockerCli -argsList @('ps','-a','--filter',('label=com.docker.compose.project='+$project),'--format','{{.Names}} | {{.Status}} | {{.Image}}') | ForEach-Object { Write-Output $_ }
    }
    'logs' {
      $name = 'bthwani-refoundation-'+$DockerService+'-1'
      $record=@(& docker --context $dockerContext inspect $name '--format' '{{json .Config.Labels}}' 2>&1)
      Assert-Ok ($LASTEXITCODE -eq 0) ('container not found: '+$name)
      $labels = (($record | Select-Object -First 1).ToString() | ConvertFrom-Json)
      Assert-Ok ($labels.'com.docker.compose.project' -eq $project) ('container ownership mismatch: '+$name)
      Invoke-DockerCli -argsList @('logs','--tail','50',$name) | ForEach-Object { Write-Output $_ }
    }
    'images' {
      Invoke-DockerCli -argsList @('image','ls','--filter','reference=bthwani-refoundation-*','--format','{{.Repository}}:{{.Tag}} | {{.ID}}') | ForEach-Object { Write-Output $_ }
    }
    'volumes' {
      Invoke-DockerCli -argsList @('volume','ls','--filter',('label=com.docker.compose.project='+$project),'--format','{{.Name}}') | ForEach-Object { Write-Output $_ }
    }
    'networks' {
      Invoke-DockerCli -argsList @('network','ls','--filter',('label=com.docker.compose.project='+$project),'--format','{{.Name}}') | ForEach-Object { Write-Output $_ }
    }
    'config' { Assert-CompleteCompose }
    'reconcile' {
      Assert-Ok (!$EnableCaptain -or $Apply) 'Captain admission requires explicit -Apply'
      Assert-Ok (!$Preview -or ($Apply -and !$EnableCaptain)) 'Preview requires explicit -Apply without capability activation'
      Assert-Ok (!$ResumeIdentityDatabase -or $RelocateIdentityDatabase) 'Resume requires Identity relocation'
      Assert-Ok (!$RelocateIdentityDatabase -or ($Apply -and !$CutoverDshDatabase -and !$PrepareDshDatabase -and !$ResumeDshDatabase -and !$EnableCaptain -and !$Preview -and !$PrepareBaseline)) 'Identity relocation requires explicit isolated Apply'
      Assert-Ok (!$CutoverDshDatabase -or ($Apply -and !$PrepareDshDatabase -and !$ResumeDshDatabase -and !$EnableCaptain -and !$Preview -and !$PrepareBaseline -and $PreparedSourceSha -cmatch '^[0-9a-f]{40}$')) 'DSH cutover requires explicit Apply and exact prepared source SHA'
      Assert-Ok (!$ResumeDshDatabase -or $PrepareDshDatabase) 'Resume requires -PrepareDshDatabase'
      Assert-Ok (!$PrepareDshDatabase -or ($Apply -and !$EnableCaptain -and !$Preview -and !$PrepareBaseline)) 'Dedicated DSH database preparation requires explicit isolated -Apply without another operation'
      Assert-Ok (!$RecoverRuntimeAttempt -or (!$Apply -and !$Automatic -and !$EnableCaptain -and !$Preview -and !$PrepareBaseline -and !$PrepareDshDatabase -and !$ResumeDshDatabase -and !$CutoverDshDatabase -and !$RelocateIdentityDatabase -and !$ResumeIdentityDatabase -and $RecoverRuntimeAttempt -cmatch '^[0-9a-f]{64}$')) 'Runtime attempt recovery requires the exact reviewed key and no Apply'
      $mode = if ($RecoverRuntimeAttempt) { '--recover-attempt' } elseif ($RelocateIdentityDatabase -and $ResumeIdentityDatabase) { '--resume-identity-database' } elseif ($RelocateIdentityDatabase) { '--relocate-identity-database' } elseif ($CutoverDshDatabase) { '--cutover-dsh-database' } elseif ($PrepareDshDatabase -and $ResumeDshDatabase) { '--resume-dsh-database' } elseif ($PrepareDshDatabase) { '--prepare-dsh-database' } elseif ($EnableCaptain) { '--apply-captain' } elseif ($Preview) { '--apply-preview' } elseif ($Apply) { '--apply' } else { '--check' }
      Assert-Ok (!$PrepareBaseline -or ($Apply -and !$EnableCaptain)) 'Baseline preparation requires isolated -Apply, without capability activation'
      $reconcileOptions = @(if ($RecoverRuntimeAttempt) { $RecoverRuntimeAttempt } elseif ($CutoverDshDatabase) { $PreparedSourceSha } elseif ($PrepareBaseline) { '--prepare-baseline' })
      $prior = $env:BTHWANI_UNIFIED_DEV_RECONCILE
      try {
        if ($Apply -or $RecoverRuntimeAttempt) { $env:BTHWANI_UNIFIED_DEV_RECONCILE = '1' }
        if ($CutoverDshDatabase) {
          & node (Join-Path $repo 'tools\dev\docker\reconcile-owner-runtime.mjs') $mode $PreparedSourceSha
        } else {
          & node (Join-Path $repo 'tools\dev\docker\reconcile-owner-runtime.mjs') $mode @reconcileOptions
        }
        Assert-Ok ($LASTEXITCODE -eq 0) 'owner runtime reconciliation failed; inspect explicit result'
      } finally { $env:BTHWANI_UNIFIED_DEV_RECONCILE = $prior }
    }
    'verify' { Assert-OwnerRuntime }
  }
}
function Wait-AppStatus {
  foreach($target in Get-AppHttpTargets){
    $result=Test-AppHttpTarget -Target $target -TimeoutSec 7 -MaxAttempts 1
    $state=if($result.Success){'200'}else{'NOT_READY'}
    Say 'WEB' ($target.U+' status='+$state+' elapsedMs='+$result.ElapsedMs+' reason='+$result.Error)
  }
  Say 'ANDROID' 'NOT_RUN (requires on-device test)'
}
function Start-VerifiedEnvironment {
  # Only start existing admitted containers; fresh provisioning is separate.
  Assert-CompleteCompose
  & node (Join-Path $repo 'tools\dev\docker\verify-runtime-provenance.mjs') '--context' $dockerContext '--include-wlt' '--start-preflight'
  Assert-Ok ($LASTEXITCODE -eq 0) 'owner startup preflight failed; use the guarded owner lifecycle for stale or missing containers'
  $composeArgs=@('compose','--env-file',$baseEnv,'-f',$baseCompose,'--profile','implementation','--profile','identity-verifier','--profile','wlt-reader')
  $services=@('postgres','media','mailpit','payment-mock','identity','dsh','wlt')
  $existing=@(Invoke-DockerCli -argsList ($composeArgs+@('ps','--all','--services')))
  foreach($service in $services){
    Assert-Ok ($existing -contains $service) ('missing existing Compose service: '+$service)
  }
  Invoke-DockerCli -argsList ($composeArgs+@('start','--wait','--wait-timeout','60')+$services) | ForEach-Object { Write-Output $_ }
  Assert-OwnerRuntime
}
function Get-DockerStopPlan {
  # Read only. Fail closed on inventory/ownership errors or live protected peers.
  $order=@('dsh','payment-mock','mailpit','media','postgres')
  $protected=@('identity','wlt')
  $rows=@(Invoke-DockerCli -argsList @('ps','-a','--no-trunc','--filter',('label=com.docker.compose.project='+$project),'--format','{{.ID}}|{{.Names}}|{{.Label "com.docker.compose.service"}}|{{.State}}'))
  $byService=@{}
  foreach($row in $rows){
    $parts=$row.Split('|')
    Assert-Ok ($parts.Length -eq 4) 'unexpected Docker inventory record'
    $id,$name,$service,$state=$parts
    Assert-Ok ($id -cmatch '^[a-f0-9]{64}$' -and $name -ceq ($project+'-'+$service+'-1') -and ($service -cin ($order+$protected))) ('unexpected project container '+$name)
    Assert-Ok (!$byService.ContainsKey($service)) ('duplicate project service '+$service)
    Assert-Ok ($state -cin @('created','exited','running')) ('unresolved container state '+$name)
    if($service -cin $protected){
      Assert-Ok ($state -ne 'running') ($service+' currently runs against shared PostgreSQL; scoped lifecycle approval required before stopping the environment')
    }
    $byService[$service]=@{Id=$id;Name=$name;State=$state}
  }
  foreach($service in $order){
    if($byService.ContainsKey($service) -and $byService[$service].State -eq 'running'){ $byService[$service] }
  }
}
function Stop-Docker {
  # Revalidate after application shutdown. Stop exact owned IDs, never volumes.
  $plan=@(Get-DockerStopPlan)
  foreach($target in $plan){
    if($target.Name -ceq ($project+'-postgres-1')){
      $null=@(Get-DockerStopPlan)
    }
    Invoke-DockerCli -argsList @('stop','--time','20',$target.Id) | ForEach-Object { Write-Output $_ }
    $state=@(Invoke-DockerCli -argsList @('inspect',$target.Id,'--format','{{.State.Running}}'))
    Assert-Ok (($state -join '') -ceq 'false') ('container stop not proven '+$target.Name)
    Say 'DOCKER_STOP' $target.Name
  }
  Say 'DOCKER_VOLUMES' 'PRESERVED'
  Say 'IDENTITY_WLT' 'UNTOUCHED (requires separate acceptance)'
}
function Verify-Checks {
  Banner 'OWNERED STATIC CHECKS'
  $tests=@(
    'tests/infra/compose-policy.test.mjs',
    'tests/infra/verify-runtime-provenance.test.mjs',
    'tests/infra/reconcile-owner-runtime.test.mjs',
    'tests/infra/owner-preview-source.test.mjs',
    'tools/dev/sync-lenovo-source.test.mjs',
    'tools/dev/dev-powershell.test.mjs',
    'tools/dev/verify-nx-project-graph.test.mjs'
  )
  $testArgs=@('--test') + @($tests | ForEach-Object { Join-Path $repo $_ })
  & node @testArgs
  Assert-Ok ($LASTEXITCODE -eq 0) 'native Node policy tests failed'
  & pnpm 'exec' 'nx' 'show' 'projects'
  Assert-Ok ($LASTEXITCODE -eq 0) 'Nx graph command failed'
  if ($DeepSql) {
    $sqlProof = Join-Path $repo 'tests\infra\verify-isolated-postgres.ps1'
    Assert-Ok (Test-Path -LiteralPath $sqlProof -PathType Leaf) 'missing existing synthetic isolated PostgreSQL proof'
    & $sqlProof -DockerContext $dockerContext
    Assert-Ok ($LASTEXITCODE -eq 0) 'disposable SQL migration and privilege/restore proof failed'
    Say 'SQL_PROOF' 'PASS disposable isolated DSH, Identity and WLT; not shared protected database'
  } else { Say 'SQL_PROOF' 'NOT_RUN (optional: pnpm dev verify -DeepSql)' }
  Say 'STATIC_VERIFY' 'PASS static/policy only; authenticated journeys and finance remain separate gates'
}

$originalLauncherPath=$env:Path
try {
  Assert-Ok (!$RecoverRuntimeAttempt -or ($Action -eq 'Docker' -and $DockerAction -eq 'reconcile')) 'Runtime attempt recovery belongs to docker reconcile only'
  $readOnlyOperation = $Action -in @('Status','Verify','Migrations') -or
    ($Action -eq 'Apps' -and $DockerAction -in @('help','status','verify','logs','android')) -or
    ($Action -eq 'Apps' -and $DockerAction -eq 'reconcile' -and !$Apply) -or
    ($Action -eq 'Docker' -and $DockerAction -in @('help','status','ps','logs','images','volumes','networks','config','verify'))
  if (-not $readOnlyOperation) {
    try { $hasMutex = $mutex.WaitOne(0) }
    catch [Threading.AbandonedMutexException] { $hasMutex = $true }
    Assert-Ok $hasMutex 'another unified dev operation is in progress'
  }
  New-Item -ItemType Directory -Path $logRoot -Force | Out-Null
  $logFile = Join-Path $logRoot ('dev-'+(Get-Date -Format 'yyyyMMdd-HHmmss-fff')+'-'+$PID+'.log')
  Start-Transcript -Path $logFile -ErrorAction Stop | Out-Null
  $transcript = $true
  Say 'ACTION' $Action
  Check-LocalIdentity
  # Docker and its Node children must use the same SSH client as the launcher.
  # Keep the change in this process and restore the caller's PATH on exit.
  $env:Path=(Split-Path -Parent $ssh)+';'+$env:Path
  switch ($Action.ToLowerInvariant()) {
    'docker' { Invoke-ScopedDocker; break }
    'apps' { Invoke-AppAction; break }
    'launch' {
      Check-Ssh
      Start-LocalTasks
      Start-LenovoTasks
      Open-AppSurfaces
      Show-OperatorAuthReadiness
      Say 'SURFACES_LAUNCH' 'PASS (existing tasks and screens opened where available)'
      Check-DockerContext
      Assert-EnvironmentReady
      break
    }
    'status' {
      Check-Ssh
      Show-LocalTasks
      Show-LenovoTasks
      Check-DockerContext
      Show-Docker
      Wait-AppStatus
      break
    }
    {$_ -in @('up','warm')} {
      Check-Ssh
      Check-DockerContext
      Start-VerifiedEnvironment
      Start-LocalTasks
      Start-LenovoTasks
      try { Open-AppSurfaces } catch { Say 'SURFACES' ('BLOCKED '+$_.Exception.Message) }
      Show-OperatorAuthReadiness
      Assert-EnvironmentReady
      break
    }
    'down' {
      Check-Ssh
      Check-DockerContext
      $null=@(Get-DockerStopPlan)
      Stop-LenovoTasks
      Stop-LocalTasks
      Stop-Docker
      Say 'DOWN' 'DONE; no volume deletion, no Image/Identity/WLT mutation'
      break
    }
    'verify' {
      Check-Ssh
      Check-DockerContext
      Verify-Checks
      Assert-EnvironmentReady
      break
    }
    'migrations' {
      Say 'MIGRATIONS' 'NOT_EXECUTED; owner approval and database role/schema/version verification required'
      Say 'DSH_SQL' 'fresh: services/dsh/database/schema; historical experimental upgrades: Git only'
      Say 'IDENTITY_SQL' 'fresh: services/identity/database/schema; historical experimental upgrades: Git only'
      Say 'WLT_SQL' 'fresh: services/wlt/database/schema; test-only: services/wlt/database/sandbox; historical experiments: Git history (read/review only)'
      break
    }
  }
  Say 'LOG_FILE' $logFile
} catch {
  Write-Error ('UNIFIED_DEV_FAILED action='+$Action+' detail='+$_.Exception.Message) -ErrorAction Continue
  exit 1
} finally {
  $env:Path=$originalLauncherPath
  if($transcript) { Stop-Transcript | Out-Null }
  if($hasMutex) { $mutex.ReleaseMutex() }
  $mutex.Dispose()
}
