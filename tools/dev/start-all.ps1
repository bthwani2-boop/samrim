#Requires -Version 7.4
[CmdletBinding()]
param()

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$repo = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
$started = [System.Collections.Generic.List[object]]::new()
$envFile = Join-Path $repo 'infra\local\compose\.env'
$composeFile = Join-Path $repo 'infra\local\compose\compose.yaml'

function Test-Ready([int]$Port, [string]$Uri, [switch]$Expo) {
    $uris = if ($Expo) {
        @("http://localhost:$Port/status", "http://localhost:$Port/")
    } else {
        @($Uri)
    }
    foreach ($target in $uris) {
        try {
            $r = Invoke-WebRequest -Uri $target -TimeoutSec 3 -SkipHttpErrorCheck
            if ($r.StatusCode -ge 200 -and $r.StatusCode -lt 500) { return $true }
        } catch {}
    }
    return $false
}

function Resolve-AdbSerial {
    if (-not (Get-Command adb -ErrorAction SilentlyContinue)) { return '' }
    $devices = @(
        & adb devices |
            Where-Object { $_ -match '\tdevice$' } |
            ForEach-Object { ($_ -split '\t', 2)[0].Trim() }
    )
    if ($env:BTHWANI_ADB_SERIAL) {
        if ($env:BTHWANI_ADB_SERIAL -notin $devices) {
            throw "BTHWANI_ADB_SERIAL is not online: $env:BTHWANI_ADB_SERIAL"
        }
        return $env:BTHWANI_ADB_SERIAL
    }
    $tcp = @($devices | Where-Object { $_ -match '^\d{1,3}(?:\.\d{1,3}){3}:\d+$' })
    if ($tcp.Count -eq 1) { return $tcp[0] }
    if ($devices.Count -eq 1) { return $devices[0] }
    if ($devices.Count -eq 0) { return '' }
    throw "ADB target is not deterministic. Online devices: $($devices -join ', ')"
}

function Start-Dev([string]$Label, [string]$Command) {
    $pwsh = (Get-Command pwsh -CommandType Application -ErrorAction Stop).Source
    $pnpm = (
        Get-Command pnpm -All -ErrorAction Stop |
            Where-Object { $_.CommandType -in @('Application','ExternalScript') } |
            Select-Object -First 1
    ).Source
    $r = $repo.Replace("'", "''")
    $p = $pnpm.Replace("'", "''")
    $c = $Command.Replace("'", "''")
    $l = $Label.Replace("'", "''")
    $child = @"
`$Host.UI.RawUI.WindowTitle = 'BThwani - $l'
Set-Location -LiteralPath '$r'
& '$p' '$c'
exit `$LASTEXITCODE
"@
    $encoded = [Convert]::ToBase64String([Text.Encoding]::Unicode.GetBytes($child))
    $process = Start-Process $pwsh -ArgumentList @(
        '-NoProfile','-ExecutionPolicy','Bypass','-EncodedCommand',$encoded
    ) -PassThru
    $started.Add($process)
    Write-Host "DEV_PROCESS_STARTED label=$Label pid=$($process.Id)"
    return $process
}

function Ensure-Dev(
    [string]$Label,
    [string]$Command,
    [int]$Port,
    [string]$Uri,
    [switch]$Expo
) {
    if (Test-Ready -Port $Port -Uri $Uri -Expo:$Expo) {
        Write-Host "DEV_COMPONENT=ALREADY_READY label=$Label port=$Port"
        return
    }
    $listeners = @(Get-NetTCPConnection -State Listen -LocalPort $Port -ErrorAction SilentlyContinue)
    if ($listeners.Count -gt 0) {
        throw "Port $Port is occupied but $Label is not ready."
    }
    $process = Start-Dev -Label $Label -Command $Command
    $deadline = [DateTime]::UtcNow.AddSeconds(120)
    while ([DateTime]::UtcNow -lt $deadline) {
        if (Test-Ready -Port $Port -Uri $Uri -Expo:$Expo) {
            Write-Host "DEV_COMPONENT=READY label=$Label port=$Port"
            return
        }
        if ($process.HasExited) {
            throw "$Label exited before readiness. exit=$($process.ExitCode)"
        }
        Start-Sleep -Milliseconds 500
    }
    throw "Timed out waiting for $Label on port $Port."
}

function Stop-Started {
    foreach ($process in @($started)) {
        try {
            if (-not $process.HasExited) {
                & taskkill.exe /PID $process.Id /T /F *> $null
            }
        } catch {}
    }
}

foreach ($tool in @('docker','pnpm','pwsh')) {
    if (-not (Get-Command $tool -ErrorAction SilentlyContinue)) { throw "$tool is required." }
}

$adb = Resolve-AdbSerial
if ($adb) {
    $env:BTHWANI_ADB_SERIAL = $adb
    Write-Host "ADB_TARGET=PASS serial=$adb"
} else {
    Remove-Item Env:BTHWANI_ADB_SERIAL -ErrorAction SilentlyContinue
    Write-Host 'ADB_TARGET=NOT_CONNECTED mobile=metro-only'
}

$existingCompose = @(
    & docker compose --env-file $envFile -f $composeFile ps -q 2>$null |
        Where-Object { $_ }
).Count -gt 0

try {
    Push-Location $repo
    try {
        & pnpm runtime:up
        if ($LASTEXITCODE -ne 0) { throw "pnpm runtime:up failed: $LASTEXITCODE" }
    } finally { Pop-Location }

    Write-Host 'DEV_INFRASTRUCTURE=READY'

    Ensure-Dev 'Identity' 'identity' 18082 'http://127.0.0.1:18082/identity/readiness'
    Ensure-Dev 'DSH' 'dsh' 58080 'http://127.0.0.1:58080/dsh/readiness'
    Ensure-Dev 'Control' 'control' 13000 'http://127.0.0.1:13000/'

    foreach ($app in @(
        @('Client','client',18101),
        @('Partner','partner',18102),
        @('Captain','captain',18103),
        @('Field','field',18104)
    )) {
        Ensure-Dev -Label $app[0] -Command $app[1] -Port $app[2] -Uri "http://localhost:$($app[2])/" -Expo
    }

    Write-Host ''
    Write-Host 'BTHWANI_DEV_ALL=PASS' -ForegroundColor Green
    Write-Host 'READY=PostgreSQL,Mailpit,Identity,DSH,Control,Client,Partner,Captain,Field'
    Write-Host 'Close the spawned PowerShell windows to stop host/mobile runtimes.'
    Write-Host 'Use pnpm runtime:down to stop PostgreSQL/Mailpit.'
}
catch {
    Stop-Started
    if (-not $existingCompose) {
        Push-Location $repo
        try { & pnpm runtime:down *> $null } finally { Pop-Location }
    }
    throw
}
