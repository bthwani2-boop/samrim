#Requires -Version 7.4
[CmdletBinding()]
param(
    [string] $ExpectedBranch = "",
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

function Write-Utf8File([string] $Path, [string] $Content) {
    [IO.File]::WriteAllText(
        $Path,
        $Content.TrimEnd() + [Environment]::NewLine,
        [Text.UTF8Encoding]::new($false)
    )
}

function Ensure-LocalEnv {
    if (-not (Test-Path $envExamplePath -PathType Leaf)) {
        Fail "Missing infra/local/compose/.env.example"
    }

    if (-not (Test-Path $envPath -PathType Leaf)) {
        $content = Get-Content $envExamplePath -Raw
        $content = $content.Replace(
            "SAMRIM_POSTGRES_PASSWORD=change-me-local-only",
            "SAMRIM_POSTGRES_PASSWORD=$(New-RandomHex)"
        )
        $content = $content.Replace(
            "SAMRIM_MINIO_ROOT_PASSWORD=change-me-local-only",
            "SAMRIM_MINIO_ROOT_PASSWORD=$(New-RandomHex)"
        )

        Write-Utf8File -Path $envPath -Content $content
        Write-Host "LOCAL_RUNTIME_ENV=CREATED"
        return
    }

}

function Read-EnvMap {
    $map = @{}

    foreach ($line in Get-Content $envPath) {
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

function Invoke-Compose {
    param([string[]] $Arguments)

    $baseArgs = @(
        "compose",
        "--env-file", $envPath,
        "-f", $composeFile,
        "--profile", "integration"
    )

    & docker @baseArgs @Arguments | Out-Host
    $code = $LASTEXITCODE
    return $code
}

function Stop-ExistingIntegrationStack {
    Write-Host ""
    Write-Host "=== Reset previous integration stack ==="
    $code = Invoke-Compose -Arguments @("down", "--remove-orphans")
    if ($code -ne 0) {
        Fail "Unable to stop previous Integration compose stack."
    }
}

function Test-PortBindable([int] $Port) {
    $listener = $null

    try {
        $listener = [Net.Sockets.TcpListener]::new(
            [Net.IPAddress]::Loopback,
            $Port
        )
        $listener.Start()
        return $true
    }
    catch {
        return $false
    }
    finally {
        if ($null -ne $listener) {
            try { $listener.Stop() } catch {}
        }
    }
}

function Get-PortOwnerDescription([int] $Port) {
    try {
        $connections = @(
            Get-NetTCPConnection -LocalAddress "127.0.0.1" -LocalPort $Port -State Listen -ErrorAction SilentlyContinue
        )

        if ($connections.Count -eq 0) {
            $connections = @(
                Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue
            )
        }

        if ($connections.Count -eq 0) {
            return "owner=unknown"
        }

        $owners = @()
        foreach ($connection in $connections) {
            $pidValue = [int] $connection.OwningProcess
            $processName = "unknown"

            try {
                $processName = (Get-Process -Id $pidValue -ErrorAction Stop).ProcessName
            }
            catch {}

            $owners += "pid=$pidValue process=$processName"
        }

        return ($owners | Sort-Object -Unique) -join "; "
    }
    catch {
        return "owner=unknown"
    }
}

function Verify-HostPortsAvailable {
    param([hashtable] $Env)

    $portKeys = @(
        "SAMRIM_POSTGRES_PORT",
        "SAMRIM_MINIO_API_PORT",
        "SAMRIM_MINIO_CONSOLE_PORT",
        "SAMRIM_MAILPIT_SMTP_PORT",
        "SAMRIM_MAILPIT_WEB_PORT",
        "SAMRIM_IDENTITY_PORT",
        "SAMRIM_DSH_PORT",
        "SAMRIM_WLT_PORT"
    )

    $seen = @{}
    $failures = @()

    foreach ($key in $portKeys) {
        if (-not $Env.ContainsKey($key)) {
            $failures += "$key is missing from infra/local/compose/.env"
            continue
        }

        $port = 0
        if (-not [int]::TryParse($Env[$key], [ref] $port)) {
            $failures += "$key is not a valid integer: $($Env[$key])"
            continue
        }

        if ($port -lt 1 -or $port -gt 65535) {
            $failures += "$key is outside valid TCP port range: $port"
            continue
        }

        if ($seen.ContainsKey($port)) {
            $failures += "Duplicate host port ${port}: $($seen[$port]) and $key"
            continue
        }

        $seen[$port] = $key

        if (-not (Test-PortBindable -Port $port)) {
            $owner = Get-PortOwnerDescription -Port $port
            $failures += "Host port 127.0.0.1:${port} is already allocated ($key; $owner)"
        }
    }

    if ($failures.Count -gt 0) {
        Fail ("FOUNDATION_HOST_PORT_PREFLIGHT=FAIL" +
            [Environment]::NewLine +
            ($failures -join [Environment]::NewLine))
    }

    Write-Host "FOUNDATION_HOST_PORT_PREFLIGHT=PASS"
}

function Test-TcpReady([string] $HostName, [int] $Port) {
    $client = [Net.Sockets.TcpClient]::new()

    try {
        $task = $client.ConnectAsync($HostName, $Port)
        if (-not $task.Wait([TimeSpan]::FromSeconds(3))) {
            return $false
        }
        return $client.Connected
    }
    catch {
        return $false
    }
    finally {
        $client.Dispose()
    }
}

function Test-HttpReady([string] $Uri) {
    try {
        $response = Invoke-WebRequest -Uri $Uri -Method Get -TimeoutSec 5
        return $response.StatusCode -ge 200 -and $response.StatusCode -lt 500
    }
    catch {
        return $false
    }
}

function Verify-InfraEndpoints {
    param(
        [hashtable] $Env,
        [int] $Attempts = 45,
        [int] $DelaySeconds = 2
    )

    $checks = @(
        @{
            Name = "postgres-tcp"
            Test = {
                Test-TcpReady -HostName "127.0.0.1" -Port ([int] $Env["SAMRIM_POSTGRES_PORT"])
            }
        },
        @{
            Name = "minio-live"
            Test = {
                Test-HttpReady -Uri "http://127.0.0.1:$($Env["SAMRIM_MINIO_API_PORT"])/minio/health/live"
            }
        },
        @{
            Name = "mailpit-smtp"
            Test = {
                Test-TcpReady -HostName "127.0.0.1" -Port ([int] $Env["SAMRIM_MAILPIT_SMTP_PORT"])
            }
        },
        @{
            Name = "mailpit-web"
            Test = {
                Test-HttpReady -Uri "http://127.0.0.1:$($Env["SAMRIM_MAILPIT_WEB_PORT"])/"
            }
        }
    )

    $pending = [System.Collections.Generic.HashSet[string]]::new()
    $tests = @{}

    foreach ($check in $checks) {
        $null = $pending.Add($check.Name)
        $tests[$check.Name] = $check.Test
    }

    for ($attempt = 1; $attempt -le $Attempts -and $pending.Count -gt 0; $attempt++) {
        foreach ($name in @($pending)) {
            if (& $tests[$name]) {
                Write-Host "PASS infra:$name"
                $null = $pending.Remove($name)
            }
        }

        if ($pending.Count -gt 0 -and $attempt -lt $Attempts) {
            Write-Host "WAIT infra pending=$($pending.Count) attempt=$attempt/$Attempts"
            Start-Sleep -Seconds $DelaySeconds
        }
    }

    if ($pending.Count -gt 0) {
        Fail ("FOUNDATION_INFRA_RUNTIME=FAIL pending=" +
            (($pending | Sort-Object) -join ", "))
    }

    Write-Host "FOUNDATION_INFRA_RUNTIME=PASS"
}

function Show-Diagnostics {
    Write-Host ""
    Write-Host "=== Integration runtime diagnostics ==="

    $baseArgs = @(
        "compose",
        "--env-file", $envPath,
        "-f", $composeFile,
        "--profile", "integration"
    )

    & docker @baseArgs "ps"
    & docker @baseArgs "logs" "--tail" "200" "identity" "dsh" "wlt" "postgres" "minio" "mailpit"
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

    if (-not [string]::IsNullOrWhiteSpace($ExpectedBranch) -and $branch -ne $ExpectedBranch) {
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
    $envMap = Read-EnvMap

    Stop-ExistingIntegrationStack

    Write-Host ""
    Write-Host "=== Integration host port preflight ==="
    Verify-HostPortsAvailable -Env $envMap

    Write-Host ""
    Write-Host "=== Integration compose config ==="
    $null = & docker compose --env-file $envPath -f $composeFile --profile integration config
    if ($LASTEXITCODE -ne 0) {
        Fail "Integration compose config failed."
    }
    Write-Host "FOUNDATION_DOCKER_CONFIG=PASS"

    Write-Host ""
    Write-Host "=== Build and start integration runtime ==="
    $upCode = Invoke-Compose -Arguments @("up", "-d", "--build")
    if ($upCode -ne 0) {
        Show-Diagnostics
        Fail "Integration compose build/up failed."
    }

    Write-Host ""
    Write-Host "=== Verify integration infrastructure ==="
    Verify-InfraEndpoints -Env $envMap -Attempts 60 -DelaySeconds 2

    Write-Host ""
    Write-Host "=== Verify integration service endpoints ==="
    & pwsh -NoProfile -ExecutionPolicy Bypass -File tools/dev/verify-integration-runtime.ps1 -Attempts 60 -DelaySeconds 2

    if ($LASTEXITCODE -ne 0) {
        Show-Diagnostics
        Fail "Integration service endpoint verification failed."
    }

    Write-Host ""
    Write-Host "=== Verify compose service state ==="
    $services = @(
        & docker compose --env-file $envPath -f $composeFile --profile integration ps --status running --services
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
        "dsh",
        "wlt"
    )

    $missing = @($expected | Where-Object { $_ -notin $services })
    if ($missing.Count -gt 0) {
        Show-Diagnostics
        Fail ("Integration services not running: " + ($missing -join ", "))
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
    Write-Host "FOUNDATION_HOST_PORT_PREFLIGHT=PASS"
    Write-Host "FOUNDATION_DOCKER_CONFIG=PASS"
    Write-Host "FOUNDATION_INFRA_RUNTIME=PASS"
    Write-Host "FOUNDATION_COMPOSE_SERVICES=PASS"
    Write-Host "FOUNDATION_RUNTIME=PASS"
}
finally {
    if ($success -and -not $KeepRunning) {
        Write-Host ""
        Write-Host "=== Stop integration runtime after successful proof ==="
        $null = Invoke-Compose -Arguments @("down")
        if ($LASTEXITCODE -ne 0) {
            Write-Warning "Runtime proof passed, but compose down returned a non-zero exit code."
        }
    }
    elseif (-not $success) {
        Write-Host ""
        Write-Host "Integration runtime was left running for diagnosis when possible."
    }

    Pop-Location
}
