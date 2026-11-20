#Requires -Version 5.1
param(
  [Parameter(Mandatory=$true)]
  [ValidateSet('customer','merchant','captain','control-panel')]
  [string]$App,
  [switch]$Surface,
  [ValidateRange(1024,65535)]
  [int]$IdentityPort=23201,
  [ValidateRange(1024,65535)]
  [int]$DshPort=23202
)
$ErrorActionPreference='Stop'
Set-StrictMode -Version Latest

function Assert-SurfaceCapability([string]$Uri, [int]$ExpectedStatus) {
  try {
    $status=[int](Invoke-WebRequest -Uri $Uri -UseBasicParsing -TimeoutSec 3 -MaximumRedirection 0).StatusCode
  } catch {
    $httpResponse=$_.Exception.PSObject.Properties['Response']
    if (!$httpResponse -or !$httpResponse.Value) { throw }
    $status=[int]$httpResponse.Value.StatusCode
  }
  if ($status -ne $ExpectedStatus) {
    throw ('SURFACE_PREVIEW_CAPABILITY_NOT_READY uri=' + $Uri + ' status=' + $status)
  }
}

$ports = @{ customer=28111; merchant=28112; captain=28113; 'control-panel'=23010 }
if ($Surface) {
  $source=(Resolve-Path -LiteralPath (Join-Path $PSScriptRoot '..')).Path
  $node=(Get-Command node.exe -CommandType Application -ErrorAction Stop | Select-Object -First 1).Source
  $nodeDir=Split-Path -Parent $node
  $logs=Join-Path $source '.tmp\surface-preview-logs'
  $ports = @{ customer=23101; merchant=23102; captain=23103; 'control-panel'=23100 }
} else {
  $runner='C:\Users\bthwa\BThwaniAppRunner'
  $source=Join-Path $runner 'source-runtime'
  $nodeDir=Join-Path $runner 'tools\node-v24.22.1-refoundation'
  $node=Join-Path $nodeDir 'node.exe'
  $logs=Join-Path $runner 'logs'
}
if(!(Test-Path -LiteralPath $node) -or !(Test-Path -LiteralPath (Join-Path $source 'pnpm-lock.yaml'))){
  throw 'REFOUNDATION_RUNTIME_SOURCE_OR_TOOLCHAIN_MISSING'
}
if ((& $node --version) -ne ('v' + (Get-Content -LiteralPath (Join-Path $source '.node-version') -Raw).Trim())) {
  throw 'REFOUNDATION_NODE_PIN_MISMATCH'
}
$port=$ports[$App]
if (Get-NetTCPConnection -State Listen -LocalPort $port -ErrorAction SilentlyContinue |
    Select-Object -First 1) {
  throw ('REFOUNDATION_APP_PORT_IN_USE app=' + $App + ' port=' + $port)
}
if ($Surface) {
  if ($IdentityPort -eq $DshPort -or $ports.Values -contains $IdentityPort -or $ports.Values -contains $DshPort) {
    throw 'SURFACE_PREVIEW_PORT_COLLISION'
  }
  foreach ($ownerPort in @($IdentityPort,$DshPort)) {
    $listener=Get-NetTCPConnection -State Listen -LocalPort $ownerPort -LocalAddress '127.0.0.1' -ErrorAction SilentlyContinue |
      Select-Object -First 1
    if (!$listener -or (Get-Process -Id $listener.OwningProcess).ProcessName -match '^(ssh|plink)$') {
      throw ('SURFACE_PREVIEW_OWNER_NOT_LOCAL port=' + $ownerPort)
    }
    $health=Invoke-RestMethod -Uri ("http://127.0.0.1:$ownerPort/health") -TimeoutSec 3 -MaximumRedirection 0
    if ($health.status -ne 'ok') { throw ('SURFACE_PREVIEW_OWNER_NOT_READY port=' + $ownerPort) }
  }
  $identity="http://127.0.0.1:$IdentityPort"
  $dsh="http://127.0.0.1:$DshPort"
  if ($App -eq 'control-panel') {
    Assert-SurfaceCapability "$identity/v1/operators/passkey/authentication/options" 405
  } else {
    Assert-SurfaceCapability "$identity/v1/customer-auth/phone-challenges" 405
  }
  if ($App -eq 'captain') { Assert-SurfaceCapability "$dsh/v1/captains/me/standing" 401 }
  if ($App -eq 'merchant') { Assert-SurfaceCapability "$dsh/v1/stores/mine" 401 }
  $env:BTHWANI_SURFACE_PREVIEW='1'
  $env:EXPO_PUBLIC_BTHWANI_SURFACE_PREVIEW='1'
  switch ($App) {
    'customer' {
      $env:CUSTOMER_SYNTHETIC_IDENTITY_ORIGIN=$identity
      $env:EXPO_PUBLIC_CUSTOMER_SYNTHETIC_IDENTITY_ORIGIN=$identity
      $env:EXPO_PUBLIC_DSH_API_URL=$dsh
    }
    'merchant' {
      $env:MERCHANT_SYNTHETIC_IDENTITY_ORIGIN=$identity
      $env:MERCHANT_SYNTHETIC_DSH_ORIGIN=$dsh
      $env:EXPO_PUBLIC_MERCHANT_SYNTHETIC_IDENTITY_ORIGIN=$identity
      $env:EXPO_PUBLIC_MERCHANT_SYNTHETIC_DSH_ORIGIN=$dsh
    }
    'captain' {
      $env:EXPO_PUBLIC_CAPTAIN_SYNTHETIC_IDENTITY_ORIGIN=$identity
      $env:EXPO_PUBLIC_CAPTAIN_SYNTHETIC_DSH_ORIGIN=$dsh
    }
    'control-panel' {
      $env:BTHWANI_ISOLATED_TEST_MODE='true'
      $env:OPERATOR_ENABLE_ISOLATED_PASSKEY_BFF='true'
      $env:OPERATOR_PASSKEY_BROWSER_ORIGIN="http://localhost:$port"
      $env:OPERATOR_PASSKEY_IDENTITY_ORIGIN=$identity
      $env:OPERATOR_POLICY_DSH_ORIGIN=$dsh
    }
  }
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
switch($App){
  'customer' {
    $cli=Join-Path $dir 'node_modules\expo\bin\cli'
    $args=@('start','--web','--dev-client','--localhost','--port',"$port")
  }
  'merchant' {
    $cli=Join-Path $dir 'node_modules\expo\bin\cli'
    $args=@('start','--web','--dev-client','--localhost','--port',"$port")
  }
  'captain' {
    $cli=Join-Path $dir 'node_modules\expo\bin\cli'
    $args=@('start','--dev-client','--localhost','--port',"$port")
  }
  'control-panel' {
    $cli=Join-Path $dir 'node_modules\next\dist\bin\next'
    $bind=if ($Surface) {'localhost'} else {'127.0.0.1'}
    $args=@('dev','-H',$bind,'-p',"$port")
  }
}
if ($Surface -and $App -ne 'control-panel') { $args+=@('--max-workers','2') }
if(!(Test-Path -LiteralPath $cli)){throw ('REFOUNDATION_APP_CLI_MISSING '+$cli)}
"START refoundation app=$App source=$source port=$port surface=$Surface" | Out-File -FilePath $log -Append -Encoding utf8
# PowerShell 5.1 wraps native stderr warnings as NativeCommandError when
# ErrorActionPreference=Stop. Keep stderr logged, but judge failure by exit code.
$ErrorActionPreference='Continue'
& $node $cli @args 1>> $log 2>> $err
$nativeExit=$LASTEXITCODE
if($nativeExit -ne 0){
  "EXIT app=$App code=$nativeExit" | Out-File -FilePath $err -Append -Encoding utf8
}
exit $nativeExit
