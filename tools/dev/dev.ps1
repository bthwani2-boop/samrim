#Requires -Version 7.4
param(
    [Parameter(Position=0)]
    [ValidateSet('daily','up','down','status')]
    [string]$Target='daily'
)

Set-StrictMode -Version Latest
$ErrorActionPreference='Stop'
$PSNativeCommandUseErrorActionPreference=$false

$Root=(Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
$EnvPath=Join-Path $Root 'infra\local\.env'
$ComposePath=Join-Path $Root 'infra\local\compose\compose.yaml'
$Project='samrim-local'
Set-Location $Root

function Fail([string]$Message){throw $Message}

function Compose([string[]]$Arguments){
    & docker compose --ansi never --project-name $Project --env-file $EnvPath -f $ComposePath @Arguments
    if($LASTEXITCODE-ne0){Fail "DOCKER_COMPOSE_FAILED args=$($Arguments-join' ')"}
}

function Read-RunningBackendServices{
    return @(Compose @('ps','--status','running','--services')|ForEach-Object{$_.Trim()}|Where-Object{$_})
}

function Ensure-Backend{
    $required=@('postgres','mailpit','identity','dsh','wlt')
    Compose @('up','-d','--build','--wait','--wait-timeout','300','--remove-orphans')
    $running=@(Read-RunningBackendServices)
    $missing=@($required|Where-Object{$running-notcontains$_})
    if($missing.Count-ne0){Fail "BACKEND_NOT_READY missing=$($missing-join',')"}
}

function Stop-RepositoryHosts{
    foreach($process in @(Get-CimInstance Win32_Process -Filter "Name='node.exe'" -ErrorAction SilentlyContinue)){
        $command=[string]$process.CommandLine
        if($command.Contains($Root,[StringComparison]::OrdinalIgnoreCase)){
            Stop-Process -Id ([int]$process.ProcessId) -Force -ErrorAction SilentlyContinue
        }
    }
}

switch($Target){
    'up'{
        [void](Ensure-Backend)
        Write-Host 'RUNTIME_UP=PASS state=reconciled'
        return
    }
    'down'{
        Stop-RepositoryHosts
        Compose @('down','--remove-orphans')
        Write-Host 'RUNTIME_DOWN=PASS scope=repository-hosts+backend'
        return
    }
    'status'{Compose @('ps','-a');return}
}

[void](Ensure-Backend)
Write-Host "DEV_READY=PASS backend=reconciled surfaces=direct-package-dev root=$Root"
