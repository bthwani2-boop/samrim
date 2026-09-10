#Requires -Version 7.4
[CmdletBinding()]
param()

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$dailyProject = "samrim-local"
$integrationProject = "samrim-integration"

& docker version *> $null
if ($LASTEXITCODE -ne 0) { throw "Docker CLI/daemon is not available." }

function Show-Project([string]$Project, [string]$Label) {
    Write-Host ""
    Write-Host "=== $Label ($Project) ==="
    $rows = @(
        & docker ps -a `
            --filter "label=com.docker.compose.project=$Project" `
            --format 'table {{.Names}}\t{{.Status}}\t{{.Ports}}'
    )
    if ($LASTEXITCODE -ne 0) { throw "Unable to inspect Docker project: $Project" }
    if ($rows.Count -eq 0) { Write-Host "containers=0" } else { $rows | Write-Host }

    $volumes = @(
        & docker volume ls `
            --filter "label=com.docker.compose.project=$Project" `
            --format '{{.Name}}' |
            ForEach-Object { $_.Trim() } |
            Where-Object { $_ }
    )
    Write-Host "volumes=$($volumes.Count)"
}

Show-Project -Project $dailyProject -Label "DAILY_DEV"
Show-Project -Project $integrationProject -Label "FULL_INTEGRATION residue census"

$integrationContainers = @(
    & docker ps -a `
        --filter "label=com.docker.compose.project=$integrationProject" `
        --format '{{.ID}}' |
        ForEach-Object { $_.Trim() } |
        Where-Object { $_ }
)
$integrationVolumes = @(
    & docker volume ls `
        --filter "label=com.docker.compose.project=$integrationProject" `
        --format '{{.Name}}' |
        ForEach-Object { $_.Trim() } |
        Where-Object { $_ }
)

Write-Host ""
Write-Host "RUNTIME_STATUS=PASS"
Write-Host "INTEGRATION_CONTAINERS=$($integrationContainers.Count)"
Write-Host "INTEGRATION_VOLUMES=$($integrationVolumes.Count)"
