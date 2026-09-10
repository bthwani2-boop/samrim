#Requires -Version 7.4
[CmdletBinding()]
param(
    [string]$ExpectedBranch = ""
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$repo = (Resolve-Path (Join-Path $PSScriptRoot "..\..")).Path
$proofCore = Join-Path $PSScriptRoot "close-integration-runtime.ps1"
$dailyRuntime = Join-Path $PSScriptRoot "local-runtime.ps1"

foreach ($required in @($proofCore, $dailyRuntime)) {
    if (-not (Test-Path -LiteralPath $required -PathType Leaf)) {
        throw "Integration proof prerequisite is missing: $required"
    }
}

$proofExitCode = 0
$cleanupExitCode = 0

Push-Location $repo
try {
    $arguments = @(
        "-NoProfile",
        "-NonInteractive",
        "-ExecutionPolicy", "Bypass",
        "-File", $proofCore
    )
    if (-not [string]::IsNullOrWhiteSpace($ExpectedBranch)) {
        $arguments += @("-ExpectedBranch", $ExpectedBranch)
    }

    & pwsh @arguments
    $proofExitCode = $LASTEXITCODE
}
finally {
    Write-Host ""
    Write-Host "=== Enforce zero integration-runtime residue ==="
    & pwsh -NoProfile -NonInteractive -ExecutionPolicy Bypass -File $dailyRuntime -Action Down
    $cleanupExitCode = $LASTEXITCODE
    Pop-Location
}

if ($cleanupExitCode -ne 0) {
    throw "INTEGRATION_RUNTIME_CLEANUP=FAIL exit=$cleanupExitCode"
}
if ($proofExitCode -ne 0) {
    Write-Error "INTEGRATION_RUNTIME_PROOF=FAIL exit=$proofExitCode residue=0"
    exit $proofExitCode
}

Write-Host "INTEGRATION_RUNTIME_PROOF=PASS residue=0"
