#Requires -Version 7.4
[CmdletBinding()]
param(
    [string] $ExpectedBranch = "a",
    [switch] $KeepRunning
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$repo = (Resolve-Path (Join-Path $PSScriptRoot "..\..")).Path
$envPath = Join-Path $repo "infra\local\compose\.env"
$envExamplePath = Join-Path $repo "infra\local\compose\.env.example"
$composeFile = Join-Path $repo "infra\local\compose\compose.yaml"

function Fail([string] $Message) {
    Write-Error $Message
    exit 1
}

function New-RandomHex([int] $Bytes = 24) {
    [Convert]::ToHexString(
        [Security.Cryptography.RandomNumberGenerator]::GetBytes($Bytes)
    ).ToLowerInvariant()
}

function Ensure-LocalEnv {
    if (Test-Path $envPath -PathType Leaf) {
        return
    }

    if (-not (Test-Path $envExamplePath -PathType Leaf)) {
        Fail "Missing infra/local/compose/.env.example"
    }

    $content = Get-Content $envExamplePath -Raw
    $content = $content.Replace(
        "SAMRIM_POSTGRES_PASSWORD=change-me-local-only",
        "SAMRIM_POSTGRES_PASSWORD=$(New-RandomHex)"
    )
    $content = $content.Replace(
        "SAMRIM_MINIO_ROOT_PASSWORD=change-me-local-only",
        "SAMRIM_MINIO_ROOT_PASSWORD=$(New-RandomHex)"
    )

    [IO.File]::WriteAllText(
        $envPath,
        $content.TrimEnd() + [Environment]::NewLine,
        [Text.UTF8Encoding]::new($false)
    )

    Write-Host "LOCAL_RUNTIME_ENV=CREATED"
}

function Invoke-Compose {
    param([string[]] $Arguments)

    $baseArgs = @(
        "compose",
        "--env-file", $envPath,
        "-f", $composeFile,
        "--profile", "foundation"
    )

    & docker @baseArgs @Arguments | Out-Host
    $code = $LASTEXITCODE
    return $code
}

function Show-Diagnostics {
    Write-Host ""
    Write-Host "=== Foundation runtime diagnostics ==="

    $baseArgs = @(
        "compose",
        "--env-file", $envPath,
        "-f", $composeFile,
        "--profile", "foundation"
    )

    & docker @baseArgs "ps"
    & docker @baseArgs "logs" "--tail" "200" "identity" "workforce" "dsh" "wlt" "postgres" "minio" "mailpit"
}

Push-Location $repo
$success = $false

try {
    $branch = (& git branch --show-current).Trim()
    if ($LASTEXITCODE -ne 0 -or [string]::IsNullOrWhiteSpace($branch)) {
        Fail "Unable to determine current Git branch."
    }

    Write-Host "Repository: $repo"
    Write-Host "Branch: $branch"

    if ($branch -ne $ExpectedBranch) {
        Fail "Expected branch '$ExpectedBranch', found '$branch'."
    }

    $status = @(& git status --porcelain)
    if ($LASTEXITCODE -ne 0) {
        Fail "Unable to inspect Git status."
    }
    if ($status.Count -gt 0) {
        Fail ("Working tree must be clean before runtime closure:" +
            [Environment]::NewLine +
            ($status -join [Environment]::NewLine))
    }

    & docker version *> $null
    if ($LASTEXITCODE -ne 0) {
        Fail "Docker CLI/daemon is not available."
    }

    Ensure-LocalEnv

    Write-Host ""
    Write-Host "=== Foundation compose config ==="
    $configOutput = & docker compose --env-file $envPath -f $composeFile --profile foundation config
    if ($LASTEXITCODE -ne 0) {
        Fail "Foundation compose config failed."
    }
    $null = $configOutput
    Write-Host "FOUNDATION_DOCKER_CONFIG=PASS"

    Write-Host ""
    Write-Host "=== Build and start foundation runtime ==="
    $upCode = Invoke-Compose -Arguments @("up", "-d", "--build")
    if ($upCode -ne 0) {
        Show-Diagnostics
        Fail "Foundation compose build/up failed."
    }

    Write-Host ""
    Write-Host "=== Verify foundation service endpoints ==="
    & pwsh -NoProfile -ExecutionPolicy Bypass -File tools/dev/verify-foundation-runtime.ps1 -Attempts 60 -DelaySeconds 2

    if ($LASTEXITCODE -ne 0) {
        Show-Diagnostics
        Fail "Foundation service endpoint verification failed."
    }

    Write-Host ""
    Write-Host "=== Verify compose service state ==="
    $services = @(
        & docker compose --env-file $envPath -f $composeFile --profile foundation ps --status running --services
    )

    if ($LASTEXITCODE -ne 0) {
        Show-Diagnostics
        Fail "Unable to inspect running compose services."
    }

    $expected = @(
        "postgres",
        "minio",
        "mailpit",
        "identity",
        "workforce",
        "dsh",
        "wlt"
    )

    $missing = @($expected | Where-Object { $_ -notin $services })
    if ($missing.Count -gt 0) {
        Show-Diagnostics
        Fail ("Foundation services not running: " + ($missing -join ", "))
    }

    Write-Host "FOUNDATION_COMPOSE_SERVICES=PASS"

    $finalStatus = @(& git status --porcelain)
    if ($LASTEXITCODE -ne 0) {
        Fail "Unable to inspect final Git status."
    }
    if ($finalStatus.Count -gt 0) {
        Show-Diagnostics
        Fail ("Runtime proof mutated repository files:" +
            [Environment]::NewLine +
            ($finalStatus -join [Environment]::NewLine))
    }

    $success = $true

    Write-Host ""
    Write-Host "FOUNDATION_RUNTIME_CLOSURE=PASS"
    Write-Host "FOUNDATION_DOCKER_CONFIG=PASS"
    Write-Host "FOUNDATION_COMPOSE_SERVICES=PASS"
    Write-Host "FOUNDATION_RUNTIME=PASS"
}
finally {
    if ($success -and -not $KeepRunning) {
        Write-Host ""
        Write-Host "=== Stop foundation runtime after successful proof ==="
        $null = Invoke-Compose -Arguments @("down")
        if ($LASTEXITCODE -ne 0) {
            Write-Warning "Runtime proof passed, but compose down returned a non-zero exit code."
        }
    }
    elseif (-not $success) {
        Write-Host ""
        Write-Host "Foundation runtime was left running for diagnosis when possible."
    }

    Pop-Location
}
