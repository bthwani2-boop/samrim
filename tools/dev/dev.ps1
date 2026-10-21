#Requires -Version 7.4
param(
    [Parameter(Position = 0)]
    [ValidateSet('up', 'down', 'status')]
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
        Compose @('down', '--remove-orphans')
        Write-Host 'RUNTIME_DOWN=PASS scope=repository-hosts+backend'
    }
    'status' { Compose @('ps', '-a') }
    default {
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
