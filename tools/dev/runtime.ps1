#Requires -Version 7.4
[CmdletBinding()]
param(
    [Parameter(Mandatory)]
    [ValidateSet(
        'DailyUp',
        'DailyDown',
        'Status',
        'Identity',
        'Dsh',
        'Control',
        'Client',
        'Partner',
        'Captain',
        'Field',
        'Scrcpy',
        'IntegrationClose'
    )]
    [string]$Action,

    [string]$DeviceSerial = $env:BTHWANI_ADB_SERIAL,
    [switch]$ClearCache,
    [string]$ExpectedBranch = ''
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$RepoRoot = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
$EnvPath = Join-Path $RepoRoot 'infra\local\compose\.env'
$DailyCompose = Join-Path $RepoRoot 'infra\local\compose\compose.yaml'
$IntegrationCompose = Join-Path $RepoRoot 'infra\local\compose\compose.integration.yaml'
$EnsureLocalEnv = Join-Path $PSScriptRoot 'ensure-local-env.ps1'
$VerifyIntegration = Join-Path $PSScriptRoot 'verify-integration-runtime.ps1'
$VerifyIdentity = Join-Path $PSScriptRoot 'verify-identity-runtime.mjs'
$VerifyDsh = Join-Path $PSScriptRoot 'verify-dsh-runtime.mjs'
$DailyProject = 'samrim-local'
$IntegrationProject = 'samrim-integration'

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
    $global:LASTEXITCODE = 0
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

function Ensure-Docker {
    if (-not (Get-Command docker -ErrorAction SilentlyContinue)) {
        Fail 'Docker CLI is required for LOCAL_INTEGRATION runtime.'
    }
    & docker version *> $null
    if ($LASTEXITCODE -ne 0) { Fail 'Docker daemon is not available.' }
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
        & docker volume ls `
            --filter "label=com.docker.compose.project=$Project" `
            --format '{{.Name}}' |
            ForEach-Object { $_.Trim() } |
            Where-Object { $_ }
    )
    if ($LASTEXITCODE -ne 0) { Fail "Unable to inspect Docker volumes for project $Project." }
    return $rows
}

function Get-ProjectServices([string]$Project, [switch]$RunningOnly) {
    $args = @('ps')
    if (-not $RunningOnly) { $args += '-a' }
    $args += @(
        '--filter', "label=com.docker.compose.project=$Project",
        '--format', '{{.Label "com.docker.compose.service"}}'
    )
    $rows = @(& docker @args | ForEach-Object { $_.Trim() } | Where-Object { $_ } | Sort-Object -Unique)
    if ($LASTEXITCODE -ne 0) { Fail "Unable to inspect Docker services for project $Project." }
    return $rows
}

function Invoke-ComposeRaw([string]$Project, [string]$ComposeFile, [string[]]$Arguments) {
    $base = @(
        'compose',
        '--ansi', 'never',
        '--progress', 'plain',
        '--project-name', $Project,
        '--env-file', $EnvPath,
        '-f', $ComposeFile
    )
    $output = @(& docker @base @Arguments 2>&1)
    $exitCode = $LASTEXITCODE
    $output | ForEach-Object { Write-Host $_ }
    return [int]$exitCode
}

function Invoke-Compose([string]$Project, [string]$ComposeFile, [string[]]$Arguments) {
    $code = Invoke-ComposeRaw -Project $Project -ComposeFile $ComposeFile -Arguments $Arguments
    if ($code -ne 0) {
        Fail "Docker Compose failed for project ${Project}: $($Arguments -join ' ')"
    }
}

function Assert-IntegrationZero {
    $containers = @(Get-ProjectContainers -Project $IntegrationProject)
    $volumes = @(Get-ProjectVolumes -Project $IntegrationProject)
    if ($containers.Count -gt 0 -or $volumes.Count -gt 0) {
        Fail "INTEGRATION_RUNTIME_RESIDUE=FAIL containers=$($containers.Count) volumes=$($volumes.Count)"
    }
    Write-Host 'INTEGRATION_RUNTIME_RESIDUE=0'
}

function Reset-IntegrationRuntime {
    Invoke-Compose `
        -Project $IntegrationProject `
        -ComposeFile $IntegrationCompose `
        -Arguments @('down', '--volumes', '--remove-orphans')
    Assert-IntegrationZero
}

function Reset-IntegrationIfPresent {
    $containers = @(Get-ProjectContainers -Project $IntegrationProject)
    $volumes = @(Get-ProjectVolumes -Project $IntegrationProject)
    if ($containers.Count -eq 0 -and $volumes.Count -eq 0) { return }

    Write-Host "RUNTIME_MODE_TRANSITION=FULL_INTEGRATION_TO_DAILY_DEV containers=$($containers.Count) volumes=$($volumes.Count)"
    Reset-IntegrationRuntime
}

function Assert-DailyRuntime {
    $running = @(Get-ProjectServices -Project $DailyProject -RunningOnly)
    $expected = @('mailpit', 'postgres')
    if (($running -join ',') -ne ($expected -join ',')) {
        Fail "DAILY_DEV service census mismatch: running=$($running -join ',') expected=$($expected -join ',')"
    }

    $all = @(Get-ProjectServices -Project $DailyProject)
    $unexpected = @($all | Where-Object { $_ -notin $expected })
    if ($unexpected.Count -gt 0) {
        Fail "DAILY_DEV Docker ownership violation: unexpected services=$($unexpected -join ',')"
    }

    Write-Host 'DAILY_RUNTIME_DOCKER_DOMAIN_SERVICES=0'
    Write-Host 'RUNTIME_MODE=DAILY_DEV'
    Write-Host 'DOCKER_OWNS=postgres,mailpit'
    Write-Host 'HOST_OWNS=identity,dsh,control-panel,mobile,scrcpy'
}

function Ensure-DailyRuntime {
    $envMap = Ensure-Environment
    Ensure-Docker

    # Selecting any DAILY_DEV action is an explicit local mode transition.
    # FULL_INTEGRATION is ephemeral and must never survive into DAILY_DEV.
    Reset-IntegrationIfPresent

    Invoke-Compose `
        -Project $DailyProject `
        -ComposeFile $DailyCompose `
        -Arguments @('up', '-d', '--wait', '--wait-timeout', '120', '--remove-orphans', 'postgres', 'mailpit')

    Assert-DailyRuntime
    Assert-IntegrationZero
    return $envMap
}

function Stop-DailyRuntime {
    $null = Ensure-Environment
    Ensure-Docker
    Invoke-Compose `
        -Project $DailyProject `
        -ComposeFile $DailyCompose `
        -Arguments @('down', '--remove-orphans')

    $containers = @(Get-ProjectContainers -Project $DailyProject)
    if ($containers.Count -gt 0) { Fail 'DAILY_RUNTIME_SHUTDOWN=FAIL project containers remain.' }
    Write-Host 'LOCAL_RUNTIME=DOWN owner=DAILY_DEV data_volume=preserved'
}

function Show-RuntimeStatus {
    Ensure-Docker
    foreach ($entry in @(
        @{ Project = $DailyProject; Label = 'DAILY_DEV' },
        @{ Project = $IntegrationProject; Label = 'FULL_INTEGRATION' }
    )) {
        Write-Host ''
        Write-Host "=== $($entry.Label) ($($entry.Project)) ==="
        $rows = @(
            & docker ps -a `
                --filter "label=com.docker.compose.project=$($entry.Project)" `
                --format 'table {{.Names}}\t{{.Status}}\t{{.Ports}}'
        )
        if ($LASTEXITCODE -ne 0) { Fail "Unable to inspect Docker project: $($entry.Project)" }
        if ($rows.Count -eq 0) { Write-Host 'containers=0' } else { $rows | Write-Host }
        $volumes = @(Get-ProjectVolumes -Project $entry.Project)
        Write-Host "volumes=$($volumes.Count)"
    }

    $integrationContainers = @(Get-ProjectContainers -Project $IntegrationProject)
    $integrationVolumes = @(Get-ProjectVolumes -Project $IntegrationProject)
    Write-Host ''
    Write-Host 'RUNTIME_STATUS=PASS'
    Write-Host "INTEGRATION_CONTAINERS=$($integrationContainers.Count)"
    Write-Host "INTEGRATION_VOLUMES=$($integrationVolumes.Count)"
}

function Get-PortOwnerSummary([object[]]$Listeners) {
    $ownerPids = @($Listeners | Select-Object -ExpandProperty OwningProcess -Unique)
    $owners = foreach ($ownerPid in $ownerPids) {
        $process = Get-Process -Id ([int]$ownerPid) -ErrorAction SilentlyContinue
        if ($null -eq $process) { "PID=$ownerPid (exited)" }
        else { "PID=$ownerPid $($process.ProcessName)" }
    }
    if ($owners.Count -eq 0) { return 'unknown process' }
    return ($owners -join ', ')
}

function Assert-PortAvailable([int]$Port, [string]$Component) {
    $listeners = @(
        Get-NetTCPConnection -State Listen -LocalPort $Port -ErrorAction SilentlyContinue |
            Where-Object { $_.LocalAddress -in @('127.0.0.1', '0.0.0.0', '::') }
    )
    if ($listeners.Count -eq 0) { return }
    $owners = Get-PortOwnerSummary -Listeners $listeners
    Fail "RUNTIME_OWNERSHIP_CONFLICT=FAIL component=$Component port=$Port owner=$owners"
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

function Start-GoService([ValidateSet('identity', 'dsh')][string]$Service) {
    $envMap = Ensure-DailyRuntime
    Set-CanonicalEnvironment -Map $envMap

    $serviceRoot = Join-Path $RepoRoot ("services\" + $Service)
    $backendPath = Join-Path $serviceRoot 'backend'
    $projectPath = Join-Path $serviceRoot 'project.json'
    foreach ($required in @(
        $projectPath,
        (Join-Path $backendPath 'go.mod'),
        (Join-Path $backendPath 'cmd\api\main.go')
    )) {
        if (-not (Test-Path -LiteralPath $required -PathType Leaf)) {
            Fail "Requested Go service is not materialized correctly: $required"
        }
    }

    $project = Get-Content -LiteralPath $projectPath -Raw | ConvertFrom-Json
    if (@($project.tags) -notcontains 'type:service' -or [string]$project.root -ne ("services/" + $Service)) {
        Fail "$Service project ownership metadata is invalid."
    }

    $portKey = 'SAMRIM_' + (($Service -replace '[^A-Za-z0-9]', '_').ToUpperInvariant()) + '_PORT'
    $runtimePort = Require-TcpPort -Map $envMap -Name $portKey
    Assert-PortAvailable -Port $runtimePort -Component $Service

    [Environment]::SetEnvironmentVariable('PORT', [string]$runtimePort, 'Process')
    [Environment]::SetEnvironmentVariable('BTHWANI_LISTEN_HOST', '127.0.0.1', 'Process')

    if ($Service -eq 'identity') {
        $dbUserRaw = Require-EnvValue -Map $envMap -Name 'SAMRIM_POSTGRES_USER'
        $dbPasswordRaw = Require-EnvValue -Map $envMap -Name 'SAMRIM_POSTGRES_PASSWORD'
        $dbNameRaw = Require-EnvValue -Map $envMap -Name 'SAMRIM_POSTGRES_DB'
        $dbPort = Require-TcpPort -Map $envMap -Name 'SAMRIM_POSTGRES_PORT'
        $mailpitSmtpPort = Require-TcpPort -Map $envMap -Name 'SAMRIM_MAILPIT_SMTP_PORT'

        $dbUser = [Uri]::EscapeDataString($dbUserRaw)
        $dbPassword = [Uri]::EscapeDataString($dbPasswordRaw)
        $dbName = [Uri]::EscapeDataString($dbNameRaw)
        $databaseURL = "postgres://${dbUser}:${dbPassword}@127.0.0.1:${dbPort}/${dbName}?sslmode=disable"

        [Environment]::SetEnvironmentVariable('IDENTITY_DATABASE_URL', $databaseURL, 'Process')
        [Environment]::SetEnvironmentVariable('IDENTITY_MAINTENANCE_DATABASE_URL', $databaseURL, 'Process')
        [Environment]::SetEnvironmentVariable('IDENTITY_MIGRATION_DATABASE_URL', $databaseURL, 'Process')
        [Environment]::SetEnvironmentVariable('IDENTITY_MAILPIT_SMTP_ADDR', "127.0.0.1:${mailpitSmtpPort}", 'Process')
        [Environment]::SetEnvironmentVariable('IDENTITY_AUTO_MIGRATE', 'false', 'Process')
        [Environment]::SetEnvironmentVariable('BTHWANI_EXPECTED_DATABASE_HOST', '127.0.0.1', 'Process')
        [Environment]::SetEnvironmentVariable('BTHWANI_EXPECTED_DATABASE_PORT', [string]$dbPort, 'Process')
        [Environment]::SetEnvironmentVariable('BTHWANI_EXPECTED_DATABASE_NAME', $dbNameRaw, 'Process')
        [Environment]::SetEnvironmentVariable('BTHWANI_EXPECTED_DATABASE_USER', $dbUserRaw, 'Process')
    }
    else {
        $identityPort = Require-TcpPort -Map $envMap -Name 'SAMRIM_IDENTITY_PORT'
        [Environment]::SetEnvironmentVariable('DSH_IDENTITY_API_BASE_URL', "http://127.0.0.1:${identityPort}", 'Process')
    }

    Write-Host "RUNTIME_OWNER=tools/dev/runtime.ps1 component=$Service port=$runtimePort"
    Push-Location $backendPath
    try {
        if ($Service -eq 'identity') {
            Write-Host 'Identity schema migration/verification: starting'
            & go run ./cmd/migrate
            if ($LASTEXITCODE -ne 0) { Fail 'Identity schema migration/verification failed.' }
            Write-Host 'Identity schema migration/verification: PASS'
        }

        & go run ./cmd/api
        if ($LASTEXITCODE -ne 0) { Fail "$Service exited with code $LASTEXITCODE." }
    }
    finally {
        Pop-Location
    }
}

function Start-ControlPanel {
    $envMap = Ensure-DailyRuntime
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

    Assert-PortAvailable -Port $origin.Port -Component 'control-panel'
    $controlRoot = Join-Path $RepoRoot 'apps\control-panel'
    Write-Host "RUNTIME_OWNER=tools/dev/runtime.ps1 component=control-panel origin=$originAuthority"
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
    $envMap = Ensure-DailyRuntime
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
    $metroPortKey = "SAMRIM_${appToken}_METRO_PORT"
    $metroPort = Require-TcpPort -Map $envMap -Name $metroPortKey
    $identityPort = Require-TcpPort -Map $envMap -Name 'SAMRIM_IDENTITY_PORT'
    $dshPort = Require-TcpPort -Map $envMap -Name 'SAMRIM_DSH_PORT'
    if (@($metroPort, $identityPort, $dshPort) | Group-Object | Where-Object { $_.Count -gt 1 }) {
        Fail "Mobile runtime ports must be distinct for $App."
    }

    Assert-PortAvailable -Port $metroPort -Component $App

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

    Write-Host "RUNTIME_OWNER=tools/dev/runtime.ps1 component=$App metro_port=$metroPort"
    & pnpm @expoArgs
    if ($LASTEXITCODE -ne 0) { Fail "$App Expo runtime exited with code $LASTEXITCODE." }
}

function Test-PortBindable([int]$Port) {
    $listener = $null
    try {
        $listener = [Net.Sockets.TcpListener]::new([Net.IPAddress]::Loopback, $Port)
        $listener.Start()
        return $true
    }
    catch { return $false }
    finally { if ($null -ne $listener) { try { $listener.Stop() } catch {} } }
}

function Assert-IntegrationPortsAvailable([hashtable]$EnvMap) {
    foreach ($key in @(
        'SAMRIM_POSTGRES_PORT',
        'SAMRIM_MAILPIT_SMTP_PORT',
        'SAMRIM_MAILPIT_WEB_PORT',
        'SAMRIM_IDENTITY_PORT',
        'SAMRIM_DSH_PORT'
    )) {
        $port = Require-TcpPort -Map $EnvMap -Name $key
        if (-not (Test-PortBindable -Port $port)) {
            Fail "INTEGRATION_HOST_PORT_PREFLIGHT=FAIL key=$key port=$port owner=host-process"
        }
    }
    Write-Host 'INTEGRATION_HOST_PORT_PREFLIGHT=PASS'
}

function Show-IntegrationDiagnostics {
    try { $null = Invoke-ComposeRaw -Project $IntegrationProject -ComposeFile $IntegrationCompose -Arguments @('ps', '-a') } catch {}
    try { $null = Invoke-ComposeRaw -Project $IntegrationProject -ComposeFile $IntegrationCompose -Arguments @('logs', '--tail', '200') } catch {}
}

function Invoke-IntegrationClose {
    $envMap = Ensure-Environment
    Ensure-Docker

    $branch = (& git -C $RepoRoot branch --show-current).Trim()
    if ($LASTEXITCODE -ne 0 -or [string]::IsNullOrWhiteSpace($branch)) { Fail 'Unable to determine current Git branch.' }
    if (-not [string]::IsNullOrWhiteSpace($ExpectedBranch) -and $branch -ne $ExpectedBranch) {
        Fail "Expected branch '$ExpectedBranch', found '$branch'."
    }
    $status = @(& git -C $RepoRoot status --porcelain --untracked-files=all)
    if ($LASTEXITCODE -ne 0 -or $status.Count -gt 0) { Fail 'Working tree must be clean before integration proof.' }

    $proofError = $null
    $cleanupError = $null
    try {
        $dailyContainers = @(Get-ProjectContainers -Project $DailyProject)
        if ($dailyContainers.Count -gt 0) {
            Write-Host "RUNTIME_MODE_TRANSITION=DAILY_DEV_TO_FULL_INTEGRATION containers=$($dailyContainers.Count)"
            Invoke-Compose -Project $DailyProject -ComposeFile $DailyCompose -Arguments @('down', '--remove-orphans')
        }

        Reset-IntegrationRuntime
        Assert-IntegrationPortsAvailable -EnvMap $envMap

        Invoke-Compose -Project $IntegrationProject -ComposeFile $IntegrationCompose -Arguments @('config', '--quiet')
        Write-Host 'INTEGRATION_DOCKER_CONFIG=PASS'
        Invoke-Compose -Project $IntegrationProject -ComposeFile $IntegrationCompose -Arguments @('up', '-d', '--build', '--wait', '--wait-timeout', '180')

        if (-not (Test-Path -LiteralPath $VerifyIntegration -PathType Leaf)) {
            Fail "Integration verifier is missing: $VerifyIntegration"
        }
        & pwsh -NoProfile -NonInteractive -ExecutionPolicy Bypass -File $VerifyIntegration -EnvFile $EnvPath -Attempts 60 -DelaySeconds 2
        if ($LASTEXITCODE -ne 0) { Fail 'Integration endpoint verification failed.' }

        $running = @(Get-ProjectServices -Project $IntegrationProject -RunningOnly)
        $expected = @('dsh', 'identity', 'mailpit', 'postgres')
        if (($running -join ',') -ne ($expected -join ',')) {
            Fail "Integration service census mismatch: running=$($running -join ',') expected=$($expected -join ',')"
        }

        foreach ($semanticVerifier in @(
            @{ Path = $VerifyIdentity; Label = 'Identity runtime semantics' },
            @{ Path = $VerifyDsh; Label = 'DSH managed-access runtime' }
        )) {
            if (-not (Test-Path -LiteralPath $semanticVerifier.Path -PathType Leaf)) {
                Fail "$($semanticVerifier.Label) verifier is missing: $($semanticVerifier.Path)"
            }
            & node $semanticVerifier.Path "--env-file=$EnvPath"
            if ($LASTEXITCODE -ne 0) { Fail "$($semanticVerifier.Label) verification failed." }
        }

        $finalStatus = @(& git -C $RepoRoot status --porcelain --untracked-files=all)
        if ($LASTEXITCODE -ne 0 -or $finalStatus.Count -gt 0) { Fail 'Integration proof mutated repository state.' }
        Write-Host 'INTEGRATION_RUNTIME_PROOF=PASS'
    }
    catch {
        $proofError = $_
        Show-IntegrationDiagnostics
    }
    finally {
        try { Reset-IntegrationRuntime }
        catch { $cleanupError = $_ }
    }

    if ($null -ne $cleanupError) { Fail "INTEGRATION_RUNTIME_CLEANUP=FAIL: $($cleanupError.Exception.Message)" }
    if ($null -ne $proofError) { Fail "INTEGRATION_RUNTIME_PROOF=FAIL residue=0: $($proofError.Exception.Message)" }
    Write-Host 'INTEGRATION_RUNTIME_CLEANUP=PASS'
    Write-Host 'INTEGRATION_RUNTIME_PROOF=PASS residue=0'
}

Push-Location $RepoRoot
try {
    switch ($Action) {
        'DailyUp' { $null = Ensure-DailyRuntime }
        'DailyDown' { Stop-DailyRuntime }
        'Status' { Show-RuntimeStatus }
        'Identity' { Start-GoService -Service 'identity' }
        'Dsh' { Start-GoService -Service 'dsh' }
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
        'IntegrationClose' { Invoke-IntegrationClose }
    }
}
finally {
    Pop-Location
}
