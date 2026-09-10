#Requires -Version 7.4
[CmdletBinding()]
param(
    [Parameter(Mandatory)]
    [ValidateSet("identity", "dsh")]
    [string]$Service
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$repo = (Resolve-Path (Join-Path $PSScriptRoot "..\..")).Path
$serviceRoot = Join-Path $repo ("services\" + $Service)
$backendPath = Join-Path $serviceRoot "backend"
$projectPath = Join-Path $serviceRoot "project.json"
$goModPath = Join-Path $backendPath "go.mod"
$apiMainPath = Join-Path $backendPath "cmd\api\main.go"
$ensureLocalEnvPath = Join-Path $PSScriptRoot "ensure-local-env.ps1"
$envPath = Join-Path $repo "infra\local\compose\.env"

foreach ($required in @(
    $projectPath,
    $goModPath,
    $apiMainPath,
    $ensureLocalEnvPath
)) {
    if (-not (Test-Path -LiteralPath $required -PathType Leaf)) {
        throw "Requested Go service is not a discovered materialized service: $required"
    }
}

$project = Get-Content -LiteralPath $projectPath -Raw | ConvertFrom-Json
if (@($project.tags) -notcontains "type:service") {
    throw "$Service is not tagged as type:service."
}
if ([string]$project.root -ne ("services/" + $Service)) {
    throw "$Service project.root does not match services/$Service."
}

& $ensureLocalEnvPath

if (-not (Test-Path -LiteralPath $envPath -PathType Leaf)) {
    throw "Local runtime environment is missing after ensure-local-env: $envPath"
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
            continue
        }

        $map[$parts[0].Trim()] = $parts[1].Trim()
    }

    return $map
}

function Require-EnvMapValue(
    [hashtable]$Map,
    [string]$Name
) {
    if (
        -not $Map.ContainsKey($Name) -or
        [string]::IsNullOrWhiteSpace([string]$Map[$Name])
    ) {
        throw "Required local runtime setting is missing: $Name"
    }

    return [string]$Map[$Name]
}

function Set-ProcessEnvironment(
    [string]$Name,
    [AllowEmptyString()][string]$Value
) {
    [Environment]::SetEnvironmentVariable(
        $Name,
        $Value,
        [EnvironmentVariableTarget]::Process
    )
}

$localEnv = Read-EnvMap -Path $envPath

$runtimeEnvironment = Require-EnvMapValue -Map $localEnv -Name "BTHWANI_ENV"
if ($runtimeEnvironment -ne "development") {
    throw "LOCAL_INTEGRATION host runtime requires BTHWANI_ENV=development."
}

$portKey = "SAMRIM_" +
    (($Service -replace '[^A-Za-z0-9]', '_').ToUpperInvariant()) +
    "_PORT"

$configuredPort = Require-EnvMapValue -Map $localEnv -Name $portKey
$inheritedPort = [Environment]::GetEnvironmentVariable(
    "PORT",
    [EnvironmentVariableTarget]::Process
)
if (
    -not [string]::IsNullOrWhiteSpace($inheritedPort) -and
    $inheritedPort -ne $configuredPort
) {
    throw "Host runtime does not accept inherited PORT=$inheritedPort for $Service. Canonical local port is $configuredPort from $portKey in infra/local/compose/.env."
}
$runtimePort = $configuredPort

$readinessPath = switch ($Service) {
    "identity" { "/identity/readiness" }
    "dsh" { "/dsh/readiness" }
}
$readinessUri = "http://127.0.0.1:${runtimePort}${readinessPath}"

function Get-PortOwnerSummary([object[]] $Listeners) {
    $ownerPids = @(
        $Listeners |
            Select-Object -ExpandProperty OwningProcess -Unique
    )
    $owners = foreach ($ownerPid in $ownerPids) {
        $process = Get-Process -Id ([int] $ownerPid) -ErrorAction SilentlyContinue
        if ($null -eq $process) {
            "PID=$ownerPid (exited)"
        }
        else {
            "PID=$ownerPid $($process.ProcessName)"
        }
    }
    if ($owners.Count -eq 0) {
        return "unknown process"
    }
    return ($owners -join ", ")
}

function Assert-ServicePortAvailable {
    $listeners = @(
        Get-NetTCPConnection -State Listen -LocalPort ([int] $runtimePort) -ErrorAction SilentlyContinue
    )
    if ($listeners.Count -eq 0) {
        return
    }

    $owners = Get-PortOwnerSummary -Listeners $listeners
    throw "RUNTIME_OWNERSHIP_CONFLICT=FAIL service=$Service port=$runtimePort owner=$owners. The host launcher requires exclusive ownership and will not accept a pre-existing healthy endpoint as success. If FULL_INTEGRATION Docker is active, run 'pnpm runtime:integration:down' then 'pnpm runtime:daily:up'. Otherwise stop the owning process."
}

Assert-ServicePortAvailable

$managedNames = [System.Collections.Generic.HashSet[string]]::new(
    [StringComparer]::OrdinalIgnoreCase
)

foreach ($name in $localEnv.Keys) {
    $null = $managedNames.Add([string]$name)
}

foreach ($name in @(
    "PORT",
    "BTHWANI_LISTEN_HOST",
    "BTHWANI_EXPECTED_DATABASE_HOST",
    "BTHWANI_EXPECTED_DATABASE_PORT",
    "BTHWANI_EXPECTED_DATABASE_NAME",
    "BTHWANI_EXPECTED_DATABASE_USER",
    "IDENTITY_DATABASE_URL",
    "IDENTITY_MAINTENANCE_DATABASE_URL",
    "IDENTITY_MIGRATION_DATABASE_URL",
    "IDENTITY_MAILPIT_SMTP_ADDR",
    "IDENTITY_AUTO_MIGRATE",
    "DSH_IDENTITY_API_BASE_URL"
)) {
    $null = $managedNames.Add($name)
}

$previous = @{}
foreach ($name in $managedNames) {
    $previous[$name] = [Environment]::GetEnvironmentVariable(
        $name,
        [EnvironmentVariableTarget]::Process
    )
}

try {
    foreach ($entry in $localEnv.GetEnumerator()) {
        Set-ProcessEnvironment `
            -Name ([string]$entry.Key) `
            -Value ([string]$entry.Value)
    }

    Set-ProcessEnvironment -Name "PORT" -Value $runtimePort
    Set-ProcessEnvironment -Name "BTHWANI_LISTEN_HOST" -Value "127.0.0.1"

    switch ($Service) {
        "identity" {
            $dbUserRaw = Require-EnvMapValue -Map $localEnv -Name "SAMRIM_POSTGRES_USER"
            $dbPasswordRaw = Require-EnvMapValue -Map $localEnv -Name "SAMRIM_POSTGRES_PASSWORD"
            $dbNameRaw = Require-EnvMapValue -Map $localEnv -Name "SAMRIM_POSTGRES_DB"
            $dbPort = Require-EnvMapValue -Map $localEnv -Name "SAMRIM_POSTGRES_PORT"
            $mailpitSmtpPort = Require-EnvMapValue -Map $localEnv -Name "SAMRIM_MAILPIT_SMTP_PORT"

            $dbUser = [Uri]::EscapeDataString($dbUserRaw)
            $dbPassword = [Uri]::EscapeDataString($dbPasswordRaw)
            $dbName = [Uri]::EscapeDataString($dbNameRaw)

            $databaseURL = "postgres://${dbUser}:${dbPassword}@127.0.0.1:${dbPort}/${dbName}?sslmode=disable"

            Set-ProcessEnvironment -Name "IDENTITY_DATABASE_URL" -Value $databaseURL
            Set-ProcessEnvironment -Name "IDENTITY_MAINTENANCE_DATABASE_URL" -Value $databaseURL
            Set-ProcessEnvironment -Name "IDENTITY_MIGRATION_DATABASE_URL" -Value $databaseURL
            Set-ProcessEnvironment -Name "IDENTITY_MAILPIT_SMTP_ADDR" -Value "127.0.0.1:${mailpitSmtpPort}"
            Set-ProcessEnvironment -Name "IDENTITY_AUTO_MIGRATE" -Value "false"

            Set-ProcessEnvironment -Name "BTHWANI_EXPECTED_DATABASE_HOST" -Value "127.0.0.1"
            Set-ProcessEnvironment -Name "BTHWANI_EXPECTED_DATABASE_PORT" -Value $dbPort
            Set-ProcessEnvironment -Name "BTHWANI_EXPECTED_DATABASE_NAME" -Value $dbNameRaw
            Set-ProcessEnvironment -Name "BTHWANI_EXPECTED_DATABASE_USER" -Value $dbUserRaw
        }

        "dsh" {
            $identityPort = Require-EnvMapValue -Map $localEnv -Name "SAMRIM_IDENTITY_PORT"
            Set-ProcessEnvironment `
                -Name "DSH_IDENTITY_API_BASE_URL" `
                -Value "http://127.0.0.1:${identityPort}"
        }
    }

    Write-Host "Service: $Service"
    Write-Host "Backend: $backendPath"
    Write-Host "Environment source: $envPath"
    Write-Host "PORT=$runtimePort"
    Write-Host "LISTEN_HOST=127.0.0.1"

    Push-Location $backendPath
    try {
        if ($Service -eq "identity") {
            Write-Host "Identity schema migration/verification: starting"
            & go run ./cmd/migrate
            if ($LASTEXITCODE -ne 0) {
                exit $LASTEXITCODE
            }
            Write-Host "Identity schema migration/verification: PASS"
        }

        & go run ./cmd/api
        if ($LASTEXITCODE -ne 0) {
            exit $LASTEXITCODE
        }
    }
    finally {
        Pop-Location
    }
}
finally {
    foreach ($name in $managedNames) {
        $oldValue = $previous[$name]

        if ($null -eq $oldValue) {
            [Environment]::SetEnvironmentVariable(
                $name,
                $null,
                [EnvironmentVariableTarget]::Process
            )
        }
        else {
            [Environment]::SetEnvironmentVariable(
                $name,
                [string]$oldValue,
                [EnvironmentVariableTarget]::Process
            )
        }
    }
}
