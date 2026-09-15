#Requires -Version 7.4
[CmdletBinding()]
param(
    [Parameter(Mandatory)]
    [ValidateSet('Up','Down','Restart','Status','Logs','Doctor','Reset','Purge','Control','Rebuild','RestartService','LogsService','Surface')]
    [string]$Action,
    [string]$Service = '',
    [ValidateSet('client','partner','captain','field')]
    [string]$Surface = ''
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$PSNativeCommandUseErrorActionPreference = $false

$RepoRoot = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
$ComposePath = Join-Path $RepoRoot 'infra\local\compose\compose.yaml'
$EnvPath = Join-Path $RepoRoot 'infra\local\compose\.env'
$EnvExamplePath = Join-Path $RepoRoot 'infra\local\compose\.env.example'
$Project = 'samrim-local'
$AllowedServices = @('identity','dsh','control','metro-client','metro-partner','metro-captain','metro-field')
$CanonicalServices = @('postgres','mailpit','identity-migrate','identity','dsh-migrate','dsh','js-deps','control','metro-client','metro-partner','metro-captain','metro-field')
$RunningServices = @('postgres','mailpit','identity','dsh','control','metro-client','metro-partner','metro-captain','metro-field')
$OneShotServices = @('identity-migrate','dsh-migrate','js-deps')
$Ports = @(
    @{ Key='SAMRIM_MAILPIT_WEB_PORT'; Service='mailpit' },
    @{ Key='SAMRIM_IDENTITY_PORT'; Service='identity' },
    @{ Key='SAMRIM_DSH_PORT'; Service='dsh' },
    @{ Key='SAMRIM_CONTROL_PORT'; Service='control' },
    @{ Key='SAMRIM_APP_CLIENT_METRO_PORT'; Service='metro-client' },
    @{ Key='SAMRIM_APP_PARTNER_METRO_PORT'; Service='metro-partner' },
    @{ Key='SAMRIM_APP_CAPTAIN_METRO_PORT'; Service='metro-captain' },
    @{ Key='SAMRIM_APP_FIELD_METRO_PORT'; Service='metro-field' }
)

function Fail([string]$Message) { throw $Message }
function New-RandomHex([int]$Bytes = 32) { [Convert]::ToHexString([Security.Cryptography.RandomNumberGenerator]::GetBytes($Bytes)).ToLowerInvariant() }

function Read-Env([string]$Path) {
    $map = @{}
    foreach ($line in Get-Content -LiteralPath $Path) {
        $trimmed = $line.Trim()
        if (-not $trimmed -or $trimmed.StartsWith('#')) { continue }
        $parts = $trimmed.Split('=', 2)
        if ($parts.Count -ne 2 -or [string]::IsNullOrWhiteSpace($parts[0])) { Fail "Malformed environment line: $line" }
        $name = $parts[0].Trim()
        if ($map.ContainsKey($name)) { Fail "Duplicate environment key: $name" }
        $map[$name] = $parts[1].Trim()
    }
    return $map
}

function Require-Env([hashtable]$Map, [string]$Name) {
    if (-not $Map.ContainsKey($Name) -or [string]::IsNullOrWhiteSpace([string]$Map[$Name])) { Fail "Required local runtime setting is missing: $Name" }
    return [string]$Map[$Name]
}

function Require-Port([hashtable]$Map, [string]$Name) {
    $raw = Require-Env $Map $Name
    $port = 0
    if (-not [int]::TryParse($raw, [ref]$port) -or $port -lt 1 -or $port -gt 65535) { Fail "Invalid TCP port in ${Name}: $raw" }
    return $port
}

function Ensure-Environment {
    if (-not (Test-Path -LiteralPath $EnvExamplePath -PathType Leaf)) { Fail "Missing runtime template: $EnvExamplePath" }
    $current = if (Test-Path -LiteralPath $EnvPath -PathType Leaf) { Read-Env $EnvPath } else { @{} }
    $secretNames = [System.Collections.Generic.HashSet[string]]::new([StringComparer]::OrdinalIgnoreCase)
    foreach ($name in @('SAMRIM_POSTGRES_PASSWORD','IDENTITY_CHALLENGE_HMAC_SECRET','IDENTITY_DSH_SERVICE_TOKEN','CONTROL_PANEL_SERVICE_TOKEN','IDENTITY_ABUSE_HMAC_SECRET','OPERATOR_BOOTSTRAP_SECRET')) { $null = $secretNames.Add($name) }

    $output = [System.Collections.Generic.List[string]]::new()
    foreach ($line in Get-Content -LiteralPath $EnvExamplePath) {
        $trimmed = $line.Trim()
        if (-not $trimmed -or $trimmed.StartsWith('#')) { $output.Add($line); continue }
        $parts = $line.Split('=', 2)
        if ($parts.Count -ne 2) { Fail "Malformed runtime template line: $line" }
        $name = $parts[0].Trim()
        $value = $parts[1].Trim()
        if ($secretNames.Contains($name)) {
            $value = if ($current.ContainsKey($name) -and -not [string]::IsNullOrWhiteSpace([string]$current[$name])) { [string]$current[$name] } else { New-RandomHex }
        }
        $output.Add("${name}=${value}")
    }

    [IO.File]::WriteAllText($EnvPath, (($output -join [Environment]::NewLine).TrimEnd() + [Environment]::NewLine), [Text.UTF8Encoding]::new($false))
    return Read-CanonicalEnvironment
}

function Read-CanonicalEnvironment {
    if (-not (Test-Path -LiteralPath $EnvPath -PathType Leaf)) { Fail "LOCAL_RUNTIME_ENV=NOT_READY reason=missing_env path=$EnvPath" }
    $map = Read-Env $EnvPath
    if ((Require-Env $map 'BTHWANI_ENV') -ne 'development') { Fail 'LOCAL_INTEGRATION requires BTHWANI_ENV=development.' }
    return $map
}

function Ensure-Docker {
    if (-not (Get-Command docker -ErrorAction SilentlyContinue)) { Fail 'Docker CLI is required.' }
    & docker version *> $null
    if ($LASTEXITCODE -ne 0) { Fail 'Docker daemon is not available.' }
}

function Compose([string[]]$Arguments, [switch]$Quiet) {
    $base = @('compose','--ansi','never','--progress','plain','--project-name',$Project)
    if (Test-Path -LiteralPath $EnvPath -PathType Leaf) { $base += @('--env-file',$EnvPath) }
    $base += @('-f',$ComposePath)
    if ($Quiet) { & docker @base @Arguments *> $null } else { & docker @base @Arguments 2>&1 | ForEach-Object { Write-Host $_ } }
    if ($LASTEXITCODE -ne 0) { Fail "Docker Compose failed: $($Arguments -join ' ')" }
}

function Container-Ids([string]$ServiceName) {
    $ids = @(& docker ps -a --filter "label=com.docker.compose.project=$Project" --filter "label=com.docker.compose.service=$ServiceName" --format '{{.ID}}' | ForEach-Object { $_.Trim() } | Where-Object { $_ })
    if ($LASTEXITCODE -ne 0) { Fail "Unable to inspect $Project/$ServiceName." }
    return $ids
}

function Assert-No-Parallel-Runtime {
    $projects = @(& docker ps -a --format '{{.Label "com.docker.compose.project"}}' | Where-Object { $_ -like 'samrim-*' -and $_ -ne $Project } | Sort-Object -Unique)
    if ($LASTEXITCODE -ne 0) { Fail 'Unable to inspect Docker project ownership.' }
    if ($projects.Count -gt 0) { Fail "PARALLEL_RUNTIME_RESIDUE=FAIL projects=$($projects -join ',')" }
    $unexpected = @(& docker ps -a --filter "label=com.docker.compose.project=$Project" --format '{{.Label "com.docker.compose.service"}}' | Where-Object { $_ -and $_ -notin $CanonicalServices } | Sort-Object -Unique)
    if ($unexpected.Count -gt 0) { Fail "CANONICAL_RUNTIME_RESIDUE=FAIL services=$($unexpected -join ',')" }
}

function Assert-No-Native-Backend {
    if (-not $IsWindows) { return }
    $matches = @(Get-CimInstance Win32_Process -ErrorAction SilentlyContinue | Where-Object {
        $_.CommandLine -and $_.CommandLine -match '\bgo(?:\.exe)?\b' -and
        ($_.CommandLine -match 'services[\\/]identity[\\/]backend' -or $_.CommandLine -match 'services[\\/]dsh[\\/]backend')
    })
    if ($matches.Count -gt 0) { Fail "NATIVE_RUNTIME_RESIDUE=FAIL pids=$($matches.ProcessId -join ',')" }
}

function Assert-Service([string]$ServiceName, [switch]$Healthy) {
    $ids = @(Container-Ids $ServiceName)
    if ($ids.Count -ne 1) { Fail "SERVICE_STATE=FAIL service=$ServiceName containers=$($ids.Count)" }
    $status = (& docker inspect --format '{{.State.Status}}' $ids[0]).Trim()
    if ($status -ne 'running') { Fail "SERVICE_STATE=FAIL service=$ServiceName status=$status" }
    if ($Healthy) {
        $health = (& docker inspect --format '{{if .State.Health}}{{.State.Health.Status}}{{else}}missing{{end}}' $ids[0]).Trim()
        if ($health -ne 'healthy') { Fail "SERVICE_HEALTH=FAIL service=$ServiceName health=$health" }
    }
}

function Assert-OneShot([string]$ServiceName) {
    $ids = @(Container-Ids $ServiceName)
    if ($ids.Count -ne 1) { Fail "ONE_SHOT_SERVICE=FAIL service=$ServiceName containers=$($ids.Count)" }
    $state = (& docker inspect --format '{{.State.Status}}|{{.State.ExitCode}}' $ids[0]).Trim()
    if ($state -ne 'exited|0') { Fail "ONE_SHOT_SERVICE=FAIL service=$ServiceName state=$state" }
}

function Assert-Port([hashtable]$EnvMap, [string]$ServiceName, [string]$Key) {
    $port = Require-Port $EnvMap $Key
    $needle = ":${port}->"
    $rows = @(& docker ps --format '{{.Ports}}|{{.Label "com.docker.compose.project"}}|{{.Label "com.docker.compose.service"}}' | Where-Object { $_ -and $_.Contains($needle) })
    $expected = @($rows | Where-Object { $_ -match "\|$Project\|$([regex]::Escape($ServiceName))$" })
    if ($rows.Count -ne 1 -or $expected.Count -ne 1 -or $rows[0] -notmatch '^127\.0\.0\.1:') { Fail "PORT_OWNERSHIP=FAIL port=$port service=$ServiceName observed=$($rows -join ';')" }
}

function Assert-Full-Runtime([hashtable]$EnvMap) {
    Assert-No-Parallel-Runtime
    Assert-No-Native-Backend
    foreach ($serviceName in $OneShotServices) { Assert-OneShot $serviceName }
    foreach ($serviceName in $RunningServices) {
        $healthy = $serviceName -notin @('mailpit')
        Assert-Service $serviceName -Healthy:$healthy
    }
    foreach ($port in $Ports) { Assert-Port $EnvMap $port.Service $port.Key }
}

function Assert-Target-Runtime([hashtable]$EnvMap, [string]$Target) {
    Assert-No-Parallel-Runtime
    Assert-No-Native-Backend
    foreach ($serviceName in @('identity-migrate','dsh-migrate','js-deps')) { Assert-OneShot $serviceName }
    $targets = @('postgres','mailpit','identity','dsh',$Target) | Select-Object -Unique
    foreach ($serviceName in $targets) {
        $healthy = $serviceName -ne 'mailpit'
        Assert-Service $serviceName -Healthy:$healthy
    }
    foreach ($port in @($Ports | Where-Object { $_.Service -in @('mailpit','identity','dsh',$Target) })) { Assert-Port $EnvMap $port.Service $port.Key }
}

function Start-Full-Runtime {
    $envMap = Ensure-Environment
    Ensure-Docker
    Assert-No-Parallel-Runtime
    Assert-No-Native-Backend
    Compose @('config','--quiet') -Quiet
    # Full-stack up starts every Docker-owned component without making image rebuild a startup tax.
    Compose @('up','-d','--wait','--wait-timeout','300','--remove-orphans')
    Assert-Full-Runtime $envMap
    Write-Host 'CANONICAL_LOCAL_RUNTIME=PASS mode=full'
    Write-Host 'DOCKER_RUNTIME=PASS'
    Write-Host 'DOCKER_OWNS=postgres,mailpit,identity-migrate,identity,dsh-migrate,dsh,js-deps,control,metro-client,metro-partner,metro-captain,metro-field'
}

function Ensure-Target-Runtime([string]$Target) {
    $envMap = Ensure-Environment
    Ensure-Docker
    Assert-No-Parallel-Runtime
    Assert-No-Native-Backend
    Compose @('config','--quiet') -Quiet
    # Compose starts causal dependencies. Already-running unrelated surfaces are left untouched.
    Compose @('up','-d','--wait','--wait-timeout','300','--remove-orphans',$Target)
    Assert-Target-Runtime $envMap $Target
    Write-Host "CANONICAL_LOCAL_RUNTIME=PASS mode=target target=$Target"
    return $envMap
}

function Show-Status {
    Write-Host "RUNTIME_STATUS=READ_ONLY scope=full-canonical-compose"
    $envMap = $null
    try { $envMap = Read-CanonicalEnvironment; Write-Host 'LOCAL_RUNTIME_ENV=PASS mode=read-only' } catch { Write-Host "LOCAL_RUNTIME_ENV=NOT_READY reason=$($_.Exception.Message)" }
    Ensure-Docker
    foreach ($serviceName in $CanonicalServices) {
        $ids = @(Container-Ids $serviceName)
        if ($ids.Count -eq 0) { Write-Host "DOCKER_SERVICE=$serviceName state=missing"; continue }
        if ($ids.Count -ne 1) { Write-Host "DOCKER_SERVICE=$serviceName state=duplicate count=$($ids.Count)"; continue }
        $state = (& docker inspect --format '{{.State.Status}}|{{if .State.Health}}{{.State.Health.Status}}{{else}}none{{end}}|{{.State.ExitCode}}' $ids[0]).Trim()
        Write-Host "DOCKER_SERVICE=$serviceName state=$state"
    }
}

function Doctor {
    $failures = @()
    $envMap = $null
    try { $envMap = Read-CanonicalEnvironment } catch { Write-Host "LOCAL_RUNTIME_ENV=NOT_READY reason=$($_.Exception.Message)"; $failures += 'environment' }
    try { Ensure-Docker; Assert-No-Parallel-Runtime; Assert-No-Native-Backend } catch { Write-Host "DOCKER_RUNTIME=NOT_READY reason=$($_.Exception.Message)"; $failures += 'docker' }
    if ($null -ne $envMap -and $failures.Count -eq 0) {
        try { Assert-Full-Runtime $envMap; Write-Host 'CANONICAL_RUNTIME_READBACK=PASS scope=full-canonical-compose' }
        catch { Write-Host "CANONICAL_RUNTIME_READBACK=NOT_READY reason=$($_.Exception.Message)"; $failures += 'runtime' }
    }
    Write-Host 'DEVICE_RUNTIME=SEPARATE_OWNER'
    Write-Host 'DESTRUCTIVE=0'
    if ($failures.Count -gt 0) { Write-Host "RUNTIME_DOCTOR=NOT_READY failures=$($failures.Count)"; exit 1 }
    Write-Host 'RUNTIME_DOCTOR=PASS'
}

function Require-Service {
    if (-not $Service -or $Service -notin $AllowedServices) { Fail "SERVICE_REQUIRED allowed=$($AllowedServices -join ',')" }
    return $Service
}

function Rebuild-Service {
    $target = Require-Service
    $null = Ensure-Environment
    Ensure-Docker
    Assert-No-Parallel-Runtime
    Assert-No-Native-Backend
    if ($target -eq 'identity') {
        Compose @('build','identity-migrate','identity')
        Compose @('up','-d','--force-recreate','--wait','--wait-timeout','300','identity')
    }
    elseif ($target -eq 'dsh') {
        Compose @('build','dsh-migrate','dsh')
        Compose @('up','-d','--force-recreate','--wait','--wait-timeout','300','dsh')
    }
    else {
        Compose @('up','-d','--build','--force-recreate','--no-deps','--wait','--wait-timeout','300',$target)
    }
    Write-Host "RUNTIME_SERVICE_REBUILD=PASS service=$target"
}

function Restart-Service {
    $target = Require-Service
    $null = Read-CanonicalEnvironment
    Ensure-Docker
    Compose @('restart',$target)
    Write-Host "RUNTIME_SERVICE_RESTART=PASS service=$target"
}

Push-Location $RepoRoot
try {
    switch ($Action) {
        'Up' { Start-Full-Runtime }
        'Down' { Ensure-Docker; Compose @('down','--remove-orphans'); Write-Host 'CANONICAL_RUNTIME_STOP=PASS data_volume=preserved' }
        'Restart' { Ensure-Docker; Compose @('down','--remove-orphans'); Start-Full-Runtime }
        'Status' { Show-Status }
        'Logs' { Ensure-Docker; Compose @('logs','--tail','200','-f') }
        'Doctor' { Doctor }
        'Reset' {
            Ensure-Docker
            Compose @('down','--remove-orphans')
            $volumes = @(& docker volume ls --filter "label=com.docker.compose.project=$Project" --format '{{.Name}}' | Where-Object { $_ -match 'samrim-postgres-data$' })
            foreach ($volume in $volumes) { & docker volume rm -f $volume *> $null; if ($LASTEXITCODE -ne 0) { Fail "RUNTIME_RESET=FAIL volume=$volume" } }
            Write-Host 'RUNTIME_RESET=PASS final_state=DOWN secrets=preserved'
        }
        'Purge' { Ensure-Docker; Compose @('down','--volumes','--remove-orphans'); Write-Host 'RUNTIME_PURGE=PASS final_state=DOWN secrets=preserved' }
        'Control' {
            $envMap = Ensure-Target-Runtime 'control'
            $port = Require-Port $envMap 'SAMRIM_CONTROL_PORT'
            Write-Host "CONTROL_PANEL_READY=PASS url=http://127.0.0.1:$port"
        }
        'Surface' {
            if (-not $Surface) { Fail 'SURFACE_REQUIRED allowed=client,partner,captain,field' }
            $target = "metro-$Surface"
            $null = Ensure-Target-Runtime $target
            Write-Host "MOBILE_SURFACE_RUNTIME=PASS surface=$Surface service=$target"
        }
        'Rebuild' { Rebuild-Service }
        'RestartService' { Restart-Service }
        'LogsService' { $target = Require-Service; Ensure-Docker; Compose @('logs','--tail','200','-f',$target) }
    }
}
finally {
    Pop-Location
}
