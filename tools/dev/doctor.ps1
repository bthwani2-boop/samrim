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
$composePath = Join-Path $repo "infra\local\compose\compose.yaml"
$ensureLocalEnvPath = Join-Path $PSScriptRoot "ensure-local-env.ps1"
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
        if (-not $trimmed -or $trimmed.StartsWith("#")) {
            continue
        }

        $parts = $trimmed.Split("=", 2)
        if ($parts.Count -ne 2) {
            throw "Malformed environment line in ${Path}: $line"
        }

        $name = $parts[0].Trim()
        $value = $parts[1].Trim()
        if ($map.ContainsKey($name)) {
            throw "Duplicate environment key '$name' in ${Path}."
        }

        $map[$name] = $value
    }

    return $map
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
        "tools/dev/ensure-local-env.ps1"
    )) {
        Check $file { Test-Path $file } { param($v) $v -eq $true }
    }

    Check "local runtime env reconciliation" {
        & $ensureLocalEnvPath
        if ($LASTEXITCODE -ne 0) {
            throw "ensure-local-env failed."
        }
        "canonical"
    } { param($v) $v -eq "canonical" }

    Check "control-panel origin coherence" {
        $template = Read-EnvMap -Path $envExamplePath
        $actual = Read-EnvMap -Path $envPath
        $expected = [string]$template["CONTROL_PANEL_PUBLIC_ORIGIN"]
        $observed = [string]$actual["CONTROL_PANEL_PUBLIC_ORIGIN"]
        $uri = [Uri]::new($expected, [UriKind]::Absolute)
        ($observed -eq $expected -and $uri.Scheme -eq "http" -and $uri.Host -eq "127.0.0.1")
    } { param($v) $v -eq $true }

    Check "identity CORS coherence" {
        $template = Read-EnvMap -Path $envExamplePath
        $actual = Read-EnvMap -Path $envPath
        $expectedOrigin = [string]$template["CONTROL_PANEL_PUBLIC_ORIGIN"]
        $expectedCors = [string]$template["IDENTITY_CORS_ALLOWED_ORIGINS"]
        $observedCors = [string]$actual["IDENTITY_CORS_ALLOWED_ORIGINS"]
        ($expectedCors -eq $expectedOrigin -and $observedCors -eq $expectedCors)
    } { param($v) $v -eq $true }

    Check "Docker domain-service residue" {
        $rows = @(
            docker compose `
                --env-file $envPath `
                -f $composePath `
                --profile integration `
                ps --status running --services identity dsh
        )
        if ($LASTEXITCODE -ne 0) {
            throw "Unable to census integration-profile domain services."
        }

        $running = @(
            $rows |
                ForEach-Object { $_.Trim() } |
                Where-Object { $_ } |
                Sort-Object -Unique
        )

        if ($running.Count -eq 0) {
            "0"
        }
        else {
            $running -join ","
        }
    } { param($v) $v -eq "0" }

    if (Test-Path "node_modules") {
        Check "TypeScript" { pnpm exec tsc --version } { param($v) $v -match "6\.0\.2" }
        Check "Nx" { pnpm exec nx --version } { param($v) $v -match "23\.2\.0" }
    }

    if ($failures.Count -gt 0) {
        exit 1
    }

    Write-Host "Doctor PASS" -ForegroundColor Green
}
finally {
    Pop-Location
}
