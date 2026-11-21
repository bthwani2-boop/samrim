#Requires -Version 5.1
param(
  [Parameter(Mandatory=$true)]
  [ValidateSet('customer','merchant','captain','control-panel')]
  [string]$App,
  [switch]$Surface,
  [ValidateRange(1024,65535)]
  [int]$IdentityPort=23201,
  [ValidateRange(1024,65535)]
  [int]$DshPort=23202,
  [switch]$EnableAndroidWalletPreview,
  [ValidateRange(1024,65535)]
  [int]$WltPort=23203,
  [switch]$EnableDockerWalletWebPreview,
  [switch]$EnableIsolatedOperatorPasskeyPreview,
  [switch]$EnableIsolatedRootBootstrap
)
$ErrorActionPreference='Stop'
Set-StrictMode -Version Latest
if ($EnableAndroidWalletPreview -and (!$Surface -or $App -ne 'customer')) {
  throw 'NATIVE_WALLET_PREVIEW_REQUIRES_SURFACE_CUSTOMER'
}
if ($EnableDockerWalletWebPreview -and ($Surface -or $App -ne 'customer' -or $EnableAndroidWalletPreview)) {
  throw 'DOCKER_WALLET_WEB_PREVIEW_REQUIRES_LENOVO_CUSTOMER_ONLY'
}

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
  if ($EnableDockerWalletWebPreview) {
    if ((hostname).ToUpperInvariant() -ne 'BTHWANI-DOCKER') {
      throw 'DOCKER_WALLET_WEB_PREVIEW_REQUIRES_VERIFIED_LENOVO_HOST'
    }
    foreach ($owner in @(
      @{ Name='bthwani-refoundation-identity-1'; Capability='identity-synthetic-session-verifier' },
      @{ Name='bthwani-refoundation-wlt-1'; Capability='customer-wallet-read-only' }
    )) {
      $proof=(& docker inspect $owner.Name --format '{{index .Config.Labels "com.bthwani.capability"}}|{{index .Config.Labels "com.bthwani.environment"}}|{{.State.Health.Status}}').Trim()
      if ($LASTEXITCODE -ne 0 -or $proof -cne ($owner.Capability + '|refoundation|healthy')) {
        throw 'DOCKER_WALLET_WEB_PREVIEW_OWNER_NOT_VERIFIED'
      }
    }
    Assert-SurfaceCapability 'http://127.0.0.1:3201/v1/customer-auth/phone-challenges' 405
    Assert-SurfaceCapability 'http://127.0.0.1:3203/v1/wallets/me' 401
    $env:BTHWANI_SURFACE_PREVIEW='0'
    $env:BTHWANI_ISOLATED_TEST_MODE='true'
    $env:BTHWANI_DOCKER_WALLET_WEB_PREVIEW='1'
    $env:CUSTOMER_SYNTHETIC_IDENTITY_ORIGIN='http://127.0.0.1:3201'
    $env:CUSTOMER_SYNTHETIC_WLT_ORIGIN='http://127.0.0.1:3203'
    $env:EXPO_PUBLIC_BTHWANI_SURFACE_PREVIEW='0'
    Remove-Item Env:EXPO_PUBLIC_CUSTOMER_SYNTHETIC_WLT_ORIGIN -ErrorAction SilentlyContinue
  }
}
if ($EnableIsolatedRootBootstrap -and !$EnableIsolatedOperatorPasskeyPreview) {
  throw 'OPERATOR_ROOT_BOOTSTRAP_REQUIRES_EXPLICIT_PASSKEY_PREVIEW'
}
# Only a deliberately opted-in, isolated Operator development process may
# issue a localhost-bound WebAuthn request through the existing SSH tunnel.
# Merely starting this application never creates or recovers an Operator.
if ($EnableIsolatedOperatorPasskeyPreview) {
  if ($Surface -or $App -ne 'control-panel' -or (hostname).ToUpperInvariant() -ne 'BTHWANI-DOCKER') {
    throw 'OPERATOR_PASSKEY_PREVIEW_REQUIRES_VERIFIED_LENOVO_OPERATOR'
  }
  $identityRuntime = @(& docker inspect bthwani-refoundation-identity-1 | ConvertFrom-Json)
  if ($LASTEXITCODE -ne 0 -or $identityRuntime.Count -ne 1) {
    throw 'OPERATOR_PASSKEY_IDENTITY_RUNTIME_UNAVAILABLE'
  }
  $identityOwner = $identityRuntime[0]
  if ($identityOwner.Config.Labels.'com.bthwani.environment' -cne 'refoundation' -or
      $identityOwner.Config.Labels.'com.bthwani.capability' -cne 'identity-synthetic-session-verifier' -or
      $identityOwner.State.Health.Status -cne 'healthy') {
    throw 'OPERATOR_PASSKEY_IDENTITY_OWNER_NOT_ISOLATED'
  }
  $ownerEnv = @($identityOwner.Config.Env)
  foreach ($required in @(
    'BTHWANI_ISOLATED_TEST_MODE=true',
    'BTHWANI_ISOLATED_CONTAINER_MODE=true',
    'IDENTITY_ENABLE_ISOLATED_OPERATOR_PASSKEY_AUTH=true',
    'IDENTITY_OPERATOR_PASSKEY_RPID=localhost',
    'IDENTITY_OPERATOR_PASSKEY_ORIGINS=http://localhost:13000'
  )) {
    if ($ownerEnv -cnotcontains $required) {
      throw 'OPERATOR_PASSKEY_IDENTITY_OWNER_NOT_OPTED_IN'
    }
  }
  $schemas = @($ownerEnv | Where-Object { $_ -like 'IDENTITY_DB_SCHEMA=*' })
  if ($schemas.Count -ne 1 -or
      ($schemas[0] -split '=',2)[1] -cnotmatch '^identity_test_[a-z0-9_]+$') {
    throw 'OPERATOR_PASSKEY_IDENTITY_SCHEMA_NOT_ISOLATED'
  }
  $bindings = @($identityOwner.HostConfig.PortBindings.'3302/tcp')
  if ($bindings.Count -ne 1 -or $bindings[0].HostIp -cne '127.0.0.1' -or
      $bindings[0].HostPort -cne '3201') {
    throw 'OPERATOR_PASSKEY_IDENTITY_PORT_NOT_LOOPBACK'
  }
  Assert-SurfaceCapability 'http://127.0.0.1:3201/v1/operators/passkey/authentication/options' 405
  Assert-SurfaceCapability 'http://127.0.0.1:3201/v1/operators/passkey/authentication' 405
  Assert-SurfaceCapability 'http://127.0.0.1:3201/v1/sessions/current' 401
  $env:BTHWANI_ISOLATED_TEST_MODE='true'
  $env:OPERATOR_ENABLE_ISOLATED_PASSKEY_BFF='true'
  $env:OPERATOR_PASSKEY_BROWSER_ORIGIN='http://localhost:13000'
  $env:OPERATOR_PASSKEY_IDENTITY_ORIGIN='http://127.0.0.1:3201'
  $env:OPERATOR_POLICY_DSH_ORIGIN='http://127.0.0.1:3202'
  if ($EnableIsolatedRootBootstrap) {
    if ($ownerEnv -cnotcontains 'IDENTITY_ENABLE_ISOLATED_OPERATOR_BOOTSTRAP=true') {
      throw 'OPERATOR_ROOT_BOOTSTRAP_OWNER_NOT_OPTED_IN'
    }
    Assert-SurfaceCapability 'http://127.0.0.1:3201/v1/operators/passkey/bootstrap/options' 405
    Assert-SurfaceCapability 'http://127.0.0.1:3201/v1/operators/passkey/bootstrap' 405
    $env:OPERATOR_ENABLE_ISOLATED_ROOT_BOOTSTRAP_BFF='true'
  }
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
  if ($EnableAndroidWalletPreview) {
    if ($WltPort -eq $IdentityPort -or $WltPort -eq $DshPort -or
        $ports.Values -contains $WltPort) { throw 'SURFACE_PREVIEW_WLT_PORT_COLLISION' }
    $wltListener=Get-NetTCPConnection -State Listen -LocalPort $WltPort -LocalAddress '127.0.0.1' -ErrorAction SilentlyContinue |
      Select-Object -First 1
    if (!$wltListener -or (Get-Process -Id $wltListener.OwningProcess).ProcessName -match '^(ssh|plink)$') {
      throw 'SURFACE_PREVIEW_WLT_OWNER_NOT_LOCAL'
    }
    Assert-SurfaceCapability "http://127.0.0.1:$WltPort/v1/wallets/me" 401
  }
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
      if ($EnableAndroidWalletPreview) {
        # 10.0.2.2 maps from Android emulator back to Surface loopback.
        # The Web BFF retains 127.0.0.1 and an unrelated HttpOnly cookie.
        $env:EXPO_PUBLIC_CUSTOMER_SYNTHETIC_IDENTITY_ORIGIN="http://10.0.2.2:$IdentityPort"
        $env:EXPO_PUBLIC_CUSTOMER_SYNTHETIC_WLT_ORIGIN="http://10.0.2.2:$WltPort"
        $env:CUSTOMER_SYNTHETIC_WLT_ORIGIN="http://127.0.0.1:$WltPort"
      }
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
# Expo Web/Metro exhausted Node's default ~4 GiB V8 heap on Lenovo (exit 134).
# The ceiling is per process and does not reserve memory. Restrict the larger
# heap to the two Web Metro owners on a verified >=24 GiB development host;
# never alter Surface previews, Captain Metro or the Next.js Operator process.
if (!$Surface -and $App -in @('customer','merchant')) {
  if ((hostname).ToUpperInvariant() -ne 'BTHWANI-DOCKER') {
    throw 'WEB_METRO_HEAP_REQUIRES_VERIFIED_LENOVO'
  }
  $memory=Get-CimInstance -ClassName Win32_OperatingSystem -ErrorAction Stop
  if (!$memory -or [double]$memory.TotalVisibleMemorySize -lt (24 * 1MB)) {
    throw 'WEB_METRO_HEAP_REQUIRES_24_GIB_RAM'
  }
  $env:NODE_OPTIONS += ' --max-old-space-size=6144'
}
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
