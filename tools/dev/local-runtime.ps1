#Requires -Version 7.4
[CmdletBinding()]
param(
    [Parameter(Mandatory)]
    [ValidateSet("Daily", "Integration")]
    [string] $Mode,

    [Parameter(Mandatory)]
    [ValidateSet("Up", "Down")]
    [string] $Action
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

function Read-EnvMap([string] $Path) {
    $map = @{}
    foreach ($line in Get-Content -LiteralPath $Path) {
        $trimmed = $line.Trim()
        if (-not $trimmed -or $trimmed.StartsWith("#")) { continue }
        $parts = $trimmed.Split("=", 2)
        if ($parts.Count -eq 2) { $map[$parts[0].Trim()] = $parts[1].Trim() }
    }
    return $map
}

function Require-EnvValue([hashtable] $Map, [string] $Name) {
    if (-not $Map.ContainsKey($Name) -or [string]::IsNullOrWhiteSpace([string] $Map[$Name])) {
        throw "Required local runtime setting is missing: $Name"
    }
    return [string] $Map[$Name]
}

$envMap = Read-EnvMap -Path $envPath
if ((Require-EnvValue -Map $envMap -Name "BTHWANI_ENV") -ne "development") {
    throw "Local runtime mutations require BTHWANI_ENV=development."
}

$composeBase = @("compose", "--ansi", "never", "--env-file", $envPath, "-f", $composeFile)

function Invoke-Compose {
    param([Parameter(Mandatory)][string[]] $Arguments, [switch] $Integration)
    $args = @($composeBase)
    if ($Integration) { $args += @("--profile", "integration") }
    & docker @args @Arguments
    if ($LASTEXITCODE -ne 0) { throw "docker compose failed: $($Arguments -join ' ')" }
}

function Get-PortOwnerDescription([int] $Port) {
    if (-not (Get-Command Get-NetTCPConnection -ErrorAction SilentlyContinue)) { return "owner=unknown" }
    try {
        $connections = @(Get-NetTCPConnection -State Listen -LocalPort $Port -ErrorAction SilentlyContinue)
        if ($connections.Count -eq 0) { return "owner=unknown" }
        $owners = foreach ($connection in $connections) {
            $pidValue = [int] $connection.OwningProcess
            $process = Get-Process -Id $pidValue -ErrorAction SilentlyContinue
            if ($null -eq $process) { "pid=$pidValue process=unknown" }
            else { "pid=$pidValue process=$($process.ProcessName)" }
        }
        return (($owners | Sort-Object -Unique) -join "; ")
    }
    catch { return "owner=unknown" }
}

function Assert-PortAvailable([int] $Port, [string] $Label) {
    $listener = $null
    try {
        $listener = [Net.Sockets.TcpListener]::new([Net.IPAddress]::Loopback, $Port)
        $listener.Start()
    }
    catch {
        $owner = Get-PortOwnerDescription -Port $Port
        throw "RUNTIME_MODE_CONFLICT=FAIL mode=FULL_INTEGRATION port=$Port label=$Label $owner. Stop the host/foreign process before starting Docker integration."
    }
    finally {
        if ($null -ne $listener) { try { $listener.Stop() } catch {} }
    }
}

function Get-RunningIntegrationServices([string[]] $Services = @()) {
    $args = @($composeBase) + @("--profile", "integration", "ps", "--status", "running", "--services")
    if ($Services.Count -gt 0) { $args += $Services }
    $rows = @(& docker @args)
    if ($LASTEXITCODE -ne 0) { throw "Unable to inspect integration Compose services." }
    return @($rows | ForEach-Object { $_.Trim() } | Where-Object { $_ } | Sort-Object -Unique)
}

Push-Location $repo
try {
    if ($Action -eq "Down") {
        Invoke-Compose -Integration -Arguments @("down", "--remove-orphans")
        Write-Host "LOCAL_RUNTIME=DOWN mode=$Mode"
        exit 0
    }

    if ($Mode -eq "Daily") {
        Write-Host "RUNTIME_MODE_TRANSITION=DAILY_DEV"
        Invoke-Compose -Integration -Arguments @("stop", "identity", "dsh")
        Invoke-Compose -Integration -Arguments @("rm", "-s", "-f", "identity", "dsh", "identity-migrate")
        Invoke-Compose -Arguments @("up", "-d", "--wait", "--wait-timeout", "120", "postgres", "mailpit")

        $unexpected = @(Get-RunningIntegrationServices -Services @("identity", "dsh"))
        if ($unexpected.Count -gt 0) { throw "DAILY_DEV Docker ownership violation: $($unexpected -join ', ')" }

        Write-Host "RUNTIME_MODE=DAILY_DEV"
        Write-Host "DOCKER_OWNS=postgres,mailpit"
        Write-Host "HOST_OWNS=identity,dsh,control-panel,mobile"
        Write-Host "DAILY_RUNTIME_DOCKER_DOMAIN_SERVICES=0"
        exit 0
    }

    Write-Host "RUNTIME_MODE_TRANSITION=FULL_INTEGRATION"
    Invoke-Compose -Integration -Arguments @("down", "--remove-orphans")

    foreach ($entry in @(
        @{ Name = "postgres"; Key = "SAMRIM_POSTGRES_PORT" },
        @{ Name = "mailpit-smtp"; Key = "SAMRIM_MAILPIT_SMTP_PORT" },
        @{ Name = "mailpit-web"; Key = "SAMRIM_MAILPIT_WEB_PORT" },
        @{ Name = "identity"; Key = "SAMRIM_IDENTITY_PORT" },
        @{ Name = "dsh"; Key = "SAMRIM_DSH_PORT" }
    )) {
        $raw = Require-EnvValue -Map $envMap -Name $entry.Key
        $port = 0
        if (-not [int]::TryParse($raw, [ref] $port)) { throw "$($entry.Key) is not a valid TCP port: $raw" }
        Assert-PortAvailable -Port $port -Label $entry.Name
    }

    Invoke-Compose -Integration -Arguments @("up", "-d", "--build", "--wait", "--wait-timeout", "180")

    $running = @(Get-RunningIntegrationServices)
    $expected = @("dsh", "identity", "mailpit", "postgres")
    $missing = @($expected | Where-Object { $_ -notin $running })
    $unexpected = @($running | Where-Object { $_ -notin $expected })
    if ($missing.Count -gt 0 -or $unexpected.Count -gt 0) {
        throw "FULL_INTEGRATION service census mismatch. running=$($running -join ',') missing=$($missing -join ',') unexpected=$($unexpected -join ',')"
    }

    Write-Host "RUNTIME_MODE=FULL_INTEGRATION"
    Write-Host "DOCKER_OWNS=postgres,mailpit,identity,dsh"
    Write-Host "HOST_DOMAIN_SERVICES_ALLOWED=0"
}
finally { Pop-Location }
