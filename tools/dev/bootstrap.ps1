#Requires -Version 7.4
[CmdletBinding()]
param()

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"
$repo = (Resolve-Path (Join-Path $PSScriptRoot "..\..")).Path
& (Join-Path $PSScriptRoot "ensure-local-env.ps1")

Push-Location $repo
try {
    if (-not (Test-Path "pnpm-lock.yaml")) { throw "pnpm-lock.yaml is missing; generate and commit it before normal bootstrap." }
    pnpm install --frozen-lockfile
    if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
    go work sync
    if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
    Write-Host "Bootstrap PASS"
}
finally { Pop-Location }
