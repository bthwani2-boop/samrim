[CmdletBinding()]
param(
    [ValidateSet('Edge', 'Chrome', 'Both')]
    [string]$Browser = 'Edge',
    [string]$Url = 'http://localhost:13000/'
)

$ErrorActionPreference = 'Stop'

function Start-BThwaniBrowser {
    param(
        [Parameter(Mandatory)] [string]$Name,
        [Parameter(Mandatory)] [string]$Exe,
        [Parameter(Mandatory)] [int]$Port,
        [Parameter(Mandatory)] [string]$ProfileDir,
        [Parameter(Mandatory)] [string]$TargetUrl
    )

    if (-not (Test-Path -LiteralPath $Exe)) {
        throw "$Name executable not found: $Exe"
    }
    New-Item -ItemType Directory -Force -Path $ProfileDir | Out-Null
    $arguments = @(
        "--remote-debugging-address=127.0.0.1"
        "--remote-debugging-port=$Port"
        "--user-data-dir=`"$ProfileDir`""
        "--no-first-run"
        "--no-default-browser-check"
        "`"$TargetUrl`""
    )
    Start-Process -FilePath $Exe -ArgumentList $arguments | Out-Null

    $debugReady = $false
    for ($i = 0; $i -lt 10; $i++) {
        Start-Sleep -Milliseconds 350
        if (Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue) {
            $debugReady = $true
            break
        }
    }
    $status = if ($debugReady) { 'READY' } else { 'STARTED_PORT_PENDING' }
    Write-Host "$Name $status | URL=$TargetUrl | CDP=http://127.0.0.1:$Port"
}

$edgeExe = 'C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe'
if (-not (Test-Path -LiteralPath $edgeExe)) {
    $edgeExe = 'C:\Program Files\Microsoft\Edge\Application\msedge.exe'
}
$chromeExe = 'C:\Program Files\Google\Chrome\Application\chrome.exe'
$profilesRoot = Join-Path $env:LOCALAPPDATA 'BThwani\BrowserAutomation'

if ($Browser -in @('Edge', 'Both')) {
    Start-BThwaniBrowser -Name 'Edge' -Exe $edgeExe -Port 9223 -ProfileDir (Join-Path $profilesRoot 'Edge') -TargetUrl $Url
}
if ($Browser -in @('Chrome', 'Both')) {
    Start-BThwaniBrowser -Name 'Chrome' -Exe $chromeExe -Port 9222 -ProfileDir (Join-Path $profilesRoot 'Chrome') -TargetUrl $Url
}
