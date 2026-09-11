#Requires -Version 7.4
[CmdletBinding()]
param(
    [Parameter(Mandatory)]
    [ValidateSet('Up','Down','Restart','Status','Logs','Doctor','Reset','Control','Client','Partner','Captain','Field','Scrcpy')]
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

function Remove-ProjectResources([string]$Project) {
    $containers = @(Get-ProjectResourceIds -Kind container -Project $Project)
    if ($containers.Count) {
        & docker rm -f @containers *> $null
        if ($LASTEXITCODE -ne 0) { Fail "Failed removing containers for $Project." }
    }
    $volumes = @(Get-ProjectResourceIds -Kind volume -Project $Project)
    if ($volumes.Count) {
        & docker volume rm -f @volumes *> $null
        if ($LASTEXITCODE -ne 0) { Fail "Failed removing volumes for $Project." }
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

    $lan = Get-MobileLanContext
    [Environment]::SetEnvironmentVariable('SAMRIM_HOTSPOT_IP', [string]$lan.IP, 'Process')

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

    Ensure-MobileLanInfrastructure `
        -Lan $lan `
        -IdentityPort (Require-TcpPort -Map $envMap -Name 'SAMRIM_IDENTITY_PORT') `
        -DshPort (Require-TcpPort -Map $envMap -Name 'SAMRIM_DSH_PORT') `
        -MetroPorts $metroPorts

    Write-Host 'CANONICAL_LOCAL_RUNTIME=PASS'
    Write-Host 'DOCKER_OWNS=postgres,mailpit,identity,dsh,control,metro-client,metro-partner,metro-captain,metro-field'
    Write-Host "MOBILE_TRANSPORT=WIFI_LAN hotspot=$($lan.IP)"
    Write-Host 'ADB_REVERSE_DEPENDENCY=0'
    return $envMap
}

function Ensure-CanonicalRuntime {
    $envMap = Ensure-Environment
    Set-CanonicalEnvironment -Map $envMap
    Ensure-Docker
    Assert-NoNativeBackendProcesses

    if (Test-CanonicalRuntimeReady -EnvMap $envMap) {
        $lan = Get-MobileLanContext
        [Environment]::SetEnvironmentVariable('SAMRIM_HOTSPOT_IP', [string]$lan.IP, 'Process')

        $metroPorts = @(
            Require-TcpPort -Map $envMap -Name 'SAMRIM_APP_CLIENT_METRO_PORT'
            Require-TcpPort -Map $envMap -Name 'SAMRIM_APP_PARTNER_METRO_PORT'
            Require-TcpPort -Map $envMap -Name 'SAMRIM_APP_CAPTAIN_METRO_PORT'
            Require-TcpPort -Map $envMap -Name 'SAMRIM_APP_FIELD_METRO_PORT'
        )

        Ensure-MobileLanInfrastructure `
            -Lan $lan `
            -IdentityPort (Require-TcpPort -Map $envMap -Name 'SAMRIM_IDENTITY_PORT') `
            -DshPort (Require-TcpPort -Map $envMap -Name 'SAMRIM_DSH_PORT') `
            -MetroPorts $metroPorts

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
    $null = Ensure-Environment
    Ensure-Docker
    $base = Get-ComposeBaseArgs
    & docker @base ps -a
    if ($LASTEXITCODE -ne 0) { Fail 'Unable to inspect canonical runtime.' }
    $parallelProjects = @(Get-NonCanonicalSamrimProjects)
    Write-Host "PARALLEL_RUNTIME_PROJECTS=$($parallelProjects.Count)"
    foreach ($project in $parallelProjects) {
        Write-Host "NONCANONICAL_PROJECT=$project containers=$(@(Get-ProjectResourceIds -Kind container -Project $project).Count) volumes=$(@(Get-ProjectResourceIds -Kind volume -Project $project).Count) networks=$(@(Get-ProjectResourceIds -Kind network -Project $project).Count)"
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
    $envMap = Ensure-Environment
    Set-CanonicalEnvironment -Map $envMap
    Ensure-Docker
    $composeFiles = @(Get-ChildItem -LiteralPath $ComposeDir -File | Where-Object { $_.Name -match '^compose(?:\..+)?\.ya?ml$' })
    if ($composeFiles.Count -ne 1 -or $composeFiles[0].FullName -ne $ComposePath) { Fail "CANONICAL_LOCAL_COMPOSE_FILES=FAIL observed=$($composeFiles.Name -join ',')" }
    Write-Host 'CANONICAL_LOCAL_COMPOSE_FILES=1'
    Invoke-Compose -Arguments @('config','--quiet') -Quiet
    Assert-NoParallelRuntimeResidue
    Assert-NoNativeBackendProcesses
    Assert-CanonicalRuntime -EnvMap $envMap
    & node $OwnershipVerifier
    if ($LASTEXITCODE -ne 0) { Fail 'Repository runtime ownership verifier failed.' }
    Write-Host 'PARALLEL_LOCAL_RUNTIME_AUTHORITY=0'
    Write-Host 'PORT_OWNERSHIP=PASS'
    Write-Host 'SERVICE_HEALTH=PASS'
    Write-Host 'RUNTIME_DOCTOR=PASS'
}

function Reset-CanonicalRuntime {
    $envMap = Ensure-Environment
    Ensure-Docker
    Remove-MobileLanInfrastructure -EnvMap $envMap
    Write-Host 'RUNTIME_RESET=DESTRUCTIVE_LOCAL_DATA scope=samrim Docker containers/networks/volumes; local .env secrets are preserved'
    $parallelProjects = @(Get-NonCanonicalSamrimProjects)
    try { Invoke-Compose -Arguments @('down','--volumes','--remove-orphans') } catch { Write-Host "Canonical compose teardown was not complete: $($_.Exception.Message)" }
    Remove-ProjectResources -Project $CanonicalProject
    foreach ($project in $parallelProjects) { Remove-ProjectResources -Project $project }
    foreach ($project in @($CanonicalProject) + $parallelProjects) {
        foreach ($kind in @('container','volume','network')) {
            if (@(Get-ProjectResourceIds -Kind $kind -Project $project).Count) { Fail "RUNTIME_RESET=FAIL project=$project kind=$kind residue=present" }
        }
    }
    if (@(Get-NonCanonicalSamrimProjects).Count) { Fail 'RUNTIME_RESET=FAIL noncanonical samrim Compose projects remain.' }
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
    Write-Host 'RUNTIME_RESET=PASS final_state=DOWN secrets=preserved'
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

function Get-MobileLanContext {
    if (-not $IsWindows) {
        Fail 'MOBILE_LAN_PLATFORM=FAIL Windows Mobile Hotspot requires Windows.'
    }

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

    if ($found.Count -eq 0) {
        Fail 'MOBILE_LAN=FAIL Windows Mobile Hotspot is not active.'
    }

    if ($found.Count -ne 1) {
        $found | Format-Table -AutoSize
        Fail "MOBILE_LAN=FAIL candidates=$($found.Count)"
    }

    return $found[0]
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

function Test-MobileLanInfrastructure(
    [pscustomobject]$Lan,
    [int]$IdentityPort,
    [int]$DshPort,
    [int[]]$MetroPorts
) {
    $rules = @(
        Get-NetFirewallRule `
            -Group $MobileLanFirewallGroup `
            -ErrorAction SilentlyContinue
    )

    if ($rules.Count -ne 1) {
        Write-Host "MOBILE_LAN_FIREWALL_CHECK=FAIL count=$($rules.Count)"
        return $false
    }

    $enabled = [string]$rules[0].Enabled
    $direction = [string]$rules[0].Direction
    $action = [string]$rules[0].Action

    if ($enabled -ne 'True' -or $direction -ne 'Inbound' -or $action -ne 'Allow') {
        Write-Host "MOBILE_LAN_FIREWALL_CHECK=FAIL enabled=$enabled direction=$direction action=$action"
        return $false
    }

    $managedPorts = @($IdentityPort,$DshPort) + @($MetroPorts) |
        Sort-Object -Unique

    $mappings = @(Get-PortProxyMappings)

    foreach ($port in $managedPorts) {
        $matches = @(
            $mappings |
                Where-Object {
                    $_.ListenAddress -eq $Lan.IP -and
                    $_.ListenPort -eq $port -and
                    $_.ConnectAddress -eq '127.0.0.1' -and
                    $_.ConnectPort -eq $port
                }
        )

        if ($matches.Count -ne 1) {
            Write-Host "MOBILE_LAN_PORTPROXY_CHECK=FAIL port=$port count=$($matches.Count)"
            return $false
        }
    }

    Write-Host 'MOBILE_LAN_FIREWALL_CHECK=PASS'
    Write-Host 'MOBILE_LAN_PORTPROXY_CHECK=PASS'

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
        Fail 'MOBILE_LAN_ADMIN_REQUIRED=1 Run pnpm runtime:up once from PowerShell 7 as Administrator after Docker cutover.'
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
        -RemoteAddress "$($Lan.IP)/$($Lan.Prefix)" `
        -Profile Any *> $null

    if ($LASTEXITCODE -ne 0) {
        Fail 'MOBILE_LAN_FIREWALL=FAIL'
    }

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

function Start-Mobile(
    [ValidateSet(
        'app-client',
        'app-partner',
        'app-captain',
        'app-field'
    )]
    [string]$App
) {
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

    $lan = Get-MobileLanContext

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
        'Control' { Start-ControlPanel }
        'Client'  { Start-Mobile -App 'app-client' }
        'Partner' { Start-Mobile -App 'app-partner' }
        'Captain' { Start-Mobile -App 'app-captain' }
        'Field'   { Start-Mobile -App 'app-field' }
        'Scrcpy'  {
            if (-not (Get-Command scrcpy -ErrorAction SilentlyContinue)) { Fail 'scrcpy is not available on PATH.' }
            Write-Host 'RUNTIME_OWNER=tools/dev/runtime.ps1 component=scrcpy'
            & scrcpy --tcpip
            if ($LASTEXITCODE -ne 0) { Fail "scrcpy exited with code $LASTEXITCODE." }
        }
    }
} finally { Pop-Location }
