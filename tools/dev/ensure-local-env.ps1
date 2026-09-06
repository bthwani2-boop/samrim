#Requires -Version 7.4
[CmdletBinding()]
param(
    [switch]$Force
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$repo = (Resolve-Path (Join-Path $PSScriptRoot "..\..")).Path
$envFile = Join-Path $repo "infra\local\compose\.env"
$envExample = Join-Path $repo "infra\local\compose\.env.example"

function New-RandomHex([int]$Bytes = 32) {
    [Convert]::ToHexString([Security.Cryptography.RandomNumberGenerator]::GetBytes($Bytes)).ToLowerInvariant()
}

if ($Force -or -not (Test-Path $envFile)) {
    if (-not (Test-Path $envExample)) {
        throw "Missing $envExample"
    }

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
SAMRIM_IDENTITY_BIND_HOST=0.0.0.0
SAMRIM_DSH_PORT=58080

BTHWANI_ENV=development

IDENTITY_CHALLENGE_HMAC_SECRET=$(New-RandomHex)
IDENTITY_DSH_SERVICE_TOKEN=$(New-RandomHex)
IDENTITY_PLATFORM_CONTROL_SERVICE_TOKEN=$(New-RandomHex)
DSH_PLATFORM_CONTROL_SERVICE_TOKEN=$(New-RandomHex)
IDENTITY_ABUSE_HMAC_SECRET=$(New-RandomHex)
IDENTITY_PLATFORM_BOOTSTRAP_SECRET=$(New-RandomHex)
IDENTITY_RETENTION_CHALLENGE_DAYS=30
IDENTITY_RETENTION_PASSWORD_ATTEMPT_DAYS=30
IDENTITY_RETENTION_ACTIVATION_DAYS=30
IDENTITY_RETENTION_SESSION_DAYS=90
IDENTITY_RETENTION_AUDIT_DAYS=365
IDENTITY_RETENTION_BATCH_SIZE=500
IDENTITY_TRUSTED_PROXY_IPS=
IDENTITY_API_BASE_URL=http://127.0.0.1:18082
DSH_API_BASE_URL=http://127.0.0.1:58080
IDENTITY_CHALLENGE_DELIVERY_MODE=mailpit
IDENTITY_MAILPIT_RECIPIENT=identity-dev@samrim.local
IDENTITY_CORS_ALLOWED_ORIGINS=http://localhost:13000
"@

    [IO.File]::WriteAllText($envFile, $content.Trim() + "`n", [Text.UTF8Encoding]::new($false))
    Write-Host "LOCAL_RUNTIME_ENV=ENSURED"
}
