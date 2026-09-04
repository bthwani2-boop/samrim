#Requires -Version 7.4
[CmdletBinding()]
param(
    [switch] $SkipBranchCheck
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"
$repo = (Resolve-Path (Join-Path $PSScriptRoot "..\..")).Path
$failures = [System.Collections.Generic.List[string]]::new()

function Check([string]$Name, [scriptblock]$Probe, [scriptblock]$Accept) {
    try {
        $value = & $Probe
        if (& $Accept $value) { Write-Host "[PASS] $Name : $value" -ForegroundColor Green }
        else { Write-Host "[FAIL] $Name : $value" -ForegroundColor Red; $failures.Add($Name) }
    } catch { Write-Host "[FAIL] $Name : $($_.Exception.Message)" -ForegroundColor Red; $failures.Add($Name) }
}

Push-Location $repo
try {
    if (-not $SkipBranchCheck) {
        Check "branch" { git branch --show-current } { param($v) $v.Trim() -eq "a" }
    }
    Check "node" { node --version } { param($v) ($v.Trim() -replace '^v','') -eq "24.17.0" }
    Check "pnpm" { pnpm --version } { param($v) $v.Trim() -eq "10.34.0" }
    Check "go" { go version } { param($v) $v -match 'go1\.27\.1\b' }
    Check "docker" { docker info --format '{{.ServerVersion}}' } { param($v) -not [string]::IsNullOrWhiteSpace($v) }
    foreach ($file in @("package.json","pnpm-workspace.yaml","nx.json","tsconfig.base.json","go.work")) {
        Check $file { Test-Path $file } { param($v) $v -eq $true }
    }
    if (Test-Path "node_modules") {
        Check "TypeScript" { pnpm exec tsc --version } { param($v) $v -match '6\.0\.2' }
        Check "Nx" { pnpm exec nx --version } { param($v) $v -match '23\.2\.0' }
    }
    if ($failures.Count -gt 0) { exit 1 }
    Write-Host "Doctor PASS" -ForegroundColor Green
}
finally { Pop-Location }
