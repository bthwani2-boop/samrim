#Requires -Version 7.4
[CmdletBinding()]
param(
    [Parameter(Mandatory)]
    [ValidateNotNullOrEmpty()]
    [string]$Component
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$integrationProject = "samrim-integration"

if (-not (Get-Command docker -ErrorAction SilentlyContinue)) {
    throw "Docker CLI is required to prove DAILY_DEV ownership before starting $Component."
}

& docker version *> $null
if ($LASTEXITCODE -ne 0) {
    throw "Docker daemon is required to prove DAILY_DEV ownership before starting $Component."
}

$containers = @(
    & docker ps -a `
        --filter "label=com.docker.compose.project=$integrationProject" `
        --format '{{.ID}}' |
        ForEach-Object { $_.Trim() } |
        Where-Object { $_ }
)
if ($LASTEXITCODE -ne 0) {
    throw "Unable to inspect Integration containers before starting $Component."
}

$volumes = @(
    & docker volume ls `
        --filter "label=com.docker.compose.project=$integrationProject" `
        --format '{{.Name}}' |
        ForEach-Object { $_.Trim() } |
        Where-Object { $_ }
)
if ($LASTEXITCODE -ne 0) {
    throw "Unable to inspect Integration volumes before starting $Component."
}

if ($containers.Count -gt 0 -or $volumes.Count -gt 0) {
    throw "RUNTIME_OWNERSHIP_CONFLICT=FAIL component=$Component integration_containers=$($containers.Count) integration_volumes=$($volumes.Count). DAILY_DEV host runtimes require zero Integration residue."
}

Write-Host "DAILY_HOST_RUNTIME_OWNERSHIP=PASS component=$Component integration_containers=0 integration_volumes=0"
