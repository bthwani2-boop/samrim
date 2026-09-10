#Requires -Version 7.4
[CmdletBinding()]
param()

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$repo = (Resolve-Path (Join-Path $PSScriptRoot "..\..")).Path
$envFile = Join-Path $repo "infra\local\compose\.env"
$envExample = Join-Path $repo "infra\local\compose\.env.example"

function New-RandomHex([int]$Bytes = 32) {
    [Convert]::ToHexString(
        [Security.Cryptography.RandomNumberGenerator]::GetBytes($Bytes)
    ).ToLowerInvariant()
}

function Read-EnvMap([string]$Path) {
    $map = @{}
    foreach ($line in Get-Content -LiteralPath $Path) {
        $trimmed = $line.Trim()
        if (-not $trimmed -or $trimmed.StartsWith("#")) { continue }
        $parts = $trimmed.Split("=", 2)
        if ($parts.Count -ne 2) { throw "Malformed local runtime environment line in ${Path}: $line" }
        $name = $parts[0].Trim()
        $value = $parts[1].Trim()
        if ([string]::IsNullOrWhiteSpace($name)) { throw "Local runtime environment contains an empty key in ${Path}." }
        if ($map.ContainsKey($name)) { throw "Duplicate local runtime environment key '$name' in ${Path}." }
        $map[$name] = $value
    }
    return $map
}

if (-not (Test-Path -LiteralPath $envExample -PathType Leaf)) {
    throw "Missing canonical local runtime template: $envExample"
}

# These are the only local values that may survive reconciliation from an existing .env.
# Everything else is canonical non-secret configuration and is projected exactly from .env.example.
$generatedSecretKeys = [System.Collections.Generic.HashSet[string]]::new([StringComparer]::OrdinalIgnoreCase)
foreach ($name in @(
    "SAMRIM_POSTGRES_PASSWORD",
    "IDENTITY_CHALLENGE_HMAC_SECRET",
    "IDENTITY_DSH_SERVICE_TOKEN",
    "IDENTITY_PLATFORM_CONTROL_SERVICE_TOKEN",
    "DSH_PLATFORM_CONTROL_SERVICE_TOKEN",
    "IDENTITY_ABUSE_HMAC_SECRET",
    "IDENTITY_PLATFORM_BOOTSTRAP_SECRET"
)) {
    $null = $generatedSecretKeys.Add($name)
}

$current = @{}
$existingRaw = $null
$state = "created"
if (Test-Path -LiteralPath $envFile -PathType Leaf) {
    $current = Read-EnvMap -Path $envFile
    $existingRaw = Get-Content -LiteralPath $envFile -Raw
    $state = "unchanged"
}

$templateLines = @(Get-Content -LiteralPath $envExample)
$templateKeys = [System.Collections.Generic.HashSet[string]]::new([StringComparer]::OrdinalIgnoreCase)
$output = [System.Collections.Generic.List[string]]::new()

foreach ($line in $templateLines) {
    $trimmed = $line.Trim()
    if (-not $trimmed -or $trimmed.StartsWith("#")) {
        $output.Add($line)
        continue
    }

    $parts = $line.Split("=", 2)
    if ($parts.Count -ne 2) { throw "Malformed canonical local runtime template line: $line" }
    $name = $parts[0].Trim()
    $templateValue = $parts[1].Trim()

    if (-not $templateKeys.Add($name)) { throw "Duplicate canonical local runtime template key '$name'." }

    if ($generatedSecretKeys.Contains($name)) {
        if ($current.ContainsKey($name) -and -not [string]::IsNullOrWhiteSpace([string]$current[$name])) {
            $resolvedValue = [string]$current[$name]
        }
        else {
            $resolvedValue = New-RandomHex
            $state = if ($null -eq $existingRaw) { "created" } else { "reconciled" }
        }
    }
    else {
        $resolvedValue = $templateValue
        if (-not $current.ContainsKey($name) -or [string]$current[$name] -ne $resolvedValue) {
            if ($null -ne $existingRaw) { $state = "reconciled" }
        }
    }

    $output.Add("${name}=${resolvedValue}")
}

$unknownKeys = @(
    $current.Keys |
        Where-Object { -not $templateKeys.Contains([string]$_) } |
        Sort-Object
)
if ($unknownKeys.Count -gt 0 -and $null -ne $existingRaw) {
    $state = "reconciled"
}

$newRaw = (($output -join [Environment]::NewLine).TrimEnd()) + [Environment]::NewLine
if ($null -eq $existingRaw -or $existingRaw -ne $newRaw) {
    [IO.File]::WriteAllText($envFile, $newRaw, [Text.UTF8Encoding]::new($false))
    if ($null -ne $existingRaw) { $state = "reconciled" }
}

Write-Host "LOCAL_RUNTIME_ENV=PASS state=$state source=infra/local/compose/.env.example secrets=preserved unknown_removed=$($unknownKeys.Count)"
