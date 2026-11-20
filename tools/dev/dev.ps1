#Requires -Version 7.0
<#
BThwani canonical development orchestration, Surface only.
Download and run: .\BThwani-Install-Unified-Dev.ps1 Install -Apply
This same file is installed as D:\samrim\tools\dev\dev.ps1 and called by pnpm dev.
Never runs SQL migrations, operator bootstrap, Identity activation, WLT, image builds,
Docker volume deletion, branch changes, Git commits/pushes, or credential modifications.
#>
[CmdletBinding()]
param(
  [Parameter(Position=0)]
  [ValidateSet('Install','Up','Warm','Status','Down','Verify','Migrations','Docker','Apps')]
  [string]$Action = 'Up',
  [switch]$Apply,
  [switch]$DeepSql,
  [Parameter(Position=1)]
  [ValidateSet('help','status','ps','logs','images','volumes','networks','config','verify','start','restart','android')]
  [string]$DockerAction = 'help',
  [Parameter(Position=2)]
  [ValidateSet('dsh','identity','postgres','media','mailpit','payment-mock')]
  [string]$DockerService = 'dsh',
  [ValidateSet('customer','merchant','captain','control-panel')]
  [string]$App = ''
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
$appCompose = Join-Path $repo 'infra\compose.apps.yaml'
$ownerTasks = @(
  @{Name='BThwani Lenovo Source Sync'; Pattern='sync-lenovo-source\.mjs'},
  @{Name='BThwani Customer Lenovo SSH Tunnel'; Pattern='Start-AppTunnel\.ps1'},
  @{Name='BThwani Merchant Lenovo SSH Tunnel'; Pattern='Start-AppTunnel\.ps1'},
  @{Name='BThwani Captain Lenovo SSH Tunnel'; Pattern='Start-AppTunnel\.ps1'},
  @{Name='BThwani Control Lenovo SSH Tunnel'; Pattern='Start-AppTunnel\.ps1'}
)
$localPorts = @(18101,18102,18103,13000)
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
function Check-LocalIdentity {
  Assert-Ok ($env:COMPUTERNAME -ieq $expectedSurface) ('must run on Surface '+$expectedSurface)
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
      $port = switch -Regex ($spec.Name) {
        'Customer' {18101;break}; 'Merchant' {18102;break}; 'Captain' {18103;break}; 'Control' {13000;break}
      }
      $busy = @(Get-NetTCPConnection -State Listen -LocalPort $port -ErrorAction SilentlyContinue).Count -gt 0
      Assert-Ok (-not $busy) ("port $port occupied while task stopped; inspect owner")
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
$remoteTasksScript = @'
$specs=@(
 @{N='BThwani Client Metro Native';A='customer';P=28111},
 @{N='BThwani Partner Metro Native';A='merchant';P=28112},
 @{N='BThwani Captain Metro Native';A='captain';P=28113},
 @{N='BThwani Control Next Native';A='control-panel';P=23010}
)
foreach($s in $specs){
  $task=Get-ScheduledTask -TaskName $s.N -ErrorAction Stop
  $actions=($task.Actions | ForEach-Object { [string]$_.Execute+' '+[string]$_.Arguments }) -join ' '
  if($actions -notmatch 'Start-RefoundationApp\.ps1' -or $actions -notmatch [regex]::Escape($s.A)) {throw ('TASK_OWNER_CHANGED '+$s.N)}
  $port=@(Get-NetTCPConnection -State Listen -LocalPort $s.P -ErrorAction SilentlyContinue).Count -gt 0
  Write-Output ('LENOVO_APP app='+$s.A+' task='+$task.State+' port='+$s.P+' listen='+$port)
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
  $stop = $remoteTasksScript + @'
foreach($s in $specs){
  $task=Get-ScheduledTask -TaskName $s.N -ErrorAction Stop
  if([string]$task.State -eq 'Running') {
    Stop-ScheduledTask -TaskName $s.N -ErrorAction Stop
    Write-Output ('LENOVO_APP_STOP_REQUESTED '+$s.A)
  }
}
'@
  Invoke-Lenovo $stop
}

function Show-AppsHelp {
  Write-Output 'APPS=canonical customer / merchant / captain / control-panel; no duplicate launchers'
  Write-Output 'pnpm dev apps status                   # read-only task, listener, process owner and mirror check'
  Write-Output 'pnpm dev apps verify                   # above plus Web and Metro HTTP, not visual Fast Refresh'
  Write-Output 'pnpm dev apps android                  # inspect ADB device and reverse mappings, no changes'
  Write-Output 'pnpm dev apps logs -App customer       # last 20 log lines, redacted'
  Write-Output 'pnpm dev apps start -App merchant      # preflight/dry run only'
  Write-Output 'pnpm dev apps start -App merchant -Apply # start only stopped and port-free task'
  Write-Output 'pnpm dev apps restart -App captain     # preflight/dry run only'
  Write-Output 'pnpm dev apps restart -App captain -Apply # only if unhealthy, scoped, fail-closed'
  Write-Output 'APPS_GUARDS=never force-stop unknown PID, healthy app, Docker, SSH tunnels, cache or source watcher'
}
function Inspect-AppOwners([switch]$StrictCheck) {
  $lock=(Get-FileHash -LiteralPath (Join-Path $repo 'pnpm-lock.yaml') -Algorithm SHA256).Hash
  $mode=if($StrictCheck){'$true'}else{'$false'}
  $script=@'
$specs=@(
 @{A='customer';N='BThwani Client Metro Native';P=28111;Cli='expo'}
 @{A='merchant';N='BThwani Partner Metro Native';P=28112;Cli='expo'}
 @{A='captain';N='BThwani Captain Metro Native';P=28113;Cli='expo'}
 @{A='control-panel';N='BThwani Control Next Native';P=23010;Cli='next'}
)
$root='C:\Users\bthwa\BThwaniAppRunner\source-runtime'
$node='C:\Users\bthwa\BThwaniAppRunner\tools\node-v24.22.1-refoundation\node.exe'
$strict=__STRICT__
$expectedLock='__LOCK__'
if(!(Test-Path -LiteralPath $root -PathType Container)){throw 'APP_MIRROR_MISSING'}
$version=(Get-Content -LiteralPath (Join-Path $root '.node-version') -Raw).Trim()
$actualNode=if(Test-Path -LiteralPath $node -PathType Leaf){(& $node --version).Trim().TrimStart('v')}else{'MISSING'}
$lock=(Get-FileHash -LiteralPath (Join-Path $root 'pnpm-lock.yaml') -Algorithm SHA256).Hash
Write-Output ('APP_MIRROR nodePin='+$version+' nodeActual='+$actualNode+' lockMatch='+($lock -eq $expectedLock))
if($strict -and ($version -ne '24.22.1' -or $actualNode -ne $version -or $lock -ne $expectedLock)){throw 'APP_MIRROR_TOOLCHAIN_OR_LOCK_MISMATCH'}
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
  if($actions.Count -ne 1 -or $action -notmatch 'Start-RefoundationApp\.ps1' -or
    $action -notmatch ('(?i)-App\s+'+[regex]::Escape($s.A)+'(?:\s|$)')){throw ('TASK_OWNER_CHANGED '+$s.A)}
  $listeners=@(Get-NetTCPConnection -State Listen -LocalPort $s.P -ErrorAction SilentlyContinue)
  $pidValue=if($listeners.Count -eq 1){[int]$listeners[0].OwningProcess}else{0}
  $owner=if($pidValue){Get-CimInstance Win32_Process -Filter ('ProcessId='+$pidValue)}else{$null}
  $owned=$false
  if($owner -and $owner.Name -eq 'node.exe' -and $owner.CommandLine -match $s.Cli){
    $cursor=$owner
    for($i=0;$i -lt 6 -and $cursor;$i++){
      if($cursor.Name -in @('powershell.exe','pwsh.exe') -and $cursor.CommandLine -match 'Start-RefoundationApp\.ps1' -and
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
function Verify-AppWeb {
  $targets=@(
    @{A='customer';U='http://127.0.0.1:18101/'},
    @{A='customer';U='http://127.0.0.1:18101/stores'},
    @{A='merchant';U='http://127.0.0.1:18102/'},
    @{A='captain-metro';U='http://127.0.0.1:18103/status'},
    @{A='control-panel';U='http://127.0.0.1:13000/'}
  )
  $failures=0
  foreach($target in $targets){
    try {
      $result=Invoke-WebRequest -UseBasicParsing -Uri $target.U -TimeoutSec 8 -ErrorAction Stop
      if($result.StatusCode -ne 200){throw ('HTTP_'+$result.StatusCode)}
      Say 'APP_HTTP' ($target.A+' PASS status=200')
    } catch {
      $failures++
      Say 'APP_HTTP' ($target.A+' FAIL path='+$target.U)
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
  foreach($port in @(18101,18102,18103)){
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
foreach($kind in @('out','err')){
  $path=Join-Path $base ('refoundation-'+$app+'.'+$kind+'.log')
  if(!(Test-Path -LiteralPath $path -PathType Leaf)){Write-Output ('APP_LOG_MISSING '+$app+' '+$kind);continue}
  Write-Output ('APP_LOG app='+$app+' stream='+$kind)
  Get-Content -LiteralPath $path -Tail 20 -ErrorAction Stop | ForEach-Object {
    $line=$_.ToString()
    $line=$line -replace '(?i)(Bearer\s+)[A-Za-z0-9._~-]+','$1[REDACTED]'
    $line=$line -replace '(?i)(password|secret|token|api[_-]?key)\s*[=:]\s*[^,;\s]+','$1=[REDACTED]'
    if($line.Length -gt 300){$line=$line.Substring(0,300)}
    Write-Output $line
  }
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
$specs=@{
 'customer'=@{N='BThwani Client Metro Native';P=28111;Cli='expo'}
 'merchant'=@{N='BThwani Partner Metro Native';P=28112;Cli='expo'}
 'captain'=@{N='BThwani Captain Metro Native';P=28113;Cli='expo'}
 'control-panel'=@{N='BThwani Control Next Native';P=23010;Cli='next'}
}
$s=$specs[$app]
if(!$s){throw 'APP_NOT_ALLOWED'}
$t=Get-ScheduledTask -TaskName $s.N -ErrorAction Stop
$actions=@($t.Actions)
$action=($actions | ForEach-Object {[string]$_.Execute+' '+[string]$_.Arguments}) -join ' '
if($actions.Count -ne 1 -or $action -notmatch 'Start-RefoundationApp\.ps1' -or
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
    if($cursor.Name -in @('powershell.exe','pwsh.exe') -and $cursor.CommandLine -match 'Start-RefoundationApp\.ps1' -and
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
    try{
      $uri='http://127.0.0.1:'+$s.P+$route
      $resp=Invoke-WebRequest -Uri $uri -UseBasicParsing -TimeoutSec 4 -ErrorAction Stop
      if($resp.StatusCode -eq 200){Write-Output ('APP_RESTART_SKIPPED_HEALTHY '+$app);return}
    }catch{}
  }
  if($t.State -eq 'Running'){
    Stop-ScheduledTask -TaskName $s.N -ErrorAction Stop
    Write-Output ('APP_STOP_TASK_REQUESTED '+$app)
    for($i=0;$i -lt 10;$i++){Start-Sleep -Milliseconds 500;if((Get-ScheduledTask -TaskName $s.N).State -ne 'Running'){break}}
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
  Invoke-Lenovo $body
}
function Invoke-AppAction {
  if($DockerAction -eq 'help'){Show-AppsHelp;return}
  if($DockerAction -eq 'android'){Inspect-AppAndroid;return}
  Check-Ssh
  switch($DockerAction.ToLowerInvariant()){
    'status' {Inspect-AppOwners}
    'verify' {Inspect-AppOwners -StrictCheck;Verify-AppWeb}
    'logs' {Show-AppLogs}
    'start' {Control-SingleApp 'start'}
    'restart' {Control-SingleApp 'restart'}
    default {throw ('UNSUPPORTED_APP_ACTION '+$DockerAction)}
  }
}

function Show-Docker {
  Banner 'DOCKER CONTAINERS'
  Invoke-DockerCli -argsList @('ps','-a','--filter','label=com.docker.compose.project=bthwani-refoundation','--format','{{.Names}} | {{.Status}} | {{.Image}}') | ForEach-Object { Write-Output $_ }
  if (Test-Path -LiteralPath (Join-Path $repo 'infra\verify-runtime-provenance.mjs')) {
    $result = @(& node (Join-Path $repo 'infra\verify-runtime-provenance.mjs') '--context' $dockerContext 2>&1)
    $code = $LASTEXITCODE
    foreach ($line in $result) { Write-Output $line.ToString() }
    Say 'PROVENANCE_EXIT' $code
    if ($code -ne 0) { Say 'NOTE' 'runtime provenance incomplete; Identity may be intentionally stopped. Never re-label a stopped container as PASS.' }
  }
  Say 'WLT' 'NOT_IMPLEMENTED (no runnable new backend)'
}
function Show-DockerCommands {
  Write-Output 'DOCKER_COMMANDS=READ_ONLY (Surface -> bthwani-docker SSH context)'
  Write-Output 'pnpm dev docker help           # command reference, no Docker changes'
  Write-Output 'pnpm dev docker status         # project containers and provenance summary'
  Write-Output 'pnpm dev docker ps             # project containers'
  Write-Output 'pnpm dev docker logs dsh       # last 50 DSH log lines'
  Write-Output 'pnpm dev docker logs identity  # last 50 Identity log lines'
  Write-Output 'pnpm dev docker images         # refoundation image tags'
  Write-Output 'pnpm dev docker volumes        # project-scoped volumes'
  Write-Output 'pnpm dev docker networks       # project-scoped networks'
  Write-Output 'pnpm dev docker config         # validate base and DSH Compose safely'
  Write-Output 'pnpm dev docker verify         # strict DSH + Identity live image provenance'
  Write-Output 'pnpm dev | pnpm dev warm | pnpm dev status | pnpm dev down'
  Write-Output 'pnpm dev migrations            # migration inventory only; NO SQL execution'
  Write-Output 'BUILD=use infra/build-dsh-image.ps1 or infra/build-identity-verifier-image.ps1 explicitly'
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
    'config' {
      Assert-Compose
      $null=Invoke-DockerCli -argsList @('compose','--env-file',$baseEnv,'-f',$baseCompose,'-f',$appCompose,'--profile','implementation','config','--quiet')
      Say 'COMPOSE_CONFIG' 'PASS base and DSH overlay; no SQL execution or secret output'
    }
    'verify' {
      & node (Join-Path $repo 'infra\verify-runtime-provenance.mjs') '--context' $dockerContext
      Assert-Ok ($LASTEXITCODE -eq 0) 'Docker owner provenance incomplete; inspect pnpm dev docker status'
      Say 'DOCKER_PROVENANCE' 'PASS'
    }
  }
}
function Wait-AppStatus {
  foreach ($url in @('http://127.0.0.1:18101/','http://127.0.0.1:18101/stores','http://127.0.0.1:18102/','http://127.0.0.1:13000/')) {
    try {
      $r = Invoke-WebRequest -Uri $url -UseBasicParsing -TimeoutSec 7 -ErrorAction Stop
      Say 'WEB' ($url+' status='+$r.StatusCode)
    } catch { Say 'WEB' ($url+' status=NOT_READY') }
  }
  Say 'ANDROID' 'NOT_RUN (requires on-device test)'
}
function Start-Base {
  # No image pulls, migrations, reprovisioning, cleanup, or re-creation.
  $argsList = @('compose','--env-file',$baseEnv,'-f',$baseCompose,'up','-d','--no-recreate','--no-build','--pull','never','postgres','media','mailpit','payment-mock')
  Invoke-DockerCli $argsList | ForEach-Object { Write-Output $_ }
}
function Start-DSHIfVerified {
  # DSH can be restarted from its existing exact image only when image source is unchanged.
  $name = 'bthwani-refoundation-dsh-1'
  $inspect = @(& docker --context $dockerContext inspect $name '--format' '{{.Config.Image}}|{{.State.Running}}' 2>&1)
  if ($LASTEXITCODE -ne 0) { Say 'DSH' 'BLOCKED missing container; do not create without owner review'; return }
  $parts = ($inspect | Select-Object -First 1).ToString().Trim().Split('|')
  if ($parts.Length -ne 2 -or $parts[0] -notmatch '^bthwani-refoundation-dsh:[a-z0-9._-]+$') {
    Say 'DSH' 'BLOCKED unexpected image identity'; return
  }
  $image = ($parts[0])
  $imageJson = @(& docker --context $dockerContext image inspect $image '--format' '{{json .Config.Labels}}' 2>&1)
  if ($LASTEXITCODE -ne 0) { Say 'DSH' 'BLOCKED image missing'; return }
  $labels = ($imageJson -join '') | ConvertFrom-Json
  $rev = [string]$labels.'com.bthwani.source-sha'
  $head = (Git -argsList @('rev-parse','HEAD') | Select-Object -First 1).Trim()
  if($rev -notmatch '^[0-9a-f]{40}$') { Say 'DSH' 'BLOCKED missing valid image source revision'; return }
  $changedOwner = @(Git -argsList @('diff','--name-only',$rev,$head,'--','services/dsh'))
  $localChanges = @(Git -argsList @('status','--porcelain','--','services/dsh'))
  $ancestorCode = @(& $git -C $repo 'merge-base' '--is-ancestor' $rev $head 2>&1)
  if ($rev -notmatch '^[0-9a-f]{40}$' -or $LASTEXITCODE -ne 0 -or $changedOwner.Count -gt 0 -or $localChanges.Count -gt 0) {
    Say 'DSH' 'BLOCKED stale or dirty owner image; use official build and independent tests before controlled rollout'; return
  }
  if ($parts[1] -eq 'true') { Say 'DSH' 'ALREADY_RUNNING (check provenance and health in status)'; return }
  Invoke-DockerCli -argsList @('start',$name) | ForEach-Object { Write-Output $_ }
  Say 'DSH' 'START_EXISTING_IMAGE requested'
}
function Stop-Docker {
  # Stop only known isolated containers. No `compose down`, no `-v`, no prune.
  $identity = @(& docker --context $dockerContext inspect 'bthwani-refoundation-identity-1' '--format' '{{.State.Running}}' 2>&1)
  if($LASTEXITCODE -eq 0 -and @($identity | Where-Object { $_.ToString().Trim() -eq 'true' }).Count -gt 0){
    throw 'BLOCKED: Identity currently runs against this PostgreSQL; do not stop shared state without scoped Identity lifecycle approval'
  }
  foreach($name in @('bthwani-refoundation-dsh-1','bthwani-refoundation-postgres-1','bthwani-refoundation-media-1','bthwani-refoundation-mailpit-1','bthwani-refoundation-payment-mock-1')) {
    $state = @(& docker --context $dockerContext inspect $name '--format' '{{json .}}' 2>&1)
    if ($LASTEXITCODE -ne 0) { continue }
    $record = (($state | Select-Object -First 1).ToString() | ConvertFrom-Json)
    Assert-Ok ($record.Config.Labels.'com.docker.compose.project' -eq $project) ('unexpected container owner '+$name)
    if($record.State.Running -eq $true) {
      Invoke-DockerCli -argsList @('stop','--time','20',$name) | ForEach-Object { Write-Output $_ }
      Say 'DOCKER_STOP' $name
    }
  }
  Say 'DOCKER_VOLUMES' 'PRESERVED'
  Say 'IDENTITY' 'UNTOUCHED (requires separate acceptance)'
}
function Verify-Checks {
  Banner 'OWNERED STATIC CHECKS'
  $tests=@(
    'infra/compose-policy.test.mjs',
    'infra/verify-runtime-provenance.test.mjs',
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
    $sqlProof = Join-Path $repo 'infra\verify-isolated-postgres.ps1'
    Assert-Ok (Test-Path -LiteralPath $sqlProof -PathType Leaf) 'missing existing synthetic isolated PostgreSQL proof'
    & $sqlProof -DockerContext $dockerContext
    Assert-Ok ($LASTEXITCODE -eq 0) 'disposable SQL migration and privilege/restore proof failed'
    Say 'SQL_PROOF' 'PASS disposable isolated DSH only; not shared protected database'
  } else { Say 'SQL_PROOF' 'NOT_RUN (optional: pnpm dev verify -DeepSql)' }
  Say 'VERIFY' 'PASS static/policy only; live Identity, Android and finance remain separate gates'
}
function Install-CLI {
  $source = (Resolve-Path -LiteralPath $PSCommandPath).Path
  $target = Join-Path $repo 'tools\dev\dev.ps1'
  $package = Join-Path $repo 'package.json'
  $expected = 'pwsh -NoProfile -File tools/dev/dev.ps1'
  # Other worktree changes do not block installation; guard owned targets only.
  $packageHashBefore = (Get-FileHash -Algorithm SHA256 -LiteralPath $package).Hash
  $packageBefore = [IO.File]::ReadAllText($package)
  $json = $packageBefore | ConvertFrom-Json
  $oldDev = $json.scripts.PSObject.Properties['dev']
  if ($oldDev) { Assert-Ok ($oldDev.Value -eq $expected) 'existing pnpm dev owner differs; refusing overwrite' }
  $exists = Test-Path -LiteralPath $target -PathType Leaf
  if ($exists) {
    $a = (Get-FileHash -Algorithm SHA256 -LiteralPath $source).Hash
    $b = (Get-FileHash -Algorithm SHA256 -LiteralPath $target).Hash
    Assert-Ok ($a -eq $b) 'existing tools/dev/dev.ps1 differs; refusing overwrite'
  }
  if ($exists -and $oldDev) { Say 'INSTALL' 'ALREADY_INSTALLED'; return }

  if (-not $oldDev) {
    $matcher = [regex]::new('(?m)^\s*"scripts"\s*:\s*\{')
    Assert-Ok ($matcher.IsMatch($packageBefore)) 'package.json script insertion point missing'
    $packageAfter = $matcher.Replace($packageBefore,{param($m) $m.Value + "`r`n    `"dev`": `"$expected`","},1)
    $newJson = $packageAfter | ConvertFrom-Json
    Assert-Ok ($newJson.scripts.dev -eq $expected) 'generated package.json invalid'
  } else { $packageAfter = $packageBefore }
  $tokens=$null;$errors=$null
  $null=[System.Management.Automation.Language.Parser]::ParseFile($source,[ref]$tokens,[ref]$errors)
  Assert-Ok ($errors.Count -eq 0) ('PowerShell parse failed: '+($errors -join ' | '))
  Banner 'INSTALL PLAN'
  Say 'SOURCE' $source
  Say 'TARGET' $target
  Say 'PACKAGE_CHANGE' (-not [bool]$oldDev)
  Say 'RUNNER_COPY' (-not $exists)
  if(-not $Apply) { Say 'INSTALL' 'DRY_RUN (use Install -Apply)'; return }
  # Check only owned targets immediately before writing; preserve unrelated modifications.
  Assert-Ok ((Get-FileHash -Algorithm SHA256 -LiteralPath $package).Hash -eq $packageHashBefore) 'package.json changed during installation; protect concurrent writer'
  Assert-Ok ((Test-Path -LiteralPath $target -PathType Leaf) -eq $exists) 'tools/dev/dev.ps1 appeared/disappeared during installation'
  if ($exists) {
    Assert-Ok ((Get-FileHash -Algorithm SHA256 -LiteralPath $target).Hash -eq (Get-FileHash -Algorithm SHA256 -LiteralPath $source).Hash) 'tools/dev/dev.ps1 changed during installation'
  }
  $backup = Join-Path $logRoot ('package-backup-'+(Get-Date -Format 'yyyyMMdd-HHmmss'))
  New-Item -ItemType Directory -Force -Path $backup | Out-Null
  Copy-Item -LiteralPath $package -Destination (Join-Path $backup 'package.json')
  try {
    if(-not $exists) { Copy-Item -LiteralPath $source -Destination $target }
    if(-not $oldDev) {
      $temp = Join-Path $repo 'package.json.bthwani-atomic.tmp'
      [IO.File]::WriteAllText($temp,$packageAfter,[Text.UTF8Encoding]::new($false))
      Move-Item -LiteralPath $temp -Destination $package -Force
    }
    $actual = (Get-Content -LiteralPath $package -Raw | ConvertFrom-Json).scripts.dev
    Assert-Ok ($actual -eq $expected) 'package readback mismatch'
    Assert-Ok ((Get-FileHash -LiteralPath $target).Hash -eq (Get-FileHash -LiteralPath $source).Hash) 'runner readback mismatch'
    Say 'INSTALL' 'PASS verified file hashes and package.json; local changes are not committed or pushed'
    Say 'NEXT' 'pnpm dev status | pnpm dev | pnpm dev warm | pnpm dev verify | pnpm dev down'
  } catch {
    Copy-Item -LiteralPath (Join-Path $backup 'package.json') -Destination $package -Force
    if(-not $exists -and (Test-Path -LiteralPath $target)){Remove-Item -LiteralPath $target -Force}
    throw
  }
}

try {
  try { $hasMutex = $mutex.WaitOne(0) }
  catch [Threading.AbandonedMutexException] { $hasMutex = $true }
  Assert-Ok $hasMutex 'another unified dev operation is in progress'
  New-Item -ItemType Directory -Path $logRoot -Force | Out-Null
  $logFile = Join-Path $logRoot ('dev-'+(Get-Date -Format 'yyyyMMdd-HHmmss')+'.log')
  Start-Transcript -Path $logFile -ErrorAction Stop | Out-Null
  $transcript = $true
  Say 'ACTION' $Action
  Check-LocalIdentity
  switch ($Action.ToLowerInvariant()) {
    'install' { Install-CLI; break }
    'docker' { Invoke-ScopedDocker; break }
    'apps' { Invoke-AppAction; break }
    'status' {
      Check-Ssh
      Show-LocalTasks
      Show-LenovoTasks
      Check-DockerContext
      Show-Docker
      Wait-AppStatus
      break
    }
    'up' {
      Check-Ssh
      Check-DockerContext
      Assert-Compose
      Start-LocalTasks
      Start-Base
      Start-DSHIfVerified
      Start-LenovoTasks
      Banner 'POST-START STATUS'
      Show-LocalTasks
      Show-LenovoTasks
      Show-Docker
      Wait-AppStatus
      Say 'IDENTITY' 'NOT_AUTOSTARTED (owner-backed runtime security/SQL acceptance required)'
      break
    }
    'warm' {
      Check-Ssh
      Check-DockerContext
      Assert-Compose
      Start-LocalTasks
      Start-Base
      Start-DSHIfVerified
      Start-LenovoTasks
      Banner 'POST-WARM STATUS'
      Show-Docker
      Wait-AppStatus
      Say 'WARM' 'DONE without builds, migrations, and container recreation'
      break
    }
    'down' {
      Check-Ssh
      Check-DockerContext
      Stop-LenovoTasks
      Stop-LocalTasks
      Stop-Docker
      Say 'DOWN' 'DONE; no volume deletion, no Image/Identity/WLT mutation'
      break
    }
    'verify' {
      Check-Ssh
      Check-DockerContext
      Assert-Compose
      Verify-Checks
      Show-Docker
      break
    }
    'migrations' {
      Say 'MIGRATIONS' 'NOT_EXECUTED; owner approval and database role/schema/version verification required'
      Say 'DSH_SQL' 'services/dsh/database/migrations (read/review only)'
      Say 'IDENTITY_SQL' 'services/identity/database/migrations (read/review only)'
      Say 'WLT_SQL' 'NOT_IMPLEMENTED'
      break
    }
  }
  Say 'LOG_FILE' $logFile
} catch {
  Write-Error ('UNIFIED_DEV_FAILED action='+$Action+' detail='+$_.Exception.Message) -ErrorAction Continue
  exit 1
} finally {
  if($transcript) { Stop-Transcript | Out-Null }
  if($hasMutex) { $mutex.ReleaseMutex() }
  $mutex.Dispose()
}
