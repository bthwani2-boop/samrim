#Requires -Version 7.4
[CmdletBinding()]
param(
    [string]$ExpectedBranch = "",
    [switch]$SkipBranchCheck
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$repo = (Resolve-Path (Join-Path $PSScriptRoot "..\..")).Path
$envPath = Join-Path $repo "infra\local\compose\.env"
$envExamplePath = Join-Path $repo "infra\local\compose\.env.example"
$dailyComposePath = Join-Path $repo "infra\local\compose\compose.yaml"
$integrationComposePath = Join-Path $repo "infra\local\compose\compose.integration.yaml"
$ensureLocalEnvPath = Join-Path $PSScriptRoot "ensure-local-env.ps1"
$dailyProject = "samrim-local"
$integrationProject = "samrim-integration"
$failures = [System.Collections.Generic.List[string]]::new()

function Check([string]$Name, [scriptblock]$Probe, [scriptblock]$Accept) {
    try {
        $value = & $Probe
        if (& $Accept $value) {
            Write-Host "[PASS] $Name : $value" -ForegroundColor Green
        }
        else {
            Write-Host "[FAIL] $Name : $value" -ForegroundColor Red
            $failures.Add($Name)
        }
    }
    catch {
        Write-Host "[FAIL] $Name : $($_.Exception.Message)" -ForegroundColor Red
        $failures.Add($Name)
    }
}

function Read-EnvMap([string]$Path) {
    $map = @{}
    foreach ($line in Get-Content -LiteralPath $Path) {
        $trimmed = $line.Trim()
        if (-not $trimmed -or $trimmed.StartsWith("#")) { continue }
        $parts = $trimmed.Split("=", 2)
        if ($parts.Count -ne 2) { throw "Malformed environment line in ${Path}: $line" }
        $name = $parts[0].Trim()
        if ($map.ContainsKey($name)) { throw "Duplicate environment key '$name' in ${Path}." }
        $map[$name] = $parts[1].Trim()
    }
    return $map
}

function Get-ProjectServices([string]$Project) {
    return @(
        & docker ps -a `
            --filter "label=com.docker.compose.project=$Project" `
            --format '{{.Label "com.docker.compose.service"}}' |
            ForEach-Object { $_.Trim() } |
            Where-Object { $_ } |
            Sort-Object -Unique
    )
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

Push-Location $repo
try {
    if (-not $SkipBranchCheck -and -not [string]::IsNullOrWhiteSpace($ExpectedBranch)) {
        Check "branch" { git branch --show-current } { param($v) $v.Trim() -eq $ExpectedBranch }
    }

    Check "node" { node --version } { param($v) ($v.Trim() -replace "^v", "") -eq "24.17.0" }
    Check "pnpm" { pnpm --version } { param($v) $v.Trim() -eq "10.34.0" }
    Check "go" { go version } { param($v) $v -match "go1\.27\.1\b" }
    Check "docker" { docker info --format "{{.ServerVersion}}" } { param($v) -not [string]::IsNullOrWhiteSpace($v) }

    foreach ($file in @(
        "package.json",
        "pnpm-workspace.yaml",
        "nx.json",
        "tsconfig.base.json",
        "go.work",
        "infra/local/compose/.env.example",
        "infra/local/compose/compose.yaml",
        "infra/local/compose/compose.integration.yaml",
        "tools/dev/ensure-local-env.ps1",
        "tools/dev/runtime.ps1"
    )) {
        Check $file { Test-Path $file } { param($v) $v -eq $true }
    }

    Check "local runtime env reconciliation" {
        & $ensureLocalEnvPath
        if ($LASTEXITCODE -ne 0) { throw "ensure-local-env failed." }
        "canonical"
    } { param($v) $v -eq "canonical" }

    $template = Read-EnvMap -Path $envExamplePath
    $actual = Read-EnvMap -Path $envPath
    $secretKeys = @(
        "SAMRIM_POSTGRES_PASSWORD",
        "IDENTITY_CHALLENGE_HMAC_SECRET",
        "IDENTITY_DSH_SERVICE_TOKEN",
        "IDENTITY_PLATFORM_CONTROL_SERVICE_TOKEN",
        "DSH_PLATFORM_CONTROL_SERVICE_TOKEN",
        "IDENTITY_ABUSE_HMAC_SECRET",
        "IDENTITY_PLATFORM_BOOTSTRAP_SECRET"
    )

    Check "local env key parity" {
        $expected = @($template.Keys | Sort-Object)
        $observed = @($actual.Keys | Sort-Object)
        (($expected -join "`n") -eq ($observed -join "`n"))
    } { param($v) $v -eq $true }

    Check "local non-secret value parity" {
        $drift = @(
            $template.Keys |
                Where-Object { $_ -notin $secretKeys } |
                Where-Object { [string]$actual[$_] -ne [string]$template[$_] }
        )
        $drift.Count
    } { param($v) $v -eq 0 }

    Check "control-panel origin coherence" {
        $expected = [string]$template["CONTROL_PANEL_PUBLIC_ORIGIN"]
        $uri = [Uri]::new($expected, [UriKind]::Absolute)
        (
            [string]$actual["CONTROL_PANEL_PUBLIC_ORIGIN"] -eq $expected -and
            $uri.Scheme -eq "http" -and
            $uri.Host -eq "127.0.0.1" -and
            -not $uri.IsDefaultPort -and
            $uri.AbsolutePath -eq "/"
        )
    } { param($v) $v -eq $true }

    Check "identity CORS coherence" {
        ([string]$template["IDENTITY_CORS_ALLOWED_ORIGINS"] -eq [string]$template["CONTROL_PANEL_PUBLIC_ORIGIN"] -and [string]$actual["IDENTITY_CORS_ALLOWED_ORIGINS"] -eq [string]$template["CONTROL_PANEL_PUBLIC_ORIGIN"])
    } { param($v) $v -eq $true }

    Check "daily compose identity" {
        $body = Get-Content -LiteralPath $dailyComposePath -Raw
        ($body -match "(?m)^name:\s*samrim-local\s*$" -and $body -notmatch "(?m)^\s{2}(identity|identity-migrate|dsh):\s*$")
    } { param($v) $v -eq $true }

    Check "integration compose identity" {
        $body = Get-Content -LiteralPath $integrationComposePath -Raw
        ($body -match "(?m)^name:\s*samrim-integration\s*$" -and $body -match "samrim-integration-postgres-data" -and $body -notmatch "samrim-postgres-data:/var/lib/postgresql/data")
    } { param($v) $v -eq $true }

    Check "daily compose config" {
        & docker compose --project-name $dailyProject --env-file $envPath -f $dailyComposePath config --quiet
        $LASTEXITCODE
    } { param($v) $v -eq 0 }

    Check "integration compose config" {
        & docker compose --project-name $integrationProject --env-file $envPath -f $integrationComposePath config --quiet
        $LASTEXITCODE
    } { param($v) $v -eq 0 }

    Check "daily Docker service ownership" {
        $services = @(Get-ProjectServices -Project $dailyProject)
        $unexpected = @($services | Where-Object { $_ -notin @("postgres", "mailpit") })
        if ($unexpected.Count -eq 0) { "0" } else { $unexpected -join "," }
    } { param($v) $v -eq "0" }

    Check "integration container residue" {
        @(Get-ProjectContainers -Project $integrationProject).Count
    } { param($v) $v -eq 0 }

    Check "integration volume residue" {
        @(Get-ProjectVolumes -Project $integrationProject).Count
    } { param($v) $v -eq 0 }

    if (Test-Path "node_modules") {
        Check "TypeScript" { pnpm exec tsc --version } { param($v) $v -match "6\.0\.2" }
        Check "Nx" { pnpm exec nx --version } { param($v) $v -match "23\.2\.0" }
    }

    if ($failures.Count -gt 0) { exit 1 }

    Write-Host "UNKNOWN_LOCAL_CONFIG_KEYS=0"
    Write-Host "DAILY_INTEGRATION_STATE_SHARING=0"
    Write-Host "INTEGRATION_RUNTIME_RESIDUE=0"
    Write-Host "Doctor PASS" -ForegroundColor Green
}
finally {
    Pop-Location
}
