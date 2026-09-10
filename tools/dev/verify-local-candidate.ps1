#Requires -Version 7.4
[CmdletBinding()]
param(
    [string]$ExpectedBranch = "",
    [switch]$SkipFetch,
    [switch]$SkipRuntime
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$repo = (Resolve-Path (Join-Path $PSScriptRoot "..\..")).Path
$envPath = Join-Path $repo "infra\local\compose\.env"
$dailyCompose = Join-Path $repo "infra\local\compose\compose.yaml"
$integrationCompose = Join-Path $repo "infra\local\compose\compose.integration.yaml"
$dailyProject = "samrim-local"
$integrationProject = "samrim-integration"
$dailyStarted = $false

function Fail([string]$Message) {
    throw $Message
}

function Run-Step([string]$Name, [scriptblock]$Action) {
    Write-Host ""
    Write-Host "=== $Name ==="
    $global:LASTEXITCODE = 0
    & $Action
    if ($LASTEXITCODE -ne 0) { Fail "$Name failed with exit code $LASTEXITCODE" }
}

function Assert-CleanTree([string]$Context) {
    $status = @(& git status --porcelain --untracked-files=all)
    if ($LASTEXITCODE -ne 0) { Fail "Unable to inspect Git status during $Context." }
    if ($status.Count -gt 0) {
        Fail ("Repository must remain clean during ${Context}:" + [Environment]::NewLine + ($status -join [Environment]::NewLine))
    }
}

function Read-EnvMap([string]$Path) {
    $map = @{}
    foreach ($line in Get-Content -LiteralPath $Path) {
        $trimmed = $line.Trim()
        if (-not $trimmed -or $trimmed.StartsWith("#")) { continue }
        $parts = $trimmed.Split("=", 2)
        if ($parts.Count -ne 2) { Fail "Malformed environment line: $line" }
        $name = $parts[0].Trim()
        if ($map.ContainsKey($name)) { Fail "Duplicate environment key: $name" }
        $map[$name] = $parts[1].Trim()
    }
    return $map
}

function Get-ProjectServices([string]$Project, [switch]$RunningOnly) {
    $args = @("ps")
    if (-not $RunningOnly) { $args += "-a" }
    $args += @(
        "--filter", "label=com.docker.compose.project=$Project",
        "--format", '{{.Label "com.docker.compose.service"}}'
    )
    return @(& docker @args | ForEach-Object { $_.Trim() } | Where-Object { $_ } | Sort-Object -Unique)
}

function Get-ProjectContainers([string]$Project) {
    return @(
        & docker ps -a `
            --filter "label=com.docker.compose.project=$Project" `
            --format '{{.ID}}' |
            ForEach-Object { $_.Trim() } |
            Where-Object { $_ }
    )
}

function Get-ProjectVolumes([string]$Project) {
    return @(
        & docker volume ls `
            --filter "label=com.docker.compose.project=$Project" `
            --format '{{.Name}}' |
            ForEach-Object { $_.Trim() } |
            Where-Object { $_ }
    )
}

function Assert-IntegrationZero {
    $containers = @(Get-ProjectContainers -Project $integrationProject)
    $volumes = @(Get-ProjectVolumes -Project $integrationProject)
    if ($containers.Count -gt 0 -or $volumes.Count -gt 0) {
        Fail "INTEGRATION_RUNTIME_RESIDUE=FAIL containers=$($containers.Count) volumes=$($volumes.Count)"
    }
    Write-Host "INTEGRATION_RUNTIME_RESIDUE=0"
}

function Assert-DailyOwnership([switch]$ExpectRunning) {
    $services = @(Get-ProjectServices -Project $dailyProject -RunningOnly:$ExpectRunning)
    $unexpected = @($services | Where-Object { $_ -notin @("postgres", "mailpit") })
    if ($unexpected.Count -gt 0) { Fail "DAILY_DEV ownership violation: $($unexpected -join ',')" }
    if ($ExpectRunning) {
        $expected = @("mailpit", "postgres")
        if (($services -join ",") -ne ($expected -join ",")) {
            Fail "DAILY_DEV service census mismatch: running=$($services -join ',')"
        }
    }
    Write-Host "DAILY_RUNTIME_DOCKER_DOMAIN_SERVICES=0"
}

Push-Location $repo
try {
    $branch = (& git branch --show-current).Trim()
    if ($LASTEXITCODE -ne 0 -or [string]::IsNullOrWhiteSpace($branch)) { Fail "Unable to determine current Git branch." }
    $verificationBranch = if ([string]::IsNullOrWhiteSpace($ExpectedBranch)) { $branch } else { $ExpectedBranch }
    if (-not [string]::IsNullOrWhiteSpace($ExpectedBranch) -and $branch -ne $ExpectedBranch) {
        Fail "Expected branch '$ExpectedBranch', found '$branch'."
    }

    Assert-CleanTree "candidate start"

    if (-not $SkipFetch) {
        Run-Step "Fetch exact remote candidate" { git fetch origin $verificationBranch --prune }
        $localHead = (& git rev-parse HEAD).Trim()
        $remoteHead = (& git rev-parse ("origin/" + $verificationBranch)).Trim()
        if ($localHead -ne $remoteHead) { Fail "Exact candidate HEAD mismatch: local=$localHead remote=$remoteHead" }
        Write-Host "EXACT_HEAD_SHA=$localHead"
    }

    if ((& node --version).Trim() -ne "v24.17.0") { Fail "Node version mismatch." }
    if ((& pnpm --version).Trim() -ne "10.34.0") { Fail "pnpm version mismatch." }
    if ((& go version | Out-String).Trim() -notmatch "\bgo1\.27\.1\b") { Fail "Go version mismatch." }
    & docker version *> $null
    if ($LASTEXITCODE -ne 0) { Fail "Docker is unavailable." }

    Run-Step "Repository structure" { node tools/dev/verify-repository-structure.mjs }
    Run-Step "Structural hygiene" { node tools/dev/verify-structural-hygiene.mjs }
    Run-Step "Runtime ownership" { node tools/dev/verify-local-runtime-ownership.mjs }
    Run-Step "Theme authority" { pnpm run theme:verify }
    Run-Step "Docs parity" { pnpm run docs:verify:all }
    Run-Step "Knowledge invariants" { pnpm run knowledge:verify:all }
    Run-Step "PowerShell syntax" { pwsh -NoProfile -ExecutionPolicy Bypass -File tools/dev/verify-powershell-syntax.ps1 }
    Run-Step "Frozen workspace install" { pnpm install --frozen-lockfile }
    Run-Step "Mobile deployable identities" { pnpm run mobile:verify-config }
    Run-Step "Workspace dependency references" { node tools/dev/verify-workspace-dependencies.mjs }
    Run-Step "Nx project tags" { pnpm run nx:verify-tags }
    Run-Step "Developer doctor" { pwsh -NoProfile -ExecutionPolicy Bypass -File tools/dev/doctor.ps1 -ExpectedBranch $verificationBranch }
    Run-Step "Developer bootstrap" { pwsh -NoProfile -ExecutionPolicy Bypass -File tools/dev/bootstrap.ps1 }
    Assert-CleanTree "developer bootstrap"
    Run-Step "Workspace verification" { pnpm run workspace:verify }

    Run-Step "Daily compose config" {
        docker compose --project-name $dailyProject --env-file infra/local/compose/.env.example -f $dailyCompose config --quiet
    }
    Run-Step "Integration compose config" {
        docker compose --project-name $integrationProject --env-file infra/local/compose/.env.example -f $integrationCompose config --quiet
    }

    if (-not $SkipRuntime) {
        Assert-IntegrationZero

        try {
            pnpm runtime:daily:up
            if ($LASTEXITCODE -ne 0) { Fail "runtime:daily:up failed." }
            $dailyStarted = $true

            Assert-DailyOwnership -ExpectRunning
            $envMap = Read-EnvMap -Path $envPath
            $postgresId = @(
                & docker ps `
                    --filter "label=com.docker.compose.project=$dailyProject" `
                    --filter "label=com.docker.compose.service=postgres" `
                    --format '{{.ID}}' |
                    ForEach-Object { $_.Trim() } |
                    Where-Object { $_ }
            )
            if ($postgresId.Count -ne 1) { Fail "Unable to resolve exactly one DAILY_DEV PostgreSQL container." }
            $health = (& docker inspect --format '{{.State.Health.Status}}' $postgresId[0]).Trim()
            if ($health -ne "healthy") { Fail "DAILY_DEV PostgreSQL is not healthy: $health" }

            $mailpitPort = [int]$envMap["SAMRIM_MAILPIT_WEB_PORT"]
            $mailpit = Invoke-WebRequest -Uri "http://127.0.0.1:$mailpitPort/" -Method Get -TimeoutSec 5 -SkipHttpErrorCheck
            if ($mailpit.StatusCode -lt 200 -or $mailpit.StatusCode -ge 500) { Fail "DAILY_DEV Mailpit is not reachable." }

            pnpm runtime:status
            if ($LASTEXITCODE -ne 0) { Fail "runtime:status failed." }

            Write-Host "DAILY_DEV_RUNTIME=PASS"
        }
        finally {
            if ($dailyStarted) {
                pnpm runtime:daily:down
                if ($LASTEXITCODE -ne 0) { Fail "runtime:daily:down failed." }
                $dailyStarted = $false
            }
        }

        if (@(Get-ProjectContainers -Project $dailyProject).Count -gt 0) {
            Fail "DAILY_DEV containers remain after runtime:daily:down."
        }

        Run-Step "Canonical integration proof" { pnpm runtime:integration:close }
        Assert-IntegrationZero

        Write-Host "DAILY_INTEGRATION_STATE_SHARING=0"
        Write-Host "LOCAL_CANDIDATE_RUNTIME=PASS"
    }

    Assert-CleanTree "candidate completion"
    Write-Host "LOCAL_CANDIDATE_WORKSPACE=PASS"
    Write-Host "LOCAL_CANDIDATE_WINDOWS_PROOF=PASS"
}
finally {
    if ($dailyStarted) {
        try { pnpm runtime:daily:down *> $null } catch {}
    }
    Pop-Location
}
