#Requires -Version 5.1
<#
Canonical one-way Surface -> Lenovo development source synchronization.
The existing Scheduled Task ('BThwani Lenovo Source Sync') runs node.exe directly
so Task Scheduler owns the process and can stop it without an orphan.
Use this script for manual -ValidateOnly or -Once checks, not a second watcher.
#>
[CmdletBinding()]
param(
  [switch]$Once,
  [switch]$ValidateOnly
)
$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
if ($env:COMPUTERNAME.ToUpperInvariant() -ne 'BTHWANI') {
  throw 'SOURCE_SYNC_WRONG_COMPUTER'
}
$root = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot '..\..')).Path
if ($root.ToLowerInvariant() -ne 'd:\samrim') { throw 'SOURCE_SYNC_NONCANONICAL_REPO' }
$pin = (Get-Content -LiteralPath (Join-Path $root '.node-version') -Raw).Trim()
$node = 'C:\Program Files\nodejs\node.exe'
if (-not (Test-Path -LiteralPath $node -PathType Leaf)) { throw 'SOURCE_SYNC_NODE_NOT_FOUND' }
$actual = (& $node --version).Trim().TrimStart('v')
if ($actual -ne $pin) { throw ('SOURCE_SYNC_NODE_VERSION_MISMATCH required=' + $pin + ' actual=' + $actual) }
$script = Join-Path $PSScriptRoot 'sync-lenovo-source.mjs'
if (-not (Test-Path -LiteralPath $script -PathType Leaf)) { throw 'SOURCE_SYNC_SCRIPT_NOT_FOUND' }
if ($ValidateOnly) {
  & $node --check $script
  if ($LASTEXITCODE -ne 0) { throw 'SOURCE_SYNC_JAVASCRIPT_PARSE_FAILED' }
  Write-Output ('SOURCE_SYNC_CONFIG_PASS root=' + $root + ' node=' + $actual)
  return
}
if ($Once) { & $node $script --once } else { & $node $script --watch }
exit $LASTEXITCODE
