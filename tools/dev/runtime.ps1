#Requires -Version 7.4
[CmdletBinding()]
param(
    [Parameter(Mandatory)]
    [ValidateSet(
        'Up',
        'Down',
        'Restart',
        'Status',
        'Logs',
        'Doctor',
        'Reset',
        'Control',
        'Client',
        'Partner',
        'Captain',
        'Field',
        'Scrcpy'
    )]
    [string]$Action,

    [string]$DeviceSerial = $env:BTHWANI_ADB_SERIAL,
    [switch]$ClearCache
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$RepoRoot = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
$ComposeDir = Join-Path $RepoRoot 'infra\local\compose'
$EnvPath = Join-Path $ComposeDir '.env'
$ComposePath = Join-Path $ComposeDir 'compose.yaml'
$EnsureLocalEnv = Join-Path $PSScriptRoot 'ensure-local-env.ps1'
$OwnershipVerifier = Join-Path $PSScriptRoot 'verify-local-runtime-ownership.mjs'
$CanonicalProject = 'samrim-local'
$LegacyProjects = @('samrim-integration')

function Fail([string]$Message) {
    throw $Message
}

function Read-EnvMap([string]$Path) {
    $map = @{}
    foreach ($line in Get-Content -LiteralPath $Path) {
        $trimmed = $line.Trim()
        if (-not $trimmed -or $trimmed.StartsWith('#')) { continue }
        $parts = $trimmed.Split('=', 2)
        if ($parts.Count -ne 2) { Fail "Malformed local runtime environment line in ${Path}: $line" }
        $name = $parts[0].Trim()
        if ([string]::IsNullOrWhiteSpace($name)) { Fail "Local runtime environment contains an empty key in ${Path}." }
        if ($map.ContainsKey($name)) { Fail "Duplicate local runtime environment key '$name' in ${Path}." }
        $map[$name] = $parts[1].Trim()
    }
    return $map
}

function Require-EnvValue([hashtable]$Map, [string]$Name) {
    if (-not $Map.ContainsKey($Name) -or [string]::IsNullOrWhiteSpace([string]$Map[$Name])) {
        Fail "Required local runtime setting is missing: $Name"
    }
    return [string]$Map[$Name]
}

function Require-TcpPort([hashtable]$Map, [string]$Name) {
    $raw = Require-EnvValue -Map $Map -Name $Name
    $port = 0
    if (-not [int]::TryParse($raw, [ref]$port) -or $port -lt 1 -or $port -gt 65535) {
        Fail "Invalid TCP port in ${Name}: $raw"
    }
    return $port
}

function Ensure-Environment {
    if (-not (Test-Path -LiteralPath $EnsureLocalEnv -PathType Leaf)) {
        Fail "Canonical local environment reconciler is missing: $EnsureLocalEnv"
    }
    & $EnsureLocalEnv
    if ($LASTEXITCODE -ne 0 -or -not (Test-Path -LiteralPath $EnvPath -PathType Leaf)) {
        Fail 'Canonical local runtime environment reconciliation failed.'
    }
    $map = Read-EnvMap -Path $EnvPath
    if ((Require-EnvValue -Map $map -Name 'BTHWANI_ENV') -ne 'development') {
        Fail 'LOCAL_INTEGRATION runtime requires BTHWANI_ENV=development.'
    }
    return $map
}

function Set-CanonicalEnvironment([hashtable]$Map) {
    foreach ($entry in $Map.GetEnumerator()) {
        [Environment]::SetEnvironmentVariable(
            [string]$entry.Key,
            [string]$entry.Value,
            [EnvironmentVariableTarget]::Process
        )
    }
}

function Ensure-Docker {
    if (-not (Get-Command docker -ErrorAction SilentlyContinue)) {
        Fail 'Docker CLI is required for LOCAL_INTEGRATION runtime.'
    }
    & docker version *> $null
    if ($LASTEXITCODE -ne 0) { Fail 'Docker daemon is not available.' }
}

function Get-ComposeBaseArgs {
    return @(
        'compose',
        '--ansi', 'never',
        '--progress', 'plain',
        '--project-name', $CanonicalProject,
        '--env-file', $EnvPath,
        '-f', $ComposePath
    )
}

function Invoke-ComposeRaw([string[]]$Arguments, [switch]$Quiet) {
    $base = Get-ComposeBaseArgs
    if ($Quiet) {
        & docker @base @Arguments *> $null
        return [int]$LASTEXITCODE
    }
    $output = @(& docker @base @Arguments 2>&1)
    $exitCode = $LASTEXITCODE
    $output | ForEach-Object { Write-Host $_ }
    return [int]$exitCode
}

function Invoke-Compose([string[]]$Arguments) {
    $code = Invoke-ComposeRaw -Arguments $Arguments
    if ($code -ne 0) {
        Fail "Docker Compose failed: $($Arguments -join ' ')"
    }
}

function Get-ProjectContainers([string]$Project, [switch]$RunningOnly) {
    $args = @('ps')
    if (-not $RunningOnly) { $args += '-a' }
    $args += @('--filter', "label=com.docker.compose.project=$Project", '--format', '{{.ID}}')
    $rows = @(& docker @args | ForEach-Object { $_.Trim() } | Where-Object { $_ })
    if ($LASTEXITCODE -ne 0) { Fail "Unable to inspect Docker containers for project $Project." }
    return $rows
}

function Get-ProjectVolumes([string]$Project) {
    $rows = @(
        & docker volume ls --filter "label=com.docker.compose.project=$Project" --format '{{.Name}}' |
            ForEach-Object { $_.Trim() } |
            Where-Object { $_ }
    )
    if ($LASTEXITCODE -ne 0) { Fail "Unable to inspect Docker volumes for project $Project." }
    return $rows
}

function Get-ProjectNetworks([string]$Project) {
    $rows = @(
        & docker network ls --filter "label=com.docker.compose.project=$Project" --format '{{.ID}}' |
            ForEach-Object { $_.Trim() } |
            Where-Object { $_ }
    )
    if ($LASTEXITCODE -ne 0) { Fail "Unable to inspect Docker networks for project $Project." }
    return $rows
}

function Get-ServiceContainerId([string]$Project, [string]$Service) {
    $ids = @(
        & docker ps -a `
            --filter "label=com.docker.compose.project=$Project" `
            --filter "label=com.docker.compose.service=$Service" `
            --format '{{.ID}}' |
            ForEach-Object { $_.Trim() } |
            Where-Object { $_ }
    )
    if ($LASTEXITCODE -ne 0) { Fail "Unable to inspect service container $Project/$Service." }
    if ($ids.Count -ne 1) { Fail "Expected exactly one container for $Project/$Service; observed=$($ids.Count)." }
    return $ids[0]
}

function Assert-OneShotSucceeded([string]$Service) {
    $id = Get-ServiceContainerId -Project $CanonicalProject -Service $Service
    $state = (& docker inspect --format '{{.State.Status}}|{{.State.ExitCode}}' $id).Trim()
    if ($LASTEXITCODE -ne 0 -or $state -ne 'exited|0') {
        Fail "ONE_SHOT_SERVICE=FAIL service=$Service state=$state"
    }
    Write-Host "ONE_SHOT_SERVICE=PASS service=$Service"
}

function Assert-RunningService([string]$Service, [switch]$RequireHealthy) {
    $id = Get-ServiceContainerId -Project $CanonicalProject -Service $Service
    $status = (& docker inspect --format '{{.State.Status}}' $id).Trim()
    if ($LASTEXITCODE -ne 0 -or $status -ne 'running') {
        Fail "SERVICE_STATE=FAIL service=$Service status=$status"
    }
    if ($RequireHealthy) {
        $health = (& docker inspect --format '{{if .State.Health}}{{.State.Health.Status}}{{else}}missing{{end}}' $id).Trim()
        if ($LASTEXITCODE -ne 0 -or $health -ne 'healthy') {
            Fail "SERVICE_HEALTH=FAIL service=$Service health=$health"
        }
    }
}

function Get-DockerPublishedPortOwners([int]$Port) {
    $needle = ":${Port}->"
    $rows = @(
        & docker ps --format '{{.ID}}|{{.Names}}|{{.Ports}}|{{.Label "com.docker.compose.project"}}|{{.Label "com.docker.compose.service"}}' |
            Where-Object { $_ -and $_.Contains($needle) }
    )
    if ($LASTEXITCODE -ne 0) { Fail "Unable to inspect Docker published port ownership for $Port." }
    return $rows
}

function Get-PortOwnerSummary([int]$Port) {
    if (-not (Get-Command Get-NetTCPConnection -ErrorAction SilentlyContinue)) {
        return 'host listener inspection unavailable'
    }
    $listeners = @(
        Get-NetTCPConnection -State Listen -LocalPort $Port -ErrorAction SilentlyContinue |
            Where-Object { $_.LocalAddress -in @('127.0.0.1', '0.0.0.0', '::', '::1') }
    )
    if ($listeners.Count -eq 0) { return 'none' }
    $owners = foreach ($ownerPid in @($listeners | Select-Object -ExpandProperty OwningProcess -Unique)) {
        $process = Get-Process -Id ([int]$ownerPid) -ErrorAction SilentlyContinue
        if ($null -eq $process) { "PID=$ownerPid(exited)" } else { "PID=$ownerPid:$($process.ProcessName)" }
    }
    return ($owners -join ',')
}

function Test-PortListening([int]$Port) {
    if (-not (Get-Command Get-NetTCPConnection -ErrorAction SilentlyContinue)) {
        try {
            $client = [Net.Sockets.TcpClient]::new()
            $task = $client.ConnectAsync('127.0.0.1', $Port)
            if (-not $task.Wait(300)) { $client.Dispose(); return $false }
            $connected = $client.Connected
            $client.Dispose()
            return $connected
        }
        catch { return $false }
    }
    return @(
        Get-NetTCPConnection -State Listen -LocalPort $Port -ErrorAction SilentlyContinue |
            Where-Object { $_.LocalAddress -in @('127.0.0.1', '0.0.0.0', '::', '::1') }
    ).Count -gt 0
}

function Assert-PublishedPortSafe([int]$Port, [string]$ExpectedService) {
    if (-not (Test-PortListening -Port $Port)) { return }
    $dockerOwners = @(Get-DockerPublishedPortOwners -Port $Port)
    $expected = @($dockerOwners | Where-Object { $_ -match "\|$CanonicalProject\|$([regex]::Escape($ExpectedService))$" })
    if ($expected.Count -eq 1 -and $dockerOwners.Count -eq 1) { return }
    $hostOwner = Get-PortOwnerSummary -Port $Port
    $dockerText = if ($dockerOwners.Count -eq 0) { 'none' } else { $dockerOwners -join ';' }
    Fail "RUNTIME_OWNERSHIP_CONFLICT=FAIL port=$Port expected=$CanonicalProject/$ExpectedService host_owner=$hostOwner docker_owner=$dockerText"
}

function Assert-CanonicalPublishedPort([int]$Port, [string]$ExpectedService) {
    $dockerOwners = @(Get-DockerPublishedPortOwners -Port $Port)
    $expected = @($dockerOwners | Where-Object { $_ -match "\|$CanonicalProject\|$([regex]::Escape($ExpectedService))$" })
    if ($expected.Count -ne 1 -or $dockerOwners.Count -ne 1 -or -not (Test-PortListening -Port $Port)) {
        $hostOwner = Get-PortOwnerSummary -Port $Port
        $dockerText = if ($dockerOwners.Count -eq 0) { 'none' } else { $dockerOwners -join ';' }
        Fail "PORT_OWNERSHIP=FAIL port=$Port expected=$CanonicalProject/$ExpectedService host_owner=$hostOwner docker_owner=$dockerText"
    }
}

function Assert-PortFree([int]$Port, [string]$Component) {
    if (-not (Test-PortListening -Port $Port)) { return }
    $dockerOwners = @(Get-DockerPublishedPortOwners -Port $Port)
    $hostOwner = Get-PortOwnerSummary -Port $Port
    $dockerText = if ($dockerOwners.Count -eq 0) { 'none' } else { $dockerOwners -join ';' }
    Fail "PORT_OWNERSHIP_CONFLICT=FAIL component=$Component port=$Port host_owner=$hostOwner docker_owner=$dockerText"
}

function Assert-NoLegacyRuntimeResidue {
    foreach ($project in $LegacyProjects) {
        $containers = @(Get-ProjectContainers -Project $project)
        $volumes = @(Get-ProjectVolumes -Project $project)
        $networks = @(Get-ProjectNetworks -Project $project)
        if ($containers.Count -gt 0 -or $volumes.Count -gt 0 -or $networks.Count -gt 0) {
            Fail "LEGACY_RUNTIME_RESIDUE=FAIL project=$project containers=$($containers.Count) volumes=$($volumes.Count) networks=$($networks.Count) action=run-pnpm-runtime-reset"
        }
    }
}

function Remove-ProjectResidue([string]$Project) {
    $containers = @(Get-ProjectContainers -Project $Project)
    if ($containers.Count -gt 0) {
        & docker rm -f @containers *> $null
        if ($LASTEXITCODE -ne 0) { Fail "Unable to remove containers for legacy project $Project." }
    }
    $volumes = @(Get-ProjectVolumes -Project $Project)
    if ($volumes.Count -gt 0) {
        & docker volume rm -f @volumes *> $null
        if ($LASTEXITCODE -ne 0) { Fail "Unable to remove volumes for legacy project $Project." }
    }
    $networks = @(Get-ProjectNetworks -Project $Project)
    foreach ($network in $networks) {
        & docker network rm $network *> $null
        if ($LASTEXITCODE -ne 0) { Fail "Unable to remove network $network for legacy project $Project." }
    }
}

function Remove-LegacyImages {
    $rows = @(& docker image ls --format '{{.Repository}}|{{.ID}}')
    if ($LASTEXITCODE -ne 0) { Fail 'Unable to inspect Docker images.' }
    $ids = @(
        $rows |
            ForEach-Object { $_.Split('|', 2) } |
            Where-Object { $_.Count -eq 2 -and $_[0] -like 'samrim-integration-*' } |
            ForEach-Object { $_[1] } |
            Sort-Object -Unique
    )
    if ($ids.Count -gt 0) {
        & docker image rm @ids *> $null
        if ($LASTEXITCODE -ne 0) { Fail 'Unable to remove obsolete samrim-integration images.' }
    }
}

function Assert-Endpoint([string]$Service, [string]$Uri) {
    try {
        $response = Invoke-RestMethod -Uri $Uri -Method Get -TimeoutSec 5
    }
    catch {
        Fail "SERVICE_ENDPOINT=FAIL service=$Service uri=$Uri error=$($_.Exception.Message)"
    }
    if ($null -eq $response -or $response.status -ne 'ok' -or $response.service -ne $Service) {
        Fail "SERVICE_ENDPOINT=FAIL service=$Service uri=$Uri"
    }
}

function Assert-Mailpit([hashtable]$EnvMap) {
    $port = Require-TcpPort -Map $EnvMap -Name 'SAMRIM_MAILPIT_WEB_PORT'
    try {
        $response = Invoke-WebRequest -Uri "http://127.0.0.1:$port/" -Method Get -TimeoutSec 5 -SkipHttpErrorCheck
    }
    catch {
        Fail "MAILPIT_READY=FAIL error=$($_.Exception.Message)"
    }
    if ($response.StatusCode -lt 200 -or $response.StatusCode -ge 500) {
        Fail "MAILPIT_READY=FAIL status=$($response.StatusCode)"
    }
}

function Assert-CanonicalRuntime([hashtable]$EnvMap) {
    Assert-OneShotSucceeded -Service 'identity-migrate'
    Assert-OneShotSucceeded -Service 'dsh-migrate'
    Assert-RunningService -Service 'postgres' -RequireHealthy
    Assert-RunningService -Service 'mailpit'
    Assert-RunningService -Service 'identity' -RequireHealthy
    Assert-RunningService -Service 'dsh' -RequireHealthy

    $identityPort = Require-TcpPort -Map $EnvMap -Name 'SAMRIM_IDENTITY_PORT'
    $dshPort = Require-TcpPort -Map $EnvMap -Name 'SAMRIM_DSH_PORT'
    $mailpitPort = Require-TcpPort -Map $EnvMap -Name 'SAMRIM_MAILPIT_WEB_PORT'
    Assert-CanonicalPublishedPort -Port $identityPort -ExpectedService 'identity'
    Assert-CanonicalPublishedPort -Port $dshPort -ExpectedService 'dsh'
    Assert-CanonicalPublishedPort -Port $mailpitPort -ExpectedService 'mailpit'

    $identityBase = (Require-EnvValue -Map $EnvMap -Name 'IDENTITY_API_BASE_URL').TrimEnd('/')
    $dshBase = (Require-EnvValue -Map $EnvMap -Name 'DSH_API_BASE_URL').TrimEnd('/')
    Assert-Endpoint -Service 'identity' -Uri "$identityBase/identity/health"
    Assert-Endpoint -Service 'identity' -Uri "$identityBase/identity/readiness"
    Assert-Endpoint -Service 'dsh' -Uri "$dshBase/dsh/health"
    Assert-Endpoint -Service 'dsh' -Uri "$dshBase/dsh/readiness"
    Assert-Mailpit -EnvMap $EnvMap
}

function Test-CanonicalRuntimeReady([hashtable]$EnvMap) {
    try {
        Assert-NoLegacyRuntimeResidue
        Assert-CanonicalRuntime -EnvMap $EnvMap
        return $true
    }
    catch {
        return $false
    }
}

function Start-CanonicalRuntime {
    $envMap = Ensure-Environment
    Set-CanonicalEnvironment -Map $envMap
    Ensure-Docker
    Assert-NoLegacyRuntimeResidue

    if (-not (Test-Path -LiteralPath $ComposePath -PathType Leaf)) {
        Fail "Canonical Compose file is missing: $ComposePath"
    }
    $configCode = Invoke-ComposeRaw -Arguments @('config', '--quiet') -Quiet
    if ($configCode -ne 0) { Fail 'CANONICAL_COMPOSE_CONFIG=FAIL' }

    Assert-PublishedPortSafe -Port (Require-TcpPort -Map $envMap -Name 'SAMRIM_IDENTITY_PORT') -ExpectedService 'identity'
    Assert-PublishedPortSafe -Port (Require-TcpPort -Map $envMap -Name 'SAMRIM_DSH_PORT') -ExpectedService 'dsh'
    Assert-PublishedPortSafe -Port (Require-TcpPort -Map $envMap -Name 'SAMRIM_MAILPIT_WEB_PORT') -ExpectedService 'mailpit'

    Invoke-Compose -Arguments @('up', '-d', '--build', '--wait', '--wait-timeout', '180', '--remove-orphans')
    Assert-CanonicalRuntime -EnvMap $envMap

    Write-Host 'CANONICAL_LOCAL_RUNTIME=PASS'
    Write-Host 'DOCKER_OWNS=postgres,mailpit,identity,dsh'
    Write-Host "IDENTITY_API=$(Require-EnvValue -Map $envMap -Name 'IDENTITY_API_BASE_URL')"
    Write-Host "DSH_API=$(Require-EnvValue -Map $envMap -Name 'DSH_API_BASE_URL')"
    Write-Host "MAILPIT_WEB=http://127.0.0.1:$(Require-TcpPort -Map $envMap -Name 'SAMRIM_MAILPIT_WEB_PORT')"
    return $envMap
}

function Ensure-CanonicalRuntime {
    $envMap = Ensure-Environment
    Set-CanonicalEnvironment -Map $envMap
    Ensure-Docker
    if (Test-CanonicalRuntimeReady -EnvMap $envMap) {
        Write-Host 'CANONICAL_LOCAL_RUNTIME=READY'
        return $envMap
    }
    return Start-CanonicalRuntime
}

function Stop-CanonicalRuntime {
    $null = Ensure-Environment
    Ensure-Docker
    Invoke-Compose -Arguments @('down', '--remove-orphans')
    if (@(Get-ProjectContainers -Project $CanonicalProject).Count -gt 0) {
        Fail 'CANONICAL_RUNTIME_STOP=FAIL containers remain.'
    }
    Write-Host 'CANONICAL_RUNTIME_STOP=PASS data_volume=preserved'
}

function Show-RuntimeStatus {
    $null = Ensure-Environment
    Ensure-Docker
    Write-Host "CANONICAL_PROJECT=$CanonicalProject"
    $base = Get-ComposeBaseArgs
    & docker @base ps -a
    if ($LASTEXITCODE -ne 0) { Fail 'Unable to inspect canonical Compose runtime.' }
    foreach ($project in $LegacyProjects) {
        Write-Host "LEGACY_PROJECT=$project containers=$(@(Get-ProjectContainers -Project $project).Count) volumes=$(@(Get-ProjectVolumes -Project $project).Count) networks=$(@(Get-ProjectNetworks -Project $project).Count)"
    }
}

function Show-RuntimeLogs {
    $null = Ensure-Environment
    Ensure-Docker
    $base = Get-ComposeBaseArgs
    & docker @base logs --tail 200 -f
    if ($LASTEXITCODE -ne 0) { Fail 'Docker Compose logs failed.' }
}

function Assert-NoNativeBackendProcesses {
    if (-not (Get-Command Get-CimInstance -ErrorAction SilentlyContinue)) { return }
    $repoNeedle = $RepoRoot.ToLowerInvariant()
    $matches = @(
        Get-CimInstance Win32_Process -ErrorAction SilentlyContinue |
            Where-Object {
                $command = [string]$_.CommandLine
                if ([string]::IsNullOrWhiteSpace($command)) { return $false }
                $lower = $command.ToLowerInvariant()
                $inRepo = $lower.Contains($repoNeedle)
                $backend = $lower.Contains('services\identity') -or $lower.Contains('services/identity') -or $lower.Contains('services\dsh') -or $lower.Contains('services/dsh')
                $nativeServer = $lower.Contains('go run') -or $lower.Contains('cmd\api') -or $lower.Contains('cmd/api')
                return $inRepo -and $backend -and $nativeServer
            }
    )
    if ($matches.Count -gt 0) {
        $summary = $matches | ForEach-Object { "PID=$($_.ProcessId) $($_.Name)" }
        Fail "NATIVE_BACKEND_RUNTIME=FAIL $($summary -join '; ')"
    }
    Write-Host 'NATIVE_BACKEND_RUNTIME=0'
}

function Invoke-RuntimeDoctor {
    $envMap = Ensure-Environment
    Set-CanonicalEnvironment -Map $envMap
    Ensure-Docker

    $composeFiles = @(
        Get-ChildItem -LiteralPath $ComposeDir -File -ErrorAction Stop |
            Where-Object { $_.Name -match '^compose(?:\..+)?\.ya?ml$' }
    )
    if ($composeFiles.Count -ne 1 -or $composeFiles[0].FullName -ne $ComposePath) {
        Fail "CANONICAL_LOCAL_COMPOSE_FILES=FAIL observed=$($composeFiles.Name -join ',')"
    }
    Write-Host 'CANONICAL_LOCAL_COMPOSE_FILES=1'

    $configCode = Invoke-ComposeRaw -Arguments @('config', '--quiet') -Quiet
    if ($configCode -ne 0) { Fail 'CANONICAL_COMPOSE_CONFIG=FAIL' }
    Assert-NoLegacyRuntimeResidue
    Assert-NoNativeBackendProcesses
    Assert-CanonicalRuntime -EnvMap $envMap

    if (Test-Path -LiteralPath $OwnershipVerifier -PathType Leaf) {
        & node $OwnershipVerifier
        if ($LASTEXITCODE -ne 0) { Fail 'Repository runtime ownership verifier failed.' }
    }

    Write-Host 'PARALLEL_LOCAL_RUNTIME_AUTHORITY=0'
    Write-Host 'PORT_OWNERSHIP=PASS'
    Write-Host 'SERVICE_HEALTH=PASS'
    Write-Host 'RUNTIME_DOCTOR=PASS'
}

function Reset-CanonicalRuntime {
    $envMap = Ensure-Environment
    Ensure-Docker
    Write-Host 'RUNTIME_RESET=DESTRUCTIVE_LOCAL_DATA scope=samrim Docker containers/networks/volumes; local .env secrets are preserved'

    $null = Invoke-ComposeRaw -Arguments @('down', '--volumes', '--remove-orphans')
    Remove-ProjectResidue -Project $CanonicalProject
    foreach ($project in $LegacyProjects) {
        Remove-ProjectResidue -Project $project
    }
    Remove-LegacyImages

    foreach ($project in @($CanonicalProject) + $LegacyProjects) {
        $containers = @(Get-ProjectContainers -Project $project)
        $volumes = @(Get-ProjectVolumes -Project $project)
        $networks = @(Get-ProjectNetworks -Project $project)
        if ($containers.Count -gt 0 -or $volumes.Count -gt 0 -or $networks.Count -gt 0) {
            Fail "RUNTIME_RESET=FAIL project=$project containers=$($containers.Count) volumes=$($volumes.Count) networks=$($networks.Count)"
        }
    }

    Assert-PortFree -Port (Require-TcpPort -Map $envMap -Name 'SAMRIM_IDENTITY_PORT') -Component 'identity'
    Assert-PortFree -Port (Require-TcpPort -Map $envMap -Name 'SAMRIM_DSH_PORT') -Component 'dsh'
    Assert-PortFree -Port (Require-TcpPort -Map $envMap -Name 'SAMRIM_MAILPIT_WEB_PORT') -Component 'mailpit-web'
    Write-Host 'LEGACY_RUNTIME_RESIDUE=0'
    Write-Host 'RUNTIME_RESET=PASS final_state=DOWN secrets=preserved'
}

function Start-ControlPanel {
    $envMap = Ensure-CanonicalRuntime
    Set-CanonicalEnvironment -Map $envMap

    $originRaw = Require-EnvValue -Map $envMap -Name 'CONTROL_PANEL_PUBLIC_ORIGIN'
    try { $origin = [Uri]::new($originRaw, [UriKind]::Absolute) }
    catch { Fail "CONTROL_PANEL_PUBLIC_ORIGIN is not a valid absolute URI: $originRaw" }

    $originAuthority = $origin.GetLeftPart([UriPartial]::Authority)
    if (
        $origin.Scheme -ne 'http' -or
        $origin.Host -ne '127.0.0.1' -or
        $origin.IsDefaultPort -or
        $origin.AbsolutePath -ne '/' -or
        -not [string]::IsNullOrEmpty($origin.Query) -or
        -not [string]::IsNullOrEmpty($origin.Fragment) -or
        $originAuthority -ne $originRaw.TrimEnd('/')
    ) {
        Fail "CONTROL_PANEL_ORIGIN_CONTRACT=FAIL observed=$originRaw"
    }

    $corsRaw = Require-EnvValue -Map $envMap -Name 'IDENTITY_CORS_ALLOWED_ORIGINS'
    $corsOrigins = @($corsRaw.Split(',') | ForEach-Object { $_.Trim().TrimEnd('/') } | Where-Object { $_ })
    if ($corsOrigins.Count -ne 1 -or $corsOrigins[0] -ne $originAuthority) {
        Fail "CONTROL_PANEL_CORS_CONTRACT=FAIL control_origin=$originAuthority identity_cors=$corsRaw"
    }

    Assert-PortFree -Port $origin.Port -Component 'control-panel'
    $controlRoot = Join-Path $RepoRoot 'apps\control-panel'
    Write-Host "RUNTIME_OWNER=tools/dev/runtime.ps1 component=control-panel origin=$originAuthority backend_owner=docker"
    & pnpm --dir $controlRoot exec next dev -H $origin.Host -p $origin.Port
    if ($LASTEXITCODE -ne 0) { Fail "Control Panel exited with code $LASTEXITCODE." }
}

function Resolve-AdbTargetSerial([string]$RequestedSerial) {
    if (-not (Get-Command adb -ErrorAction SilentlyContinue)) { return '' }
    $serials = @(
        & adb devices |
            Where-Object { $_ -match '\tdevice$' } |
            ForEach-Object { ($_ -split '\t', 2)[0].Trim() } |
            Where-Object { $_ }
    )
    if ($LASTEXITCODE -ne 0) { Fail 'Unable to query ADB devices.' }

    if (-not [string]::IsNullOrWhiteSpace($RequestedSerial)) {
        if ($RequestedSerial -notin $serials) {
            Fail "ADB target mismatch: requested '$RequestedSerial' is not an attached device."
        }
        return $RequestedSerial
    }
    if ($serials.Count -eq 0) { return '' }
    if ($serials.Count -gt 1) {
        Fail ("Multiple ADB devices are attached; set BTHWANI_ADB_SERIAL. Devices: " + ($serials -join ', '))
    }
    return $serials[0]
}

function Start-Mobile([ValidateSet('app-client', 'app-partner', 'app-captain', 'app-field')][string]$App) {
    $envMap = Ensure-CanonicalRuntime
    Set-CanonicalEnvironment -Map $envMap

    $appRoot = Join-Path $RepoRoot ("apps\" + $App)
    $packagePath = Join-Path $appRoot 'package.json'
    $projectPath = Join-Path $appRoot 'project.json'
    $mobileConfig = Join-Path $appRoot 'mobile.config.json'
    foreach ($required in @($packagePath, $projectPath, $mobileConfig)) {
        if (-not (Test-Path -LiteralPath $required -PathType Leaf)) {
            Fail "Mobile runtime prerequisite is missing: $required"
        }
    }

    $package = Get-Content -LiteralPath $packagePath -Raw | ConvertFrom-Json
    if ($null -ne $package.scripts.PSObject.Properties['start']) {
        Fail "$App package.json exposes a forbidden secondary local start authority."
    }
    $project = Get-Content -LiteralPath $projectPath -Raw | ConvertFrom-Json
    if (@($project.tags) -notcontains 'type:app' -or [string]$project.root -ne ("apps/" + $App)) {
        Fail "$App project ownership metadata is invalid."
    }

    $appToken = ($App -replace '[^A-Za-z0-9]', '_').ToUpperInvariant()
    $metroPort = Require-TcpPort -Map $envMap -Name "SAMRIM_${appToken}_METRO_PORT"
    $identityPort = Require-TcpPort -Map $envMap -Name 'SAMRIM_IDENTITY_PORT'
    $dshPort = Require-TcpPort -Map $envMap -Name 'SAMRIM_DSH_PORT'
    Assert-PortFree -Port $metroPort -Component $App
    Assert-CanonicalPublishedPort -Port $identityPort -ExpectedService 'identity'
    Assert-CanonicalPublishedPort -Port $dshPort -ExpectedService 'dsh'

    $adbSerial = Resolve-AdbTargetSerial -RequestedSerial $DeviceSerial
    if (-not [string]::IsNullOrWhiteSpace($adbSerial)) {
        foreach ($port in @($metroPort, $identityPort, $dshPort)) {
            & adb -s $adbSerial reverse "tcp:$port" "tcp:$port" *> $null
            if ($LASTEXITCODE -ne 0) { Fail "ADB reverse failed for $adbSerial port $port." }
        }
        Write-Host "ADB_TARGET=PASS serial=$adbSerial app=$App"
        Write-Host "ADB_REVERSE=READY serial=$adbSerial ports=$metroPort,$identityPort,$dshPort"
    }

    $nodeOptions = [Environment]::GetEnvironmentVariable('NODE_OPTIONS', 'Process')
    if ([string]::IsNullOrWhiteSpace($nodeOptions)) {
        $nodeOptions = '--dns-result-order=ipv4first'
    }
    elseif ($nodeOptions -match '(?i)(^|\s)--dns-result-order=\S+') {
        $nodeOptions = [regex]::Replace($nodeOptions, '(?i)(^|\s)--dns-result-order=\S+', '$1--dns-result-order=ipv4first')
    }
    else {
        $nodeOptions = "$nodeOptions --dns-result-order=ipv4first"
    }
    [Environment]::SetEnvironmentVariable('NODE_OPTIONS', $nodeOptions, 'Process')

    $expoArgs = @('--dir', $appRoot, 'exec', 'expo', 'start', '--dev-client', '--localhost', '--port', [string]$metroPort)
    if ($ClearCache) { $expoArgs += '--clear' }

    Write-Host "RUNTIME_OWNER=tools/dev/runtime.ps1 component=$App metro_port=$metroPort backend_owner=docker"
    & pnpm @expoArgs
    if ($LASTEXITCODE -ne 0) { Fail "$App Expo runtime exited with code $LASTEXITCODE." }
}

Push-Location $RepoRoot
try {
    switch ($Action) {
        'Up' { $null = Start-CanonicalRuntime }
        'Down' { Stop-CanonicalRuntime }
        'Restart' { Stop-CanonicalRuntime; $null = Start-CanonicalRuntime }
        'Status' { Show-RuntimeStatus }
        'Logs' { Show-RuntimeLogs }
        'Doctor' { Invoke-RuntimeDoctor }
        'Reset' { Reset-CanonicalRuntime }
        'Control' { Start-ControlPanel }
        'Client' { Start-Mobile -App 'app-client' }
        'Partner' { Start-Mobile -App 'app-partner' }
        'Captain' { Start-Mobile -App 'app-captain' }
        'Field' { Start-Mobile -App 'app-field' }
        'Scrcpy' {
            if (-not (Get-Command scrcpy -ErrorAction SilentlyContinue)) { Fail 'scrcpy is not available on PATH.' }
            Write-Host 'RUNTIME_OWNER=tools/dev/runtime.ps1 component=scrcpy'
            & scrcpy --tcpip
            if ($LASTEXITCODE -ne 0) { Fail "scrcpy exited with code $LASTEXITCODE." }
        }
    }
}
finally {
    Pop-Location
}
