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

& $ensureLocalEnvPath

if (-not (Test-Path -LiteralPath $envPath -PathType Leaf)) {
    throw "Local runtime environment is missing: $envPath"
}

& docker version *> $null
if ($LASTEXITCODE -ne 0) {
    throw "Docker CLI/daemon is not available."
}

function Read-EnvMap([string]$Path) {
    $map = @{}
    foreach ($line in Get-Content -LiteralPath $Path) {
        $trimmed = $line.Trim()
        if (-not $trimmed -or $trimmed.StartsWith("#")) {
            continue
        }

        $parts = $trimmed.Split("=", 2)
        if ($parts.Count -ne 2) {
            throw "Malformed local runtime environment line in ${Path}: $line"
        }

        $name = $parts[0].Trim()
        $value = $parts[1].Trim()
        if ($map.ContainsKey($name)) {
            throw "Duplicate local runtime environment key '$name' in ${Path}."
        }

        $map[$name] = $value
    }

    return $map
}

function Require-EnvValue([hashtable]$Map, [string]$Name) {
    if (-not $Map.ContainsKey($Name) -or [string]::IsNullOrWhiteSpace([string]$Map[$Name])) {
        throw "Required local runtime setting is missing: $Name"
    }

    return [string]$Map[$Name]
}

$envMap = Read-EnvMap -Path $envPath
if ((Require-EnvValue -Map $envMap -Name "BTHWANI_ENV") -ne "development") {
    throw "Local runtime mutations require BTHWANI_ENV=development."
}

$composeBase = @(
    "compose",
    "--ansi", "never",
    "--env-file", $envPath,
    "-f", $composeFile
)

function Invoke-Compose {
    param(
        [Parameter(Mandatory)]
        [string[]]$Arguments,
        [switch]$IncludeIntegrationProfile
    )

    $args = @($composeBase)
    if ($IncludeIntegrationProfile) {
        $args += @("--profile", "integration")
    }

    & docker @args @Arguments
    if ($LASTEXITCODE -ne 0) {
        throw "docker compose failed: $($Arguments -join ' ')"
    }
}

function Get-RunningDomainContainers {
    $args = @($composeBase) + @(
        "--profile", "integration",
        "ps", "--status", "running", "--services",
        "identity", "dsh"
    )

    $rows = @(& docker @args)
    if ($LASTEXITCODE -ne 0) {
        throw "Unable to inspect Docker-owned integration domain services."
    }

    return @(
        $rows |
            ForEach-Object { $_.Trim() } |
            Where-Object { $_ } |
            Sort-Object -Unique
    )
}

Push-Location $repo
try {
    if ($Action -eq "Down") {
        Invoke-Compose -IncludeIntegrationProfile -Arguments @(
            "down",
            "--remove-orphans"
        )
        Write-Host "LOCAL_RUNTIME=DOWN owner=DAILY_DEV"
        exit 0
    }

    Write-Host "RUNTIME_MODE_TRANSITION=DAILY_DEV"

    Invoke-Compose -IncludeIntegrationProfile -Arguments @(
        "stop",
        "identity",
        "dsh"
    )
    Invoke-Compose -IncludeIntegrationProfile -Arguments @(
        "rm",
        "-s",
        "-f",
        "identity",
        "dsh",
        "identity-migrate"
    )
    Invoke-Compose -Arguments @(
        "up",
        "-d",
        "--wait",
        "--wait-timeout", "120",
        "postgres",
        "mailpit"
    )

    $unexpected = @(Get-RunningDomainContainers)
    if ($unexpected.Count -gt 0) {
        throw "DAILY_DEV Docker ownership violation: $($unexpected -join ', ')"
    }

    Write-Host "RUNTIME_MODE=DAILY_DEV"
    Write-Host "DOCKER_OWNS=postgres,mailpit"
    Write-Host "HOST_OWNS=identity,dsh,control-panel,mobile"
    Write-Host "DAILY_RUNTIME_DOCKER_DOMAIN_SERVICES=0"
}
finally {
    Pop-Location
}
