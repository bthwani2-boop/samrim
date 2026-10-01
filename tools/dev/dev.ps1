#Requires -Version 7.4
param(
    [Parameter(Position = 0)]
    [ValidateSet('daily', 'up', 'down', 'status')]
    [string]$Target = 'daily'
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$PSNativeCommandUseErrorActionPreference = $false

$Root = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
$EnvPath = Join-Path $Root 'infra\local\.env'
$ComposePath = Join-Path $Root 'infra\local\compose\compose.yaml'
$Project = 'samrim-local'
$RuntimeStateDir = Join-Path $Root '.cache\samrim-local-runtime'
$RuntimeStatePath = Join-Path $RuntimeStateDir 'backend-input-state.json'
$BackendImages = @{
    identity = 'samrim-local-identity:dev'
    dsh      = 'samrim-local-dsh:dev'
    wlt      = 'samrim-local-wlt:dev'
}
Set-Location $Root

function Fail([string]$Message) { throw $Message }

function Compose([string[]]$Arguments) {
    & docker compose --ansi never --project-name $Project --env-file $EnvPath -f $ComposePath @Arguments
    if ($LASTEXITCODE -ne 0) { Fail "DOCKER_COMPOSE_FAILED args=$($Arguments -join ' ')" }
}

function Read-BackendServiceStates {
    $states = @{}
    foreach ($line in @(Compose @('ps', '-a', '--format', '{{.ID}}|{{.Service}}|{{.State}}|{{.Health}}'))) {
        $parts = @($line -split '\|', 4)
        if ($parts.Count -lt 3) { continue }
        $containerID = $parts[0].Trim()
        $service = $parts[1].Trim()
        if (-not $service) { continue }
        $states[$service] = [pscustomobject]@{
            ContainerID = $containerID
            State       = $parts[2].Trim().ToLowerInvariant()
            Health      = if ($parts.Count -ge 4) { $parts[3].Trim().ToLowerInvariant() } else { '' }
        }
    }
    return $states
}

function Test-BackendReady([hashtable]$States) {
    $required = @('postgres', 'mailpit', 'media', 'identity', 'dsh', 'wlt')
    $healthRequired = @('postgres', 'media', 'identity', 'dsh', 'wlt')
    foreach ($service in $required) {
        if (-not $States.ContainsKey($service)) { return $false }
        if ($States[$service].State -ne 'running') { return $false }
        if ($healthRequired -contains $service -and $States[$service].Health -ne 'healthy') { return $false }
    }
    return $true
}

function Read-RunningBackendImages([hashtable]$States) {
    $services = @('identity', 'dsh', 'wlt')
    $containerIDs = @($services | ForEach-Object { [string]$States[$_].ContainerID })
    if ($containerIDs | Where-Object { -not $_ }) { Fail 'BACKEND_IMAGE_PROVENANCE_MISSING_CONTAINER' }
    $imageIDs = @(& docker inspect --format '{{.Image}}' @containerIDs)
    if ($LASTEXITCODE -ne 0 -or $imageIDs.Count -ne $services.Count) { Fail 'BACKEND_IMAGE_PROVENANCE_READ_FAILED' }
    $images = @{}
    for ($index = 0; $index -lt $services.Count; $index++) {
        $images[$services[$index]] = ([string]$imageIDs[$index]).Trim()
    }
    return $images
}

function Get-TextSha256([string]$Text) {
    $bytes = [Text.Encoding]::UTF8.GetBytes($Text)
    $hash = [Security.Cryptography.SHA256]::HashData($bytes)
    return [Convert]::ToHexString($hash).ToLowerInvariant()
}

function Get-FileSha256([string]$Path) {
    if (-not (Test-Path -LiteralPath $Path -PathType Leaf)) { return 'missing' }
    return (Get-FileHash -LiteralPath $Path -Algorithm SHA256).Hash.ToLowerInvariant()
}

function Test-RuntimeBuildMaterial([System.IO.FileInfo]$File) {
    if ($File.Name -in @('Dockerfile', 'go.mod', 'go.sum')) { return $true }
    if ($File.Extension -eq '.sql') { return $true }
    if ($File.Extension -eq '.go' -and -not $File.Name.EndsWith('_test.go', [StringComparison]::OrdinalIgnoreCase)) { return $true }
    return $false
}

function Get-PathFingerprint([string[]]$PathSpecs) {
    $files = [System.Collections.Generic.List[System.IO.FileInfo]]::new()
    foreach ($pathSpec in $PathSpecs) {
        $absolute = Join-Path $Root ($pathSpec -replace '/', [IO.Path]::DirectorySeparatorChar)
        if (Test-Path -LiteralPath $absolute -PathType Leaf) {
            $files.Add((Get-Item -LiteralPath $absolute -Force))
            continue
        }
        if (Test-Path -LiteralPath $absolute -PathType Container) {
            foreach ($file in @(Get-ChildItem -LiteralPath $absolute -Recurse -Force -File | Where-Object { Test-RuntimeBuildMaterial $_ })) { $files.Add($file) }
        }
    }

    $records = [System.Collections.Generic.List[string]]::new()
    foreach ($file in @($files | Sort-Object FullName -Unique)) {
        $relative = [IO.Path]::GetRelativePath($Root, $file.FullName).Replace('\', '/')
        $records.Add("$relative=$(Get-FileSha256 $file.FullName)")
    }
    return (Get-TextSha256 ($records -join "`n"))
}

function Get-BackendInputState {
    if (-not (Test-Path -LiteralPath $EnvPath -PathType Leaf)) { Fail "LOCAL_ENV_MISSING path=$EnvPath" }
    return @{
        schema   = 2
        compose  = (Get-FileSha256 $ComposePath)
        env      = (Get-FileSha256 $EnvPath)
        identity = (Get-PathFingerprint @('.dockerignore', 'services/identity/backend', 'services/identity/database/migrations'))
        dsh      = (Get-PathFingerprint @('.dockerignore', 'services/dsh/backend', 'services/dsh/database/migrations', 'services/identity/clients/go'))
        wlt      = (Get-PathFingerprint @('.dockerignore', 'services/wlt/backend', 'services/wlt/database/migrations'))
    }
}

function Read-BackendInputState {
    if (-not (Test-Path -LiteralPath $RuntimeStatePath -PathType Leaf)) { return $null }
    try {
        $state = Get-Content -LiteralPath $RuntimeStatePath -Raw | ConvertFrom-Json -AsHashtable
        if ($state['schema'] -ne 2) { return $null }
        return $state
    }
    catch {
        return $null
    }
}

function Write-BackendInputState([hashtable]$State) {
    New-Item -ItemType Directory -Path $RuntimeStateDir -Force | Out-Null
    $temp = Join-Path $RuntimeStateDir ("backend-input-state-{0}.tmp" -f [guid]::NewGuid().ToString('N'))
    try {
        $State | ConvertTo-Json -Depth 4 -Compress | Set-Content -LiteralPath $temp -Encoding utf8NoBOM
        Move-Item -LiteralPath $temp -Destination $RuntimeStatePath -Force
    }
    finally {
        if (Test-Path -LiteralPath $temp) { Remove-Item -LiteralPath $temp -Force -ErrorAction SilentlyContinue }
    }
}

function Test-BackendInputStateEqual([hashtable]$Left, [hashtable]$Right) {
    if ($null -eq $Left -or $null -eq $Right) { return $false }
    foreach ($key in @('schema', 'compose', 'env', 'identity', 'dsh', 'wlt')) {
        if (([string]$Left[$key]) -ne ([string]$Right[$key])) { return $false }
    }
    return $true
}

function Test-BackendImageStateEqual([hashtable]$StoredState, [hashtable]$RunningImages) {
    if ($null -eq $StoredState -or -not $StoredState.ContainsKey('images')) { return $false }
    $storedImages = $StoredState['images']
    if ($storedImages -isnot [hashtable]) { return $false }
    foreach ($service in @('identity', 'dsh', 'wlt')) {
        if (([string]$storedImages[$service]) -ne ([string]$RunningImages[$service])) { return $false }
    }
    return $true
}

function Test-BackendImageExists([string]$Service) {
    $image = [string]$BackendImages[$Service]
    if (-not $image) { return $false }
    & docker image inspect $image *> $null
    return $LASTEXITCODE -eq 0
}

function Reconcile-BackendCold {
    Compose @('up','-d','--build','--wait','--wait-timeout','300','--remove-orphans')
}

function Ensure-Backend {
    $currentState = Get-BackendInputState
    $previousState = Read-BackendInputState
    $states = Read-BackendServiceStates
    if ((Test-BackendReady $states) -and (Test-BackendInputStateEqual $previousState $currentState)) {
        $runningImages = Read-RunningBackendImages $states
        if (Test-BackendImageStateEqual $previousState $runningImages) {
            Write-Host 'BACKEND_REUSE=PASS state=healthy inputs=unchanged images=verified'
            return
        }
    }

    if ($null -eq $previousState) {
        Reconcile-BackendCold
    }
    else {
        $composeChanged = ([string]$previousState['compose']) -ne ([string]$currentState['compose'])
        $buildServices = [System.Collections.Generic.List[string]]::new()
        foreach ($service in @('identity', 'dsh', 'wlt')) {
            if ($composeChanged -or (([string]$previousState[$service]) -ne ([string]$currentState[$service])) -or -not (Test-BackendImageExists $service)) {
                $buildServices.Add($service)
            }
        }
        if ($buildServices.Count -gt 0) {
            Write-Host "BACKEND_BUILD_REQUIRED services=$($buildServices -join ',')"
            Compose (@('build') + $buildServices.ToArray())
        }
        Compose @('up', '-d', '--no-build', '--wait', '--wait-timeout', '300', '--remove-orphans')
    }

    $states = Read-BackendServiceStates
    if (-not (Test-BackendReady $states)) { Fail 'BACKEND_NOT_READY after=reconcile' }
    $currentState['images'] = Read-RunningBackendImages $states
    Write-BackendInputState $currentState
    Write-Host 'BACKEND_RECONCILE=PASS state=healthy inputs=current images=recorded'
}

function Stop-RepositoryHosts {
    foreach ($process in @(Get-CimInstance Win32_Process -Filter "Name='node.exe'" -ErrorAction SilentlyContinue)) {
        $command = [string]$process.CommandLine
        if ($command.Contains($Root, [StringComparison]::OrdinalIgnoreCase)) {
            Stop-Process -Id ([int]$process.ProcessId) -Force -ErrorAction SilentlyContinue
        }
    }
}

switch ($Target) {
    'up' {
        [void](Ensure-Backend)
        Write-Host 'RUNTIME_UP=PASS state=reconciled-or-reused'
        return
    }
    'down' {
        Stop-RepositoryHosts
        Compose @('down', '--remove-orphans')
        Write-Host 'RUNTIME_DOWN=PASS scope=repository-hosts+backend'
        return
    }
    'status' { Compose @('ps', '-a'); return }
}

[void](Ensure-Backend)
Write-Host "DEV_READY=PASS backend=reconciled-or-reused surfaces=direct-package-dev root=$Root"
