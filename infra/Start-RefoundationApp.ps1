#Requires -Version 5.1
param(
  [Parameter(Mandatory=$true)]
  [ValidateSet('customer','merchant','captain','control-panel')]
  [string]$App
)
$ErrorActionPreference='Stop'
Set-StrictMode -Version Latest

$runner='C:\Users\bthwa\BThwaniAppRunner'
$source=Join-Path $runner 'source-runtime'
$nodeDir=Join-Path $runner 'tools\node-v24.22.1-refoundation'
$node=Join-Path $nodeDir 'node.exe'
$logs=Join-Path $runner 'logs'
if(!(Test-Path -LiteralPath $node) -or !(Test-Path -LiteralPath (Join-Path $source 'pnpm-lock.yaml'))){
  throw 'REFOUNDATION_RUNTIME_SOURCE_OR_TOOLCHAIN_MISSING'
}
if(((Get-Content -LiteralPath (Join-Path $source '.node-version') -Raw).Trim()) -ne '24.22.1'){
  throw 'REFOUNDATION_NODE_PIN_MISMATCH'
}
New-Item -ItemType Directory -Path $logs -Force | Out-Null
$env:PATH="$nodeDir;$env:PATH"
$env:NODE_OPTIONS='--dns-result-order=ipv4first'
$env:EXPO_NO_TELEMETRY='1'
# Preserve Metro's incremental cache across routine starts. Use an explicitly
# requested one-off cache reset only when diagnosing a verified stale bundle.
# Secrets root must be passed explicitly by the authorized launcher/environment.
# Do not implicitly select the deleted worktree or donor keys.
$dir=Join-Path $source ('apps\'+$App)
Set-Location -LiteralPath $dir
$log=Join-Path $logs ('refoundation-'+$App+'.out.log')
$err=Join-Path $logs ('refoundation-'+$App+'.err.log')
"START refoundation app=$App source=$source node=24.22.1" | Out-File -FilePath $log -Append -Encoding utf8

switch($App){
  'customer' {
    $cli=Join-Path $dir 'node_modules\expo\bin\cli'
    $args=@('start','--web','--dev-client','--localhost','--port','28111')
  }
  'merchant' {
    if (-not $env:MERCHANT_SYNTHETIC_IDENTITY_ORIGIN) {
      $identityOrigin = 'http://127.0.0.1:3201'
      $curl = Join-Path $env:WINDIR 'System32\curl.exe'
      if (Test-Path -LiteralPath $curl -PathType Leaf) {
        # The optional phone endpoint allows POST only when synthetic admission is enabled.
        $status = & $curl --silent --noproxy '127.0.0.1' --max-time 2 --output NUL --write-out '%{http_code}' `
          "$identityOrigin/v1/customer-auth/phone-challenges"
        if ($LASTEXITCODE -eq 0 -and $status -eq '405') {
          $env:MERCHANT_SYNTHETIC_IDENTITY_ORIGIN = $identityOrigin
        }
      }
    }
    $cli=Join-Path $dir 'node_modules\expo\bin\cli'
    $args=@('start','--web','--dev-client','--localhost','--port','28112')
  }
  'captain' {
    $cli=Join-Path $dir 'node_modules\expo\bin\cli'
    $args=@('start','--dev-client','--localhost','--port','28113')
  }
  'control-panel' {
    $cli=Join-Path $dir 'node_modules\next\dist\bin\next'
    $args=@('dev','-H','127.0.0.1','-p','23010')
  }
}
if(!(Test-Path -LiteralPath $cli)){throw ('REFOUNDATION_APP_CLI_MISSING '+$cli)}
# Task Scheduler can stop the PowerShell launcher while leaving its Expo
# child alive. Reclaim ONLY a verified orphan from this exact application;
# never kill an unrelated listener or another active launcher.
if ($App -in @('customer','merchant')) {
  $port = if ($App -eq 'customer') { 28111 } else { 28112 }
  $listenerPids = @(Get-NetTCPConnection -State Listen -LocalPort $port -ErrorAction SilentlyContinue |
    Select-Object -ExpandProperty OwningProcess -Unique)
  foreach ($listenerPid in $listenerPids) {
    $old = Get-CimInstance Win32_Process -Filter ('ProcessId=' + $listenerPid)
    if (-not $old -or $old.Name -ne 'node.exe' -or
        $old.ExecutablePath -ine $node -or
        -not $old.CommandLine -or
        -not $old.CommandLine.Contains($cli)) {
      throw ('REFOUNDATION_PORT_OWNED_BY_OTHER_PROCESS app=' + $App + ' port=' + $port)
    }
    $parent = Get-CimInstance Win32_Process -Filter ('ProcessId=' + $old.ParentProcessId)
    if ($parent) {
      throw ('REFOUNDATION_APP_ALREADY_RUNNING app=' + $App + ' port=' + $port)
    }
    Stop-Process -Id $old.ProcessId -Force -ErrorAction Stop
    "RECLAIMED_ORPHAN app=$App pid=$($old.ProcessId) port=$port" |
      Out-File -FilePath $err -Append -Encoding utf8
  }
}
# PowerShell 5.1 wraps native stderr warnings as NativeCommandError when
# ErrorActionPreference=Stop. Keep stderr logged, but judge failure by exit code.
$ErrorActionPreference='Continue'
& $node $cli @args 1>> $log 2>> $err
$nativeExit=$LASTEXITCODE
if($nativeExit -ne 0){
  "EXIT app=$App code=$nativeExit" | Out-File -FilePath $err -Append -Encoding utf8
}
exit $nativeExit
