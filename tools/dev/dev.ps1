#Requires -Version 7.4
param(
    [Parameter(Position = 0)]
    [ValidateSet('daily', 'up', 'down', 'status')]
    [string]$Target = 'daily'
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

switch ($Target) {
    'down' {
        Stop-RepositoryHosts
        Compose @('down', '--remove-orphans')
        Write-Host 'RUNTIME_DOWN=PASS scope=repository-hosts+backend'
    }
    'status' { Compose @('ps', '-a') }
    default {
        # BuildKit owns build-input invalidation; Compose owns image, environment and health reconciliation.
        Compose @('up', '-d', '--build', '--wait', '--wait-timeout', '300', '--remove-orphans')
        Write-Host 'RUNTIME_UP=PASS state=compose-reconciled'
    }
}
