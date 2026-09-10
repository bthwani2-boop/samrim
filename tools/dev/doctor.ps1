#Requires -Version 7.4
[CmdletBinding()]
param(
    [string]$ExpectedBranch = '',
    [switch]$SkipBranchCheck
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$repo = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
$envPath = Join-Path $repo 'infra\local\compose\.env'
$envExamplePath = Join-Path $repo 'infra\local\compose\.env.example'
$composePath = Join-Path $repo 'infra\local\compose\compose.yaml'
$ensureLocalEnvPath = Join-Path $PSScriptRoot 'ensure-local-env.ps1'
$ownershipVerifier = Join-Path $PSScriptRoot 'verify-local-runtime-ownership.mjs'
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
        if (-not $trimmed -or $trimmed.StartsWith('#')) { continue }
        $parts = $trimmed.Split('=', 2)
        if ($parts.Count -ne 2) { throw "Malformed environment line in ${Path}: $line" }
        $name = $parts[0].Trim()
        if ($map.ContainsKey($name)) { throw "Duplicate environment key '$name' in ${Path}." }
        $map[$name] = $parts[1].Trim()
    }
    return $map
}

Push-Location $repo
try {
    if (-not $SkipBranchCheck -and -not [string]::IsNullOrWhiteSpace($ExpectedBranch)) {
        Check 'branch' { git branch --show-current } { param($v) $v.Trim() -eq $ExpectedBranch }
    }

    Check 'node' { node --version } { param($v) ($v.Trim() -replace '^v', '') -eq '24.17.0' }
    Check 'pnpm' { pnpm --version } { param($v) $v.Trim() -eq '10.34.0' }
    Check 'go' { go version } { param($v) $v -match 'go1\.27\.1\b' }
    Check 'docker' { docker info --format '{{.ServerVersion}}' } { param($v) -not [string]::IsNullOrWhiteSpace($v) }

    foreach ($file in @(
        'package.json',
        'pnpm-workspace.yaml',
        'nx.json',
        'tsconfig.base.json',
        'go.work',
        'infra/local/compose/.env.example',
        'infra/local/compose/compose.yaml',
        'tools/dev/ensure-local-env.ps1',
        'tools/dev/runtime.ps1',
        'tools/dev/verify-local-runtime-ownership.mjs'
    )) {
        Check $file { Test-Path $file } { param($v) $v -eq $true }
    }

    Check 'parallel compose file absent' {
        Test-Path 'infra/local/compose/compose.integration.yaml'
    } { param($v) $v -eq $false }

    Check 'local runtime env reconciliation' {
        & $ensureLocalEnvPath
        if ($LASTEXITCODE -ne 0) { throw 'ensure-local-env failed.' }
        'canonical'
    } { param($v) $v -eq 'canonical' }

    $template = Read-EnvMap -Path $envExamplePath
    $actual = Read-EnvMap -Path $envPath
    $secretKeys = @(
        'SAMRIM_POSTGRES_PASSWORD',
        'IDENTITY_CHALLENGE_HMAC_SECRET',
        'IDENTITY_DSH_SERVICE_TOKEN',
        'IDENTITY_PLATFORM_CONTROL_SERVICE_TOKEN',
        'DSH_PLATFORM_CONTROL_SERVICE_TOKEN',
        'IDENTITY_ABUSE_HMAC_SECRET',
        'IDENTITY_PLATFORM_BOOTSTRAP_SECRET'
    )

    Check 'local env key parity' {
        $expected = @($template.Keys | Sort-Object)
        $observed = @($actual.Keys | Sort-Object)
        (($expected -join "`n") -eq ($observed -join "`n"))
    } { param($v) $v -eq $true }

    Check 'local non-secret value parity' {
        $drift = @(
            $template.Keys |
                Where-Object { $_ -notin $secretKeys } |
                Where-Object { [string]$actual[$_] -ne [string]$template[$_] }
        )
        $drift.Count
    } { param($v) $v -eq 0 }

    Check 'obsolete host-only infra ports removed' {
        @('SAMRIM_POSTGRES_PORT', 'SAMRIM_MAILPIT_SMTP_PORT', 'SAMRIM_IDENTITY_BIND_HOST') |
            Where-Object { $template.ContainsKey($_) } |
            Measure-Object |
            Select-Object -ExpandProperty Count
    } { param($v) $v -eq 0 }

    Check 'control-panel origin coherence' {
        $expected = [string]$template['CONTROL_PANEL_PUBLIC_ORIGIN']
        $uri = [Uri]::new($expected, [UriKind]::Absolute)
        (
            [string]$actual['CONTROL_PANEL_PUBLIC_ORIGIN'] -eq $expected -and
            $uri.Scheme -eq 'http' -and
            $uri.Host -eq '127.0.0.1' -and
            -not $uri.IsDefaultPort -and
            $uri.AbsolutePath -eq '/'
        )
    } { param($v) $v -eq $true }

    Check 'identity CORS coherence' {
        ([string]$template['IDENTITY_CORS_ALLOWED_ORIGINS'] -eq [string]$template['CONTROL_PANEL_PUBLIC_ORIGIN'] -and [string]$actual['IDENTITY_CORS_ALLOWED_ORIGINS'] -eq [string]$template['CONTROL_PANEL_PUBLIC_ORIGIN'])
    } { param($v) $v -eq $true }

    Check 'canonical compose identity and services' {
        $body = Get-Content -LiteralPath $composePath -Raw
        $expectedServices = @('postgres', 'mailpit', 'identity-migrate', 'identity', 'dsh-migrate', 'dsh')
        $missing = @($expectedServices | Where-Object { $body -notmatch "(?m)^  $([regex]::Escape($_)):\s*$" })
        ($body -match '(?m)^name:\s*samrim-local\s*$' -and $missing.Count -eq 0 -and $body -notmatch '(?m)^profiles:\s*$')
    } { param($v) $v -eq $true }

    Check 'canonical compose config' {
        docker compose --project-name samrim-local --env-file $envPath -f $composePath config --quiet
        $LASTEXITCODE
    } { param($v) $v -eq 0 }

    Check 'runtime ownership verifier' {
        & node $ownershipVerifier
        $LASTEXITCODE
    } { param($v) $v -eq 0 }

    if (Test-Path 'node_modules') {
        Check 'TypeScript' { pnpm exec tsc --version } { param($v) $v -match '6\.0\.2' }
        Check 'Nx' { pnpm exec nx --version } { param($v) $v -match '23\.2\.0' }
    }

    if ($failures.Count -gt 0) { exit 1 }

    Write-Host 'DEVELOPER_PREREQUISITES=PASS'
    Write-Host 'CANONICAL_LOCAL_COMPOSE_FILES=1'
    Write-Host 'STATIC_RUNTIME_OWNERSHIP=PASS'
    Write-Host 'Doctor PASS' -ForegroundColor Green
}
finally {
    Pop-Location
}
