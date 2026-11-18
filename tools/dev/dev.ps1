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
  [ValidateSet('Install','Up','Warm','Status','Down','Verify','Migrations')]
  [string]$Action = 'Up',
  [switch]$Apply,
  [switch]$DeepSql
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
$lenovoTasks = @(
  @{Name='BThwani Client Metro Native'; App='customer'; Port=28111},
  @{Name='BThwani Partner Metro Native'; App='merchant'; Port=28112},
  @{Name='BThwani Captain Metro Native'; App='captain'; Port=28113},
  @{Name='BThwani Control Next Native'; App='control-panel'; Port=23010}
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
  $rows = @(& $ssh '-T' '-o' 'BatchMode=yes' '-o' 'StrictHostKeyChecking=yes' '-o' 'ConnectTimeout=8' 'bthwani-docker' 'powershell.exe' '-NoLogo' '-NoProfile' '-NonInteractive' '-EncodedCommand' $encoded 2>&1)
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
  Write-Output ('LENOVO_APP name='+$s.N+' task='+$task.State+' port='+$s.P+' listen='+$port)
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
  Write-Output ('LENOVO_APP_START_REQUESTED '+$s.N)
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
    Write-Output ('LENOVO_APP_STOP_REQUESTED '+$s.N)
  }
}
'@
  Invoke-Lenovo $stop
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
