[CmdletBinding()]
param(
    [ValidateSet('Chrome')]
    [string]$Browser = 'Chrome',
    [string]$Url = 'http://localhost:13000/',
    [string]$AccountEmail,
    [switch]$VerifyAuthenticated,
    [string]$RequireSelector
)

$ErrorActionPreference = 'Stop'
$profilesRoot = Join-Path $env:LOCALAPPDATA 'BThwani\BrowserAutomation'
$accountFile = Join-Path $profilesRoot 'account.txt'
if (-not $AccountEmail -and (Test-Path -LiteralPath $accountFile)) {
    $AccountEmail = (Get-Content -LiteralPath $accountFile -Raw -Encoding UTF8).Trim()
}

function Test-AccountIndex {
    param([string]$ProfileDir, [string]$Email)
    if (-not $Email) { return 'NOT_REQUESTED' }
    $localState = Join-Path $ProfileDir 'Local State'
    if (-not (Test-Path -LiteralPath $localState)) { return 'NOT_VERIFIED' }
    try {
        $state = Get-Content -LiteralPath $localState -Raw -Encoding UTF8 | ConvertFrom-Json -AsHashtable
        foreach ($entry in $state.profile.info_cache.GetEnumerator()) {
            if ([string]$entry.Value.user_name -ieq $Email) { return 'PROFILE_EMAIL_MATCH' }
        }
    } catch {
        return 'NOT_VERIFIED'
    }
    return 'PROFILE_EMAIL_NOT_FOUND'
}

function Test-CdpEndpoint {
    param([string]$Name, [string]$Executable, [string]$ProfileDir, [int]$Port)
    $connections = @(Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue)
    if ($connections.Count -eq 0) { return $false }
    foreach ($connection in $connections) {
        if ($connection.LocalAddress -notin @('127.0.0.1', '::1')) {
            throw "$Name CDP_UNSAFE_BIND: $Port is listening beyond loopback"
        }
        $owner = Get-CimInstance Win32_Process -Filter ("ProcessId=" + $connection.OwningProcess) -ErrorAction Stop
        $expected = [System.IO.Path]::GetFileName($Executable)
        if ($owner.Name -ine $expected -or
            -not $owner.CommandLine -or
            $owner.CommandLine.IndexOf($ProfileDir, [StringComparison]::OrdinalIgnoreCase) -lt 0) {
            throw "$Name CDP_PORT_CONFLICT: $Port is not owned by the expected profile"
        }
    }
    try {
        $version = Invoke-RestMethod -Uri "http://127.0.0.1:$Port/json/version" -TimeoutSec 3
        $expectedProduct = 'Chrome/'
        if (-not ([string]$version.Browser).StartsWith($expectedProduct, [StringComparison]::Ordinal)) {
            throw 'Incorrect browser product'
        }
        $uri = [Uri]$version.webSocketDebuggerUrl
        if ($uri.Scheme -ne 'ws' -or $uri.Host -notin @('127.0.0.1', '::1') -or $uri.Port -ne $Port) {
            throw 'Unexpected WebSocket debugger address'
        }
        $socket = [System.Net.WebSockets.ClientWebSocket]::new()
        $cancel = [System.Threading.CancellationTokenSource]::new([TimeSpan]::FromSeconds(3))
        try {
            $socket.ConnectAsync($uri, $cancel.Token).GetAwaiter().GetResult()
            if ($socket.State -ne [System.Net.WebSockets.WebSocketState]::Open) {
                throw 'WebSocket handshake incomplete'
            }
        } finally {
            $socket.Dispose()
            $cancel.Dispose()
        }
    } catch {
        throw "$Name CDP_NOT_READY: $($_.Exception.Message)"
    }
    return $true
}

function Start-BThwaniBrowser {
    param([string]$Name, [string]$Executable, [int]$Port, [string]$ProfileDir, [string]$TargetUrl)
    if (-not (Test-Path -LiteralPath $Executable)) { throw "$Name BROWSER_MISSING" }
    if (-not (Test-Path -LiteralPath $ProfileDir)) {
        New-Item -ItemType Directory -Path $ProfileDir -Force | Out-Null
    }
    $ready = Test-CdpEndpoint -Name $Name -Executable $Executable -ProfileDir $ProfileDir -Port $Port
    if (-not $ready) {
        $existing = @(Get-CimInstance Win32_Process -Filter ("Name='" + [IO.Path]::GetFileName($Executable) + "'") |
            Where-Object { $_.CommandLine -and $_.CommandLine.IndexOf($ProfileDir, [StringComparison]::OrdinalIgnoreCase) -ge 0 })
        if ($existing.Count -gt 0) {
            throw "$Name PROFILE_ALREADY_RUNNING_WITHOUT_CDP: preserve session; close it manually if necessary"
        }
        $arguments = @(
            '--remote-debugging-address=127.0.0.1',
            "--remote-debugging-port=$Port",
            ('--user-data-dir="' + $ProfileDir + '"'),
            '--no-first-run',
            '--no-default-browser-check',
            ('"' + $TargetUrl + '"')
        )
        Start-Process -FilePath $Executable -ArgumentList $arguments | Out-Null
        for ($i = 0; $i -lt 20; $i++) {
            Start-Sleep -Milliseconds 350
            $ready = Test-CdpEndpoint -Name $Name -Executable $Executable -ProfileDir $ProfileDir -Port $Port
            if ($ready) { break }
        }
        if (-not $ready) { throw "$Name CDP_START_TIMEOUT: browser launched; do not launch another copy" }
    }
    $targetUri = [Uri]$TargetUrl
    $origin = $targetUri.GetLeftPart([UriPartial]::Authority)
    $pages = @(Invoke-RestMethod -Uri "http://127.0.0.1:$Port/json/list" -TimeoutSec 3)
    $present = @($pages | Where-Object {
        $_.type -eq 'page' -and
        ($_.url -eq $TargetUrl -or ($targetUri.AbsolutePath -eq '/' -and
            ([string]$_.url).StartsWith($origin + '/', [StringComparison]::OrdinalIgnoreCase)))
    })
    if ($present.Count -eq 0) {
        $encodedUrl = [Uri]::EscapeDataString($TargetUrl)
        Invoke-RestMethod -Uri "http://127.0.0.1:$Port/json/new?$encodedUrl" -Method Put -TimeoutSec 5 | Out-Null
    }
    $account = Test-AccountIndex -ProfileDir $ProfileDir -Email $AccountEmail
    Write-Host "$Name CDP_READY | URL=$TargetUrl | CDP=http://127.0.0.1:$Port | ACCOUNT=$account | SITE_AUTH=NOT_TESTED"
}

$chromeExe = 'C:\Program Files\Google\Chrome\Application\chrome.exe'
try {
    Start-BThwaniBrowser -Name 'Chrome' -Executable $chromeExe -Port 9222 -ProfileDir (Join-Path $profilesRoot 'Chrome') -TargetUrl $Url
} catch {
    Write-Error -Message $_.Exception.Message -ErrorAction Continue
    exit 1
}

if ($VerifyAuthenticated) {
    if (-not $RequireSelector) {
        Write-Error -Message 'REQUIRE_SELECTOR_FOR_AUTHENTICATED_PAGE' -ErrorAction Continue
        exit 1
    }
    $gate = Join-Path $PSScriptRoot 'verify-authenticated-browser.cjs'
    & node $gate --url $Url --require-selector $RequireSelector
    if ($LASTEXITCODE -ne 0) { exit 1 }
}
