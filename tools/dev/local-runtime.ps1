#Requires -Version 7.4
[CmdletBinding()]
param(
    [Parameter(Mandatory)]
    [ValidateSet("Up", "Down")]
    [string]$Action
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$repo = (Resolve-Path (Join-Path $PSScriptRoot "..\..")).Path
$envPath = Join-Path $repo "infra\local\compose\.env"
$composeFile = Join-Path $repo "infra\local\compose\compose.yaml"
$ensureLocalEnvPath = Join-Path $PSScriptRoot "ensure-local-env.ps1"
$dailyProject = "samrim-local"
$integrationProject = "samrim-integration"

& $ensureLocalEnvPath
if ($LASTEXITCODE -ne 0) { throw "Local runtime environment reconciliation failed." }

& docker version *> $null
if ($LASTEXITCODE -ne 0) { throw "Docker CLI/daemon is not available." }

function Read-EnvMap([string]$Path) {
    $map = @{}
    foreach ($line in Get-Content -LiteralPath $Path) {
        $trimmed = $line.Trim()
        if (-not $trimmed -or $trimmed.StartsWith("#")) { continue }
        $parts = $trimmed.Split("=", 2)
        if ($parts.Count -ne 2) { throw "Malformed local runtime environment line in ${Path}: $line" }
        $name = $parts[0].Trim()
        if ($map.ContainsKey($name)) { throw "Duplicate local runtime environment key '$name' in ${Path}." }
        $map[$name] = $parts[1].Trim()
    }
    return $map
}

function Get-ProjectContainers([string]$Project, [switch]$RunningOnly) {
    $args = @("ps")
    if (-not $RunningOnly) { $args += "-a" }
    $args += @("--filter", "label=com.docker.compose.project=$Project", "--format", "{{.ID}}")
    return @(& docker @args | ForEach-Object { $_.Trim() } | Where-Object { $_ })
}

function Get-ProjectVolumes([string]$Project) {
    return @(
        & docker volume ls `
            --filter "label=com.docker.compose.project=$Project" `
            --format "{{.Name}}" |
            ForEach-Object { $_.Trim() } |
            Where-Object { $_ }
    )
}

function Invoke-DailyCompose([string[]]$Arguments) {
    & docker compose `
        --ansi never `
        --project-name $dailyProject `
        --env-file $envPath `
        -f $composeFile `
        @Arguments
    if ($LASTEXITCODE -ne 0) { throw "DAILY_DEV docker compose failed: $($Arguments -join ' ')" }
}

function Assert-NoIntegrationResidue {
    $containers = @(Get-ProjectContainers -Project $integrationProject)
    $volumes = @(Get-ProjectVolumes -Project $integrationProject)
    if ($containers.Count -gt 0 -or $volumes.Count -gt 0) {
        throw "RUNTIME_MODE_CONFLICT=FAIL integration_containers=$($containers.Count) integration_volumes=$($volumes.Count). FULL_INTEGRATION must leave zero residue before DAILY_DEV starts."
    }
}

function Assert-DailyServiceCensus {
    $services = @(
        & docker ps -a `
            --filter "label=com.docker.compose.project=$dailyProject" `
            --format "{{.Label \"com.docker.compose.service\"}}" |
            ForEach-Object { $_.Trim() } |
            Where-Object { $_ } |
            Sort-Object -Unique
    )
    $unexpected = @($services | Where-Object { $_ -notin @("postgres", "mailpit") })
    if ($unexpected.Count -gt 0) {
        throw "DAILY_DEV Docker ownership violation: unexpected services=$($unexpected -join ',')"
    }
    Write-Host "DAILY_RUNTIME_DOCKER_DOMAIN_SERVICES=0"
}

$envMap = Read-EnvMap -Path $envPath
if ([string]$envMap["BTHWANI_ENV"] -ne "development") {
    throw "Local runtime mutations require BTHWANI_ENV=development."
}

Push-Location $repo
try {
    if ($Action -eq "Down") {
        Invoke-DailyCompose -Arguments @("down", "--remove-orphans")
        if (@(Get-ProjectContainers -Project $dailyProject).Count -gt 0) {
            throw "DAILY_RUNTIME_SHUTDOWN=FAIL project containers remain."
        }
        Write-Host "LOCAL_RUNTIME=DOWN owner=DAILY_DEV data_volume=preserved"
        exit 0
    }

    Write-Host "RUNTIME_MODE_TRANSITION=DAILY_DEV"
    Assert-NoIntegrationResidue

    Invoke-DailyCompose -Arguments @(
        "up",
        "-d",
        "--wait",
        "--wait-timeout", "120",
        "--remove-orphans",
        "postgres",
        "mailpit"
    )

    Assert-DailyServiceCensus

    Write-Host "RUNTIME_MODE=DAILY_DEV"
    Write-Host "DAILY_PROJECT=$dailyProject"
    Write-Host "DOCKER_OWNS=postgres,mailpit"
    Write-Host "HOST_OWNS=identity,dsh,control-panel,mobile"
    Write-Host "INTEGRATION_RUNTIME_RESIDUE=0"
}
finally {
    Pop-Location
}
