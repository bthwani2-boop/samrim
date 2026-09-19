#Requires -Version 7.4
[CmdletBinding()]
param(
    [Parameter(Mandatory)]
    [ValidateSet('Up','Down','Status','Logs','Doctor','Reset','Rebuild')]
    [string]$Action,
    [string]$Service = '',
    [switch]$AllowDataLoss
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$PSNativeCommandUseErrorActionPreference = $false

$RepoRoot=(Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
$ComposePath=Join-Path $RepoRoot 'infra\local\compose\compose.yaml'
$EnvPath=Join-Path $RepoRoot 'infra\local\.env'
$EnvExamplePath=Join-Path $RepoRoot 'infra\local\.env.example'
$Project='samrim-local'

function Fail([string]$Message) { throw $Message }

function New-RandomHex([int]$Bytes=32) {
    return [Convert]::ToHexString([Security.Cryptography.RandomNumberGenerator]::GetBytes($Bytes)).ToLowerInvariant()
}

function Read-EnvMap {
    if (-not (Test-Path -LiteralPath $EnvPath -PathType Leaf)) { Fail 'LOCAL_RUNTIME_ENV=NOT_READY run=pnpm_runtime:up' }
    $map=@{}
    foreach ($line in Get-Content -LiteralPath $EnvPath) {
        $trim=$line.Trim()
        if (-not $trim -or $trim.StartsWith('#')) { continue }
        $parts=$trim.Split('=',2)
        if ($parts.Count -ne 2 -or [string]::IsNullOrWhiteSpace($parts[0])) { Fail "Malformed environment line: $line" }
        $name=$parts[0].Trim()
        if ($map.ContainsKey($name)) { Fail "Duplicate environment key: $name" }
        $map[$name]=$parts[1].Trim()
    }
    if ([string]$map['BTHWANI_ENV'] -ne 'development') { Fail 'LOCAL_INTEGRATION requires BTHWANI_ENV=development.' }
    return $map
}

function Ensure-Environment {
    if (Test-Path -LiteralPath $EnvPath -PathType Leaf) {
        $null=Read-EnvMap
        Write-Host 'LOCAL_RUNTIME_ENV=READY action=reuse'
        return
    }
    if (-not (Test-Path -LiteralPath $EnvExamplePath -PathType Leaf)) { Fail "Missing runtime template: $EnvExamplePath" }

    $secretNames=@(
        'SAMRIM_POSTGRES_PASSWORD',
        'IDENTITY_CHALLENGE_HMAC_SECRET',
        'IDENTITY_DSH_SERVICE_TOKEN',
        'CONTROL_PANEL_SERVICE_TOKEN',
        'IDENTITY_ABUSE_HMAC_SECRET',
        'OPERATOR_BOOTSTRAP_SECRET'
    )
    $output=[System.Collections.Generic.List[string]]::new()
    foreach ($line in Get-Content -LiteralPath $EnvExamplePath) {
        $trim=$line.Trim()
        if (-not $trim -or $trim.StartsWith('#')) { $output.Add($line); continue }
        $parts=$line.Split('=',2)
        if ($parts.Count -ne 2) { Fail "Malformed runtime template line: $line" }
        $name=$parts[0].Trim()
        $value=if ($name -in $secretNames) { New-RandomHex } else { $parts[1].Trim() }
        $output.Add("$name=$value")
    }
    [IO.File]::WriteAllText(
        $EnvPath,
        (($output -join [Environment]::NewLine).TrimEnd() + [Environment]::NewLine),
        [Text.UTF8Encoding]::new($false)
    )
    $null=Read-EnvMap
    Write-Host 'LOCAL_RUNTIME_ENV=READY action=create'
}

function Require-Docker {
    if (-not (Get-Command docker -ErrorAction SilentlyContinue)) { Fail 'Docker CLI is required.' }
}

function Compose([string[]]$Arguments,[switch]$Capture) {
    $base=@('compose','--ansi','never','--project-name',$Project,'--env-file',$EnvPath,'-f',$ComposePath)
    if ($Capture) {
        $output=@(& docker @base @Arguments 2>&1)
        if ($LASTEXITCODE -ne 0) { Fail "Docker Compose failed: $($Arguments -join ' ')" }
        return $output
    }
    & docker @base @Arguments
    if ($LASTEXITCODE -ne 0) { Fail "Docker Compose failed: $($Arguments -join ' ')" }
}

function Test-Http([string]$Url) {
    $response=$null
    $client=[Net.Http.HttpClient]::new()
    $client.Timeout=[TimeSpan]::FromSeconds(2)
    try {
        $response=$client.GetAsync($Url).GetAwaiter().GetResult()
        return ([int]$response.StatusCode -ge 200 -and [int]$response.StatusCode -lt 300)
    } catch {
        return $false
    } finally {
        if ($null -ne $response) { $response.Dispose() }
        $client.Dispose()
    }
}

function Assert-Container([string]$Service,[string]$ExpectedState,[string]$ExpectedHealth='',[int]$ExpectedExit=-1) {
    $ids=@(Compose @('ps','-a','-q',$Service) -Capture | Where-Object { $_ })
    if ($ids.Count -ne 1) { Fail "SERVICE_STATE=FAIL service=$Service containers=$($ids.Count)" }
    $format='{{.State.Status}}|{{if .State.Health}}{{.State.Health.Status}}{{else}}none{{end}}|{{.State.ExitCode}}'
    $raw=((& docker inspect --format $format $ids[0] 2>&1 | Out-String).Trim())
    if ($LASTEXITCODE -ne 0) { Fail "SERVICE_STATE=FAIL service=$Service reason=inspect" }
    $parts=$raw.Split('|',3)
    if ($parts[0] -ne $ExpectedState) { Fail "SERVICE_STATE=FAIL service=$Service state=$($parts[0])" }
    if ($ExpectedHealth -and $parts[1] -ne $ExpectedHealth) { Fail "SERVICE_HEALTH=FAIL service=$Service health=$($parts[1])" }
    if ($ExpectedExit -ge 0 -and [int]$parts[2] -ne $ExpectedExit) { Fail "SERVICE_STATE=FAIL service=$Service exit=$($parts[2])" }
}

function Doctor {
    $envMap=Read-EnvMap
    Require-Docker

    Assert-Container 'postgres' 'running' 'healthy'
    Assert-Container 'mailpit' 'running'
    Assert-Container 'identity-migrate' 'exited' '' 0
    Assert-Container 'identity' 'running' 'healthy'
    Assert-Container 'dsh-migrate' 'exited' '' 0
    Assert-Container 'dsh' 'running' 'healthy'

    if (-not (Test-Http "http://127.0.0.1:$($envMap['SAMRIM_IDENTITY_PORT'])/identity/health")) { Fail 'HOST_ENDPOINT=FAIL name=identity' }
    if (-not (Test-Http "http://127.0.0.1:$($envMap['SAMRIM_DSH_PORT'])/dsh/health")) { Fail 'HOST_ENDPOINT=FAIL name=dsh' }
    if (-not (Test-Http "http://127.0.0.1:$($envMap['SAMRIM_MAILPIT_WEB_PORT'])/")) { Fail 'HOST_ENDPOINT=FAIL name=mailpit' }

    Write-Host 'CANONICAL_RUNTIME_READBACK=PASS scope=backend-compose'
    Write-Host 'APPLICATION_RUNTIME=HOST_OWNED'
    Write-Host 'DEVICE_RUNTIME=DEVICE_OWNED'
    Write-Host 'RUNTIME_DOCTOR=PASS'
}

function Require-Service {
    if ($Service -notin @('identity','dsh')) { Fail 'SERVICE_REQUIRED allowed=identity,dsh' }
}

if ($Action -eq 'Up') { Ensure-Environment } else { $null=Read-EnvMap }
Require-Docker

switch ($Action) {
    'Up' {
        Compose @('up','-d','--wait','--wait-timeout','300','--remove-orphans')
        Write-Host 'RUNTIME_UP=PASS scope=backend'
    }
    'Down' {
        Compose @('down','--remove-orphans')
        Write-Host 'RUNTIME_DOWN=PASS scope=backend'
    }
    'Status' {
        Compose @('ps','-a')
    }
    'Logs' {
        Compose @('logs','--tail','200','-f')
    }
    'Doctor' {
        Doctor
    }
    'Rebuild' {
        Require-Service
        Compose @('build',$Service)
        if ($Service -eq 'identity') {
            Compose @('up','-d','--force-recreate','--wait','--wait-timeout','300','identity-migrate','identity')
        } else {
            Compose @('up','-d','--force-recreate','--wait','--wait-timeout','300','dsh-migrate','dsh')
        }
        Write-Host "RUNTIME_REBUILD=PASS service=$Service"
    }
    'Reset' {
        if (-not $AllowDataLoss) { Fail 'DATA_LOSS_AUTHORIZATION_REQUIRED use=-AllowDataLoss' }
        Compose @('down','-v','--remove-orphans')
        Compose @('up','-d','--wait','--wait-timeout','300','--remove-orphans')
        Write-Host 'RUNTIME_RESET=PASS data_loss=authorized'
    }
}
