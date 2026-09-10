#Requires -Version 7.4
[CmdletBinding()]
param(
    [string] $EnvFile = "infra/local/compose/.env",

    [ValidateRange(1, 120)]
    [int] $Attempts = 45,

    [ValidateRange(1, 30)]
    [int] $DelaySeconds = 2
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$RepoRoot = (Resolve-Path (Join-Path $PSScriptRoot "..\..")).Path
$EnvPath = if ([IO.Path]::IsPathRooted($EnvFile)) { $EnvFile } else { Join-Path $RepoRoot $EnvFile }
if (-not (Test-Path -LiteralPath $EnvPath -PathType Leaf)) {
    throw "Canonical local runtime environment is missing: $EnvPath"
}

function Read-EnvMap([string] $Path) {
    $map = @{}
    foreach ($line in Get-Content -LiteralPath $Path) {
        $trimmed = $line.Trim()
        if (-not $trimmed -or $trimmed.StartsWith("#")) { continue }
        $parts = $trimmed.Split("=", 2)
        if ($parts.Count -ne 2) { throw "Malformed local runtime environment line in ${Path}: $line" }
        $name = $parts[0].Trim()
        if ([string]::IsNullOrWhiteSpace($name)) { throw "Local runtime environment contains an empty key in ${Path}." }
        if ($map.ContainsKey($name)) { throw "Duplicate local runtime environment key '$name' in ${Path}." }
        $map[$name] = $parts[1].Trim()
    }
    return $map
}

function Require-EnvValue([hashtable] $Map, [string] $Name) {
    if (-not $Map.ContainsKey($Name) -or [string]::IsNullOrWhiteSpace([string] $Map[$Name])) {
        throw "Required local runtime setting is missing: $Name"
    }
    return [string] $Map[$Name]
}

function Require-TcpPort([hashtable] $Map, [string] $Name) {
    $raw = Require-EnvValue -Map $Map -Name $Name
    $port = 0
    if (-not [int]::TryParse($raw, [ref] $port) -or $port -lt 1 -or $port -gt 65535) {
        throw "Invalid TCP port in ${Name}: $raw"
    }
    return $port
}

$envMap = Read-EnvMap -Path $EnvPath
$identityPort = Require-TcpPort -Map $envMap -Name "SAMRIM_IDENTITY_PORT"
$dshPort = Require-TcpPort -Map $envMap -Name "SAMRIM_DSH_PORT"
$identityBase = (Require-EnvValue -Map $envMap -Name "IDENTITY_API_BASE_URL").TrimEnd("/")
$dshBase = (Require-EnvValue -Map $envMap -Name "DSH_API_BASE_URL").TrimEnd("/")
foreach ($entry in @(
    @{ Name = "IDENTITY_API_BASE_URL"; Value = $identityBase; Port = $identityPort },
    @{ Name = "DSH_API_BASE_URL"; Value = $dshBase; Port = $dshPort }
)) {
    try { $uri = [Uri]::new($entry.Value, [UriKind]::Absolute) }
    catch { throw "$($entry.Name) is not a valid absolute URI: $($entry.Value)" }
    if ($uri.Scheme -ne "http" -or $uri.Port -ne $entry.Port -or $uri.AbsolutePath -ne "/") {
        throw "$($entry.Name) must use canonical runtime port $($entry.Port): $($entry.Value)"
    }
}

$checks = @(
    @{ Name = "identity";  Base = "$identityBase/identity" },
    @{ Name = "dsh";       Base = "$dshBase/dsh" }
)

function Test-Endpoint([string] $Service, [string] $Uri) {
    try {
        $response = Invoke-RestMethod -Uri $Uri -Method Get -TimeoutSec 5
        return (
            $null -ne $response -and
            $response.status -eq "ok" -and
            $response.service -eq $Service
        )
    }
    catch {
        return $false
    }
}

$pending = [System.Collections.Generic.HashSet[string]]::new()
foreach ($service in $checks) {
    foreach ($endpoint in @("health", "readiness")) {
        $null = $pending.Add("$($service.Name)|$($service.Base)/$endpoint")
    }
}

for ($attempt = 1; $attempt -le $Attempts -and $pending.Count -gt 0; $attempt++) {
    foreach ($entry in @($pending)) {
        $parts = $entry.Split("|", 2)
        $serviceName = $parts[0]
        $uri = $parts[1]
        if (Test-Endpoint -Service $serviceName -Uri $uri) {
            Write-Host "PASS $uri"
            $null = $pending.Remove($entry)
        }
    }

    if ($pending.Count -gt 0 -and $attempt -lt $Attempts) {
        Write-Host "WAIT runtime endpoints pending=$($pending.Count) attempt=$attempt/$Attempts"
        Start-Sleep -Seconds $DelaySeconds
    }
}

if ($pending.Count -gt 0) {
    Write-Error "Integration runtime endpoints did not become ready:"
    foreach ($entry in ($pending | Sort-Object)) {
        $parts = $entry.Split("|", 2)
        Write-Error "  $($parts[1])"
    }
    exit 1
}

Write-Host "INTEGRATION_RUNTIME=PASS"

$composeArgs = @(
    "compose",
    "--project-name", "samrim-integration",
    "--env-file", $EnvPath,
    "-f", (Join-Path $RepoRoot "infra/local/compose/compose.integration.yaml"),
    "exec", "-T", "identity", "/schema-verify"
)
& docker @composeArgs
if ($LASTEXITCODE -ne 0) {
    Write-Error "Identity exact schema verification failed"
    exit 1
}
Write-Host "IDENTITY_SCHEMA_EXACT=PASS"

$dshSchemaArgs = @(
    "compose",
    "--project-name", "samrim-integration",
    "--env-file", $EnvPath,
    "-f", (Join-Path $RepoRoot "infra/local/compose/compose.integration.yaml"),
    "exec", "-T", "dsh", "/schema-verify"
)
& docker @dshSchemaArgs
if ($LASTEXITCODE -ne 0) {
    Write-Error "DSH exact schema verification failed"
    exit 1
}
Write-Host "DSH_SCHEMA_EXACT=PASS"
