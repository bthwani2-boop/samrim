#Requires -Version 7.4
[CmdletBinding()]
param()

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$PSNativeCommandUseErrorActionPreference = $false

if (-not $IsWindows) { throw 'The canonical daily Control Panel development runtime is Windows-hosted.' }

$RepoRoot = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
$EnvPath = Join-Path $RepoRoot 'infra\local\.env'
$RuntimePath = Join-Path $PSScriptRoot 'runtime.ps1'

function Fail([string]$Message) { throw $Message }

function Read-EnvMap([string]$Path) {
    if (-not (Test-Path -LiteralPath $Path -PathType Leaf)) { Fail "RUNTIME_NOT_READY reason=missing_environment path=$Path run=pnpm_runtime:up" }
    $map=@{}
    foreach ($line in Get-Content -LiteralPath $Path) {
        $trim=$line.Trim()
        if (-not $trim -or $trim.StartsWith('#')) { continue }
        $parts=$trim.Split('=',2)
        if ($parts.Count -ne 2 -or $map.ContainsKey($parts[0].Trim())) { Fail 'RUNTIME_NOT_READY reason=invalid_environment' }
        $map[$parts[0].Trim()]=$parts[1].Trim()
    }
    if ($map['BTHWANI_ENV'] -ne 'development') { Fail 'RUNTIME_NOT_READY reason=environment_must_be_development' }
    return $map
}

function Require([hashtable]$Map,[string]$Name) {
    $value=[string]$Map[$Name]
    if ([string]::IsNullOrWhiteSpace($value)) { Fail "RUNTIME_NOT_READY reason=missing_environment_value name=$Name" }
    return $value
}

function Test-ControlReady([int]$Port) {
    $response=$null
    $client=[Net.Http.HttpClient]::new()
    $client.Timeout=[TimeSpan]::FromSeconds(1)
    try {
        $response=$client.GetAsync("http://127.0.0.1:$Port/api/auth/session").GetAwaiter().GetResult()
        $status=[int]$response.StatusCode
        return ($status -ge 200 -and $status -lt 500)
    } catch {
        return $false
    } finally {
        if ($null -ne $response) { $response.Dispose() }
        $client.Dispose()
    }
}

function Test-ControlProcessTree([int]$ProcessId) {
    $seen=[System.Collections.Generic.HashSet[int]]::new()
    $current=$ProcessId
    $sawNextDev=$false
    $sawControlRoot=$false
    $absoluteControlRoot=Join-Path $RepoRoot 'apps\control-panel'

    while ($current -gt 0 -and $seen.Add($current)) {
        $process=Get-CimInstance Win32_Process -Filter "ProcessId=$current" -ErrorAction SilentlyContinue
        if ($null -eq $process) { break }

        $command=[string]$process.CommandLine
        if (
            $command.Contains('next',[StringComparison]::OrdinalIgnoreCase) -and
            $command.Contains('dev',[StringComparison]::OrdinalIgnoreCase)
        ) {
            $sawNextDev=$true
        }
        if (
            $command.Contains($absoluteControlRoot,[StringComparison]::OrdinalIgnoreCase) -or
            (
                $command.Contains('apps/control-panel',[StringComparison]::OrdinalIgnoreCase) -or
                $command.Contains('apps\control-panel',[StringComparison]::OrdinalIgnoreCase)
            )
        ) {
            $sawControlRoot=$true
        }
        if ($sawNextDev -and $sawControlRoot) { return $true }
        $current=[int]$process.ParentProcessId
    }
    return $false
}

function Get-ControlState([int]$Port) {
    $listeners=@(Get-NetTCPConnection -State Listen -LocalPort $Port -ErrorAction SilentlyContinue)
    if ($listeners.Count -eq 0) { return [pscustomobject]@{ State='FREE'; ProcessIds=@() } }

    $processIds=[System.Collections.Generic.HashSet[int]]::new()
    foreach ($listener in $listeners) {
        $ownerProcessId=[int]$listener.OwningProcess
        if (-not (Test-ControlProcessTree -ProcessId $ownerProcessId)) {
            $process=Get-CimInstance Win32_Process -Filter "ProcessId=$ownerProcessId" -ErrorAction SilentlyContinue
            $name=if ($null -eq $process) { '<unknown>' } else { [string]$process.Name }
            Fail "CONTROL_PORT_IN_USE port=$Port address=$($listener.LocalAddress) pid=$ownerProcessId name=$name"
        }
        $null=$processIds.Add($ownerProcessId)
    }

    if (Test-ControlReady -Port $Port) {
        return [pscustomobject]@{ State='HEALTHY'; ProcessIds=@($processIds) }
    }
    return [pscustomobject]@{ State='STALE'; ProcessIds=@($processIds) }
}

function Remove-StaleControl([int]$Port,[int[]]$ProcessIds) {
    foreach ($ownerProcessId in @($ProcessIds | Sort-Object -Unique)) {
        Stop-Process -Id $ownerProcessId -Force -ErrorAction SilentlyContinue
        Write-Host "CONTROL_STALE_PROCESS=REMOVED port=$Port pid=$ownerProcessId"
    }
    $deadline=[DateTime]::UtcNow.AddSeconds(5)
    while ([DateTime]::UtcNow -lt $deadline) {
        if (@(Get-NetTCPConnection -State Listen -LocalPort $Port -ErrorAction SilentlyContinue).Count -eq 0) { return }
        Start-Sleep -Milliseconds 100
    }
    Fail "CONTROL_PORT_IN_USE port=$Port reason=stale_process_not_released"
}

& pwsh -NoProfile -ExecutionPolicy Bypass -File $RuntimePath -Action Doctor
if ($LASTEXITCODE -ne 0) { Fail 'RUNTIME_NOT_READY reason=backend_doctor_failed run=pnpm_runtime:up' }

$map=Read-EnvMap $EnvPath
$port=0
if (-not [int]::TryParse((Require $map 'SAMRIM_CONTROL_PORT'),[ref]$port)) { Fail 'RUNTIME_NOT_READY reason=invalid_control_port' }
$publicOrigin=Require $map 'CONTROL_PANEL_PUBLIC_ORIGIN'
$publicUri=$null
if (
    -not [Uri]::TryCreate($publicOrigin,[UriKind]::Absolute,[ref]$publicUri) -or
    $publicUri.Scheme -ne 'http' -or
    $publicUri.Host -ne 'localhost' -or
    $publicUri.Port -ne $port
) {
    Fail 'RUNTIME_NOT_READY reason=invalid_control_public_origin expected=http://localhost:<control-port>'
}

$state=Get-ControlState -Port $port
if ($state.State -eq 'HEALTHY') {
    Write-Host "CONTROL_PANEL_REUSE=PASS url=$publicOrigin pid=$($state.ProcessIds -join ',')"
    return
}
if ($state.State -eq 'STALE') {
    Remove-StaleControl -Port $port -ProcessIds $state.ProcessIds
}

$env:NODE_ENV='development'
$env:BTHWANI_ENV='development'
$env:NEXT_TELEMETRY_DISABLED='1'
$env:NEXT_PRIVATE_DISABLE_DEV_OVERLAY_UX='1'
$env:CONTROL_PANEL_PUBLIC_ORIGIN=$publicOrigin
$env:IDENTITY_API_BASE_URL=Require $map 'IDENTITY_API_BASE_URL'
$env:DSH_API_BASE_URL=Require $map 'DSH_API_BASE_URL'
$env:CONTROL_PANEL_SERVICE_TOKEN=Require $map 'CONTROL_PANEL_SERVICE_TOKEN'

Write-Host "CONTROL_PANEL_HOST=START url=$publicOrigin bind=127.0.0.1:$port"
Push-Location $RepoRoot
try {
    & pnpm --dir apps/control-panel exec next dev -H 127.0.0.1 -p $port
    exit $LASTEXITCODE
}
finally {
    Pop-Location
}
