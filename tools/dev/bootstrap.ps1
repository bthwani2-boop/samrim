#Requires -Version 7.4
[CmdletBinding()]
param()

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"
$repo = (Resolve-Path (Join-Path $PSScriptRoot "..\..")).Path
$envFile = Join-Path $repo "infra\local\compose\.env"

function New-RandomHex([int]$Bytes = 24) {
    [Convert]::ToHexString([Security.Cryptography.RandomNumberGenerator]::GetBytes($Bytes)).ToLowerInvariant()
}

if (-not (Test-Path $envFile)) {
    $content = @"
SAMRIM_POSTGRES_USER=samrim_local
SAMRIM_POSTGRES_PASSWORD=$(New-RandomHex)
SAMRIM_POSTGRES_DB=samrim_local
SAMRIM_POSTGRES_PORT=58432

SAMRIM_MINIO_ROOT_USER=samrim_local
SAMRIM_MINIO_ROOT_PASSWORD=$(New-RandomHex)
SAMRIM_MINIO_API_PORT=59000
SAMRIM_MINIO_CONSOLE_PORT=59001

SAMRIM_MAILPIT_SMTP_PORT=58025
SAMRIM_MAILPIT_WEB_PORT=58026

SAMRIM_IDENTITY_PORT=18082
SAMRIM_DSH_PORT=58080
SAMRIM_WLT_PORT=18083
"@
    [IO.File]::WriteAllText($envFile, $content.Trim() + "`n", [Text.UTF8Encoding]::new($false))
}

Push-Location $repo
try {
    if (-not (Test-Path "pnpm-lock.yaml")) { throw "pnpm-lock.yaml is missing; generate and commit it before normal bootstrap." }
    pnpm install --frozen-lockfile
    if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
    go work sync
    if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
    docker compose --env-file infra/local/compose/.env -f infra/local/compose/compose.yaml config *> $null
    if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
    Write-Host "Bootstrap PASS"
}
finally { Pop-Location }
