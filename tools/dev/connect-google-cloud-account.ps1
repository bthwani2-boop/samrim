[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'
$gcloud = Get-Command 'gcloud' -ErrorAction SilentlyContinue

if (-not $gcloud) {
    throw 'gcloud was not found on PATH. Install Google Cloud CLI, open a new PowerShell window, and run this script again.'
}

Write-Host 'Starting Google Cloud CLI sign-in and project selection.'
Write-Host 'Complete the browser sign-in, grant access, and choose the BThwani Google Cloud project.'

& $gcloud.Source init
if ($LASTEXITCODE -ne 0) {
    throw "gcloud init failed with exit code $LASTEXITCODE."
}

Write-Host ''
Write-Host 'Active local gcloud account and project:'
& $gcloud.Source config list '--format=text(core.account,core.project)'
if ($LASTEXITCODE -ne 0) {
    throw "Could not read the active gcloud configuration (exit code $LASTEXITCODE)."
}
