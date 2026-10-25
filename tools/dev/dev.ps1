#Requires -Version 7.4
param(
    [Parameter(Position = 0)]
    [ValidateSet('up', 'warm', 'light', 'down', 'status')]
    [string]$Target = 'up'
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$PSNativeCommandUseErrorActionPreference = $false
$Root = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
$EnvPath = Join-Path $Root 'infra\local\.env'
$ComposePath = Join-Path $Root 'infra\local\compose\compose.yaml'
Set-Location $Root

function Compose([string[]]$Arguments) {
    & docker compose --ansi never --project-name samrim-local --env-file $EnvPath -f $ComposePath @Arguments
    if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
}

function Ensure-DockerRunning {
    & docker info --format '{{.ServerVersion}}' *> $null
    if ($LASTEXITCODE -eq 0) { return }
    Write-Host 'DOCKER_DESKTOP_STARTING=on-demand'
    & docker desktop start --timeout 150
    if ($LASTEXITCODE -ne 0) { throw 'Could not start Docker Desktop' }
    $ready = $false
    for ($attempt = 0; $attempt -lt 45; $attempt++) {
        & docker info --format '{{.ServerVersion}}' *> $null
        if ($LASTEXITCODE -eq 0) { $ready = $true; break }
        Start-Sleep -Seconds 2
    }
    if (-not $ready) { throw 'Docker Desktop engine did not become ready' }
}

function Stop-RepositoryHosts {
    $appsRoot = [regex]::Escape((Join-Path $Root 'apps'))
    $entrypoints = @(
        "(?i)$appsRoot[\\/]app-(?:client|partner|captain|field)[\\/]node_modules[\\/]expo[\\/]bin[\\/]cli(?:\.js)?\s+start(?:\s|$)",
        "(?i)$appsRoot[\\/]control-panel[\\/]node_modules[\\/]next[\\/]dist[\\/]bin[\\/]next(?:\.js)?\s+dev(?:\s|$)"
    )
    $processes = @(Get-CimInstance Win32_Process -Filter "Name='node.exe'" | Where-Object {
        $command = [string]$_.CommandLine
        $command -and (@($entrypoints | Where-Object { [regex]::IsMatch($command, $_) }).Count -gt 0)
    })
    foreach ($process in $processes) {
        $processId = [int]$process.ProcessId
        & taskkill.exe /PID $processId /T /F
        if ($LASTEXITCODE -ne 0) {
            if (Get-CimInstance Win32_Process -Filter "ProcessId = $processId") {
                throw "LOCAL_SURFACE_STOP_FAILED process_id=$processId"
            }
        }
    }
}

function Ensure-DatabaseRuntimePasswords {
    if (-not (Test-Path -LiteralPath $EnvPath)) { throw "Missing ignored local configuration: $EnvPath" }
    $content = [System.IO.File]::ReadAllText($EnvPath)
    $changed = $false
    foreach ($key in @('SAMRIM_IDENTITY_DB_PASSWORD', 'SAMRIM_IDENTITY_MAINTENANCE_DB_PASSWORD', 'SAMRIM_DSH_DB_PASSWORD', 'SAMRIM_WLT_DB_PASSWORD')) {
        $match = [regex]::Match($content, "(?m)^$([regex]::Escape($key))=(.*)$")
        if ($match.Success -and -not [string]::IsNullOrWhiteSpace($match.Groups[1].Value)) { continue }
        if ($match.Success) { throw "Empty existing local database credential: $key" }
        $bytes = [byte[]]::new(32)
        $rng = [Security.Cryptography.RandomNumberGenerator]::Create()
        try { $rng.GetBytes($bytes) } finally { $rng.Dispose() }
        $password = [Convert]::ToHexString($bytes).ToLowerInvariant()
        $content += "`n$key=$password`n"
        $changed = $true
    }
    if ($changed) { [System.IO.File]::WriteAllText($EnvPath, $content, [System.Text.UTF8Encoding]::new($false)) }
}

switch ($Target) {
    'down' {
        Stop-RepositoryHosts
        & docker info --format '{{.ServerVersion}}' *> $null
        if ($LASTEXITCODE -ne 0) { Write-Host 'RUNTIME_DOWN=PASS already-stopped'; break }
        Compose @('down', '--remove-orphans')
        Write-Host 'RUNTIME_DOWN=PASS scope=repository-hosts+backend'
    }
    'light' {
        & docker info --format '{{.ServerVersion}}' *> $null
        if ($LASTEXITCODE -ne 0) { Write-Host 'RUNTIME_LIGHT=PASS engine-already-stopped'; break }
        $outside = @(& docker ps --format '{{.Names}}' | Where-Object { $_ -notlike 'samrim-local-*' })
        Compose @('stop', '--timeout', '20')
        if ($outside.Count -gt 0) {
            Write-Host "RUNTIME_LIGHT=PARTIAL other-containers-running=$($outside.Count); Docker Desktop left running"
        } else {
            # Prevent test-volume and stale-cache accumulation when leaving development.
            $activeBuild = @(Get-CimInstance Win32_Process | Where-Object {
                $_.Name -match '^(docker|node|pwsh|powershell)\.exe$' -and
                $_.CommandLine -match '(?i)docker (build|buildx|compose.+build)|buildx build'
            })
            if ($activeBuild.Count -eq 0) {
                & pwsh -NoProfile -File (Join-Path $PSScriptRoot 'clean-docker-anonymous.ps1') -Apply
                & docker buildx prune --all --filter 'until=168h' --force *> $null
                Write-Host 'DOCKER_OLD_CACHE=pruned-7d'
            } else {
                Write-Host 'DOCKER_OLD_CACHE=skipped-active-build'
            }
            & docker desktop stop --timeout 120
            if ($LASTEXITCODE -ne 0) { throw 'Docker Desktop could not be stopped safely' }
            # Reclaim the remaining WSL VM memory only when Docker owns the sole distro.
            $distros = @(& wsl --list --quiet 2>$null | ForEach-Object { ($_ -replace [char]0, '').Trim() } | Where-Object { $_ })
            if ($distros.Count -eq 1 -and $distros[0] -eq 'docker-desktop') {
                & wsl --shutdown
                Write-Host 'WSL_IDLE_MEMORY=released'
            }
            Write-Host 'RUNTIME_LIGHT=PASS Docker Desktop stopped; volumes and images retained'
        }
    }
    'status' {
        & docker info --format '{{.ServerVersion}}' *> $null
        if ($LASTEXITCODE -ne 0) { Write-Host 'RUNTIME_STATUS=Docker Desktop stopped'; break }
        Compose @('ps', '-a')
    }
    'warm' {
        Ensure-DockerRunning
        Ensure-DatabaseRuntimePasswords
        # Warm start is only valid after initial migrations/bootstrap have completed.
        foreach ($job in @('identity-migrate', 'identity-bootstrap', 'dsh-migrate', 'wlt-migrate', 'postgres-access')) {
            $id = "samrim-local-$job-1"
            $state = & docker inspect $id --format '{{.State.Status}}:{{.State.ExitCode}}' 2>$null
            if ($LASTEXITCODE -ne 0 -or "$state" -ne 'exited:0') {
                throw "Warm mode requires completed setup ($job). Use pnpm dev for full setup and rebuild."
            }
        }
        # Preserve completed one-shot jobs: never rerun migrations merely to resume development.
        Compose @('up', '-d', '--no-build', '--no-deps', '--wait', '--wait-timeout', '120', 'postgres', 'media', 'mailpit', 'payment-mock')
        Compose @('up', '-d', '--no-build', '--no-deps', '--wait', '--wait-timeout', '120', 'identity', 'wlt')
        Compose @('up', '-d', '--no-build', '--no-deps', '--wait', '--wait-timeout', '120', 'dsh')
        Write-Host 'RUNTIME_WARM=PASS existing-images-reused one-shot-jobs-untouched'
    }
    default {
        Ensure-DockerRunning
        Ensure-DatabaseRuntimePasswords
        # A Git SHA labels the built source only when the working tree is clean.
        $sourceRevision = (& git -C $Root rev-parse --verify HEAD).Trim()
        if ($LASTEXITCODE -ne 0 -or $sourceRevision -notmatch '^[0-9a-f]{40}$') {
            throw 'Cannot resolve the source revision for local runtime build'
        }
        $dirtyPaths = @(& git -C $Root status --porcelain=v1)
        if ($LASTEXITCODE -ne 0) { throw 'Cannot check working-tree provenance' }
        $env:SAMRIM_SOURCE_REVISION = if ($dirtyPaths.Count -eq 0) { $sourceRevision } else { 'unverified' }
        # BuildKit owns build-input invalidation; Compose owns image, environment and health reconciliation.
        Compose @('up', '-d', '--build', '--wait', '--wait-timeout', '300', '--remove-orphans')
        Write-Host 'RUNTIME_UP=PASS state=compose-reconciled'
    }
}
