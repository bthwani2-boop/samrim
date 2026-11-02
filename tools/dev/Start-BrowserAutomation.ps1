[CmdletBinding()]
param(
    [ValidateSet('Edge', 'Chrome', 'Both')]
    [string]$Browser = 'Both',
    [string]$Url = 'http://localhost:13000/',
    [string]$AccountEmail
)

$ErrorActionPreference = 'Stop'

# User-specific account selection lives outside the repository and works in already-open shells.
$accountFile = Join-Path $env:LOCALAPPDATA 'BThwani\BrowserAutomation\account.txt'
if (-not $AccountEmail -and (Test-Path -LiteralPath $accountFile)) {
    $AccountEmail = (Get-Content -LiteralPath $accountFile -Raw -Encoding UTF8).Trim()
}

function Start-BThwaniBrowser {
    param(
        [Parameter(Mandatory)] [string]$Name,
        [Parameter(Mandatory)] [string]$Exe,
        [Parameter(Mandatory)] [int]$Port,
        [Parameter(Mandatory)] [string]$ProfileDir,
        [Parameter(Mandatory)] [string]$TargetUrl,
        [string]$AdditionalUrl
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
    if ($AdditionalUrl) {
        $arguments += "`"$AdditionalUrl`""
    }
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

# Read Chromium's own profile index; never copy cookies or credentials.
function Get-AccountProfile {
    param(
        [Parameter(Mandatory)] [string]$UserDataDir,
        [Parameter(Mandatory)] [string]$Email
    )
    $localState = Join-Path $UserDataDir 'Local State'
    if (-not (Test-Path -LiteralPath $localState)) { return $null }
    try {
        $state = Get-Content -LiteralPath $localState -Raw -Encoding UTF8 | ConvertFrom-Json -AsHashtable
        foreach ($profile in $state.profile.info_cache.GetEnumerator()) {
            if ([string]$profile.Value.user_name -ieq $Email) {
                return [string]$profile.Key
            }
        }
    } catch {
        Write-Warning "Could not read browser profile index: $UserDataDir"
    }
    return $null
}

function Start-AccountProfile {
    param(
        [Parameter(Mandatory)] [string]$Name,
        [Parameter(Mandatory)] [string]$Exe,
        [Parameter(Mandatory)] [string]$Profile,
        [Parameter(Mandatory)] [string]$TargetUrl
    )
    if (-not (Test-Path -LiteralPath $Exe)) { throw "$Name executable not found: $Exe" }
    # Default browser profiles cannot reliably expose CDP; preserve their existing sign-in sessions.
    Start-Process -FilePath $Exe -ArgumentList @(
        "--profile-directory=`"$Profile`"",
        '--new-window',
        "`"$TargetUrl`""
    ) | Out-Null
    Write-Host "$Name PROFILE_OPENED | PROFILE=$Profile | URL=$TargetUrl | CDP=NOT_ENABLED_FOR_EXISTING_PROFILE"
}

$edgeExe = 'C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe'
if (-not (Test-Path -LiteralPath $edgeExe)) {
    $edgeExe = 'C:\Program Files\Microsoft\Edge\Application\msedge.exe'
}
$chromeExe = 'C:\Program Files\Google\Chrome\Application\chrome.exe'
$profilesRoot = Join-Path $env:LOCALAPPDATA 'BThwani\BrowserAutomation'

if ($Browser -in @('Edge', 'Both')) {
    $edgeProfile = if ($AccountEmail) {
        Get-AccountProfile -UserDataDir (Join-Path $env:LOCALAPPDATA 'Microsoft\Edge\User Data') -Email $AccountEmail
    } else { $null }

    if ($edgeProfile) {
        Start-AccountProfile -Name 'Edge' -Exe $edgeExe -Profile $edgeProfile -TargetUrl $Url
    } else {
        $signInUrl = if ($AccountEmail) {
            'https://accounts.google.com/AccountChooser?Email=' +
                [Uri]::EscapeDataString($AccountEmail) +
                '&continue=https%3A%2F%2Fmyaccount.google.com%2F'
        } else { $null }
        Start-BThwaniBrowser -Name 'Edge' -Exe $edgeExe -Port 9223 -ProfileDir (Join-Path $profilesRoot 'Edge') -TargetUrl $Url -AdditionalUrl $signInUrl
        if ($AccountEmail) {
            Write-Host "Edge ACCOUNT_NOT_VERIFIED | Sign in to Google with $AccountEmail in the opened tab if prompted"
        }
    }
}

if ($Browser -in @('Chrome', 'Both')) {
    $chromeProfile = if ($AccountEmail) {
        Get-AccountProfile -UserDataDir (Join-Path $env:LOCALAPPDATA 'Google\Chrome\User Data') -Email $AccountEmail
    } else { $null }

    if ($chromeProfile) {
        Start-AccountProfile -Name 'Chrome' -Exe $chromeExe -Profile $chromeProfile -TargetUrl $Url
    } else {
        Start-BThwaniBrowser -Name 'Chrome' -Exe $chromeExe -Port 9222 -ProfileDir (Join-Path $profilesRoot 'Chrome') -TargetUrl $Url
        if ($AccountEmail) {
            Write-Host "Chrome ACCOUNT_NOT_VERIFIED | No matching signed-in Chrome profile found for $AccountEmail"
        }
    }
}
