#Requires -Version 5.1
param(
  [Parameter(Mandatory=$true)]
  [ValidateSet('customer','merchant','captain','control-panel')]
  [string]$App
)
$ErrorActionPreference='Stop'
Set-StrictMode -Version Latest

$runner='C:\Users\bthwa\BThwaniAppRunner'
$source=Join-Path $runner 'refoundation-runtime-3b2f744'
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
$env:BTHWANI_SECRETS_ROOT='C:\BTHWANI-Secrets\samrim-refoundation-clean-20261112'
$dir=Join-Path $source ('apps\'+$App)
Set-Location -LiteralPath $dir
$log=Join-Path $logs ('refoundation-'+$App+'.out.log')
$err=Join-Path $logs ('refoundation-'+$App+'.err.log')
"START refoundation app=$App source=$source node=24.22.1" | Out-File -FilePath $log -Append -Encoding utf8

switch($App){
  'customer' {
    $cli=Join-Path $dir 'node_modules\expo\bin\cli'
    $args=@('start','--web','--dev-client','--localhost','--port','28111','--clear')
  }
  'merchant' {
    $cli=Join-Path $dir 'node_modules\expo\bin\cli'
    $args=@('start','--web','--dev-client','--localhost','--port','28112','--clear')
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
# PowerShell 5.1 wraps native stderr warnings as NativeCommandError when
# ErrorActionPreference=Stop. Keep stderr logged, but judge failure by exit code.
$ErrorActionPreference='Continue'
& $node $cli @args 1>> $log 2>> $err
$nativeExit=$LASTEXITCODE
if($nativeExit -ne 0){
  "EXIT app=$App code=$nativeExit" | Out-File -FilePath $err -Append -Encoding utf8
}
exit $nativeExit
