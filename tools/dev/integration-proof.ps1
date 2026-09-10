#Requires -Version 7.4
[CmdletBinding()]
param(
    [string]$ExpectedBranch = ""
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$repo = (Resolve-Path (Join-Path $PSScriptRoot "..\..")).Path
$envPath = Join-Path $repo "infra\local\compose\.env"
$integrationCompose = Join-Path $repo "infra\local\compose\compose.integration.yaml"
$ensureLocalEnv = Join-Path $PSScriptRoot "ensure-local-env.ps1"
$verifyIntegration = Join-Path $PSScriptRoot "verify-integration-runtime.ps1"
$integrationProject = "samrim-integration"
$dailyProject = "samrim-local"

function Fail([string]$Message) {
    throw $Message
}

function Read-EnvMap([string]$Path) {
    $map = @{}
    foreach ($line in Get-Content -LiteralPath $Path) {
        $trimmed = $line.Trim()
        if (-not $trimmed -or $trimmed.StartsWith("#")) { continue }
        $parts = $trimmed.Split("=", 2)
        if ($parts.Count -ne 2) { Fail "Malformed local runtime environment line: $line" }
        $name = $parts[0].Trim()
        if ($map.ContainsKey($name)) { Fail "Duplicate local runtime environment key: $name" }
        $map[$name] = $parts[1].Trim()
    }
    return $map
}

function Invoke-IntegrationCompose([string[]]$Arguments) {
    $base = @(
        "compose",
        "--ansi", "never",
        "--progress", "plain",
        "--project-name", $integrationProject,
        "--env-file", $envPath,
        "-f", $integrationCompose
    )
    $output = @(& docker @base @Arguments 2>&1)
    $exitCode = $LASTEXITCODE
    $output | ForEach-Object { Write-Host $_ }
    return $exitCode
}

function Get-ProjectContainers([string]$Project, [switch]$RunningOnly) {
    $args = @("ps")
    if (-not $RunningOnly) { $args += "-a" }
    $args += @(
        "--filter", "label=com.docker.compose.project=$Project",
        "--format", "{{.ID}}"
    )
    return @(
        & docker @args |
            ForEach-Object { $_.Trim() } |
            Where-Object { $_ }
    )
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

function Reset-IntegrationRuntime {
    $code = Invoke-IntegrationCompose -Arguments @("down", "--volumes", "--remove-orphans")
    if ($code -ne 0) { Fail "Unable to reset isolated integration runtime." }
}

function Assert-NoIntegrationResidue {
    $containers = @(Get-ProjectContainers -Project $integrationProject)
    $volumes = @(Get-ProjectVolumes -Project $integrationProject)
    if ($containers.Count -gt 0 -or $volumes.Count -gt 0) {
        Fail "INTEGRATION_RUNTIME_RESIDUE=FAIL containers=$($containers.Count) volumes=$($volumes.Count)"
    }
    Write-Host "INTEGRATION_RUNTIME_RESIDUE=0"
}

function Test-PortBindable([int]$Port) {
    $listener = $null
    try {
        $listener = [Net.Sockets.TcpListener]::new([Net.IPAddress]::Loopback, $Port)
        $listener.Start()
        return $true
    }
    catch {
        return $false
    }
    finally {
        if ($null -ne $listener) { try { $listener.Stop() } catch {} }
    }
}

function Assert-PortsAvailable([hashtable]$Env) {
    foreach ($key in @(
        "SAMRIM_POSTGRES_PORT",
        "SAMRIM_MAILPIT_SMTP_PORT",
        "SAMRIM_MAILPIT_WEB_PORT",
        "SAMRIM_IDENTITY_PORT",
        "SAMRIM_DSH_PORT"
    )) {
        if (-not $Env.ContainsKey($key)) { Fail "Missing integration host port: $key" }
        $port = 0
        if (-not [int]::TryParse([string]$Env[$key], [ref]$port)) { Fail "Invalid integration host port: $key" }
        if (-not (Test-PortBindable -Port $port)) {
            Fail "INTEGRATION_HOST_PORT_PREFLIGHT=FAIL key=$key port=$port owner=external-or-daily-runtime"
        }
    }
    Write-Host "INTEGRATION_HOST_PORT_PREFLIGHT=PASS"
}

function Show-Diagnostics {
    try {
        $null = Invoke-IntegrationCompose -Arguments @("ps", "-a")
        $null = Invoke-IntegrationCompose -Arguments @("logs", "--tail", "200")
    }
    catch {}
}

foreach ($required in @($integrationCompose, $ensureLocalEnv, $verifyIntegration)) {
    if (-not (Test-Path -LiteralPath $required -PathType Leaf)) {
        Fail "Integration proof prerequisite is missing: $required"
    }
}

Push-Location $repo
$proofError = $null
$cleanupError = $null
try {
    $branch = (& git branch --show-current).Trim()
    if ($LASTEXITCODE -ne 0 -or [string]::IsNullOrWhiteSpace($branch)) {
        Fail "Unable to determine current Git branch."
    }
    if (-not [string]::IsNullOrWhiteSpace($ExpectedBranch) -and $branch -ne $ExpectedBranch) {
        Fail "Expected branch '$ExpectedBranch', found '$branch'."
    }

    $status = @(& git status --porcelain --untracked-files=all)
    if ($LASTEXITCODE -ne 0 -or $status.Count -gt 0) {
        Fail "Working tree must be clean before integration proof."
    }

    & docker version *> $null
    if ($LASTEXITCODE -ne 0) { Fail "Docker CLI/daemon is not available." }

    & $ensureLocalEnv
    if ($LASTEXITCODE -ne 0) { Fail "Local runtime environment reconciliation failed." }
    $envMap = Read-EnvMap -Path $envPath
    if ([string]$envMap["BTHWANI_ENV"] -ne "development") {
        Fail "Integration proof requires BTHWANI_ENV=development."
    }

    $dailyRunning = @(Get-ProjectContainers -Project $dailyProject -RunningOnly)
    if ($dailyRunning.Count -gt 0) {
        Fail "RUNTIME_MODE_CONFLICT=FAIL daily_project=$dailyProject running_containers=$($dailyRunning.Count). Stop DAILY_DEV before FULL_INTEGRATION proof."
    }

    Write-Host "INTEGRATION_PROJECT=$integrationProject"
    Write-Host "DAILY_INTEGRATION_STATE_SHARING=0"

    # Re-found every proof from a zero-state isolated project. No prior integration state survives.
    Reset-IntegrationRuntime
    Assert-NoIntegrationResidue
    Assert-PortsAvailable -Env $envMap

    $configCode = Invoke-IntegrationCompose -Arguments @("config", "--quiet")
    if ($configCode -ne 0) { Fail "Integration compose configuration is invalid." }
    Write-Host "INTEGRATION_DOCKER_CONFIG=PASS"

    $upCode = Invoke-IntegrationCompose -Arguments @("up", "-d", "--build", "--wait", "--wait-timeout", "180")
    if ($upCode -ne 0) {
        Show-Diagnostics
        Fail "Integration compose build/start failed."
    }

    & pwsh -NoProfile -NonInteractive -ExecutionPolicy Bypass -File $verifyIntegration -Attempts 60 -DelaySeconds 2
    if ($LASTEXITCODE -ne 0) {
        Show-Diagnostics
        Fail "Integration endpoint verification failed."
    }

    $running = @(
        & docker compose `
            --project-name $integrationProject `
            --env-file $envPath `
            -f $integrationCompose `
            ps --status running --services |
            ForEach-Object { $_.Trim() } |
            Where-Object { $_ } |
            Sort-Object
    )
    if ($LASTEXITCODE -ne 0) { Fail "Unable to census integration services." }
    $expected = @("dsh", "identity", "mailpit", "postgres")
    if (($running -join ",") -ne ($expected -join ",")) {
        Show-Diagnostics
        Fail "Integration service census mismatch: running=$($running -join ',') expected=$($expected -join ',')"
    }

    $finalStatus = @(& git status --porcelain --untracked-files=all)
    if ($LASTEXITCODE -ne 0 -or $finalStatus.Count -gt 0) {
        Fail "Integration proof mutated repository state."
    }

    Write-Host "INTEGRATION_COMPOSE_SERVICES=PASS"
    Write-Host "INTEGRATION_RUNTIME_PROOF=PASS"
}
catch {
    $proofError = $_
    Show-Diagnostics
}
finally {
    try {
        Write-Host ""
        Write-Host "=== Mandatory isolated integration teardown ==="
        Reset-IntegrationRuntime
        Assert-NoIntegrationResidue
    }
    catch {
        $cleanupError = $_
    }
    Pop-Location
}

if ($null -ne $cleanupError) {
    throw "INTEGRATION_RUNTIME_CLEANUP=FAIL: $($cleanupError.Exception.Message)"
}
if ($null -ne $proofError) {
    throw "INTEGRATION_RUNTIME_PROOF=FAIL residue=0: $($proofError.Exception.Message)"
}

Write-Host "INTEGRATION_RUNTIME_CLEANUP=PASS"
Write-Host "INTEGRATION_RUNTIME_PROOF=PASS residue=0"
