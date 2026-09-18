#Requires -Version 7.4
[CmdletBinding()]
param(
    [Parameter(Mandatory)]
    [ValidateSet('Up','Down','Restart','Status','Logs','Doctor','Reset','Purge','Control','Rebuild','RestartService','LogsService','Surface')]
    [string]$Action,
    [string]$Service = '',
    [ValidateSet('client','partner','captain','field')]
    [string]$Surface = '',
    [switch]$AllowDataLoss
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
$WorkspaceServices = @('control','metro-client','metro-partner','metro-captain','metro-field')
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

    $desired = (($output -join [Environment]::NewLine).TrimEnd() + [Environment]::NewLine)
    $existingText = if (Test-Path -LiteralPath $EnvPath -PathType Leaf) { [IO.File]::ReadAllText($EnvPath) } else { '' }
    if ($existingText -cne $desired) {
        [IO.File]::WriteAllText($EnvPath, $desired, [Text.UTF8Encoding]::new($false))
        Write-Host 'LOCAL_RUNTIME_ENV=READY action=write'
    }
    else {
        Write-Host 'LOCAL_RUNTIME_ENV=READY action=reuse'
    }
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

function Get-CanonicalRuntimeSnapshot {
    $rows = @(& docker ps -a --no-trunc --format '{{.ID}}|{{.State}}|{{.Ports}}|{{.Label "com.docker.compose.project"}}|{{.Label "com.docker.compose.service"}}' 2>&1)
    if ($LASTEXITCODE -ne 0) { Fail 'Unable to read Docker runtime state.' }

    $containers = [System.Collections.Generic.List[object]]::new()
    foreach ($row in $rows) {
        $parts = @(([string]$row) -split '\|', 5)
        if ($parts.Count -ne 5 -or [string]::IsNullOrWhiteSpace($parts[0])) { continue }
        $containers.Add([pscustomobject]@{
            Id = $parts[0].Trim()
            State = $parts[1].Trim()
            Ports = $parts[2].Trim()
            Project = $parts[3].Trim()
            Service = $parts[4].Trim()
            Health = 'none'
            ExitCode = $null
            Mounts = @()
        })
    }

    $samrimIds = @($containers | Where-Object { $_.Project -like 'samrim-*' } | Select-Object -ExpandProperty Id -Unique)
    if ($samrimIds.Count -gt 0) {
        $inspectJson = (& docker inspect @samrimIds 2>&1 | Out-String)
        if ($LASTEXITCODE -ne 0) { Fail 'Unable to inspect Samrim runtime containers.' }
        $details = @($inspectJson | ConvertFrom-Json)
        foreach ($detail in $details) {
            $matches = @($containers | Where-Object { $_.Id -eq [string]$detail.Id })
            if ($matches.Count -ne 1) { Fail "DOCKER_SNAPSHOT=FAIL id=$($detail.Id) matches=$($matches.Count)" }
            $entry = $matches[0]
            $entry.State = [string]$detail.State.Status
            $entry.ExitCode = [int]$detail.State.ExitCode
            $entry.Health = if ($null -ne $detail.State.Health) { [string]$detail.State.Health.Status } else { 'none' }
            $entry.Mounts = @($detail.Mounts | ForEach-Object {
                [pscustomobject]@{
                    Type = [string]$_.Type
                    Source = [string]$_.Source
                    Destination = [string]$_.Destination
                }
            })
        }
    }

    return [pscustomobject]@{ Containers = @($containers | ForEach-Object { $_ }) }
}

function Get-ServiceContainers($Snapshot, [string]$ServiceName) {
    return @($Snapshot.Containers | Where-Object { $_.Project -eq $Project -and $_.Service -eq $ServiceName })
}

function Assert-No-Parallel-Runtime($Snapshot) {
    $projects = @($Snapshot.Containers | Where-Object { $_.Project -like 'samrim-*' } | Select-Object -ExpandProperty Project -Unique)
    $parallel = @($projects | Where-Object { $_ -ne $Project })
    if ($parallel.Count -gt 0) { Fail "PARALLEL_RUNTIME_RESIDUE=FAIL projects=$($parallel -join ',')" }
    $unexpected = @($Snapshot.Containers | Where-Object { $_.Project -eq $Project -and $_.Service -and $_.Service -notin $CanonicalServices } | Select-Object -ExpandProperty Service -Unique)
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

function Normalize-Workspace-Source([string]$Source) {
    $raw = $Source.Trim()
    $dockerDesktopPath = [regex]::Match($raw, '^/+run/desktop/mnt/host/([a-zA-Z])/(.+)$')
    if ($dockerDesktopPath.Success) {
        $value = '{0}:\\{1}' -f $dockerDesktopPath.Groups[1].Value.ToUpperInvariant(), $dockerDesktopPath.Groups[2].Value
    } else {
        $value = $raw.Replace('/', '\\')
    }
    return [IO.Path]::GetFullPath($value).TrimEnd('\\')
}

function Assert-WorkspaceMounts($Snapshot, [string[]]$Services = $WorkspaceServices) {
    $expected = Normalize-Workspace-Source $RepoRoot
    foreach ($serviceName in $Services) {
        $containers = @(Get-ServiceContainers $Snapshot $serviceName)
        if ($containers.Count -ne 1) { Fail "WORKSPACE_MOUNT=FAIL service=$serviceName containers=$($containers.Count)" }
        $mounts = @($containers[0].Mounts | Where-Object { $_.Destination -eq '/workspace' })
        if ($mounts.Count -ne 1) { Fail "WORKSPACE_MOUNT=FAIL service=$serviceName target=/workspace mounts=$($mounts.Count)" }
        if ($mounts[0].Type -ne 'bind') { Fail "WORKSPACE_MOUNT=FAIL service=$serviceName target=/workspace type=$($mounts[0].Type)" }
        try { $actual = Normalize-Workspace-Source $mounts[0].Source } catch { Fail "WORKSPACE_MOUNT=FAIL service=$serviceName source=$($mounts[0].Source)" }
        if (-not [StringComparer]::OrdinalIgnoreCase.Equals($actual, $expected)) { Fail "WORKSPACE_MOUNT=FAIL service=$serviceName expected=$expected actual=$actual" }
    }
}

function Assert-Service($Snapshot, [string]$ServiceName, [switch]$Healthy) {
    $containers = @(Get-ServiceContainers $Snapshot $ServiceName)
    if ($containers.Count -ne 1) { Fail "SERVICE_STATE=FAIL service=$ServiceName containers=$($containers.Count)" }
    $entry = $containers[0]
    if ($entry.State -ne 'running') { Fail "SERVICE_STATE=FAIL service=$ServiceName status=$($entry.State)" }
    if ($Healthy -and $entry.Health -ne 'healthy') { Fail "SERVICE_HEALTH=FAIL service=$ServiceName health=$($entry.Health)" }
}

function Assert-OneShot($Snapshot, [string]$ServiceName) {
    $containers = @(Get-ServiceContainers $Snapshot $ServiceName)
    if ($containers.Count -ne 1) { Fail "ONE_SHOT_SERVICE=FAIL service=$ServiceName containers=$($containers.Count)" }
    $entry = $containers[0]
    if ($entry.State -ne 'exited' -or $entry.ExitCode -ne 0) { Fail "ONE_SHOT_SERVICE=FAIL service=$ServiceName state=$($entry.State)|$($entry.ExitCode)" }
}

function Assert-Port($Snapshot, [hashtable]$EnvMap, [string]$ServiceName, [string]$Key) {
    $port = Require-Port $EnvMap $Key
    $needle = ":${port}->"
    $owners = @($Snapshot.Containers | Where-Object { $_.State -eq 'running' -and $_.Ports -and $_.Ports.Contains($needle) })
    $expected = @($owners | Where-Object { $_.Project -eq $Project -and $_.Service -eq $ServiceName })
    if ($owners.Count -ne 1 -or $expected.Count -ne 1 -or $owners[0].Ports -notmatch "(^|, )127\.0\.0\.1:${port}->") {
        $observed = @($owners | ForEach-Object { "$($_.Ports)|$($_.Project)|$($_.Service)" })
        Fail "PORT_OWNERSHIP=FAIL port=$port service=$ServiceName observed=$($observed -join ';')"
    }
}

function Assert-Full-Runtime([hashtable]$EnvMap, $Snapshot) {
    Assert-No-Parallel-Runtime $Snapshot
    Assert-No-Native-Backend
    Assert-WorkspaceMounts $Snapshot
    foreach ($serviceName in $OneShotServices) { Assert-OneShot $Snapshot $serviceName }
    foreach ($serviceName in $RunningServices) {
        $healthy = $serviceName -notin @('mailpit')
        Assert-Service $Snapshot $serviceName -Healthy:$healthy
    }
    foreach ($port in $Ports) { Assert-Port $Snapshot $EnvMap $port.Service $port.Key }
}

function Assert-Target-Runtime([hashtable]$EnvMap, [string]$Target, $Snapshot) {
    Assert-No-Parallel-Runtime $Snapshot
    Assert-No-Native-Backend
    if ($Target -in $WorkspaceServices) { Assert-WorkspaceMounts $Snapshot @($Target) }
    foreach ($serviceName in @('identity-migrate','dsh-migrate','js-deps')) { Assert-OneShot $Snapshot $serviceName }
    $targets = @('postgres','mailpit','identity','dsh',$Target) | Select-Object -Unique
    foreach ($serviceName in $targets) {
        $healthy = $serviceName -ne 'mailpit'
        Assert-Service $Snapshot $serviceName -Healthy:$healthy
    }
    foreach ($port in @($Ports | Where-Object { $_.Service -in @('mailpit','identity','dsh',$Target) })) { Assert-Port $Snapshot $EnvMap $port.Service $port.Key }
}

function Get-Running-Workspace-Services($Snapshot) {
    return @($Snapshot.Containers |
        Where-Object { $_.Project -eq $Project -and $_.State -eq 'running' -and $_.Service -in $WorkspaceServices } |
        Select-Object -ExpandProperty Service -Unique |
        Sort-Object)
}

function Test-Js-Dependencies-Ready {
    try {
        # --check is read-only: it validates the fingerprint and required modules without
        # running pnpm install or rewriting the shared node_modules volumes.
        Compose @('run','--rm','js-deps','node','tools/dev/js-deps.mjs','--check') -Quiet
        return $true
    }
    catch {
        return $false
    }
}

function Start-Full-Runtime {
    $envMap = Ensure-Environment
    Ensure-Docker
    $before = Get-CanonicalRuntimeSnapshot
    Assert-No-Parallel-Runtime $before
    Assert-No-Native-Backend
    Compose @('config','--quiet') -Quiet

    # Dependency materialization belongs to explicit full startup/restart only.
    # Existing workspace services are stopped only when their shared node_modules
    # volumes are proven stale, preventing Metro/Next from observing partial rewrites.
    $runningBefore = @(Get-Running-Workspace-Services $before)
    $dependenciesReady = Test-Js-Dependencies-Ready
    if ($dependenciesReady) {
        Write-Host 'JS_DEPS_GATE=READY action=no-stop scope=full'
    }
    else {
        Write-Host 'JS_DEPS_GATE=STALE action=stop-materialize scope=full'
        if ($runningBefore.Count -gt 0) { Compose (@('stop') + $runningBefore) }
    }

    Compose @('up','-d','--wait','--wait-timeout','300','--remove-orphans')
    $after = Get-CanonicalRuntimeSnapshot
    Assert-Full-Runtime $envMap $after
    Write-Host 'CANONICAL_LOCAL_RUNTIME=PASS mode=full'
    Write-Host 'DOCKER_RUNTIME=PASS'
    Write-Host 'DOCKER_OWNS=postgres,mailpit,identity-migrate,identity,dsh-migrate,dsh,js-deps,control,metro-client,metro-partner,metro-captain,metro-field'
}

function Show-Status {
    Write-Host "RUNTIME_STATUS=READ_ONLY scope=full-canonical-compose"
    try { $null = Read-CanonicalEnvironment; Write-Host 'LOCAL_RUNTIME_ENV=PASS mode=read-only' } catch { Write-Host "LOCAL_RUNTIME_ENV=NOT_READY reason=$($_.Exception.Message)" }
    Ensure-Docker
    $snapshot = Get-CanonicalRuntimeSnapshot
    foreach ($serviceName in $CanonicalServices) {
        $containers = @(Get-ServiceContainers $snapshot $serviceName)
        if ($containers.Count -eq 0) { Write-Host "DOCKER_SERVICE=$serviceName state=missing"; continue }
        if ($containers.Count -ne 1) { Write-Host "DOCKER_SERVICE=$serviceName state=duplicate count=$($containers.Count)"; continue }
        $entry = $containers[0]
        Write-Host "DOCKER_SERVICE=$serviceName state=$($entry.State)|$($entry.Health)|$($entry.ExitCode)"
    }
    try { Assert-WorkspaceMounts $snapshot; Write-Host 'DOCKER_WORKSPACE_MOUNTS=PASS source=repository-root target=/workspace' }
    catch { Write-Host "DOCKER_WORKSPACE_MOUNTS=NOT_READY reason=$($_.Exception.Message)" }
}

function Doctor {
    $failures = @()
    $envMap = $null
    try { $envMap = Read-CanonicalEnvironment } catch { Write-Host "LOCAL_RUNTIME_ENV=NOT_READY reason=$($_.Exception.Message)"; $failures += 'environment' }
    $snapshot = $null
    try {
        Ensure-Docker
        $snapshot = Get-CanonicalRuntimeSnapshot
        Assert-No-Parallel-Runtime $snapshot
        Assert-No-Native-Backend
    }
    catch {
        Write-Host "DOCKER_RUNTIME=NOT_READY reason=$($_.Exception.Message)"
        $failures += 'docker'
    }
    if ($null -ne $envMap -and $null -ne $snapshot -and $failures.Count -eq 0) {
        try { Assert-Full-Runtime $envMap $snapshot; Write-Host 'CANONICAL_RUNTIME_READBACK=PASS scope=full-canonical-compose' }
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
    $snapshot = Get-CanonicalRuntimeSnapshot
    Assert-No-Parallel-Runtime $snapshot
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

if ($Action -in @('Reset','Purge') -and -not $AllowDataLoss) {
    Fail "DATA_LOSS_AUTHORIZATION_REQUIRED action=$Action rerun_same_invocation_with=-AllowDataLoss"
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
            $envMap = Read-CanonicalEnvironment
            Ensure-Docker
            $snapshot = Get-CanonicalRuntimeSnapshot
            Assert-Target-Runtime $envMap 'control' $snapshot
            $port = Require-Port $envMap 'SAMRIM_CONTROL_PORT'
            Write-Host "CONTROL_PANEL_READY=PASS mode=read-only url=http://127.0.0.1:$port"
        }
        'Surface' {
            if (-not $Surface) { Fail 'SURFACE_REQUIRED allowed=client,partner,captain,field' }
            $target = "metro-$Surface"
            $envMap = Read-CanonicalEnvironment
            Ensure-Docker
            $snapshot = Get-CanonicalRuntimeSnapshot
            Assert-Target-Runtime $envMap $target $snapshot
            Write-Host "MOBILE_SURFACE_RUNTIME=PASS mode=read-only surface=$Surface service=$target"
        }
        'Rebuild' { Rebuild-Service }
        'RestartService' { Restart-Service }
        'LogsService' { $target = Require-Service; Ensure-Docker; Compose @('logs','--tail','200','-f',$target) }
    }
}
finally {
    Pop-Location
}
