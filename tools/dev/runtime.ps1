#Requires -Version 7.4
[CmdletBinding()]
param(
    [Parameter(Mandatory)]
    [ValidateSet('Up','Down','Restart','Status','Logs','Doctor','Reset','Purge','Control','Client','Partner','Captain','Field')]
    [string]$Action,
    [string]$DeviceSerial = $env:BTHWANI_ADB_SERIAL
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$PSNativeCommandUseErrorActionPreference = $false

$RepoRoot = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
$ComposeDir = Join-Path $RepoRoot 'infra\local\compose'
$ComposePath = Join-Path $ComposeDir 'compose.yaml'
$EnvPath = Join-Path $ComposeDir '.env'
$EnvExamplePath = Join-Path $ComposeDir '.env.example'
$CanonicalProject = 'samrim-local'

function Fail([string]$Message) { throw $Message }

function New-RandomHex([int]$Bytes = 32) { return [Convert]::ToHexString([Security.Cryptography.RandomNumberGenerator]::GetBytes($Bytes)).ToLowerInvariant() }

function Read-EnvMap([string]$Path) {
    $map = @{}
    foreach ($line in Get-Content -LiteralPath $Path) {
        $trimmed = $line.Trim()
        if (-not $trimmed -or $trimmed.StartsWith('#')) { continue }
        $parts = $trimmed.Split('=', 2)
        if ($parts.Count -ne 2) { Fail "Malformed environment line in ${Path}: $line" }
        $name = $parts[0].Trim()
        if ([string]::IsNullOrWhiteSpace($name)) { Fail "Empty environment key in $Path." }
        if ($map.ContainsKey($name)) { Fail "Duplicate environment key '$name' in $Path." }
        $map[$name] = $parts[1].Trim()
    }
    return $map
}

function Require-EnvValue([hashtable]$Map, [string]$Name) {
    if (-not $Map.ContainsKey($Name) -or [string]::IsNullOrWhiteSpace([string]$Map[$Name])) { Fail "Required local runtime setting is missing: $Name" }
    return [string]$Map[$Name]
}

function Require-TcpPort([hashtable]$Map, [string]$Name) {
    $raw = Require-EnvValue -Map $Map -Name $Name
    $port = 0
    if (-not [int]::TryParse($raw, [ref]$port) -or $port -lt 1 -or $port -gt 65535) { Fail "Invalid TCP port in ${Name}: $raw" }
    return $port
}

function Ensure-Environment {
    if (-not (Test-Path -LiteralPath $EnvExamplePath -PathType Leaf)) { Fail "Missing canonical local runtime template: $EnvExamplePath" }
    $generatedSecrets = [System.Collections.Generic.HashSet[string]]::new([StringComparer]::OrdinalIgnoreCase)
    foreach ($name in @('SAMRIM_POSTGRES_PASSWORD','IDENTITY_CHALLENGE_HMAC_SECRET','IDENTITY_DSH_SERVICE_TOKEN','CONTROL_PANEL_SERVICE_TOKEN','IDENTITY_ABUSE_HMAC_SECRET','OPERATOR_BOOTSTRAP_SECRET')) { $null = $generatedSecrets.Add($name) }
    $current = @{}
    $state = 'created'
    if (Test-Path -LiteralPath $EnvPath -PathType Leaf) { $current = Read-EnvMap -Path $EnvPath; $state = 'unchanged' }
    $output = [System.Collections.Generic.List[string]]::new()
    $known = [System.Collections.Generic.HashSet[string]]::new([StringComparer]::OrdinalIgnoreCase)
    foreach ($line in Get-Content -LiteralPath $EnvExamplePath) {
        $trimmed = $line.Trim()
        if (-not $trimmed -or $trimmed.StartsWith('#')) { $output.Add($line); continue }
        $parts = $line.Split('=', 2)
        if ($parts.Count -ne 2) { Fail "Malformed canonical template line: $line" }
        $name = $parts[0].Trim(); $templateValue = $parts[1].Trim()
        if (-not $known.Add($name)) { Fail "Duplicate canonical template key '$name'." }
        if ($generatedSecrets.Contains($name)) {
            if ($current.ContainsKey($name) -and -not [string]::IsNullOrWhiteSpace([string]$current[$name])) { $value = [string]$current[$name] }
            else { $value = New-RandomHex; $state = 'reconciled' }
        } else {
            $value = $templateValue
            if ($current.ContainsKey($name) -and [string]$current[$name] -ne $value) { $state = 'reconciled' }
        }
        $output.Add("${name}=${value}")
    }
    $unknown = @($current.Keys | Where-Object { -not $known.Contains([string]$_) })
    if ($unknown.Count -gt 0) { $state = 'reconciled' }
    $raw = (($output -join [Environment]::NewLine).TrimEnd()) + [Environment]::NewLine
    [IO.File]::WriteAllText($EnvPath, $raw, [Text.UTF8Encoding]::new($false))
    $map = Read-EnvMap -Path $EnvPath
    if ((Require-EnvValue -Map $map -Name 'BTHWANI_ENV') -ne 'development') { Fail 'LOCAL_INTEGRATION requires BTHWANI_ENV=development.' }
    Write-Host "LOCAL_RUNTIME_ENV=PASS state=$state source=infra/local/compose/.env.example secrets=preserved unknown_removed=$($unknown.Count)"
    return $map
}

function Read-CanonicalEnvironment {
    if (-not (Test-Path -LiteralPath $EnvPath -PathType Leaf)) { Fail "LOCAL_RUNTIME_ENV=NOT_READY reason=missing_env path=$EnvPath" }
    $map = Read-EnvMap -Path $EnvPath
    if ((Require-EnvValue -Map $map -Name 'BTHWANI_ENV') -ne 'development') { Fail 'LOCAL_RUNTIME_ENV=NOT_READY reason=BTHWANI_ENV_must_be_development' }
    return $map
}

function Ensure-Docker {
    if (-not (Get-Command docker -ErrorAction SilentlyContinue)) { Fail 'Docker CLI is required.' }
    & docker version *> $null
    if ($LASTEXITCODE -ne 0) { Fail 'Docker daemon is not available.' }
}

function Get-ComposeBaseArgs { return @('compose','--ansi','never','--progress','plain','--project-name',$CanonicalProject,'--env-file',$EnvPath,'-f',$ComposePath) }

function Invoke-Compose([string[]]$Arguments, [switch]$Quiet) {
    $base = Get-ComposeBaseArgs
    if ($Quiet) { & docker @base @Arguments *> $null } else { & docker @base @Arguments 2>&1 | ForEach-Object { Write-Host $_ } }
    if ($LASTEXITCODE -ne 0) { Fail "Docker Compose failed: $($Arguments -join ' ')" }
}

function Get-ServiceContainerId([string]$Service) {
    $ids = @(& docker ps -a --filter "label=com.docker.compose.project=$CanonicalProject" --filter "label=com.docker.compose.service=$Service" --format '{{.ID}}' | ForEach-Object { $_.Trim() } | Where-Object { $_ })
    if ($LASTEXITCODE -ne 0) { Fail "Unable to inspect $CanonicalProject/$Service." }
    if ($ids.Count -ne 1) { Fail "Expected exactly one container for $CanonicalProject/$Service; observed=$($ids.Count)." }
    return $ids[0]
}

function Assert-OneShotSucceeded([string]$Service) {
    $id = Get-ServiceContainerId -Service $Service
    $state = (& docker inspect --format '{{.State.Status}}|{{.State.ExitCode}}' $id).Trim()
    if ($LASTEXITCODE -ne 0 -or $state -ne 'exited|0') { Fail "ONE_SHOT_SERVICE=FAIL service=$Service state=$state" }
    Write-Host "ONE_SHOT_SERVICE=PASS service=$Service"
}

function Assert-RunningService([string]$Service, [switch]$Healthy) {
    $id = Get-ServiceContainerId -Service $Service
    $status = (& docker inspect --format '{{.State.Status}}' $id).Trim()
    if ($LASTEXITCODE -ne 0 -or $status -ne 'running') { Fail "SERVICE_STATE=FAIL service=$Service status=$status" }
    if ($Healthy) {
        $health = (& docker inspect --format '{{if .State.Health}}{{.State.Health.Status}}{{else}}missing{{end}}' $id).Trim()
        if ($LASTEXITCODE -ne 0 -or $health -ne 'healthy') { Fail "SERVICE_HEALTH=FAIL service=$Service health=$health" }
    }
}

function Assert-NoParallelRuntimeResidue {
    $projects = @(& docker ps -a --format '{{.Label "com.docker.compose.project"}}' | Where-Object { $_ -like 'samrim-*' -and $_ -ne $CanonicalProject } | Sort-Object -Unique)
    if ($LASTEXITCODE -ne 0) { Fail 'Unable to inspect Docker project labels.' }
    if ($projects.Count -gt 0) { Fail "PARALLEL_RUNTIME_RESIDUE=FAIL projects=$($projects -join ',')" }
}

function Assert-NoNativeBackendProcesses {
    if (-not $IsWindows) { return }
    $matches = @(Get-CimInstance Win32_Process -ErrorAction SilentlyContinue | Where-Object { $_.CommandLine -and (($_.CommandLine -match 'services[\\/]identity[\\/]backend') -or ($_.CommandLine -match 'services[\\/]dsh[\\/]backend')) -and $_.CommandLine -match '\bgo(?:\.exe)?\b' })
    if ($matches.Count -gt 0) { Fail "NATIVE_RUNTIME_RESIDUE=FAIL pids=$($matches.ProcessId -join ',')" }
}

function Assert-CanonicalPublishedPort([int]$Port, [string]$ExpectedService) {
    $needle = ":${Port}->"
    $rows = @(& docker ps --format '{{.Ports}}|{{.Label "com.docker.compose.project"}}|{{.Label "com.docker.compose.service"}}' | Where-Object { $_ -and $_.Contains($needle) })
    if ($LASTEXITCODE -ne 0) { Fail "Unable to inspect Docker port ownership for $Port." }
    $expected = @($rows | Where-Object { $_ -match "\|$CanonicalProject\|$([regex]::Escape($ExpectedService))$" })
    if ($rows.Count -ne 1 -or $expected.Count -ne 1 -or $rows[0] -notmatch '^127\.0\.0\.1:') { Fail "PORT_OWNERSHIP=FAIL port=$Port service=$ExpectedService observed=$($rows -join ';')" }
}

function Assert-CanonicalRuntime([hashtable]$EnvMap) {
    Assert-NoParallelRuntimeResidue; Assert-NoNativeBackendProcesses
    Assert-OneShotSucceeded -Service 'identity-migrate'; Assert-OneShotSucceeded -Service 'dsh-migrate'; Assert-OneShotSucceeded -Service 'js-deps'
    Assert-RunningService -Service 'postgres' -Healthy; Assert-RunningService -Service 'mailpit'; Assert-RunningService -Service 'identity' -Healthy; Assert-RunningService -Service 'dsh' -Healthy; Assert-RunningService -Service 'control' -Healthy; Assert-RunningService -Service 'metro-client' -Healthy; Assert-RunningService -Service 'metro-partner' -Healthy; Assert-RunningService -Service 'metro-captain' -Healthy; Assert-RunningService -Service 'metro-field' -Healthy
    foreach ($contract in @(@{Key='SAMRIM_MAILPIT_WEB_PORT';Service='mailpit'},@{Key='SAMRIM_IDENTITY_PORT';Service='identity'},@{Key='SAMRIM_DSH_PORT';Service='dsh'},@{Key='SAMRIM_CONTROL_PORT';Service='control'},@{Key='SAMRIM_APP_CLIENT_METRO_PORT';Service='metro-client'},@{Key='SAMRIM_APP_PARTNER_METRO_PORT';Service='metro-partner'},@{Key='SAMRIM_APP_CAPTAIN_METRO_PORT';Service='metro-captain'},@{Key='SAMRIM_APP_FIELD_METRO_PORT';Service='metro-field'})) { Assert-CanonicalPublishedPort -Port (Require-TcpPort -Map $EnvMap -Name $contract.Key) -ExpectedService $contract.Service }
}

function Test-CanonicalRuntimeReady([hashtable]$EnvMap) { try { Assert-CanonicalRuntime -EnvMap $EnvMap; return $true } catch { return $false } }

function Start-CanonicalRuntime {
    $envMap = Ensure-Environment; Ensure-Docker; Assert-NoParallelRuntimeResidue; Assert-NoNativeBackendProcesses
    Invoke-Compose -Arguments @('config','--quiet') -Quiet
    Invoke-Compose -Arguments @('up','-d','--build','--wait','--wait-timeout','300','--remove-orphans')
    Assert-CanonicalRuntime -EnvMap $envMap
    Write-Host 'CANONICAL_LOCAL_RUNTIME=PASS'; Write-Host 'DOCKER_RUNTIME=PASS'; Write-Host 'BROWSER_RUNTIME=PASS'; Write-Host 'DOCKER_OWNS=postgres,mailpit,identity,dsh,control,metro-client,metro-partner,metro-captain,metro-field'; Write-Host 'ANDROID_DEVICE_OWNER=pnpm_scr'; Write-Host 'ANDROID_DATA_PATH=ADB_REVERSE'
    return $envMap
}

function Ensure-CanonicalRuntime {
    $envMap = Ensure-Environment; Ensure-Docker
    if (Test-CanonicalRuntimeReady -EnvMap $envMap) { Write-Host 'DOCKER_RUNTIME=PASS'; Write-Host 'CANONICAL_LOCAL_RUNTIME=READY'; return $envMap }
    return Start-CanonicalRuntime
}

function Stop-CanonicalRuntime { $null = Ensure-Environment; Ensure-Docker; Invoke-Compose -Arguments @('down','--remove-orphans'); Write-Host 'CANONICAL_RUNTIME_STOP=PASS data_volume=preserved' }

function Show-RuntimeStatus {
    $envMap = $null
    try { $envMap = Read-CanonicalEnvironment; Write-Host 'LOCAL_RUNTIME_ENV=PASS mode=read-only' } catch { Write-Host "LOCAL_RUNTIME_ENV=NOT_READY reason=$($_.Exception.Message)" }
    Ensure-Docker
    if ($null -ne $envMap) { $base = Get-ComposeBaseArgs; & docker @base ps -a; if ($LASTEXITCODE -ne 0) { Fail 'Unable to inspect canonical runtime.' }; Show-AdbReverseStatus -EnvMap $envMap }
}

function Show-RuntimeLogs { $null = Ensure-Environment; Ensure-Docker; $base = Get-ComposeBaseArgs; & docker @base logs --tail 200 -f; if ($LASTEXITCODE -ne 0) { Fail 'Docker Compose logs failed.' } }

function Get-ExpectedAdbReversePorts([hashtable]$EnvMap) { return @(Require-TcpPort -Map $EnvMap -Name 'SAMRIM_IDENTITY_PORT'; Require-TcpPort -Map $EnvMap -Name 'SAMRIM_DSH_PORT'; Require-TcpPort -Map $EnvMap -Name 'SAMRIM_APP_CLIENT_METRO_PORT'; Require-TcpPort -Map $EnvMap -Name 'SAMRIM_APP_PARTNER_METRO_PORT'; Require-TcpPort -Map $EnvMap -Name 'SAMRIM_APP_CAPTAIN_METRO_PORT'; Require-TcpPort -Map $EnvMap -Name 'SAMRIM_APP_FIELD_METRO_PORT') | Sort-Object -Unique }

function Get-ReadyAdbRecords {
    if (-not (Get-Command adb -ErrorAction SilentlyContinue)) { return @() }
    $records = @()
    foreach ($row in @(& adb devices -l 2>&1)) {
        if ($row -notmatch '^(\S+)\s+device(?:\s+.*)?$') { continue }
        $serial = $Matches[1]; if ($serial -match '^emulator-') { continue }
        $identity = ((& adb -s $serial shell getprop ro.serialno 2>$null | Out-String).Trim()); if ([string]::IsNullOrWhiteSpace($identity)) { $identity = ((& adb -s $serial shell getprop ro.boot.serialno 2>$null | Out-String).Trim()) }
        $kind = if ($serial -match ':\d+$') { 'WIFI' } else { 'USB' }
        $records += [pscustomobject]@{Serial=$serial;Identity=$identity;Kind=$kind}
    }
    return @($records)
}

function Select-CanonicalAdbRecord {
    $records = @(Get-ReadyAdbRecords); if ($records.Count -eq 0) { return $null }
    if (-not [string]::IsNullOrWhiteSpace($DeviceSerial)) { $selected = @($records | Where-Object { $_.Serial -eq $DeviceSerial }); if ($selected.Count -ne 1) { Fail "ADB target mismatch: $DeviceSerial" }; return $selected[0] }
    $groups = @($records | Group-Object Identity); if ($groups.Count -ne 1) { Fail "ADB_DEVICE=AMBIGUOUS physical_devices=$($groups.Count)" }
    $usb = @($groups[0].Group | Where-Object { $_.Kind -eq 'USB' }); if ($usb.Count -eq 1) { return $usb[0] }
    return @($groups[0].Group | Sort-Object Serial)[0]
}

function Assert-AdbReverseReady([hashtable]$EnvMap) {
    $record = Select-CanonicalAdbRecord; if ($null -eq $record) { Fail 'ADB_DEVICE=NOT_READY run=pnpm-scr' }
    $rows = @(& adb -s $record.Serial reverse --list 2>&1); if ($LASTEXITCODE -ne 0) { Fail "ADB_REVERSE=NOT_READY serial=$($record.Serial)" }
    foreach ($port in @(Get-ExpectedAdbReversePorts -EnvMap $EnvMap)) { if (@($rows | Where-Object { $_ -match "(^|\s)tcp:$port\s+tcp:$port($|\s)" }).Count -ne 1) { Fail "ADB_REVERSE=NOT_READY port=$port run=pnpm-scr" } }
    Write-Host "ADB_REVERSE=PASS serial=$($record.Serial)"
}

function Show-AdbReverseStatus([hashtable]$EnvMap) {
    $records = @(Get-ReadyAdbRecords); if ($records.Count -eq 0) { Write-Host 'ADB_STATE=NOT_READY reason=no_device run=pnpm-scr'; return }
    foreach ($record in $records) { Write-Host "ADB_TRANSPORT=PASS serial=$($record.Serial) kind=$($record.Kind) identity=$($record.Identity)" }
    try { Assert-AdbReverseReady -EnvMap $EnvMap } catch { Write-Host "ADB_REVERSE=NOT_READY reason=$($_.Exception.Message)" }
}

function Invoke-RuntimeDoctor {
    $failures = @(); $envMap = $null
    try { $envMap = Read-CanonicalEnvironment; Write-Host 'LOCAL_RUNTIME_ENV=PASS mode=read-only' } catch { Write-Host "LOCAL_RUNTIME_ENV=NOT_READY reason=$($_.Exception.Message)"; $failures += 'local environment' }
    try { Ensure-Docker; Write-Host 'DOCKER_DAEMON=PASS' } catch { Write-Host "DOCKER_DAEMON=NOT_READY reason=$($_.Exception.Message)"; $failures += 'docker' }
    if ($null -ne $envMap -and $failures.Count -eq 0) { try { Assert-CanonicalRuntime -EnvMap $envMap; Write-Host 'CANONICAL_RUNTIME_READBACK=PASS' } catch { Write-Host "CANONICAL_RUNTIME_READBACK=NOT_READY reason=$($_.Exception.Message)"; $failures += 'runtime' }; Show-AdbReverseStatus -EnvMap $envMap }
    Write-Host 'ANDROID_DEVICE_OWNER=pnpm_scr'; Write-Host 'ANDROID_DATA_PATH=ADB_REVERSE'; Write-Host 'ADMIN_REQUIRED=0'; Write-Host 'DESTRUCTIVE=0'
    if ($failures.Count -eq 0) { Write-Host 'RUNTIME_DOCTOR=PASS'; return }
    Write-Host "RUNTIME_DOCTOR=NOT_READY failures=$($failures.Count)"; exit 1
}

function Reset-CanonicalRuntime {
    $envMap = Ensure-Environment; Ensure-Docker; Write-Host 'RUNTIME_RESET=DESTRUCTIVE_LOCAL_DATA scope=postgres_application_state dependency_volumes=preserved secrets=preserved'; Invoke-Compose -Arguments @('down','--remove-orphans')
    $postgresVolumes = @(& docker volume ls --filter "label=com.docker.compose.project=$CanonicalProject" --format '{{.Name}}' | Where-Object { $_ -match 'samrim-postgres-data$' })
    foreach ($volume in $postgresVolumes) { & docker volume rm -f $volume *> $null; if ($LASTEXITCODE -ne 0) { Fail "RUNTIME_RESET=FAIL volume=$volume" } }
    Assert-NoNativeBackendProcesses; Write-Host 'RUNTIME_RESET=PASS final_state=DOWN secrets=preserved'
}

function Purge-CanonicalRuntime {
    $null = Ensure-Environment; Ensure-Docker; Write-Host 'RUNTIME_PURGE=DESTRUCTIVE_LOCAL_DATA scope=samrim Docker containers/networks/volumes; local .env secrets are preserved'
    try { Invoke-Compose -Arguments @('down','--volumes','--remove-orphans') } catch { Write-Host "Canonical compose teardown was not complete: $($_.Exception.Message)" }
    Assert-NoNativeBackendProcesses; Write-Host 'RUNTIME_PURGE=PASS final_state=DOWN secrets=preserved'
}

function Start-ControlPanel {
    $envMap = Ensure-CanonicalRuntime; $controlPort = Require-TcpPort -Map $envMap -Name 'SAMRIM_CONTROL_PORT'; Assert-RunningService -Service 'control' -Healthy; Assert-CanonicalPublishedPort -Port $controlPort -ExpectedService 'control'; Write-Host 'CONTROL_PANEL_OWNER=DOCKER'; Write-Host "CONTROL_PANEL_READY=PASS url=http://127.0.0.1:$controlPort"; Write-Host 'CONTROL_PANEL_OPEN=MANUAL'
}

function Start-Mobile([ValidateSet('app-client','app-partner','app-captain','app-field')][string]$App) {
    $envMap = Ensure-CanonicalRuntime
    $contract = switch ($App) { 'app-client' {@{Service='metro-client';PortKey='SAMRIM_APP_CLIENT_METRO_PORT'}} 'app-partner' {@{Service='metro-partner';PortKey='SAMRIM_APP_PARTNER_METRO_PORT'}} 'app-captain' {@{Service='metro-captain';PortKey='SAMRIM_APP_CAPTAIN_METRO_PORT'}} 'app-field' {@{Service='metro-field';PortKey='SAMRIM_APP_FIELD_METRO_PORT'}} }
    $metroPort = Require-TcpPort -Map $envMap -Name $contract.PortKey; Assert-RunningService -Service $contract.Service -Healthy; Assert-CanonicalPublishedPort -Port $metroPort -ExpectedService $contract.Service; Assert-AdbReverseReady -EnvMap $envMap
    Write-Host "RUNTIME_OWNER=tools/dev/runtime.ps1 component=$App"; Write-Host "MOBILE_OWNER=DOCKER service=$($contract.Service)"; Write-Host 'MOBILE_TRANSPORT=ADB_REVERSE'; Write-Host "METRO_DEVICE_URL=http://127.0.0.1:$metroPort"; Write-Host "IDENTITY_DEVICE_URL=http://127.0.0.1:$(Require-TcpPort -Map $envMap -Name 'SAMRIM_IDENTITY_PORT')"; Write-Host "DSH_DEVICE_URL=http://127.0.0.1:$(Require-TcpPort -Map $envMap -Name 'SAMRIM_DSH_PORT')"; Write-Host 'MOBILE_DEV_CLIENT_OPEN=MANUAL'
}

Push-Location $RepoRoot
try {
    switch ($Action) {
        'Up' {$null=Start-CanonicalRuntime}
        'Down' {Stop-CanonicalRuntime}
        'Restart' {Stop-CanonicalRuntime;$null=Start-CanonicalRuntime}
        'Status' {Show-RuntimeStatus}
        'Logs' {Show-RuntimeLogs}
        'Doctor' {Invoke-RuntimeDoctor}
        'Reset' {Reset-CanonicalRuntime}
        'Purge' {Purge-CanonicalRuntime}
        'Control' {Start-ControlPanel}
        'Client' {Start-Mobile -App 'app-client'}
        'Partner' {Start-Mobile -App 'app-partner'}
        'Captain' {Start-Mobile -App 'app-captain'}
        'Field' {Start-Mobile -App 'app-field'}
    }
} finally { Pop-Location }
