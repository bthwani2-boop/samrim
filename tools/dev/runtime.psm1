#Requires -Version 7.4
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$PSNativeCommandUseErrorActionPreference = $false

$RepoRoot = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
$ComposePath = Join-Path $RepoRoot 'infra\local\compose\compose.yaml'
$EnvPath = Join-Path $RepoRoot 'infra\local\.env'
$EnvExamplePath = Join-Path $RepoRoot 'infra\local\.env.example'
$Project = 'samrim-local'
$AllowedServices = @('identity','dsh')
$RunningServices = @('postgres','mailpit','identity','dsh')
$OneShotServices = @('identity-migrate','dsh-migrate')
$CanonicalServices = @($RunningServices + $OneShotServices)
$Ports = @(
    @{ Key='SAMRIM_MAILPIT_WEB_PORT'; Service='mailpit' },
    @{ Key='SAMRIM_IDENTITY_PORT'; Service='identity' },
    @{ Key='SAMRIM_DSH_PORT'; Service='dsh' }
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
    } else {
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
        $null = $containers.Add([pscustomobject]@{ Id=$parts[0].Trim(); State=$parts[1].Trim(); Ports=$parts[2].Trim(); Project=$parts[3].Trim(); Service=$parts[4].Trim(); Health='none'; ExitCode=$null })
    }
    $ids = @($containers | Where-Object { $_.Project -like 'samrim-*' } | Select-Object -ExpandProperty Id -Unique)
    if ($ids.Count -gt 0) {
        $inspectJson = (& docker inspect @ids 2>&1 | Out-String)
        if ($LASTEXITCODE -ne 0) { Fail 'Unable to inspect Samrim runtime containers.' }
        $details = @($inspectJson | ConvertFrom-Json)
        foreach ($detail in $details) {
            $entry = @($containers | Where-Object { $_.Id -eq [string]$detail.Id })[0]
            $entry.State = [string]$detail.State.Status
            $entry.ExitCode = [int]$detail.State.ExitCode
            $healthProperty = $detail.State.PSObject.Properties['Health']
            if ($null -ne $healthProperty -and $null -ne $healthProperty.Value) {
                $entry.Health = [string]$healthProperty.Value.Status
            }
        }
    }
    return [pscustomobject]@{ Containers=@($containers) }
}

function Get-ServiceContainers($Snapshot, [string]$ServiceName) {
    return @($Snapshot.Containers | Where-Object { $_.Project -eq $Project -and $_.Service -eq $ServiceName })
}

function Assert-No-Foreign-RuntimeProject($Snapshot) {
    $parallel = @($Snapshot.Containers | Where-Object { $_.Project -like 'samrim-*' -and $_.Project -ne $Project } | Select-Object -ExpandProperty Project -Unique)
    if ($parallel.Count -gt 0) { Fail "PARALLEL_RUNTIME_RESIDUE=FAIL projects=$($parallel -join ',')" }
}

function Assert-No-Parallel-Runtime($Snapshot) {
    Assert-No-Foreign-RuntimeProject $Snapshot
    $unexpected = @($Snapshot.Containers | Where-Object { $_.Project -eq $Project -and $_.Service -and $_.Service -notin $CanonicalServices } | Select-Object -ExpandProperty Service -Unique)
    if ($unexpected.Count -gt 0) { Fail "CANONICAL_RUNTIME_RESIDUE=FAIL services=$($unexpected -join ',')" }
}

function Assert-No-Native-Backend {
    if (-not $IsWindows) { return }
    $matches = @(Get-CimInstance Win32_Process -ErrorAction SilentlyContinue | Where-Object {
        $_.CommandLine -and $_.CommandLine -match '\bgo(?:\.exe)?\b' -and
        ($_.CommandLine -match 'services[\\/]identity[\\/]backend' -or $_.CommandLine -match 'services[\\/]dsh[\\/]backend')
    })
    if ($matches.Count -gt 0) { Fail "NATIVE_BACKEND_RESIDUE=FAIL pids=$($matches.ProcessId -join ',')" }
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
    foreach ($serviceName in $OneShotServices) { Assert-OneShot $Snapshot $serviceName }
    foreach ($serviceName in $RunningServices) { Assert-Service $Snapshot $serviceName -Healthy:($serviceName -ne 'mailpit') }
    foreach ($port in $Ports) { Assert-Port $Snapshot $EnvMap $port.Service $port.Key }
}

function Test-Full-RuntimeReady([hashtable]$EnvMap, $Snapshot) {
    try { Assert-Full-Runtime $EnvMap $Snapshot; return $true } catch { return $false }
}

function Assert-HttpEndpoint([System.Net.Http.HttpClient]$Client,[string]$Name,[string]$Url,[switch]$RequireSuccess) {
    $response = $null
    try {
        $response = $Client.GetAsync($Url).GetAwaiter().GetResult()
        $status = [int]$response.StatusCode
        if ($RequireSuccess -and ($status -lt 200 -or $status -ge 300)) { Fail "HOST_ENDPOINT=FAIL name=$Name status=$status url=$Url" }
        if (-not $RequireSuccess -and ($status -lt 200 -or $status -ge 500)) { Fail "HOST_ENDPOINT=FAIL name=$Name status=$status url=$Url" }
    } catch { Fail "HOST_ENDPOINT=FAIL name=$Name url=$Url reason=$($_.Exception.Message)" }
    finally { if ($null -ne $response) { $response.Dispose() } }
}

function Assert-BackendEndpoints([hashtable]$EnvMap) {
    $client = [System.Net.Http.HttpClient]::new(); $client.Timeout = [TimeSpan]::FromSeconds(3)
    try {
        $identityPort = Require-Port $EnvMap 'SAMRIM_IDENTITY_PORT'
        $dshPort = Require-Port $EnvMap 'SAMRIM_DSH_PORT'
        $mailpitPort = Require-Port $EnvMap 'SAMRIM_MAILPIT_WEB_PORT'
        Assert-HttpEndpoint $client 'identity' "http://127.0.0.1:$identityPort/identity/health" -RequireSuccess
        Assert-HttpEndpoint $client 'dsh' "http://127.0.0.1:$dshPort/dsh/health" -RequireSuccess
        Assert-HttpEndpoint $client 'mailpit' "http://127.0.0.1:$mailpitPort/" -RequireSuccess
    } finally { $client.Dispose() }
    Write-Host 'HOST_BACKEND_ENDPOINTS=PASS identity,dsh,mailpit'
}

function Write-Full-Runtime-Pass([string]$Mode) {
    Write-Host "CANONICAL_LOCAL_RUNTIME=PASS scope=backend mode=$Mode"
    Write-Host 'DOCKER_BACKEND_RUNTIME=PASS'
    Write-Host "DOCKER_OWNS=$($CanonicalServices -join ',')"
    Write-Host 'APPLICATION_RUNTIME=HOST_OWNED'
}

function Start-Full-Runtime {
    $envMap = Ensure-Environment
    Ensure-Docker
    Assert-No-Native-Backend
    $before = Get-CanonicalRuntimeSnapshot
    Assert-No-Foreign-RuntimeProject $before
    if (Test-Full-RuntimeReady $envMap $before) {
        try {
            Write-Host 'RUNTIME_RECONCILE=READY action=running-backend-services-only'
            Compose (@('up','-d','--no-deps','--wait','--wait-timeout','300','--remove-orphans') + $RunningServices) -Quiet
            $afterWarm = Get-CanonicalRuntimeSnapshot
            Assert-Full-Runtime $envMap $afterWarm
            Write-Full-Runtime-Pass 'warm-reconcile'
            return
        } catch { Write-Host "RUNTIME_RECONCILE=RETRY mode=full reason=$($_.Exception.Message)" }
    }
    Compose @('up','-d','--wait','--wait-timeout','300','--remove-orphans')
    $after = Get-CanonicalRuntimeSnapshot
    Assert-Full-Runtime $envMap $after
    Write-Full-Runtime-Pass 'full'
}

function Show-Status {
    Write-Host 'RUNTIME_STATUS=READ_ONLY scope=backend-service-state-display'
    try { $null = Read-CanonicalEnvironment; Write-Host 'LOCAL_RUNTIME_ENV=PASS mode=read-only' } catch { Write-Host "LOCAL_RUNTIME_ENV=NOT_READY reason=$($_.Exception.Message)" }
    Ensure-Docker
    Compose @('ps','-a')
}

function Doctor {
    $failures=@(); $envMap=$null; $snapshot=$null
    try { $envMap=Read-CanonicalEnvironment } catch { Write-Host "LOCAL_RUNTIME_ENV=NOT_READY reason=$($_.Exception.Message)"; $failures+='environment' }
    try { Assert-No-Native-Backend } catch { Write-Host "NATIVE_BACKEND=NOT_READY reason=$($_.Exception.Message)"; $failures+='native-backend' }
    try { Ensure-Docker; $snapshot=Get-CanonicalRuntimeSnapshot; Assert-No-Parallel-Runtime $snapshot } catch { Write-Host "DOCKER_RUNTIME=NOT_READY reason=$($_.Exception.Message)"; $failures+='docker' }
    if ($null -ne $envMap -and $null -ne $snapshot -and $failures.Count -eq 0) {
        try { Assert-Full-Runtime $envMap $snapshot; Assert-BackendEndpoints $envMap; Write-Host 'CANONICAL_RUNTIME_READBACK=PASS scope=backend-compose' }
        catch { Write-Host "CANONICAL_RUNTIME_READBACK=NOT_READY reason=$($_.Exception.Message)"; $failures+='runtime' }
    }
    Write-Host 'APPLICATION_RUNTIME=HOST_OWNED'
    Write-Host 'DEVICE_RUNTIME=DEVICE_OWNED'
    Write-Host 'DESTRUCTIVE=0'
    if ($failures.Count -gt 0) { Write-Host "RUNTIME_DOCTOR=NOT_READY failures=$($failures.Count)"; return $false }
    Write-Host 'RUNTIME_DOCTOR=PASS'; return $true
}

function Require-Service([string]$Candidate) {
    if (-not $Candidate -or $Candidate -notin $AllowedServices) { Fail "SERVICE_REQUIRED allowed=$($AllowedServices -join ',')" }
    return $Candidate
}

function Rebuild-Service([string]$Candidate) {
    $target=Require-Service $Candidate
    $null=Ensure-Environment; Ensure-Docker; Assert-No-Native-Backend
    $snapshot=Get-CanonicalRuntimeSnapshot; Assert-No-Parallel-Runtime $snapshot
    Compose @('build',$target)
    Compose @('up','-d','--force-recreate','--wait','--wait-timeout','300',$target)
    Write-Host "RUNTIME_SERVICE_REBUILD=PASS service=$target"
}

function Restart-Service([string]$Candidate) {
    $target=Require-Service $Candidate
    $null=Read-CanonicalEnvironment; Ensure-Docker
    Compose @('restart',$target)
    Write-Host "RUNTIME_SERVICE_RESTART=PASS service=$target"
}

function Invoke-SamrimRuntime {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory)]
        [ValidateSet('Up','Down','Restart','Status','Logs','Doctor','Reset','Purge','Rebuild','RestartService','LogsService')]
        [string]$Action,
        [string]$Service='',
        [switch]$AllowDataLoss
    )
    if ($Action -in @('Reset','Purge') -and -not $AllowDataLoss) { Fail "DATA_LOSS_AUTHORIZATION_REQUIRED action=$Action rerun_same_invocation_with=-AllowDataLoss" }
    Push-Location $RepoRoot
    try {
        switch ($Action) {
            'Up' { Start-Full-Runtime }
            'Down' { Ensure-Docker; if (Test-Path -LiteralPath $EnvPath) { Compose @('down','--remove-orphans') }; Write-Host 'CANONICAL_RUNTIME_STOP=PASS data_volume=preserved' }
            'Restart' { Ensure-Docker; if (Test-Path -LiteralPath $EnvPath) { Compose @('down','--remove-orphans') }; Start-Full-Runtime }
            'Status' { Show-Status }
            'Logs' { Ensure-Docker; Compose @('logs','--tail','200','-f') }
            'Doctor' { if (-not (Doctor)) { exit 1 } }
            'Reset' {
                Ensure-Docker; Compose @('down','--remove-orphans')
                $volumes=@(& docker volume ls --filter "label=com.docker.compose.project=$Project" --format '{{.Name}}' | Where-Object { $_ -match 'samrim-postgres-data$' })
                foreach ($volume in $volumes) { & docker volume rm -f $volume *> $null; if ($LASTEXITCODE -ne 0) { Fail "RUNTIME_RESET=FAIL volume=$volume" } }
                Write-Host 'RUNTIME_RESET=PASS final_state=DOWN secrets=preserved'
            }
            'Purge' { Ensure-Docker; Compose @('down','--volumes','--remove-orphans'); Write-Host 'RUNTIME_PURGE=PASS final_state=DOWN secrets=preserved' }
            'Rebuild' { Rebuild-Service $Service }
            'RestartService' { Restart-Service $Service }
            'LogsService' { $target=Require-Service $Service; Ensure-Docker; Compose @('logs','--tail','200','-f',$target) }
        }
    } finally { Pop-Location }
}

Export-ModuleMember -Function Invoke-SamrimRuntime
