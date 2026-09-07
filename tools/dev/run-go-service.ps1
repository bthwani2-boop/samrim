#Requires -Version 7.4
[CmdletBinding()]
param(
    [Parameter(Mandatory)]
    [string]$Service
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$repo = (Resolve-Path (Join-Path $PSScriptRoot "....")).Path
$serviceRoot = Join-Path $repo ("services\" + $Service)
$backendPath = Join-Path $serviceRoot "backend"
$projectPath = Join-Path $serviceRoot "project.json"
$goModPath = Join-Path $backendPath "go.mod"
$apiMainPath = Join-Path $backendPath "cmd\api\main.go"
$envExamplePath = Join-Path $repo "infra\local\compose\.env.example"

foreach ($required in @($projectPath, $goModPath, $apiMainPath, $envExamplePath)) {
    if (-not (Test-Path -LiteralPath $required -PathType Leaf)) {
        throw "Requested Go service is not a discovered materialized service: $required"
    }
}

$project = Get-Content -LiteralPath $projectPath -Raw | ConvertFrom-Json
if (@($project.tags) -notcontains "type:service") {
    throw "$Service is not tagged as type:service."
}
if ([string] $project.root -ne ("services/" + $Service)) {
    throw "$Service project.root does not match services/$Service."
}

$envKey = "SAMRIM_" + (($Service -replace '[^A-Za-z0-9]', '_').ToUpperInvariant()) + "_PORT"
$port = $null
foreach ($line in Get-Content -LiteralPath $envExamplePath) {
    $trimmed = $line.Trim()
    if (-not $trimmed -or $trimmed.StartsWith("#")) {
        continue
    }

    $parts = $trimmed.Split("=", 2)
    if ($parts.Count -eq 2 -and $parts[0].Trim() -eq $envKey) {
        $port = $parts[1].Trim()
        break
    }
}

if (-not $env:PORT -and [string]::IsNullOrWhiteSpace([string] $port)) {
    throw "No local default port for $Service. Expected $envKey in infra/local/compose/.env.example or an explicit PORT environment variable."
}

$oldPort = $env:PORT
try {
    if (-not $env:PORT) {
        $env:PORT = [string] $port
    }

    Write-Host "Service: $Service"
    Write-Host "Backend: $backendPath"
    Write-Host "PORT source: $(if ($oldPort) { 'environment' } else { $envExamplePath + ' ' + $envKey })"

    Push-Location $backendPath
    try {
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
    $env:PORT = $oldPort
}
