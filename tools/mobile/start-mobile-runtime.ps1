[CmdletBinding()]
param(
    [Parameter(Mandatory)]
    [string] $App,

    [string] $DeviceSerial = $env:BTHWANI_ADB_SERIAL,

    [switch] $ClearCache
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$RepoRoot = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
$AppRoot = Join-Path $RepoRoot ("apps\" + $App)
$PackageJson = Join-Path $AppRoot 'package.json'
$ProjectJson = Join-Path $AppRoot 'project.json'
$MobileConfig = Join-Path $AppRoot 'mobile.config.json'

foreach ($required in @($PackageJson, $ProjectJson, $MobileConfig)) {
    if (-not (Test-Path -LiteralPath $required -PathType Leaf)) {
        throw "Requested mobile host is not a discovered materialized mobile app: $required"
    }
}

$project = Get-Content -LiteralPath $ProjectJson -Raw | ConvertFrom-Json
if (@($project.tags) -notcontains 'type:app') {
    throw "$App is not tagged as type:app."
}

$package = Get-Content -LiteralPath $PackageJson -Raw | ConvertFrom-Json
$startScript = [string] $package.scripts.start
if ([string]::IsNullOrWhiteSpace($startScript)) {
    throw "$App package.json does not define scripts.start."
}

if (-not (Get-Command pnpm -ErrorAction SilentlyContinue)) {
    throw 'pnpm is required.'
}

$Unmerged = @(& git -C $RepoRoot diff --name-only --diff-filter=U)
if ($LASTEXITCODE -ne 0) {
    throw 'Unable to verify git merge state.'
}
if ($Unmerged.Count -gt 0) {
    throw ("Repository contains unresolved merge paths: " + ($Unmerged -join ', '))
}

function Resolve-AdbTargetSerial {
    param([string] $RequestedSerial)

    if (-not (Get-Command adb -ErrorAction SilentlyContinue)) {
        return ""
    }

    $serials = @(
        & adb devices |
            Where-Object { $_ -match '\tdevice$' } |
            ForEach-Object { ($_ -split '\t', 2)[0].Trim() } |
            Where-Object { -not [string]::IsNullOrWhiteSpace($_) }
    )

    if (-not [string]::IsNullOrWhiteSpace($RequestedSerial)) {
        if ($RequestedSerial -notin $serials) {
            throw "ADB target mismatch: requested '$RequestedSerial' is not an attached device."
        }
        return $RequestedSerial
    }

    if ($serials.Count -eq 0) {
        return ""
    }
    if ($serials.Count -gt 1) {
        throw ("Multiple ADB devices are attached; set BTHWANI_ADB_SERIAL or -DeviceSerial explicitly. Devices: " + ($serials -join ", "))
    }
    return $serials[0]
}

$Ports = @{
    'app-client' = 18101
    'app-partner' = 18102
    'app-captain' = 18103
    'app-field' = 18104
}

$adbSerial = Resolve-AdbTargetSerial -RequestedSerial $DeviceSerial
if (-not [string]::IsNullOrWhiteSpace($adbSerial)) {
    $metroPort = $Ports[$App]

    if ($metroPort) {
        & adb -s $adbSerial reverse "tcp:$metroPort" "tcp:$metroPort" *> $null
        if ($LASTEXITCODE -ne 0) {
            throw "ADB reverse failed for $adbSerial port $metroPort."
        }
    }

    & adb -s $adbSerial reverse "tcp:18082" "tcp:18082" *> $null
    if ($LASTEXITCODE -ne 0) {
        throw "ADB reverse failed for $adbSerial port 18082."
    }

    & adb -s $adbSerial reverse "tcp:58080" "tcp:58080" *> $null
    if ($LASTEXITCODE -ne 0) {
        throw "ADB reverse failed for $adbSerial port 58080."
    }

    Write-Host "ADB_TARGET=PASS serial=$adbSerial app=$App"
    Write-Host "ADB_REVERSE=READY serial=$adbSerial ports=$metroPort,18082,58080"
}

$Args = @(
    '--dir', $AppRoot,
    'run', 'start'
)
if ($ClearCache) {
    $Args += @('--', '--clear')
}

Write-Host ("Starting " + $App + " from " + $AppRoot)
Write-Host ("Invocation source: " + $PackageJson + " scripts.start")
& pnpm @Args
exit $LASTEXITCODE
