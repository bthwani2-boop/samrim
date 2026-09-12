#Requires -Version 7.4
[CmdletBinding()]
param(
    [Parameter(Mandatory)]
    [ValidateSet('Up','Down','Restart','Status','Logs','Doctor','Reset','Purge','MobileLan','Control','Client','Partner','Captain','Field')]
    [string]$Action,
    [string]$DeviceSerial = $env:BTHWANI_ADB_SERIAL,
    [switch]$ClearCache
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$RepoRoot = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
$ComposeDir = Join-Path $RepoRoot 'infra\local\compose'
$ComposePath = Join-Path $ComposeDir 'compose.yaml'
$EnvPath = Join-Path $ComposeDir '.env'
$EnvExamplePath = Join-Path $ComposeDir '.env.example'
$OwnershipVerifier = Join-Path $PSScriptRoot 'verify-local-runtime-ownership.mjs'
$CanonicalProject = 'samrim-local'
$SamrimProjectPrefix = 'samrim-'
$RuntimeBuildStatePath = Join-Path $RepoRoot '.bthwani-local\runtime-build-state.json'

function Fail([string]$Message) { throw $Message }

function New-RandomHex([int]$Bytes = 32) {
    return [Convert]::ToHexString(
        [Security.Cryptography.RandomNumberGenerator]::GetBytes($Bytes)
    ).ToLowerInvariant()
}

function Read-EnvMap([string]$Path) {
    $map = @{}
    foreach ($line in Get-Content -LiteralPath $Path) {
        $trimmed = $line.Trim()
        if (-not $trimmed -or $trimmed.StartsWith('#')) { continue }
        $parts = $trimmed.Split('=', 2)
        if ($parts.Count -ne 2) { Fail "Malformed local runtime environment line in ${Path}: $line" }
        $name = $parts[0].Trim()
        if ([string]::IsNullOrWhiteSpace($name)) { Fail "Empty local runtime environment key in $Path." }
        if ($map.ContainsKey($name)) { Fail "Duplicate local runtime environment key '$name' in $Path." }
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
    if (-not (Test-Path -LiteralPath $EnvExamplePath -PathType Leaf)) {
        Fail "Missing canonical local runtime template: $EnvExamplePath"
    }

    $generatedSecretKeys = [System.Collections.Generic.HashSet[string]]::new([StringComparer]::OrdinalIgnoreCase)
    foreach ($name in @(
        'SAMRIM_POSTGRES_PASSWORD',
        'IDENTITY_CHALLENGE_HMAC_SECRET',
        'IDENTITY_DSH_SERVICE_TOKEN',
        'IDENTITY_PLATFORM_CONTROL_SERVICE_TOKEN',
        'DSH_PLATFORM_CONTROL_SERVICE_TOKEN',
        'IDENTITY_ABUSE_HMAC_SECRET',
        'IDENTITY_PLATFORM_BOOTSTRAP_SECRET'
    )) {
        $null = $generatedSecretKeys.Add($name)
    }

    $current = @{}
    $existingRaw = $null
    $state = 'created'
    if (Test-Path -LiteralPath $EnvPath -PathType Leaf) {
        $current = Read-EnvMap -Path $EnvPath
        $existingRaw = Get-Content -LiteralPath $EnvPath -Raw
        $state = 'unchanged'
    }

    $templateLines = @(Get-Content -LiteralPath $EnvExamplePath)
    $templateKeys = [System.Collections.Generic.HashSet[string]]::new([StringComparer]::OrdinalIgnoreCase)
    $output = [System.Collections.Generic.List[string]]::new()

    foreach ($line in $templateLines) {
        $trimmed = $line.Trim()
        if (-not $trimmed -or $trimmed.StartsWith('#')) {
            $output.Add($line)
            continue
        }

        $parts = $line.Split('=', 2)
        if ($parts.Count -ne 2) { Fail "Malformed canonical local runtime template line: $line" }
        $name = $parts[0].Trim()
        $templateValue = $parts[1].Trim()
        if (-not $templateKeys.Add($name)) { Fail "Duplicate canonical local runtime template key '$name'." }

        if ($generatedSecretKeys.Contains($name)) {
            if ($current.ContainsKey($name) -and -not [string]::IsNullOrWhiteSpace([string]$current[$name])) {
                $resolvedValue = [string]$current[$name]
            } else {
                $resolvedValue = New-RandomHex
                $state = if ($null -eq $existingRaw) { 'created' } else { 'reconciled' }
            }
        } else {
            $resolvedValue = $templateValue
            if (-not $current.ContainsKey($name) -or [string]$current[$name] -ne $resolvedValue) {
                if ($null -ne $existingRaw) { $state = 'reconciled' }
            }
        }
        $output.Add("${name}=${resolvedValue}")
    }

    $unknownKeys = @(
        $current.Keys |
            Where-Object { -not $templateKeys.Contains([string]$_) } |
            Sort-Object
    )
    if ($unknownKeys.Count -gt 0 -and $null -ne $existingRaw) { $state = 'reconciled' }

    $newRaw = (($output -join [Environment]::NewLine).TrimEnd()) + [Environment]::NewLine
    if ($null -eq $existingRaw -or $existingRaw -ne $newRaw) {
        [IO.File]::WriteAllText($EnvPath, $newRaw, [Text.UTF8Encoding]::new($false))
        if ($null -ne $existingRaw) { $state = 'reconciled' }
    }

    $map = Read-EnvMap -Path $EnvPath
    if ((Require-EnvValue -Map $map -Name 'BTHWANI_ENV') -ne 'development') { Fail 'LOCAL_INTEGRATION requires BTHWANI_ENV=development.' }
    Write-Host "LOCAL_RUNTIME_ENV=PASS state=$state source=infra/local/compose/.env.example secrets=preserved unknown_removed=$($unknownKeys.Count)"
    return $map
}

function Read-CanonicalEnvironment {
    if (-not (Test-Path -LiteralPath $EnvPath -PathType Leaf)) {
        Fail "LOCAL_RUNTIME_ENV=NOT_READY reason=missing_env path=$EnvPath"
    }

    $map = Read-EnvMap -Path $EnvPath
    if ((Require-EnvValue -Map $map -Name 'BTHWANI_ENV') -ne 'development') {
        Fail 'LOCAL_RUNTIME_ENV=NOT_READY reason=BTHWANI_ENV_must_be_development'
    }
    return $map
}

function Set-CanonicalEnvironment([hashtable]$Map) {
    foreach ($entry in $Map.GetEnumerator()) {
        [Environment]::SetEnvironmentVariable([string]$entry.Key, [string]$entry.Value, [EnvironmentVariableTarget]::Process)
    }
}

function Ensure-Docker {
    if (-not (Get-Command docker -ErrorAction SilentlyContinue)) { Fail 'Docker CLI is required.' }
    & docker version *> $null
    if ($LASTEXITCODE -ne 0) { Fail 'Docker daemon is not available.' }
}

function Get-ComposeBaseArgs {
    return @('compose','--ansi','never','--progress','plain','--project-name',$CanonicalProject,'--env-file',$EnvPath,'-f',$ComposePath)
}

function Invoke-Compose([string[]]$Arguments, [switch]$Quiet) {
    $base = Get-ComposeBaseArgs
    if ($Quiet) {
        & docker @base @Arguments *> $null
        $code = $LASTEXITCODE
    } else {
        & docker @base @Arguments 2>&1 |
            ForEach-Object { Write-Host $_ }
        $code = $LASTEXITCODE
    }
    if ($code -ne 0) { Fail "Docker Compose failed: $($Arguments -join ' ')" }
}

function Get-ProjectResourceIds([ValidateSet('container','volume','network')][string]$Kind, [string]$Project) {
    switch ($Kind) {
        'container' { $rows = @(& docker ps -a --filter "label=com.docker.compose.project=$Project" --format '{{.ID}}') }
        'volume'    { $rows = @(& docker volume ls --filter "label=com.docker.compose.project=$Project" --format '{{.Name}}') }
        'network'   { $rows = @(& docker network ls --filter "label=com.docker.compose.project=$Project" --format '{{.ID}}') }
    }
    if ($LASTEXITCODE -ne 0) { Fail "Unable to inspect Docker $Kind resources for project $Project." }
    return @($rows | ForEach-Object { $_.Trim() } | Where-Object { $_ })
}

function Get-SamrimComposeProjects {
    $projects = [System.Collections.Generic.HashSet[string]]::new([StringComparer]::OrdinalIgnoreCase)
    foreach ($row in @(& docker ps -a --format '{{.Label "com.docker.compose.project"}}')) {
        $project = [string]$row
        if ($project.StartsWith($SamrimProjectPrefix, [StringComparison]::OrdinalIgnoreCase)) { $null = $projects.Add($project) }
    }
    if ($LASTEXITCODE -ne 0) { Fail 'Unable to inspect Docker container project labels.' }
    foreach ($row in @(& docker volume ls --format '{{.Label "com.docker.compose.project"}}')) {
        $project = [string]$row
        if ($project.StartsWith($SamrimProjectPrefix, [StringComparison]::OrdinalIgnoreCase)) { $null = $projects.Add($project) }
    }
    if ($LASTEXITCODE -ne 0) { Fail 'Unable to inspect Docker volume project labels.' }
    foreach ($row in @(& docker network ls --format '{{.Label "com.docker.compose.project"}}')) {
        $project = [string]$row
        if ($project.StartsWith($SamrimProjectPrefix, [StringComparison]::OrdinalIgnoreCase)) { $null = $projects.Add($project) }
    }
    if ($LASTEXITCODE -ne 0) { Fail 'Unable to inspect Docker network project labels.' }
    return @($projects | Sort-Object)
}

function Get-NonCanonicalSamrimProjects {
    return @(Get-SamrimComposeProjects | Where-Object { $_ -ne $CanonicalProject })
}

function Assert-NoParallelRuntimeResidue {
    $projects = @(Get-NonCanonicalSamrimProjects)
    if ($projects.Count) {
        $details = foreach ($project in $projects) {
            "project=$project containers=$(@(Get-ProjectResourceIds -Kind container -Project $project).Count) volumes=$(@(Get-ProjectResourceIds -Kind volume -Project $project).Count) networks=$(@(Get-ProjectResourceIds -Kind network -Project $project).Count)"
        }
        Fail "PARALLEL_RUNTIME_RESIDUE=FAIL $($details -join ';') action=pnpm-runtime-reset"
    }
}

function Remove-ProjectResources([string]$Project, [switch]$RemoveVolumes) {
    $containers = @(Get-ProjectResourceIds -Kind container -Project $Project)
    if ($containers.Count) {
        & docker rm -f @containers *> $null
        if ($LASTEXITCODE -ne 0) { Fail "Failed removing containers for $Project." }
    }
    if ($RemoveVolumes) {
        $volumes = @(Get-ProjectResourceIds -Kind volume -Project $Project)
        if ($volumes.Count) {
            & docker volume rm -f @volumes *> $null
            if ($LASTEXITCODE -ne 0) { Fail "Failed removing volumes for $Project." }
        }
    }
    $networks = @(Get-ProjectResourceIds -Kind network -Project $Project)
    foreach ($network in $networks) {
        & docker network rm $network *> $null
        if ($LASTEXITCODE -ne 0) { Fail "Failed removing network $network for $Project." }
    }
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

function Get-DockerPublishedPortOwners([int]$Port) {
    $needle = ":${Port}->"
    $rows = @(& docker ps --format '{{.ID}}|{{.Names}}|{{.Ports}}|{{.Label "com.docker.compose.project"}}|{{.Label "com.docker.compose.service"}}' | Where-Object { $_ -and $_.Contains($needle) })
    if ($LASTEXITCODE -ne 0) { Fail "Unable to inspect Docker port ownership for $Port." }
    return $rows
}

function Test-PortListening([int]$Port) {
    if (Get-Command Get-NetTCPConnection -ErrorAction SilentlyContinue) {
        return @(
            Get-NetTCPConnection -State Listen -LocalPort $Port -ErrorAction SilentlyContinue |
                Where-Object { $_.LocalAddress -in @('127.0.0.1','0.0.0.0','::','::1') }
        ).Count -gt 0
    }
    try {
        $client = [Net.Sockets.TcpClient]::new()
        $task = $client.ConnectAsync('127.0.0.1', $Port)
        if (-not $task.Wait(300)) { $client.Dispose(); return $false }
        $connected = $client.Connected
        $client.Dispose()
        return $connected
    } catch { return $false }
}

function Get-HostPortOwner([int]$Port) {
    if (-not (Get-Command Get-NetTCPConnection -ErrorAction SilentlyContinue)) { return 'unavailable' }
    $listeners = @(Get-NetTCPConnection -State Listen -LocalPort $Port -ErrorAction SilentlyContinue)
    $items = foreach ($pidValue in @($listeners | Select-Object -ExpandProperty OwningProcess -Unique)) {
        $process = Get-Process -Id ([int]$pidValue) -ErrorAction SilentlyContinue
        if ($null -eq $process) { "PID=${pidValue}(exited)" } else { "PID=${pidValue}:$($process.ProcessName)" }
    }
    if (-not $items) { return 'none' }
    return ($items -join ',')
}

function Assert-PublishedPortSafe([int]$Port, [string]$ExpectedService) {
    if (-not (Test-PortListening -Port $Port)) { return }
    $dockerOwners = @(Get-DockerPublishedPortOwners -Port $Port)
    $expected = @($dockerOwners | Where-Object { $_ -match "\|$CanonicalProject\|$([regex]::Escape($ExpectedService))$" })
    if ($dockerOwners.Count -eq 1 -and $expected.Count -eq 1) { return }
    Fail "RUNTIME_OWNERSHIP_CONFLICT=FAIL port=$Port expected=$CanonicalProject/$ExpectedService host_owner=$(Get-HostPortOwner -Port $Port) docker_owner=$($dockerOwners -join ';')"
}

function Assert-CanonicalPublishedPort([int]$Port, [string]$ExpectedService) {
    $dockerOwners = @(Get-DockerPublishedPortOwners -Port $Port)
    $expected = @($dockerOwners | Where-Object { $_ -match "\|$CanonicalProject\|$([regex]::Escape($ExpectedService))$" })
    if (-not (Test-PortListening -Port $Port) -or $dockerOwners.Count -ne 1 -or $expected.Count -ne 1) {
        Fail "PORT_OWNERSHIP=FAIL port=$Port expected=$CanonicalProject/$ExpectedService host_owner=$(Get-HostPortOwner -Port $Port) docker_owner=$($dockerOwners -join ';')"
    }
}

function Assert-PortFree([int]$Port, [string]$Component) {
    if (-not (Test-PortListening -Port $Port)) { return }
    Fail "PORT_OWNERSHIP_CONFLICT=FAIL component=$Component port=$Port host_owner=$(Get-HostPortOwner -Port $Port) docker_owner=$(@(Get-DockerPublishedPortOwners -Port $Port) -join ';')"
}

function Assert-NoNativeBackendProcesses {
    if (-not (Get-Command Get-CimInstance -ErrorAction SilentlyContinue)) { return }
    $repoNeedle = $RepoRoot.ToLowerInvariant()
    $matches = @(
        Get-CimInstance Win32_Process -ErrorAction SilentlyContinue |
            Where-Object {
                $cmd = [string]$_.CommandLine
                if ([string]::IsNullOrWhiteSpace($cmd)) { return $false }
                $lower = $cmd.ToLowerInvariant()
                $isRepo = $lower.Contains($repoNeedle)
                $isBackend = $lower.Contains('services\identity') -or $lower.Contains('services/identity') -or $lower.Contains('services\dsh') -or $lower.Contains('services/dsh')
                $isNativeServer = $lower.Contains('go run') -or $lower.Contains('cmd\api') -or $lower.Contains('cmd/api')
                return $isRepo -and $isBackend -and $isNativeServer
            }
    )
    if ($matches.Count) {
        $summary = @($matches | ForEach-Object { "PID=$($_.ProcessId):$($_.Name)" }) -join ';'
        Fail "NATIVE_BACKEND_RUNTIME=FAIL $summary"
    }
    Write-Host 'NATIVE_BACKEND_RUNTIME=0'
}

function Assert-Endpoint([string]$Service, [string]$Uri) {
    try { $response = Invoke-RestMethod -Uri $Uri -Method Get -TimeoutSec 5 }
    catch { Fail "SERVICE_ENDPOINT=FAIL service=$Service uri=$Uri error=$($_.Exception.Message)" }
    if ($null -eq $response -or $response.status -ne 'ok' -or $response.service -ne $Service) { Fail "SERVICE_ENDPOINT=FAIL service=$Service uri=$Uri" }
}

function Get-HttpText(
    [string]$Uri,
    [int]$TimeoutSec = 5
) {
    $response = Invoke-WebRequest `
        -Uri $Uri `
        -Method Get `
        -TimeoutSec $TimeoutSec `
        -SkipHttpErrorCheck `
        -NoProxy

    if ($response.StatusCode -lt 200 -or $response.StatusCode -ge 300) {
        Fail "HTTP_TEXT=FAIL uri=$Uri status=$($response.StatusCode)"
    }

    if ($response.Content -is [byte[]]) {
        return ([Text.Encoding]::UTF8.GetString([byte[]]$response.Content)).Trim()
    }

    return ([string]$response.Content).Trim()
}

function Assert-CanonicalRuntime([hashtable]$EnvMap) {
    Assert-OneShotSucceeded -Service 'identity-migrate'
    Assert-OneShotSucceeded -Service 'dsh-migrate'
    Assert-OneShotSucceeded -Service 'js-deps'
    Assert-RunningService -Service 'postgres' -Healthy
    Assert-RunningService -Service 'mailpit'
    Assert-RunningService -Service 'identity' -Healthy
    Assert-RunningService -Service 'dsh' -Healthy
    Assert-RunningService -Service 'control' -Healthy
    Assert-RunningService -Service 'metro-client' -Healthy
    Assert-RunningService -Service 'metro-partner' -Healthy
    Assert-RunningService -Service 'metro-captain' -Healthy
    Assert-RunningService -Service 'metro-field' -Healthy

    $identityPort = Require-TcpPort -Map $EnvMap -Name 'SAMRIM_IDENTITY_PORT'
    $dshPort = Require-TcpPort -Map $EnvMap -Name 'SAMRIM_DSH_PORT'
    $mailpitPort = Require-TcpPort -Map $EnvMap -Name 'SAMRIM_MAILPIT_WEB_PORT'
    $controlPort = Require-TcpPort -Map $EnvMap -Name 'SAMRIM_CONTROL_PORT'
    $clientPort = Require-TcpPort -Map $EnvMap -Name 'SAMRIM_APP_CLIENT_METRO_PORT'
    $partnerPort = Require-TcpPort -Map $EnvMap -Name 'SAMRIM_APP_PARTNER_METRO_PORT'
    $captainPort = Require-TcpPort -Map $EnvMap -Name 'SAMRIM_APP_CAPTAIN_METRO_PORT'
    $fieldPort = Require-TcpPort -Map $EnvMap -Name 'SAMRIM_APP_FIELD_METRO_PORT'

    Assert-CanonicalPublishedPort -Port $identityPort -ExpectedService 'identity'
    Assert-CanonicalPublishedPort -Port $dshPort -ExpectedService 'dsh'
    Assert-CanonicalPublishedPort -Port $mailpitPort -ExpectedService 'mailpit'
    Assert-CanonicalPublishedPort -Port $controlPort -ExpectedService 'control'
    Assert-CanonicalPublishedPort -Port $clientPort -ExpectedService 'metro-client'
    Assert-CanonicalPublishedPort -Port $partnerPort -ExpectedService 'metro-partner'
    Assert-CanonicalPublishedPort -Port $captainPort -ExpectedService 'metro-captain'
    Assert-CanonicalPublishedPort -Port $fieldPort -ExpectedService 'metro-field'

    $identityBase = (Require-EnvValue -Map $EnvMap -Name 'IDENTITY_API_BASE_URL').TrimEnd('/')
    $dshBase = (Require-EnvValue -Map $EnvMap -Name 'DSH_API_BASE_URL').TrimEnd('/')
    Assert-Endpoint -Service 'identity' -Uri "$identityBase/identity/health"
    Assert-Endpoint -Service 'identity' -Uri "$identityBase/identity/readiness"
    Assert-Endpoint -Service 'dsh' -Uri "$dshBase/dsh/health"
    Assert-Endpoint -Service 'dsh' -Uri "$dshBase/dsh/readiness"

    try {
        $mailpit = Invoke-WebRequest `
            -Uri "http://127.0.0.1:$mailpitPort/" `
            -Method Get `
            -TimeoutSec 5 `
            -SkipHttpErrorCheck `
            -NoProxy
    } catch {
        Fail "MAILPIT_READY=FAIL error=$($_.Exception.Message)"
    }

    if ($mailpit.StatusCode -lt 200 -or $mailpit.StatusCode -ge 500) {
        Fail "MAILPIT_READY=FAIL status=$($mailpit.StatusCode)"
    }

    try {
        $control = Invoke-WebRequest `
            -Uri "http://127.0.0.1:$controlPort/" `
            -Method Get `
            -TimeoutSec 10 `
            -SkipHttpErrorCheck `
            -NoProxy
    } catch {
        Fail "CONTROL_READY=FAIL error=$($_.Exception.Message)"
    }

    if ($control.StatusCode -ge 500) {
        Fail "CONTROL_READY=FAIL status=$($control.StatusCode)"
    }

    foreach ($entry in @(
        @{ Name = 'client'; Port = $clientPort },
        @{ Name = 'partner'; Port = $partnerPort },
        @{ Name = 'captain'; Port = $captainPort },
        @{ Name = 'field'; Port = $fieldPort }
    )) {
        try {
            $status = Get-HttpText `
                -Uri "http://127.0.0.1:$($entry.Port)/status" `
                -TimeoutSec 5
        } catch {
            Fail "MOBILE_METRO_READY=FAIL app=$($entry.Name) port=$($entry.Port) error=$($_.Exception.Message)"
        }

        if ($status -ne 'packager-status:running') {
            Fail "MOBILE_METRO_READY=FAIL app=$($entry.Name) port=$($entry.Port) status=$status"
        }

        Write-Host "MOBILE_METRO_READY=PASS app=$($entry.Name) port=$($entry.Port)"
    }
}

function Test-CanonicalRuntimeReady([hashtable]$EnvMap) {
    try {
        Assert-NoParallelRuntimeResidue
        Assert-CanonicalRuntime -EnvMap $EnvMap
        return $true
    } catch { return $false }
}

function Get-RuntimeInputFingerprint([string[]]$RelativePaths) {
    $entries = [System.Collections.Generic.List[string]]::new()

    foreach ($relativePath in $RelativePaths) {
        $fullPath = Join-Path $RepoRoot $relativePath

        if (Test-Path -LiteralPath $fullPath -PathType Leaf) {
            $files = @(Get-Item -LiteralPath $fullPath)
        }
        elseif (Test-Path -LiteralPath $fullPath -PathType Container) {
            $files = @(
                Get-ChildItem `
                    -LiteralPath $fullPath `
                    -Recurse `
                    -File `
                    -Force
            )
        }
        else {
            Fail "BUILD_INPUT=FAIL missing=$relativePath"
        }

        foreach ($file in $files) {
            $repoRelative = [IO.Path]::GetRelativePath(
                $RepoRoot,
                $file.FullName
            ).Replace('\','/')

            $fileHash = (
                Get-FileHash `
                    -LiteralPath $file.FullName `
                    -Algorithm SHA256
            ).Hash.ToLowerInvariant()

            $entries.Add("$repoRelative|$fileHash")
        }
    }

    if ($entries.Count -eq 0) {
        Fail 'BUILD_INPUT=FAIL empty=1'
    }

    $manifest = (
        @($entries | Sort-Object -Unique) -join "`n"
    )

    $bytes = [Text.Encoding]::UTF8.GetBytes($manifest)
    $hash = [Security.Cryptography.SHA256]::HashData($bytes)

    return [Convert]::ToHexString($hash).ToLowerInvariant()
}

function Read-RuntimeBuildState {
    if (-not (
        Test-Path `
            -LiteralPath $RuntimeBuildStatePath `
            -PathType Leaf
    )) {
        return @{}
    }

    try {
        $raw = Get-Content `
            -LiteralPath $RuntimeBuildStatePath `
            -Raw

        if ([string]::IsNullOrWhiteSpace($raw)) {
            return @{}
        }

        $state = $raw | ConvertFrom-Json -AsHashtable
        if ($null -eq $state) {
            return @{}
        }

        return $state
    }
    catch {
        Write-Host 'BUILD_STATE=STALE action=rebuild-safe'
        return @{}
    }
}

function Write-RuntimeBuildState([hashtable]$State) {
    $directory = Split-Path `
        -Parent `
        $RuntimeBuildStatePath

    New-Item `
        -ItemType Directory `
        -Force `
        -Path $directory *> $null

    $json = $State |
        ConvertTo-Json -Depth 8

    $temporary = "$RuntimeBuildStatePath.tmp"

    [IO.File]::WriteAllText(
        $temporary,
        $json + [Environment]::NewLine,
        [Text.UTF8Encoding]::new($false)
    )

    Move-Item `
        -LiteralPath $temporary `
        -Destination $RuntimeBuildStatePath `
        -Force
}

function Test-RuntimeImage([string]$Image) {
    & docker image inspect $Image *> $null
    return $LASTEXITCODE -eq 0
}

function Reconcile-RuntimeBuildComponent(
    [string]$Name,
    [string[]]$BuildServices,
    [string[]]$Images,
    [string[]]$Inputs,
    [hashtable]$State
) {
    $fingerprint = Get-RuntimeInputFingerprint `
        -RelativePaths $Inputs

    $previous = if ($State.ContainsKey($Name)) {
        [string]$State[$Name]
    } else {
        ''
    }

    $missingImages = @(
        $Images |
            Where-Object {
                -not (Test-RuntimeImage -Image $_)
            }
    )

    if (
        $previous -eq $fingerprint -and
        $missingImages.Count -eq 0
    ) {
        Write-Host "BUILD_RECONCILE=REUSED component=$Name fingerprint=$fingerprint"
        return
    }

    $reason = if ($missingImages.Count -gt 0) {
        'image-missing'
    }
    elseif ([string]::IsNullOrWhiteSpace($previous)) {
        'state-missing'
    }
    else {
        'inputs-changed'
    }

    Write-Host "BUILD_RECONCILE=BUILD component=$Name reason=$reason"

    Invoke-Compose `
        -Arguments (@('build') + $BuildServices)

    foreach ($image in $Images) {
        if (-not (Test-RuntimeImage -Image $image)) {
            Fail "BUILD_RECONCILE=FAIL component=$Name image=$image"
        }
    }

    $State[$Name] = $fingerprint
    Write-RuntimeBuildState -State $State

    Write-Host "BUILD_RECONCILE=BUILT component=$Name fingerprint=$fingerprint"
}

function Reconcile-CanonicalBuildImages {
    $state = Read-RuntimeBuildState

    Reconcile-RuntimeBuildComponent `
        -Name 'identity' `
        -BuildServices @('identity-migrate','identity') `
        -Images @(
            'samrim-local-identity-migrate:dev',
            'samrim-local-identity:dev'
        ) `
        -Inputs @(
            '.dockerignore',
            'infra/local/compose/compose.yaml',
            'services/identity/backend',
            'services/identity/database/migrations'
        ) `
        -State $state

    Reconcile-RuntimeBuildComponent `
        -Name 'dsh' `
        -BuildServices @('dsh-migrate','dsh') `
        -Images @(
            'samrim-local-dsh-migrate:dev',
            'samrim-local-dsh:dev'
        ) `
        -Inputs @(
            '.dockerignore',
            'infra/local/compose/compose.yaml',
            'services/dsh/backend',
            'services/identity/clients/go'
        ) `
        -State $state

    Reconcile-RuntimeBuildComponent `
        -Name 'js-runtime' `
        -BuildServices @('js-deps') `
        -Images @('samrim-local-js-runtime:dev') `
        -Inputs @(
            'infra/local/compose/compose.yaml',
            'infra/local/docker/js-runtime.Dockerfile'
        ) `
        -State $state

    Write-Host 'BUILD_RECONCILE=PASS'
}
function Start-CanonicalRuntime {
    $envMap = Ensure-Environment
    Set-CanonicalEnvironment -Map $envMap
    Ensure-Docker
    Assert-NoParallelRuntimeResidue
    Assert-NoNativeBackendProcesses

    $lanCandidates = @(Get-MobileLanCandidates)
    $lan = if ($lanCandidates.Count -eq 1) { $lanCandidates[0] } else { $null }
    $hotspotIp = if ($null -ne $lan) { [string]$lan.IP } else { '127.0.0.1' }
    [Environment]::SetEnvironmentVariable('SAMRIM_HOTSPOT_IP', $hotspotIp, 'Process')

    if (-not (Test-Path -LiteralPath $ComposePath -PathType Leaf)) { Fail "Canonical Compose file is missing: $ComposePath" }

    Invoke-Compose -Arguments @('config','--quiet') -Quiet

    $portContracts = @(
        @{ Key = 'SAMRIM_IDENTITY_PORT'; Service = 'identity' },
        @{ Key = 'SAMRIM_DSH_PORT'; Service = 'dsh' },
        @{ Key = 'SAMRIM_MAILPIT_WEB_PORT'; Service = 'mailpit' },
        @{ Key = 'SAMRIM_CONTROL_PORT'; Service = 'control' },
        @{ Key = 'SAMRIM_APP_CLIENT_METRO_PORT'; Service = 'metro-client' },
        @{ Key = 'SAMRIM_APP_PARTNER_METRO_PORT'; Service = 'metro-partner' },
        @{ Key = 'SAMRIM_APP_CAPTAIN_METRO_PORT'; Service = 'metro-captain' },
        @{ Key = 'SAMRIM_APP_FIELD_METRO_PORT'; Service = 'metro-field' }
    )

    foreach ($contract in $portContracts) {
        Assert-PublishedPortSafe `
            -Port (Require-TcpPort -Map $envMap -Name $contract.Key) `
            -ExpectedService $contract.Service
    }

    Reconcile-CanonicalBuildImages
    Invoke-Compose -Arguments @('up','-d','--no-build','--wait','--wait-timeout','300','--remove-orphans')

    Assert-CanonicalRuntime -EnvMap $envMap

    $metroPorts = @(
        Require-TcpPort -Map $envMap -Name 'SAMRIM_APP_CLIENT_METRO_PORT'
        Require-TcpPort -Map $envMap -Name 'SAMRIM_APP_PARTNER_METRO_PORT'
        Require-TcpPort -Map $envMap -Name 'SAMRIM_APP_CAPTAIN_METRO_PORT'
        Require-TcpPort -Map $envMap -Name 'SAMRIM_APP_FIELD_METRO_PORT'
    )

    Write-Host 'CANONICAL_LOCAL_RUNTIME=PASS'
    Write-Host 'DOCKER_RUNTIME=PASS'
    Write-Host 'BROWSER_RUNTIME=PASS'
    Write-Host 'DOCKER_OWNS=postgres,mailpit,identity,dsh,control,metro-client,metro-partner,metro-captain,metro-field'
    if ($null -eq $lan) {
        $reason = if ($lanCandidates.Count -eq 0) { 'HOTSPOT_OFF_OR_UNAVAILABLE' } else { "MULTIPLE_HOTSPOT_CANDIDATES count=$($lanCandidates.Count)" }
        Write-Host "MOBILE_LAN=NOT_READY reason=$reason"
        Write-Host "ANDROID_RUNTIME=BLOCKED reason=$reason"
    }
    else {
        $lanReady = Test-MobileLanInfrastructure `
            -Lan $lan `
            -IdentityPort (Require-TcpPort -Map $envMap -Name 'SAMRIM_IDENTITY_PORT') `
            -DshPort (Require-TcpPort -Map $envMap -Name 'SAMRIM_DSH_PORT') `
            -MetroPorts $metroPorts
        if ($lanReady) {
            Write-Host "MOBILE_LAN=PASS hotspot=$($lan.IP)"
            Write-Host 'ANDROID_RUNTIME=READY_FOR_DEVICE_PROOF'
        }
        else {
            Write-Host "MOBILE_LAN=NOT_READY reason=REPAIR_REQUIRED hotspot=$($lan.IP)"
            Write-Host 'ANDROID_RUNTIME=BLOCKED reason=MOBILE_LAN_NOT_READY'
        }
    }
    Write-Host "MOBILE_TRANSPORT=WIFI_LAN hotspot=$hotspotIp"
    Write-Host 'ADB_REVERSE_DEPENDENCY=0'
    return $envMap
}

function Ensure-CanonicalRuntime {
    $envMap = Ensure-Environment
    Set-CanonicalEnvironment -Map $envMap
    Ensure-Docker
    Assert-NoNativeBackendProcesses

    if (Test-CanonicalRuntimeReady -EnvMap $envMap) {
        Write-Host 'DOCKER_RUNTIME=PASS'
        Write-Host 'BROWSER_RUNTIME=PASS'
        Write-Host 'MOBILE_LAN=UNCHANGED explicit_repair=pnpm runtime:mobile-lan'
        Write-Host 'CANONICAL_LOCAL_RUNTIME=READY'
        return $envMap
    }

    return Start-CanonicalRuntime
}

function Stop-CanonicalRuntime {
    $null = Ensure-Environment
    Ensure-Docker
    Invoke-Compose -Arguments @('down','--remove-orphans')
    if (@(Get-ProjectResourceIds -Kind container -Project $CanonicalProject).Count) { Fail 'CANONICAL_RUNTIME_STOP=FAIL containers remain.' }
    Write-Host 'MOBILE_LAN_INFRA=PRESERVED'
    Write-Host 'CANONICAL_RUNTIME_STOP=PASS data_volume=preserved'
}

function Show-RuntimeStatus {
    $envMap = $null
    try { $envMap = Read-CanonicalEnvironment; Write-Host 'LOCAL_RUNTIME_ENV=PASS mode=read-only' }
    catch { Write-Host "LOCAL_RUNTIME_ENV=NOT_READY reason=$($_.Exception.Message)" }

    & docker version *> $null
    if ($LASTEXITCODE -ne 0) {
        Write-Host 'DOCKER_RUNTIME=NOT_READY reason=daemon_unavailable'
        return
    }

    if ($null -eq $envMap) {
        & docker ps -a --filter "label=com.docker.compose.project=$CanonicalProject"
        if ($LASTEXITCODE -ne 0) { Fail 'Unable to inspect canonical runtime.' }
        Write-Host 'DOCKER_RUNTIME=NOT_READY reason=LOCAL_ENV_NOT_READY'
        return
    }

    $base = Get-ComposeBaseArgs
    & docker @base ps -a
    if ($LASTEXITCODE -ne 0) { Fail 'Unable to inspect canonical runtime.' }
    $parallelProjects = @(Get-NonCanonicalSamrimProjects)
    Write-Host "PARALLEL_RUNTIME_PROJECTS=$($parallelProjects.Count)"
    foreach ($project in $parallelProjects) {
        Write-Host "NONCANONICAL_PROJECT=$project containers=$(@(Get-ProjectResourceIds -Kind container -Project $project).Count) volumes=$(@(Get-ProjectResourceIds -Kind volume -Project $project).Count) networks=$(@(Get-ProjectResourceIds -Kind network -Project $project).Count)"
    }

    $lanCandidates = @(Get-MobileLanCandidates)
    if ($lanCandidates.Count -eq 0) {
        Write-Host 'MOBILE_LAN=NOT_READY reason=HOTSPOT_OFF_OR_UNAVAILABLE'
    }
    elseif ($lanCandidates.Count -ne 1) {
        Write-Host "MOBILE_LAN=NOT_READY reason=MULTIPLE_HOTSPOT_CANDIDATES count=$($lanCandidates.Count)"
    }
    elseif ($null -eq $envMap) {
        Write-Host 'MOBILE_LAN=NOT_READY reason=LOCAL_ENV_NOT_READY'
    }
    else {
        $lan = $lanCandidates[0]
        $ports = Get-ExpectedMobileLanPorts -EnvMap $envMap
        $firewall = Get-MobileLanFirewallInspection -Lan $lan -Ports $ports
        $proxy = Get-MobileLanPortProxyInspection -Lan $lan -Ports $ports
        Write-Host "MOBILE_LAN_FIREWALL=$(if($firewall.Exact){'PASS'}else{'NOT_READY'}) reason=$($firewall.Reason)"
        Write-Host "MOBILE_LAN_PORTPROXY=$(if($proxy.Exact){'PASS'}else{'NOT_READY'}) reason=$($proxy.Reason)"
        Write-Host "MOBILE_LAN_STALE_ARTIFACTS=$($proxy.Stale.Count + $proxy.Duplicates.Count)"
    }
}

function Show-RuntimeLogs {
    $null = Ensure-Environment
    Ensure-Docker
    $base = Get-ComposeBaseArgs
    & docker @base logs --tail 200 -f
    if ($LASTEXITCODE -ne 0) { Fail 'Docker Compose logs failed.' }
}

function Invoke-RuntimeDoctor {
    $failures = @()
    $envMap = $null
    Write-Host "HOST_OS=$([Environment]::OSVersion.VersionString)"
    Write-Host "POWERSHELL_VERSION=$($PSVersionTable.PSVersion)"
    Write-Host "ADMIN_STATE=$(if(Test-Administrator){'ELEVATED'}else{'NOT_ELEVATED'})"
    try {
        $envMap = Read-CanonicalEnvironment
        Write-Host 'LOCAL_RUNTIME_ENV=PASS mode=read-only'
    }
    catch {
        $failures += 'local environment is not readable'
        Write-Host "LOCAL_RUNTIME_ENV=NOT_READY reason=$($_.Exception.Message)"
    }

    $dockerReady = $false
    if ($null -eq (Get-Command docker -ErrorAction SilentlyContinue)) {
        Write-Host 'DOCKER_CLI=NOT_READY reason=missing'
        $failures += 'Docker CLI is missing'
    }
    else {
        Write-Host 'DOCKER_CLI=PASS'
        & docker version *> $null
        $dockerReady = $LASTEXITCODE -eq 0
        if ($dockerReady) { Write-Host 'DOCKER_DAEMON=PASS' }
        else {
            Write-Host 'DOCKER_DAEMON=NOT_READY reason=unavailable'
            $failures += 'Docker daemon is unavailable'
        }
    }

    if ($dockerReady) {
        $composeFiles = @(Get-ChildItem -LiteralPath $ComposeDir -File | Where-Object { $_.Name -match '^compose(?:\..+)?\.ya?ml$' })
        if ($composeFiles.Count -eq 1 -and $composeFiles[0].FullName -eq $ComposePath) {
            Write-Host 'CANONICAL_COMPOSE=PASS files=1'
        }
        else {
            Write-Host "CANONICAL_COMPOSE=NOT_READY observed=$($composeFiles.Name -join ',')"
            $failures += 'canonical Compose topology is not unique'
        }
        if ($null -ne $envMap) {
            try {
                Invoke-Compose -Arguments @('config','--quiet') -Quiet
                Write-Host 'CANONICAL_COMPOSE_CONFIG=PASS'
            }
            catch {
                Write-Host "CANONICAL_COMPOSE_CONFIG=NOT_READY reason=$($_.Exception.Message)"
                $failures += 'canonical Compose config is invalid'
            }
        }
    }

    if ($dockerReady) {
        try {
            $parallelProjects = @(Get-NonCanonicalSamrimProjects)
            Write-Host "PARALLEL_RUNTIME_RESIDUE=$($parallelProjects.Count)"
            foreach ($project in $parallelProjects) {
                Write-Host "NONCANONICAL_PROJECT=$project containers=$(@(Get-ProjectResourceIds -Kind container -Project $project).Count) volumes=$(@(Get-ProjectResourceIds -Kind volume -Project $project).Count) networks=$(@(Get-ProjectResourceIds -Kind network -Project $project).Count)"
            }
            if ($parallelProjects.Count) { $failures += 'noncanonical Samrim Compose projects remain' }
        }
        catch {
            Write-Host "PARALLEL_RUNTIME_RESIDUE=UNKNOWN reason=$($_.Exception.Message)"
            $failures += 'parallel runtime residue could not be inspected'
        }

        try { Assert-NoNativeBackendProcesses }
        catch {
            Write-Host "NATIVE_RUNTIME_RESIDUE=FAIL reason=$($_.Exception.Message)"
            $failures += 'native backend runtime residue remains'
        }
    }
    else {
        Write-Host 'PARALLEL_RUNTIME_RESIDUE=UNKNOWN reason=docker_unavailable'
        Write-Host 'NATIVE_RUNTIME_RESIDUE=UNKNOWN reason=docker_unavailable'
    }

    if ($null -ne (Get-Command node -ErrorAction SilentlyContinue)) {
        & node $OwnershipVerifier
        if ($LASTEXITCODE -eq 0) { Write-Host 'CANONICAL_RUNTIME_OWNERSHIP=PASS' }
        else { Write-Host 'CANONICAL_RUNTIME_OWNERSHIP=NOT_READY'; $failures += 'repository runtime ownership verifier failed' }
    }
    else { Write-Host 'CANONICAL_RUNTIME_OWNERSHIP=UNKNOWN reason=node_missing' }

    $services = @(
        @{ Name = 'postgres'; Healthy = $true; Kind = 'running' },
        @{ Name = 'mailpit'; Healthy = $false; Kind = 'running' },
        @{ Name = 'identity-migrate'; Healthy = $false; Kind = 'oneshot' },
        @{ Name = 'identity'; Healthy = $true; Kind = 'running' },
        @{ Name = 'dsh-migrate'; Healthy = $false; Kind = 'oneshot' },
        @{ Name = 'dsh'; Healthy = $true; Kind = 'running' },
        @{ Name = 'js-deps'; Healthy = $false; Kind = 'oneshot' },
        @{ Name = 'control'; Healthy = $true; Kind = 'running' },
        @{ Name = 'metro-client'; Healthy = $true; Kind = 'running' },
        @{ Name = 'metro-partner'; Healthy = $true; Kind = 'running' },
        @{ Name = 'metro-captain'; Healthy = $true; Kind = 'running' },
        @{ Name = 'metro-field'; Healthy = $true; Kind = 'running' }
    )
    $serviceFailures = @()
    if ($dockerReady) {
        foreach ($service in $services) {
            $ids = @(& docker ps -a --filter "label=com.docker.compose.project=$CanonicalProject" --filter "label=com.docker.compose.service=$($service.Name)" --format '{{.ID}}' | ForEach-Object { $_.Trim() } | Where-Object { $_ })
            if ($ids.Count -ne 1) {
                $serviceFailures += "$($service.Name):container_count=$($ids.Count)"
                continue
            }
            $state = (& docker inspect --format '{{.State.Status}}|{{.State.ExitCode}}' $ids[0]).Trim()
            $expectedState = if ($service.Kind -eq 'oneshot') { 'exited|0' } else { 'running|0' }
            if ($state -ne $expectedState) { $serviceFailures += "$($service.Name):state=$state" }
            if ($service.Healthy -and $state -eq 'running|0') {
                $health = (& docker inspect --format '{{if .State.Health}}{{.State.Health.Status}}{{else}}missing{{end}}' $ids[0]).Trim()
                if ($health -ne 'healthy') { $serviceFailures += "$($service.Name):health=$health" }
            }
        }
        if ($serviceFailures.Count) {
            Write-Host "SERVICE_STATE=NOT_READY details=$($serviceFailures -join ',')"
            if (@($serviceFailures | Where-Object { $_ -like 'postgres:*' }).Count) { Write-Host 'DATABASE_STATE=NOT_READY reason=postgres_not_ready' }
            else { Write-Host 'DATABASE_STATE=PASS' }
            $failures += 'one or more canonical services are not ready'
        }
        else {
            Write-Host 'SERVICE_STATE=PASS'
            Write-Host 'SERVICE_HEALTH=PASS'
            Write-Host 'DATABASE_STATE=PASS'
            Write-Host 'DOCKER_RUNTIME=PASS'
            Write-Host 'BROWSER_RUNTIME=PASS'
        }
    }
    else {
        Write-Host 'SERVICE_STATE=UNKNOWN reason=docker_unavailable'
        Write-Host 'DATABASE_STATE=UNKNOWN reason=docker_unavailable'
    }

    if ($dockerReady -and $null -ne $envMap) {
        $portFailures = @()
        foreach ($contract in @(
            @{ Key = 'SAMRIM_IDENTITY_PORT'; Service = 'identity' },
            @{ Key = 'SAMRIM_DSH_PORT'; Service = 'dsh' },
            @{ Key = 'SAMRIM_MAILPIT_WEB_PORT'; Service = 'mailpit' },
            @{ Key = 'SAMRIM_CONTROL_PORT'; Service = 'control' },
            @{ Key = 'SAMRIM_APP_CLIENT_METRO_PORT'; Service = 'metro-client' },
            @{ Key = 'SAMRIM_APP_PARTNER_METRO_PORT'; Service = 'metro-partner' },
            @{ Key = 'SAMRIM_APP_CAPTAIN_METRO_PORT'; Service = 'metro-captain' },
            @{ Key = 'SAMRIM_APP_FIELD_METRO_PORT'; Service = 'metro-field' }
        )) {
            try { Assert-CanonicalPublishedPort -Port (Require-TcpPort -Map $envMap -Name $contract.Key) -ExpectedService $contract.Service }
            catch { $portFailures += "$($contract.Key):$($_.Exception.Message)" }
        }
        if ($portFailures.Count) {
            Write-Host "PORT_OWNERSHIP=NOT_READY details=$($portFailures -join ',')"
            $failures += 'canonical published port ownership is not ready'
        }
        else { Write-Host 'PORT_OWNERSHIP=PASS' }

        $volumeNames = @(Get-ProjectResourceIds -Kind volume -Project $CanonicalProject)
        $requiredJsVolumes = @('samrim-js-pnpm-store','samrim-js-root-node-modules','samrim-js-partner-node-modules','samrim-js-control-node-modules')
        $missingJsVolumes = @($requiredJsVolumes | Where-Object {
            $expectedVolume = $_
            @($volumeNames | Where-Object { $_ -match [regex]::Escape($expectedVolume) }).Count -ne 1
        })
        $pnpmStoreVolumeCount = @($volumeNames | Where-Object { $_ -match 'samrim-js-pnpm-store$' }).Count
        $jsDepsReady = $serviceFailures.Count -eq 0 -and $pnpmStoreVolumeCount -eq 1
        if ($jsDepsReady -and $missingJsVolumes.Count -eq 0) { Write-Host 'JS_DEPS_STATE=PASS fingerprinted_volume=present' }
        else { Write-Host "JS_DEPS_STATE=NOT_READY missing_volumes=$($missingJsVolumes -join ',')"; $failures += 'JS dependency runtime state is not ready' }

        $requiredImages = @(
            'samrim-local-identity:dev',
            'samrim-local-dsh:dev',
            'samrim-local-js-runtime:dev'
        )
        $missingImages = @($requiredImages | Where-Object { -not (Test-RuntimeImage -Image $_) })
        if ($missingImages.Count -eq 0) { Write-Host 'BUILD_CACHE_STATE=PASS required_images=present' }
        else { Write-Host "BUILD_CACHE_STATE=NOT_READY missing=$($missingImages -join ',')"; $failures += 'required runtime images are missing' }
    }
    else {
        Write-Host 'PORT_OWNERSHIP=UNKNOWN reason=docker_or_env_unavailable'
        Write-Host 'JS_DEPS_STATE=UNKNOWN reason=docker_or_env_unavailable'
        Write-Host 'BUILD_CACHE_STATE=UNKNOWN reason=docker_or_env_unavailable'
    }

    $lanCandidates = @(Get-MobileLanCandidates)
    $mobileReady = $false
    $mobileLanExact = $false
    if ($lanCandidates.Count -eq 0) {
        Write-Host 'HOTSPOT_STATE=OFF_OR_UNAVAILABLE'
        Write-Host 'HOTSPOT_ADAPTER=NONE'
        Write-Host 'HOTSPOT_IP=NONE'
        Write-Host 'HOTSPOT_SUBNET=NONE'
        Write-Host 'MOBILE_LAN=NOT_READY reason=HOTSPOT_OFF_OR_UNAVAILABLE'
        Write-Host 'MOBILE_LAN_FIREWALL=NOT_READY reason=HOTSPOT_OFF_OR_UNAVAILABLE'
        Write-Host 'MOBILE_LAN_FIREWALL_FILTERS=NOT_READY reason=HOTSPOT_OFF_OR_UNAVAILABLE'
        Write-Host 'MOBILE_LAN_PORTPROXY=NOT_READY reason=HOTSPOT_OFF_OR_UNAVAILABLE'
        Write-Host 'MOBILE_LAN_STALE_ARTIFACTS=UNKNOWN reason=hotspot_unavailable'
    }
    elseif ($lanCandidates.Count -ne 1) {
        Write-Host 'HOTSPOT_STATE=AMBIGUOUS'
        Write-Host 'HOTSPOT_ADAPTER=MULTIPLE'
        Write-Host 'HOTSPOT_IP=MULTIPLE'
        Write-Host 'HOTSPOT_SUBNET=MULTIPLE'
        Write-Host "HOTSPOT_CANDIDATES=$($lanCandidates.Count)"
        Write-Host 'MOBILE_LAN=NOT_READY reason=MULTIPLE_HOTSPOT_CANDIDATES'
        Write-Host 'MOBILE_LAN_FIREWALL=NOT_READY reason=MULTIPLE_HOTSPOT_CANDIDATES'
        Write-Host 'MOBILE_LAN_FIREWALL_FILTERS=NOT_READY reason=MULTIPLE_HOTSPOT_CANDIDATES'
        Write-Host 'MOBILE_LAN_PORTPROXY=NOT_READY reason=MULTIPLE_HOTSPOT_CANDIDATES'
        Write-Host 'MOBILE_LAN_STALE_ARTIFACTS=UNKNOWN reason=hotspot_ambiguous'
    }
    elseif ($null -eq $envMap) {
        Write-Host "HOTSPOT_STATE=ON adapter=$($lanCandidates[0].Adapter)"
        Write-Host "HOTSPOT_IP=$($lanCandidates[0].IP)"
        Write-Host "HOTSPOT_SUBNET=$(Get-MobileLanNetworkCidr -Lan $lanCandidates[0])"
        Write-Host 'MOBILE_LAN=NOT_READY reason=LOCAL_ENV_NOT_READY'
        Write-Host 'MOBILE_LAN_FIREWALL=UNKNOWN reason=LOCAL_ENV_NOT_READY'
        Write-Host 'MOBILE_LAN_FIREWALL_FILTERS=UNKNOWN reason=LOCAL_ENV_NOT_READY'
        Write-Host 'MOBILE_LAN_PORTPROXY=UNKNOWN reason=LOCAL_ENV_NOT_READY'
        Write-Host 'MOBILE_LAN_STALE_ARTIFACTS=UNKNOWN reason=local_env_unavailable'
    }
    else {
        $lan = $lanCandidates[0]
        $ports = Get-ExpectedMobileLanPorts -EnvMap $envMap
        Write-Host "HOTSPOT_STATE=ON adapter=$($lan.Adapter)"
        Write-Host "HOTSPOT_ADAPTER=$($lan.Adapter)"
        Write-Host "HOTSPOT_IP=$($lan.IP)"
        Write-Host "HOTSPOT_SUBNET=$(Get-MobileLanNetworkCidr -Lan $lan)"
        $firewall = Get-MobileLanFirewallInspection -Lan $lan -Ports $ports
        $proxy = Get-MobileLanPortProxyInspection -Lan $lan -Ports $ports
        $staleCount = $proxy.Stale.Count + $proxy.Duplicates.Count
        $mobileLanExact = $firewall.Exact -and $proxy.Exact
        Write-Host "MOBILE_LAN_FIREWALL=$(if($firewall.Exact){'PASS'}else{'NOT_READY'}) reason=$($firewall.Reason)"
        Write-Host "MOBILE_LAN_FIREWALL_FILTERS=$(if($firewall.Exact){'PASS'}else{'FAIL'})"
        Write-Host "MOBILE_LAN_PORTPROXY=$(if($proxy.Exact){'PASS'}else{'NOT_READY'}) reason=$($proxy.Reason)"
        Write-Host "MOBILE_LAN_STALE_ARTIFACTS=$staleCount"
        if ($mobileLanExact -and $serviceFailures.Count -eq 0) {
            try {
                $mobileReady = Test-MobileLanInfrastructure `
                    -Lan $lan `
                    -IdentityPort (Require-TcpPort -Map $envMap -Name 'SAMRIM_IDENTITY_PORT') `
                    -DshPort (Require-TcpPort -Map $envMap -Name 'SAMRIM_DSH_PORT') `
                    -MetroPorts @(
                        Require-TcpPort -Map $envMap -Name 'SAMRIM_APP_CLIENT_METRO_PORT'
                        Require-TcpPort -Map $envMap -Name 'SAMRIM_APP_PARTNER_METRO_PORT'
                        Require-TcpPort -Map $envMap -Name 'SAMRIM_APP_CAPTAIN_METRO_PORT'
                        Require-TcpPort -Map $envMap -Name 'SAMRIM_APP_FIELD_METRO_PORT'
                    )
            }
            catch { Write-Host "MOBILE_LAN_HOST_CONNECTIVITY=NOT_READY reason=$($_.Exception.Message)" }
        }
        elseif ($mobileLanExact) {
            Write-Host 'MOBILE_LAN_HOST_CONNECTIVITY=BLOCKED reason=DOCKER_SERVICES_NOT_READY'
        }
        if ($mobileReady) { Write-Host "MOBILE_LAN=PASS hotspot=$($lan.IP)" }
        elseif ($mobileLanExact) { Write-Host "MOBILE_LAN=NOT_READY reason=DOCKER_SERVICES_NOT_READY hotspot=$($lan.IP)" }
        else { Write-Host "MOBILE_LAN=NOT_READY reason=REPAIR_REQUIRED hotspot=$($lan.IP)" }
    }

    $adbRecords = @()
    if ($null -eq (Get-Command adb -ErrorAction SilentlyContinue)) {
        Write-Host 'ADB_STATE=NOT_READY reason=missing'
        Write-Host 'ADB_DEVICE_SELECTION=NOT_READY reason=adb_missing'
        Write-Host 'ADB_REVERSE_DEPENDENCY=UNKNOWN reason=adb_missing'
    }
    else {
        $adbRows = @(& adb devices -l 2>&1)
        if ($LASTEXITCODE -ne 0) {
            Write-Host 'ADB_STATE=NOT_READY reason=query_failed'
            Write-Host 'ADB_DEVICE_SELECTION=NOT_READY reason=query_failed'
            Write-Host 'ADB_REVERSE_DEPENDENCY=UNKNOWN reason=query_failed'
        }
        else {
            foreach ($row in $adbRows) {
                if ($row -match '^([^\s]+)\s+device(?:\s|$)') {
                    $serial = $Matches[1]
                    $identity = ((& adb -s $serial shell getprop ro.serialno 2>$null | Out-String).Trim())
                    if ([string]::IsNullOrWhiteSpace($identity)) { $identity = ((& adb -s $serial shell getprop ro.boot.serialno 2>$null | Out-String).Trim()) }
                    $adbRecords += [pscustomobject]@{ Serial = $serial; Identity = if ($identity) { $identity } else { 'unknown' } }
                }
            }
            Write-Host "ADB_STATE=PASS devices=$($adbRecords.Count)"
            $physicalGroups = @($adbRecords | Group-Object Identity)
            if ($adbRecords.Count -eq 0) {
                Write-Host 'ADB_DEVICE_SELECTION=NOT_READY reason=no_device'
            }
            elseif ($physicalGroups.Count -eq 1) {
                $selected = @($adbRecords | Sort-Object Serial)[0]
                Write-Host "ADB_DEVICE_SELECTION=PASS identity=$($selected.Identity) serial=$($selected.Serial) transports=$($adbRecords.Count)"
            }
            else {
                Write-Host "ADB_DEVICE_SELECTION=NOT_READY reason=multiple_physical_devices count=$($physicalGroups.Count)"
            }
            $reverseFailures = @()
            if ($null -ne $envMap) {
                $reversePorts = Get-ExpectedMobileLanPorts -EnvMap $envMap
                foreach ($record in $adbRecords) {
                    $reverseRows = @(& adb -s $record.Serial reverse --list 2>&1)
                    if ($LASTEXITCODE -ne 0) { $reverseFailures += "$($record.Serial):inspection_failed"; continue }
                    foreach ($port in $reversePorts) {
                        if (@($reverseRows | Where-Object { $_ -match "tcp:$port(\s|$)" }).Count -gt 0) { $reverseFailures += "$($record.Serial):tcp:$port" }
                    }
                }
            }
            if ($reverseFailures.Count) { Write-Host "ADB_REVERSE_DEPENDENCY=FAIL details=$($reverseFailures -join ',')" }
            else { Write-Host 'ADB_REVERSE_DEPENDENCY=0' }
        }
    }

    if ($mobileReady) {
        Write-Host 'ANDROID_LAN_READINESS=NOT_PROVEN reason=AGENT_DEVICE_REQUIRED'
    }
    else {
        Write-Host 'ANDROID_LAN_READINESS=BLOCKED reason=MOBILE_LAN_NOT_READY'
    }

    $rootCause = if (-not $dockerReady) { 'DOCKER_UNAVAILABLE' } elseif ($serviceFailures.Count) { 'DOCKER_SERVICES_NOT_READY' } elseif (-not $mobileReady) { 'MOBILE_LAN_NOT_READY' } else { 'NONE_DETECTED' }
    $adminRequired = if ($mobileLanExact) { 0 } elseif ($lanCandidates.Count -eq 1) { 1 } else { 0 }
    Write-Host "ROOT_CAUSE=$rootCause"
    $affectedLayer = switch ($rootCause) {
        'MOBILE_LAN_NOT_READY' { 'MOBILE_LAN_HOST_PROVISIONING' }
        'NONE_DETECTED' { 'NONE' }
        default { 'DOCKER_RUNTIME' }
    }
    $unaffectedLayers = if ($dockerReady -and $serviceFailures.Count -eq 0) { 'DOCKER_RUNTIME,BROWSER_RUNTIME,JS_DEPS,BUILD_CACHE' } else { 'NONE_PROVEN' }
    $repairAction = if ($mobileReady -or $mobileLanExact) { 'none' } elseif ($lanCandidates.Count -eq 1) { 'pnpm runtime:mobile-lan' } else { 'enable_one_Windows_Mobile_Hotspot' }
    Write-Host "AFFECTED_LAYER=$affectedLayer"
    Write-Host "UNAFFECTED_LAYERS=$unaffectedLayers"
    Write-Host "EXACT_REPAIR_ACTION=$repairAction"
    Write-Host "ADMIN_REQUIRED=$adminRequired"
    Write-Host 'DESTRUCTIVE=0'

    if ($failures.Count -eq 0) {
        Write-Host 'RUNTIME_DOCTOR=PASS'
    }
    else {
        Write-Host "RUNTIME_DOCTOR=NOT_READY failures=$($failures.Count)"
        exit 1
    }
}

function Reset-CanonicalRuntime {
    $envMap = Ensure-Environment
    Ensure-Docker
    Write-Host 'RUNTIME_RESET=DESTRUCTIVE_LOCAL_DATA scope=postgres_application_state; dependency_volumes=preserved mobile_lan=preserved secrets=preserved'
    $mobileLanBefore = Get-MobileLanArtifactSnapshot -EnvMap $envMap
    $parallelProjects = @(Get-NonCanonicalSamrimProjects)
    $dependencyVolumesBefore = @(
        Get-ProjectResourceIds -Kind volume -Project $CanonicalProject |
            Where-Object { $_ -match 'samrim-js-' }
    )
    try { Invoke-Compose -Arguments @('down','--remove-orphans') } catch { Write-Host "Canonical compose teardown was not complete: $($_.Exception.Message)" }
    Remove-ProjectResources -Project $CanonicalProject
    foreach ($project in $parallelProjects) { Remove-ProjectResources -Project $project }

    $postgresVolumes = @(
        Get-ProjectResourceIds -Kind volume -Project $CanonicalProject |
            Where-Object { $_ -match '(^|_)samrim-postgres-data$' }
    )
    if ($postgresVolumes.Count -gt 1) {
        Fail "RUNTIME_RESET=FAIL postgres_data_volume_count=$($postgresVolumes.Count)"
    }
    if ($postgresVolumes.Count -eq 1) {
        & docker volume rm -f $postgresVolumes[0] *> $null
        if ($LASTEXITCODE -ne 0) { Fail 'RUNTIME_RESET=FAIL postgres_data_volume_remove=1' }
    }

    foreach ($project in @($CanonicalProject) + $parallelProjects) {
        foreach ($kind in @('container','volume','network')) {
            if ($kind -eq 'volume' -and $project -eq $CanonicalProject) {
                $remaining = @(Get-ProjectResourceIds -Kind volume -Project $project | Where-Object { $_ -match '(^|_)samrim-postgres-data$' })
            }
            else {
                $remaining = @(Get-ProjectResourceIds -Kind $kind -Project $project)
            }
            if ($remaining.Count) { Fail "RUNTIME_RESET=FAIL project=$project kind=$kind residue=$($remaining -join ',')" }
        }
    }
    if (@(Get-NonCanonicalSamrimProjects).Count) { Fail 'RUNTIME_RESET=FAIL noncanonical samrim Compose projects remain.' }
    $dependencyVolumesAfter = @(
        Get-ProjectResourceIds -Kind volume -Project $CanonicalProject |
            Where-Object { $_ -match 'samrim-js-' }
    )
    if (
        $dependencyVolumesAfter.Count -ne $dependencyVolumesBefore.Count -or
        (@(Compare-Object -ReferenceObject $dependencyVolumesBefore -DifferenceObject $dependencyVolumesAfter).Count -ne 0)
    ) {
        Fail 'RUNTIME_RESET=FAIL dependency_volumes_changed=1'
    }
    $mobileLanAfter = Get-MobileLanArtifactSnapshot -EnvMap $envMap
    if (
        (@(Compare-Object -ReferenceObject $mobileLanBefore.Mappings -DifferenceObject $mobileLanAfter.Mappings).Count -ne 0) -or
        (@(Compare-Object -ReferenceObject $mobileLanBefore.Rules -DifferenceObject $mobileLanAfter.Rules).Count -ne 0)
    ) {
        Fail 'RUNTIME_RESET=FAIL mobile_lan_artifacts_changed=1'
    }
    foreach ($contract in @(
        @{ Key = 'SAMRIM_IDENTITY_PORT'; Component = 'identity' },
        @{ Key = 'SAMRIM_DSH_PORT'; Component = 'dsh' },
        @{ Key = 'SAMRIM_MAILPIT_WEB_PORT'; Component = 'mailpit-web' },
        @{ Key = 'SAMRIM_CONTROL_PORT'; Component = 'control-panel' },
        @{ Key = 'SAMRIM_APP_CLIENT_METRO_PORT'; Component = 'metro-client' },
        @{ Key = 'SAMRIM_APP_PARTNER_METRO_PORT'; Component = 'metro-partner' },
        @{ Key = 'SAMRIM_APP_CAPTAIN_METRO_PORT'; Component = 'metro-captain' },
        @{ Key = 'SAMRIM_APP_FIELD_METRO_PORT'; Component = 'metro-field' }
    )) {
        Assert-PortFree `
            -Port (Require-TcpPort -Map $envMap -Name $contract.Key) `
            -Component $contract.Component
    }
    Assert-NoNativeBackendProcesses
    Write-Host 'PARALLEL_RUNTIME_RESIDUE=0'
    Write-Host "DEPENDENCY_CACHE=PASS preserved=$($dependencyVolumesAfter.Count)"
    Write-Host "MOBILE_LAN_INFRA=PRESERVED mappings=$(@($mobileLanAfter.Mappings).Count) rules=$(@($mobileLanAfter.Rules).Count)"
    Write-Host 'RUNTIME_RESET=PASS final_state=DOWN secrets=preserved'
}

function Purge-CanonicalRuntime {
    $envMap = Ensure-Environment
    Ensure-Docker
    Remove-MobileLanInfrastructure -EnvMap $envMap
    Write-Host 'RUNTIME_PURGE=DESTRUCTIVE_LOCAL_DATA_AND_HOST_NETWORK scope=samrim Docker containers/networks/volumes + BThwani Mobile LAN; local .env secrets are preserved'
    $parallelProjects = @(Get-NonCanonicalSamrimProjects)
    try { Invoke-Compose -Arguments @('down','--volumes','--remove-orphans') } catch { Write-Host "Canonical compose teardown was not complete: $($_.Exception.Message)" }
    Remove-ProjectResources -Project $CanonicalProject -RemoveVolumes
    foreach ($project in $parallelProjects) { Remove-ProjectResources -Project $project -RemoveVolumes }
    foreach ($project in @($CanonicalProject) + $parallelProjects) {
        foreach ($kind in @('container','volume','network')) {
            if (@(Get-ProjectResourceIds -Kind $kind -Project $project).Count) { Fail "RUNTIME_PURGE=FAIL project=$project kind=$kind residue=present" }
        }
    }
    if (@(Get-NonCanonicalSamrimProjects).Count) { Fail 'RUNTIME_PURGE=FAIL noncanonical samrim Compose projects remain.' }
    foreach ($contract in @(
        @{ Key = 'SAMRIM_IDENTITY_PORT'; Component = 'identity' },
        @{ Key = 'SAMRIM_DSH_PORT'; Component = 'dsh' },
        @{ Key = 'SAMRIM_MAILPIT_WEB_PORT'; Component = 'mailpit-web' },
        @{ Key = 'SAMRIM_CONTROL_PORT'; Component = 'control-panel' },
        @{ Key = 'SAMRIM_APP_CLIENT_METRO_PORT'; Component = 'metro-client' },
        @{ Key = 'SAMRIM_APP_PARTNER_METRO_PORT'; Component = 'metro-partner' },
        @{ Key = 'SAMRIM_APP_CAPTAIN_METRO_PORT'; Component = 'metro-captain' },
        @{ Key = 'SAMRIM_APP_FIELD_METRO_PORT'; Component = 'metro-field' }
    )) {
        Assert-PortFree -Port (Require-TcpPort -Map $envMap -Name $contract.Key) -Component $contract.Component
    }
    Assert-NoNativeBackendProcesses
    Write-Host 'RUNTIME_PURGE=PASS final_state=DOWN secrets=preserved'
}

function Start-ControlPanel {
    $envMap = Ensure-CanonicalRuntime
    $controlPort = Require-TcpPort -Map $envMap -Name 'SAMRIM_CONTROL_PORT'
    Assert-RunningService -Service 'control' -Healthy
    Assert-CanonicalPublishedPort -Port $controlPort -ExpectedService 'control'
    Write-Host "CONTROL_PANEL_OWNER=DOCKER"
    Write-Host "CONTROL_PANEL_READY=PASS url=http://127.0.0.1:$controlPort"
    Write-Host 'CONTROL_PANEL_OPEN=MANUAL'
}

function Resolve-AdbTargetSerial([string]$RequestedSerial) {
    if (-not (Get-Command adb -ErrorAction SilentlyContinue)) { return '' }
    $serials = @(& adb devices | Where-Object { $_ -match '\tdevice$' } | ForEach-Object { ($_ -split '\t',2)[0].Trim() } | Where-Object { $_ })
    if ($LASTEXITCODE -ne 0) { Fail 'Unable to query ADB devices.' }
    if (-not [string]::IsNullOrWhiteSpace($RequestedSerial)) {
        if ($RequestedSerial -notin $serials) { Fail "ADB target mismatch: $RequestedSerial" }
        return $RequestedSerial
    }
    if ($serials.Count -gt 1) { Fail "Multiple ADB devices are attached; set BTHWANI_ADB_SERIAL. Devices: $($serials -join ', ')" }
    if ($serials.Count -eq 1) { return $serials[0] }
    return ''
}

$MobileLanFirewallGroup = 'BThwani Samrim Mobile LAN'

function Test-Administrator {
    $identity = [Security.Principal.WindowsIdentity]::GetCurrent()
    $principal = [Security.Principal.WindowsPrincipal]::new($identity)
    return $principal.IsInRole(
        [Security.Principal.WindowsBuiltInRole]::Administrator
    )
}

function Get-MobileLanCandidates {
    if (-not $IsWindows) { return @() }

    $found = @()
    foreach ($adapter in @(
        Get-NetAdapter -ErrorAction SilentlyContinue |
            Where-Object {
                $_.Status -eq 'Up' -and
                $_.InterfaceDescription -match 'Wi-Fi Direct'
            }
    )) {
        foreach ($address in @(
            Get-NetIPAddress `
                -InterfaceIndex $adapter.ifIndex `
                -AddressFamily IPv4 `
                -ErrorAction SilentlyContinue |
                Where-Object {
                    $_.IPAddress -and
                    $_.IPAddress -ne '127.0.0.1' -and
                    $_.IPAddress -notmatch '^169\.254\.'
                }
        )) {
            $found += [pscustomobject]@{
                Adapter = $adapter.Name
                IfIndex = $adapter.ifIndex
                IP      = $address.IPAddress
                Prefix  = [int]$address.PrefixLength
            }
        }
    }

    return @($found)
}

function Get-MobileLanContext {
    $found = @(Get-MobileLanCandidates)
    if ($found.Count -eq 0) {
        Fail 'MOBILE_LAN=NOT_READY reason=HOTSPOT_OFF_OR_UNAVAILABLE'
    }

    if ($found.Count -ne 1) {
        $found | Format-Table -AutoSize
        Fail "MOBILE_LAN=NOT_READY reason=MULTIPLE_HOTSPOT_CANDIDATES count=$($found.Count)"
    }

    return $found[0]
}

function Get-MobileLanNetworkCidr([pscustomobject]$Lan) {
    $bytes = [Net.IPAddress]::Parse([string]$Lan.IP).GetAddressBytes()
    $remaining = [int]$Lan.Prefix
    $network = foreach ($byte in $bytes) {
        $bits = [Math]::Min(8, [Math]::Max(0, $remaining))
        $mask = if ($bits -eq 0) { 0 } else { 256 - [int][Math]::Pow(2, 8 - $bits) }
        $remaining -= $bits
        ([int]$byte -band $mask)
    }
    return "$($network -join '.')/$($Lan.Prefix)"
}

function Get-ExpectedMobileLanPorts([hashtable]$EnvMap) {
    return @(
        Require-TcpPort -Map $EnvMap -Name 'SAMRIM_IDENTITY_PORT'
        Require-TcpPort -Map $EnvMap -Name 'SAMRIM_DSH_PORT'
        Require-TcpPort -Map $EnvMap -Name 'SAMRIM_APP_CLIENT_METRO_PORT'
        Require-TcpPort -Map $EnvMap -Name 'SAMRIM_APP_PARTNER_METRO_PORT'
        Require-TcpPort -Map $EnvMap -Name 'SAMRIM_APP_CAPTAIN_METRO_PORT'
        Require-TcpPort -Map $EnvMap -Name 'SAMRIM_APP_FIELD_METRO_PORT'
    ) | Sort-Object -Unique
}

function Get-PortProxyMappings {
    $result = @()

    foreach ($line in @(netsh interface portproxy show v4tov4)) {
        if (
            $line -match
            '^\s*(\d+\.\d+\.\d+\.\d+)\s+(\d+)\s+(\d+\.\d+\.\d+\.\d+)\s+(\d+)\s*$'
        ) {
            $result += [pscustomobject]@{
                ListenAddress  = $Matches[1]
                ListenPort     = [int]$Matches[2]
                ConnectAddress = $Matches[3]
                ConnectPort    = [int]$Matches[4]
            }
        }
    }

    return $result
}

function Normalize-FirewallFilterValue([string]$Value) {
    $trimmed = $Value.Trim()
    if ($trimmed -match '^((?:\d{1,3}\.){3}\d{1,3})/((?:\d{1,3}\.){3}\d{1,3})$') {
        $prefixByMask = @{
            '0' = 0; '128' = 1; '192' = 2; '224' = 3; '240' = 4
            '248' = 5; '252' = 6; '254' = 7; '255' = 8
        }
        $prefix = 0
        foreach ($octet in $Matches[2].Split('.')) {
            if (-not $prefixByMask.ContainsKey($octet)) { return $trimmed }
            $prefix += $prefixByMask[$octet]
        }
        return "$($Matches[1])/$prefix"
    }
    return $trimmed
}

function Get-NormalizedFilterValues([object]$Value) {
    $values = @()
    foreach ($item in @($Value)) {
        foreach ($part in ([string]$item -split ',')) {
            $trimmed = Normalize-FirewallFilterValue -Value $part
            if ($trimmed) { $values += $trimmed }
        }
    }
    return @($values | Sort-Object -Unique)
}

function Test-ExactFilterValues([object]$Actual, [string[]]$Expected) {
    $actualValues = @(Get-NormalizedFilterValues -Value $Actual)
    $expectedValues = @($Expected | ForEach-Object { [string]$_ } | Sort-Object -Unique)
    return ($actualValues.Count -eq $expectedValues.Count) -and
        (@(Compare-Object -ReferenceObject $expectedValues -DifferenceObject $actualValues).Count -eq 0)
}

function Get-MobileLanFirewallInspection(
    [pscustomobject]$Lan,
    [int[]]$Ports
) {
    $result = [ordered]@{
        Exact  = $false
        Count  = 0
        Reason = 'missing'
        Rule   = $null
    }

    try {
        $rules = @(
            Get-NetFirewallRule `
                -Group $MobileLanFirewallGroup `
                -ErrorAction SilentlyContinue
        )
        $result.Count = $rules.Count
        if ($rules.Count -ne 1) {
            $result.Reason = if ($rules.Count -eq 0) { 'missing' } else { "duplicate_rules count=$($rules.Count)" }
            return [pscustomobject]$result
        }

        $rule = $rules[0]
        $portFilter = @(Get-NetFirewallPortFilter -AssociatedNetFirewallRule $rule -ErrorAction Stop)
        $addressFilter = @(Get-NetFirewallAddressFilter -AssociatedNetFirewallRule $rule -ErrorAction Stop)
        $interfaceFilter = @(Get-NetFirewallInterfaceFilter -AssociatedNetFirewallRule $rule -ErrorAction Stop)
        if ($portFilter.Count -ne 1 -or $addressFilter.Count -ne 1 -or $interfaceFilter.Count -ne 1) {
            $result.Reason = "filter_cardinality port=$($portFilter.Count) address=$($addressFilter.Count) interface=$($interfaceFilter.Count)"
            return [pscustomobject]$result
        }

        $expectedPorts = @($Ports | ForEach-Object { [string]$_ })
        $expectedNetwork = Get-MobileLanNetworkCidr -Lan $Lan
        $exact =
            ([string]$rule.Enabled -eq 'True') -and
            ([string]$rule.Direction -eq 'Inbound') -and
            ([string]$rule.Action -eq 'Allow') -and
            ([string]$rule.Profile -eq 'Any') -and
            (Test-ExactFilterValues -Actual $portFilter.Protocol -Expected @('TCP')) -and
            (Test-ExactFilterValues -Actual $portFilter.LocalPort -Expected $expectedPorts) -and
            (Test-ExactFilterValues -Actual $addressFilter.LocalAddress -Expected @([string]$Lan.IP)) -and
            (Test-ExactFilterValues -Actual $addressFilter.RemoteAddress -Expected @($expectedNetwork)) -and
            (Test-ExactFilterValues -Actual $interfaceFilter.InterfaceAlias -Expected @([string]$Lan.Adapter))

        $result.Exact = $exact
        $result.Rule = $rule
        $result.Reason = if ($exact) { 'exact' } else { 'wrong_filters_or_rule_properties' }
        return [pscustomobject]$result
    }
    catch {
        $result.Reason = "inspection_error=$($_.Exception.Message)"
        return [pscustomobject]$result
    }
}

function Get-MobileLanPortProxyInspection(
    [pscustomobject]$Lan,
    [int[]]$Ports
) {
    $mappings = @(Get-PortProxyMappings)
    $managed = @(
        $mappings |
            Where-Object {
                $_.ConnectAddress -eq '127.0.0.1' -and
                $_.ConnectPort -in $Ports -and
                $_.ListenPort -eq $_.ConnectPort
            }
    )

    $missing = @()
    $duplicates = @()
    foreach ($port in $Ports) {
        $matches = @(
            $managed |
                Where-Object {
                    $_.ListenAddress -eq $Lan.IP -and
                    $_.ListenPort -eq $port -and
                    $_.ConnectPort -eq $port
                }
        )
        if ($matches.Count -eq 0) { $missing += $port }
        if ($matches.Count -gt 1) { $duplicates += $port }
    }

    $stale = @(
        $managed |
            Where-Object {
                $_.ListenAddress -ne $Lan.IP -or
                $_.ListenPort -notin $Ports
            }
    )
    $exact = $missing.Count -eq 0 -and $duplicates.Count -eq 0 -and $stale.Count -eq 0 -and $managed.Count -eq $Ports.Count
    [pscustomobject]@{
        Exact      = $exact
        Missing    = @($missing)
        Duplicates = @($duplicates)
        Stale      = @($stale)
        Managed    = @($managed)
        Reason     = if ($exact) { 'exact' } else { "missing=$($missing -join ',') duplicates=$($duplicates -join ',') stale=$($stale.Count)" }
    }
}

function Get-MobileLanArtifactSnapshot([hashtable]$EnvMap) {
    if (-not $IsWindows) {
        return [pscustomobject]@{ Mappings = @(); Rules = @() }
    }

    $ports = Get-ExpectedMobileLanPorts -EnvMap $EnvMap
    $mappings = @(
        Get-PortProxyMappings |
            Where-Object {
                $_.ConnectAddress -eq '127.0.0.1' -and
                $_.ConnectPort -in $ports -and
                $_.ListenPort -eq $_.ConnectPort
            } |
            ForEach-Object { "$($_.ListenAddress):$($_.ListenPort)>$($_.ConnectAddress):$($_.ConnectPort)" } |
            Sort-Object
    )
    $rules = @(
        Get-NetFirewallRule -Group $MobileLanFirewallGroup -ErrorAction SilentlyContinue |
            ForEach-Object { "$($_.Name)|$($_.Enabled)|$($_.Direction)|$($_.Action)|$($_.Profile)" } |
            Sort-Object
    )
    return [pscustomobject]@{ Mappings = $mappings; Rules = $rules }
}

function Test-MobileLanInfrastructure(
    [pscustomobject]$Lan,
    [int]$IdentityPort,
    [int]$DshPort,
    [int[]]$MetroPorts
) {
    $managedPorts = @($IdentityPort,$DshPort) + @($MetroPorts) | Sort-Object -Unique
    $firewall = Get-MobileLanFirewallInspection -Lan $Lan -Ports $managedPorts
    if (-not $firewall.Exact) {
        Write-Host "MOBILE_LAN_FIREWALL_EXACT=FAIL reason=$($firewall.Reason)"
        return $false
    }
    Write-Host 'MOBILE_LAN_FIREWALL_EXACT=PASS'

    $portProxy = Get-MobileLanPortProxyInspection -Lan $Lan -Ports $managedPorts
    if (-not $portProxy.Exact) {
        Write-Host "MOBILE_LAN_PORTPROXY_EXACT=FAIL reason=$($portProxy.Reason)"
        return $false
    }
    Write-Host 'MOBILE_LAN_PORTPROXY_EXACT=PASS'

    $identityUri = "http://$($Lan.IP):$IdentityPort/identity/health"
    $dshUri = "http://$($Lan.IP):$DshPort/dsh/health"

    $lastError = ''

    # Windows portproxy can require a short moment before accepting
    # the first connection after a mapping is created or reconciled.
    for ($attempt = 1; $attempt -le 12; $attempt++) {
        try {
            $identity = Invoke-RestMethod `
                -Uri $identityUri `
                -Method Get `
                -TimeoutSec 3 `
                -NoProxy

            $dsh = Invoke-RestMethod `
                -Uri $dshUri `
                -Method Get `
                -TimeoutSec 3 `
                -NoProxy

            $identityOk = (
                $null -ne $identity -and
                $identity.service -eq 'identity' -and
                $identity.status -eq 'ok'
            )

            $dshOk = (
                $null -ne $dsh -and
                $dsh.service -eq 'dsh' -and
                $dsh.status -eq 'ok'
            )

            $metroOk = $true
            foreach ($port in $MetroPorts) {
                $status = Get-HttpText `
                    -Uri "http://$($Lan.IP):$port/status" `
                    -TimeoutSec 3

                if ($status -ne 'packager-status:running') {
                    $lastError = "metro port=$port status=$status"
                    $metroOk = $false
                    break
                }
            }

            if ($identityOk -and $dshOk -and $metroOk) {
                Write-Host "MOBILE_LAN_IDENTITY=PASS uri=$identityUri"
                Write-Host "MOBILE_LAN_DSH=PASS uri=$dshUri"

                foreach ($port in $MetroPorts) {
                    Write-Host "MOBILE_LAN_METRO=PASS port=$port"
                }

                return $true
            }

            if (-not $identityOk) {
                $lastError = 'identity health contract not ready'
            }
            elseif (-not $dshOk) {
                $lastError = 'dsh health contract not ready'
            }
        }
        catch {
            $lastError = $_.Exception.Message
        }

        if ($attempt -lt 12) {
            Start-Sleep -Milliseconds 250
        }
    }

    Write-Host "MOBILE_LAN_CONNECTIVITY=FAIL identity_uri=$identityUri dsh_uri=$dshUri error=$lastError"
    Write-Host 'MOBILE_LAN_PORTPROXY_DIAGNOSTIC_BEGIN'
    netsh interface portproxy show v4tov4 |
        ForEach-Object { Write-Host $_ }
    Write-Host 'MOBILE_LAN_PORTPROXY_DIAGNOSTIC_END'

    return $false
}
function Ensure-MobileLanInfrastructure(
    [pscustomobject]$Lan,
    [int]$IdentityPort,
    [int]$DshPort,
    [int[]]$MetroPorts
) {
    if (
        Test-MobileLanInfrastructure `
            -Lan $Lan `
            -IdentityPort $IdentityPort `
            -DshPort $DshPort `
            -MetroPorts $MetroPorts
    ) {
        Write-Host "MOBILE_LAN_INFRA=READY hotspot=$($Lan.IP)"
        return
    }

    if (-not (Test-Administrator)) {
        Fail 'MOBILE_LAN_ADMIN_REQUIRED=1 Run pnpm runtime:mobile-lan from PowerShell 7 as Administrator.'
    }

    $managedPorts = @($IdentityPort,$DshPort) + @($MetroPorts) | Sort-Object -Unique

    foreach ($mapping in @(Get-PortProxyMappings)) {
        if (
            $mapping.ConnectAddress -eq '127.0.0.1' -and
            $mapping.ConnectPort -in $managedPorts -and
            $mapping.ListenPort -eq $mapping.ConnectPort
        ) {
            netsh interface portproxy delete v4tov4 `
                "listenaddress=$($mapping.ListenAddress)" `
                "listenport=$($mapping.ListenPort)" *> $null
        }
    }

    foreach ($port in $managedPorts) {
        netsh interface portproxy add v4tov4 `
            "listenaddress=$($Lan.IP)" `
            listenport=$port `
            connectaddress=127.0.0.1 `
            connectport=$port *> $null

        if ($LASTEXITCODE -ne 0) {
            Fail "MOBILE_LAN_PORTPROXY=FAIL port=$port"
        }
    }

    Get-NetFirewallRule `
        -Group $MobileLanFirewallGroup `
        -ErrorAction SilentlyContinue |
        Remove-NetFirewallRule `
            -ErrorAction SilentlyContinue

    New-NetFirewallRule `
        -DisplayName 'BThwani Samrim Mobile LAN' `
        -Group $MobileLanFirewallGroup `
        -Direction Inbound `
        -Action Allow `
        -Protocol TCP `
        -LocalAddress $Lan.IP `
        -LocalPort $managedPorts `
        -InterfaceAlias $Lan.Adapter `
        -RemoteAddress (Get-MobileLanNetworkCidr -Lan $Lan) `
        -Profile Any `
        -ErrorAction Stop *> $null

    if (-not (
        Test-MobileLanInfrastructure `
            -Lan $Lan `
            -IdentityPort $IdentityPort `
            -DshPort $DshPort `
            -MetroPorts $MetroPorts
    )) {
        Fail 'MOBILE_LAN_INFRA=FAIL'
    }

    Write-Host "MOBILE_LAN_INFRA=PASS hotspot=$($Lan.IP)"
}

function Remove-MobileLanInfrastructure(
    [hashtable]$EnvMap
) {
    if (-not $IsWindows) { return }

    $managedPorts = @(
        Require-TcpPort -Map $EnvMap -Name 'SAMRIM_IDENTITY_PORT'
        Require-TcpPort -Map $EnvMap -Name 'SAMRIM_DSH_PORT'
        Require-TcpPort -Map $EnvMap -Name 'SAMRIM_APP_CLIENT_METRO_PORT'
        Require-TcpPort -Map $EnvMap -Name 'SAMRIM_APP_PARTNER_METRO_PORT'
        Require-TcpPort -Map $EnvMap -Name 'SAMRIM_APP_CAPTAIN_METRO_PORT'
        Require-TcpPort -Map $EnvMap -Name 'SAMRIM_APP_FIELD_METRO_PORT'
    ) | Sort-Object -Unique

    $mappings = @(
        Get-PortProxyMappings |
            Where-Object {
                $_.ConnectAddress -eq '127.0.0.1' -and
                $_.ConnectPort -in $managedPorts -and
                $_.ListenPort -eq $_.ConnectPort
            }
    )

    $rules = @(
        Get-NetFirewallRule `
            -Group $MobileLanFirewallGroup `
            -ErrorAction SilentlyContinue
    )

    if ($mappings.Count -eq 0 -and $rules.Count -eq 0) {
        Write-Host 'MOBILE_LAN_INFRA=ABSENT'
        return
    }

    if (-not (Test-Administrator)) {
        Fail 'MOBILE_LAN_CLEANUP_ADMIN_REQUIRED=1'
    }

    foreach ($mapping in $mappings) {
        netsh interface portproxy delete v4tov4 `
            "listenaddress=$($mapping.ListenAddress)" `
            "listenport=$($mapping.ListenPort)" *> $null
        if ($LASTEXITCODE -ne 0) {
            Fail "MOBILE_LAN_PORTPROXY_REMOVE=FAIL address=$($mapping.ListenAddress) port=$($mapping.ListenPort)"
        }
    }

    if ($rules.Count -gt 0) {
        $rules | Remove-NetFirewallRule -ErrorAction Stop
    }

    $remainingMappings = @(
        Get-PortProxyMappings |
            Where-Object {
                $_.ConnectAddress -eq '127.0.0.1' -and
                $_.ConnectPort -in $managedPorts -and
                $_.ListenPort -eq $_.ConnectPort
            }
    )

    $remainingRules = @(
        Get-NetFirewallRule `
            -Group $MobileLanFirewallGroup `
            -ErrorAction SilentlyContinue
    )

    if ($remainingMappings.Count -ne 0 -or $remainingRules.Count -ne 0) {
        Fail 'MOBILE_LAN_CLEANUP=FAIL'
    }

    Write-Host 'MOBILE_LAN_INFRA=REMOVED'
}

function Remove-SamrimAdbReverse(
    [string]$Serial,
    [int[]]$Ports
) {
    if ([string]::IsNullOrWhiteSpace($Serial)) {
        return
    }

    foreach ($port in $Ports) {
        & adb -s $Serial reverse --remove "tcp:$port" *> $null
    }

    $remaining = @(adb -s $Serial reverse --list)

    foreach ($port in $Ports) {
        if (
            @(
                $remaining |
                    Where-Object { $_ -match "tcp:$port(\s|$)" }
            ).Count -gt 0
        ) {
            Fail "ADB_REVERSE_REMOVAL=FAIL port=$port"
        }
    }

    Write-Host "ADB_REVERSE=0 serial=$Serial"
}

function Assert-SamrimAdbReverseAbsent(
    [string]$Serial,
    [int[]]$Ports
) {
    if ([string]::IsNullOrWhiteSpace($Serial)) {
        return
    }

    $remaining = @(adb -s $Serial reverse --list)

    if ($LASTEXITCODE -ne 0) {
        Fail 'ADB_REVERSE_INSPECTION=FAIL'
    }

    foreach ($port in $Ports) {
        if (
            @(
                $remaining |
                    Where-Object {
                        $_ -match "tcp:$port(\s|$)"
                    }
            ).Count -gt 0
        ) {
            Fail "ADB_REVERSE_DEPENDENCY=FAIL port=$port"
        }
    }

    Write-Host "ADB_REVERSE_DEPENDENCY=0 serial=$Serial"
}

function Test-MobileLanMetroEnvironment(
    [hashtable]$EnvMap,
    [string]$HotspotIp
) {
    $identityPort = Require-TcpPort -Map $EnvMap -Name 'SAMRIM_IDENTITY_PORT'
    $dshPort = Require-TcpPort -Map $EnvMap -Name 'SAMRIM_DSH_PORT'
    $expected = @(
        @{ Service = 'metro-client'; PortKey = 'SAMRIM_APP_CLIENT_METRO_PORT' },
        @{ Service = 'metro-partner'; PortKey = 'SAMRIM_APP_PARTNER_METRO_PORT' },
        @{ Service = 'metro-captain'; PortKey = 'SAMRIM_APP_CAPTAIN_METRO_PORT' },
        @{ Service = 'metro-field'; PortKey = 'SAMRIM_APP_FIELD_METRO_PORT' }
    )

    try {
        foreach ($entry in $expected) {
            $container = Get-ServiceContainerId -Service $entry.Service
            $metroPort = Require-TcpPort -Map $EnvMap -Name $entry.PortKey
            $rows = @(& docker inspect --format '{{range .Config.Env}}{{println .}}{{end}}' $container)
            foreach ($value in @(
                "EXPO_PUBLIC_IDENTITY_API_URL=http://${HotspotIp}:$identityPort",
                "EXPO_PUBLIC_DSH_API_URL=http://${HotspotIp}:$dshPort",
                "EXPO_PACKAGER_PROXY_URL=http://${HotspotIp}:$metroPort"
            )) {
                if ($value -notin $rows) { return $false }
            }
        }
        return $true
    }
    catch { return $false }
}

function Repair-MobileLan {
    $lan = Get-MobileLanContext
    $envMap = Ensure-CanonicalRuntime
    [Environment]::SetEnvironmentVariable('SAMRIM_HOTSPOT_IP', [string]$lan.IP, 'Process')

    $metroPorts = @(
        Require-TcpPort -Map $envMap -Name 'SAMRIM_APP_CLIENT_METRO_PORT'
        Require-TcpPort -Map $envMap -Name 'SAMRIM_APP_PARTNER_METRO_PORT'
        Require-TcpPort -Map $envMap -Name 'SAMRIM_APP_CAPTAIN_METRO_PORT'
        Require-TcpPort -Map $envMap -Name 'SAMRIM_APP_FIELD_METRO_PORT'
    )
    $infraReady = Test-MobileLanInfrastructure `
        -Lan $lan `
        -IdentityPort (Require-TcpPort -Map $envMap -Name 'SAMRIM_IDENTITY_PORT') `
        -DshPort (Require-TcpPort -Map $envMap -Name 'SAMRIM_DSH_PORT') `
        -MetroPorts $metroPorts

    $metroReady = Test-MobileLanMetroEnvironment -EnvMap $envMap -HotspotIp $lan.IP
    if (-not $infraReady) {
        Ensure-MobileLanInfrastructure `
            -Lan $lan `
            -IdentityPort (Require-TcpPort -Map $envMap -Name 'SAMRIM_IDENTITY_PORT') `
            -DshPort (Require-TcpPort -Map $envMap -Name 'SAMRIM_DSH_PORT') `
            -MetroPorts $metroPorts
    }

    if (-not $metroReady) {
        Invoke-Compose -Arguments @(
            'up','-d','--no-build','--force-recreate',
            'metro-client','metro-partner','metro-captain','metro-field'
        )
    }

    Assert-CanonicalRuntime -EnvMap $envMap
    if (-not (
        Test-MobileLanInfrastructure `
            -Lan $lan `
            -IdentityPort (Require-TcpPort -Map $envMap -Name 'SAMRIM_IDENTITY_PORT') `
            -DshPort (Require-TcpPort -Map $envMap -Name 'SAMRIM_DSH_PORT') `
            -MetroPorts $metroPorts
    )) {
        Fail "MOBILE_LAN_REPAIR=FAIL hotspot=$($lan.IP)"
    }

    Write-Host "MOBILE_LAN_REPAIR=PASS hotspot=$($lan.IP)"
    Write-Host 'MOBILE_LAN_PRIVILEGED_MUTATION=NARROW_ONLY'
    Write-Host 'ADB_REVERSE_DEPENDENCY=0'
}

function Start-Mobile(
    [ValidateSet(
        'app-client',
        'app-partner',
        'app-captain',
        'app-field'
    )]
    [string]$App
) {
    $lan = Get-MobileLanContext
    $envMap = Ensure-CanonicalRuntime

    $contract = switch ($App) {
        'app-client'  { @{ Service = 'metro-client';  PortKey = 'SAMRIM_APP_CLIENT_METRO_PORT' } }
        'app-partner' { @{ Service = 'metro-partner'; PortKey = 'SAMRIM_APP_PARTNER_METRO_PORT' } }
        'app-captain' { @{ Service = 'metro-captain'; PortKey = 'SAMRIM_APP_CAPTAIN_METRO_PORT' } }
        'app-field'   { @{ Service = 'metro-field';   PortKey = 'SAMRIM_APP_FIELD_METRO_PORT' } }
    }

    $metroPort = Require-TcpPort -Map $envMap -Name $contract.PortKey
    Assert-RunningService -Service $contract.Service -Healthy
    Assert-CanonicalPublishedPort -Port $metroPort -ExpectedService $contract.Service

    $mobilePorts = @(
        Require-TcpPort -Map $envMap -Name 'SAMRIM_APP_CLIENT_METRO_PORT'
        Require-TcpPort -Map $envMap -Name 'SAMRIM_APP_PARTNER_METRO_PORT'
        Require-TcpPort -Map $envMap -Name 'SAMRIM_APP_CAPTAIN_METRO_PORT'
        Require-TcpPort -Map $envMap -Name 'SAMRIM_APP_FIELD_METRO_PORT'
    )
    if (-not (
        Test-MobileLanInfrastructure `
            -Lan $lan `
            -IdentityPort (Require-TcpPort -Map $envMap -Name 'SAMRIM_IDENTITY_PORT') `
            -DshPort (Require-TcpPort -Map $envMap -Name 'SAMRIM_DSH_PORT') `
            -MetroPorts $mobilePorts
    )) {
        Fail "ANDROID_RUNTIME=BLOCKED reason=MOBILE_LAN_NOT_READY action=pnpm_runtime:mobile-lan hotspot=$($lan.IP)"
    }

    Write-Host "RUNTIME_OWNER=tools/dev/runtime.ps1 component=$App"
    Write-Host "MOBILE_OWNER=DOCKER service=$($contract.Service)"
    Write-Host "MOBILE_TRANSPORT=WIFI_LAN hotspot=$($lan.IP)"
    Write-Host "METRO_LAN_URL=http://$($lan.IP):$metroPort"
    Write-Host "IDENTITY_LAN_URL=http://$($lan.IP):$(Require-TcpPort -Map $envMap -Name 'SAMRIM_IDENTITY_PORT')"
    Write-Host "DSH_LAN_URL=http://$($lan.IP):$(Require-TcpPort -Map $envMap -Name 'SAMRIM_DSH_PORT')"
    Write-Host 'ADB_REVERSE_DEPENDENCY=0'
    Write-Host 'MOBILE_DEV_CLIENT_OPEN=MANUAL'
}

Push-Location $RepoRoot
try {
    switch ($Action) {
        'Up'      { $null = Start-CanonicalRuntime }
        'Down'    { Stop-CanonicalRuntime }
        'Restart' { Stop-CanonicalRuntime; $null = Start-CanonicalRuntime }
        'Status'  { Show-RuntimeStatus }
        'Logs'    { Show-RuntimeLogs }
        'Doctor'  { Invoke-RuntimeDoctor }
        'Reset'   { Reset-CanonicalRuntime }
        'Purge'   { Purge-CanonicalRuntime }
        'MobileLan' { Repair-MobileLan }
        'Control' { Start-ControlPanel }
        'Client'  { Start-Mobile -App 'app-client' }
        'Partner' { Start-Mobile -App 'app-partner' }
        'Captain' { Start-Mobile -App 'app-captain' }
        'Field'   { Start-Mobile -App 'app-field' }

    }
} finally { Pop-Location }
