#Requires -Version 7.4
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$PSNativeCommandUseErrorActionPreference = $false

$RepoRoot = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
$EnvPath = Join-Path $RepoRoot 'infra\local\compose\.env'
$EnvExamplePath = Join-Path $RepoRoot 'infra\local\compose\.env.example'

function Fail([string]$Message) { throw $Message }

function Read-EnvMap([string]$Path) {
    $map = @{}
    foreach ($line in Get-Content -LiteralPath $Path) {
        $trimmed = $line.Trim()
        if (-not $trimmed -or $trimmed.StartsWith('#')) { continue }
        $parts = $trimmed.Split('=', 2)
        if ($parts.Count -ne 2) { Fail "Malformed environment line: $line" }
        $map[$parts[0].Trim()] = $parts[1].Trim()
    }
    return $map
}

function Require-TcpPort([hashtable]$Map, [string]$Name) {
    if (-not $Map.ContainsKey($Name)) { Fail "Missing port: $Name" }
    $port = 0
    if (-not [int]::TryParse([string]$Map[$Name], [ref]$port) -or $port -lt 1 -or $port -gt 65535) {
        Fail "Invalid port: $Name=$($Map[$Name])"
    }
    return $port
}

function Get-ManagedReversePorts {
    $source = if (Test-Path -LiteralPath $EnvPath -PathType Leaf) { $EnvPath } else { $EnvExamplePath }
    if (-not (Test-Path -LiteralPath $source -PathType Leaf)) { Fail 'Canonical local environment is unavailable.' }
    $map = Read-EnvMap -Path $source
    return @(
        Require-TcpPort -Map $map -Name 'SAMRIM_DSH_PORT'
        Require-TcpPort -Map $map -Name 'SAMRIM_IDENTITY_PORT'
        Require-TcpPort -Map $map -Name 'SAMRIM_APP_CLIENT_METRO_PORT'
        Require-TcpPort -Map $map -Name 'SAMRIM_APP_PARTNER_METRO_PORT'
        Require-TcpPort -Map $map -Name 'SAMRIM_APP_CAPTAIN_METRO_PORT'
        Require-TcpPort -Map $map -Name 'SAMRIM_APP_FIELD_METRO_PORT'
    ) | Sort-Object -Unique
}

function Get-AdbTransports {
    $items = @()
    foreach ($row in @(& adb devices -l 2>&1)) {
        if ($row -notmatch '^(\S+)\s+(\S+)(?:\s+.*)?$') { continue }
        $serial = $Matches[1]
        $state = $Matches[2]
        if ($serial -eq 'List' -or $serial -match '^emulator-') { continue }
        $kind = if ($row -match '\busb:' -or ($serial -notmatch ':\d+$' -and $serial -notmatch '^adb-.*_adb-tls-connect\._tcp$')) { 'USB' } else { 'WIFI' }
        $items += [pscustomobject]@{ Serial = $serial; State = $state; Kind = $kind }
    }
    return @($items)
}

function Get-DeviceIdentity([string]$Serial) {
    $identity = ((& adb -s $Serial shell getprop ro.serialno 2>$null | Out-String).Trim())
    if ([string]::IsNullOrWhiteSpace($identity)) { $identity = ((& adb -s $Serial shell getprop ro.boot.serialno 2>$null | Out-String).Trim()) }
    return $identity
}

function Get-DeviceWifiIp([string]$Serial) {
    $text = ((& adb -s $Serial shell ip -4 addr show wlan0 2>$null) -join "`n")
    if ($text -match '\binet\s+(\d{1,3}(?:\.\d{1,3}){3})/') { return $Matches[1] }
    $text = ((& adb -s $Serial shell ip route 2>$null) -join "`n")
    if ($text -match '\bsrc\s+(\d{1,3}(?:\.\d{1,3}){3})\b') { return $Matches[1] }
    return ''
}

function Test-AdbReady([string]$Serial) {
    $state = (& adb -s $Serial get-state 2>$null | Select-Object -First 1)
    return ($LASTEXITCODE -eq 0 -and $state -eq 'device')
}

function Wait-AdbReady([string]$Serial, [int]$Seconds = 8) {
    $deadline = [DateTime]::UtcNow.AddSeconds($Seconds)
    while ([DateTime]::UtcNow -lt $deadline) {
        if (Test-AdbReady -Serial $Serial) { return $true }
        Start-Sleep -Milliseconds 250
    }
    return $false
}

function Get-UsbPrimary {
    $rows = @(Get-AdbTransports | Where-Object { $_.Kind -eq 'USB' })
    if ($rows.Count -eq 0) { Fail 'ADB_USB_REQUIRED connect Galaxy by USB, enable USB debugging, unlock it, and accept this computer.' }
    if ($rows.Count -gt 1) { Fail "ADB_USB_AMBIGUOUS devices=$($rows.Serial -join ',')" }
    if ($rows[0].State -eq 'unauthorized') { Fail 'ADB_USB_UNAUTHORIZED unlock Galaxy and accept this computer.' }
    if ($rows[0].State -ne 'device') { Fail "ADB_USB_NOT_READY state=$($rows[0].State)" }
    return $rows[0]
}

function Find-WifiFallback([string]$Identity) {
    foreach ($row in @(Get-AdbTransports | Where-Object { $_.Kind -eq 'WIFI' -and $_.State -eq 'device' })) {
        if ((Get-DeviceIdentity -Serial $row.Serial) -eq $Identity) { return $row }
    }
    return $null
}

function Ensure-WifiFallback([string]$UsbSerial, [string]$Identity) {
    $current = Find-WifiFallback -Identity $Identity
    if ($null -ne $current) { Write-Host "ADB_WIFI_FALLBACK=PASS state=existing serial=$($current.Serial)"; return $current }
    $ip = Get-DeviceWifiIp -Serial $UsbSerial
    if ([string]::IsNullOrWhiteSpace($ip)) { Fail 'ADB_WIFI_FALLBACK=FAIL reason=device_wifi_ip_not_found' }
    Write-Host "ADB_WIFI_FALLBACK=PREPARE ip=$ip port=5555"
    & adb -s $UsbSerial tcpip 5555 | Out-Host
    if ($LASTEXITCODE -ne 0) { Fail 'ADB_WIFI_FALLBACK=FAIL reason=tcpip_command' }
    $target = "${ip}:5555"
    for ($attempt = 1; $attempt -le 12; $attempt++) {
        Start-Sleep -Milliseconds 500
        & adb connect $target *> $null
        if (Wait-AdbReady -Serial $target -Seconds 1) {
            $wifiIdentity = Get-DeviceIdentity -Serial $target
            if ($wifiIdentity -ne $Identity) { Fail 'ADB_WIFI_FALLBACK=FAIL reason=identity_mismatch' }
            if (-not (Test-AdbReady -Serial $UsbSerial)) { Fail 'ADB_WIFI_FALLBACK=FAIL reason=usb_lost_during_bootstrap' }
            Write-Host "ADB_WIFI_FALLBACK=PASS state=bootstrapped serial=$target"
            return [pscustomobject]@{ Serial = $target; State = 'device'; Kind = 'WIFI' }
        }
    }
    Fail "ADB_WIFI_FALLBACK=FAIL target=$target"
}

function Ensure-AdbReverse([string]$Serial, [int[]]$Ports) {
    foreach ($port in $Ports) {
        & adb -s $Serial reverse "tcp:$port" "tcp:$port" *> $null
        if ($LASTEXITCODE -ne 0) { Fail "ADB_REVERSE=FAIL serial=$Serial port=$port" }
    }
    $rows = @(& adb -s $Serial reverse --list 2>&1)
    if ($LASTEXITCODE -ne 0) { Fail "ADB_REVERSE=FAIL serial=$Serial reason=list_failed" }
    foreach ($port in $Ports) {
        if (@($rows | Where-Object { $_ -match "(^|\s)tcp:$port\s+tcp:$port($|\s)" }).Count -ne 1) { Fail "ADB_REVERSE=FAIL serial=$Serial port=$port reason=readback" }
    }
    Write-Host "ADB_REVERSE=PASS serial=$Serial ports=$($Ports -join ',')"
}

function Start-Scrcpy([string]$Serial, [string]$Transport) {
    Write-Host "SCRCPY=START transport=$Transport serial=$Serial"
    & scrcpy -s $Serial
    $code = $LASTEXITCODE
    Write-Host "SCRCPY=EXIT transport=$Transport serial=$Serial code=$code"
    return $code
}

foreach ($command in @('adb','scrcpy')) { if (-not (Get-Command $command -ErrorAction SilentlyContinue)) { Fail "$command is not available on PATH." } }

Write-Host 'DEVICE_OWNER=WINDOWS'
Write-Host 'DEVICE_POLICY=USB_PRIMARY_WIFI_HOT_FALLBACK'
Write-Host 'ANDROID_DATA_PATH=ADB_REVERSE'
Write-Host 'DOCKER_DEPENDENCY=0'

& adb start-server *> $null
if ($LASTEXITCODE -ne 0) { Fail 'ADB_SERVER=FAIL' }
$ports = @(Get-ManagedReversePorts)
$usb = Get-UsbPrimary
$identity = Get-DeviceIdentity -Serial $usb.Serial
if ([string]::IsNullOrWhiteSpace($identity)) { Fail 'ADB_DEVICE_IDENTITY=FAIL' }
Write-Host "ADB_USB_PRIMARY=PASS serial=$($usb.Serial) identity=$identity"
$wifi = Ensure-WifiFallback -UsbSerial $usb.Serial -Identity $identity
Ensure-AdbReverse -Serial $usb.Serial -Ports $ports
Write-Host "ADB_PRIMARY=USB serial=$($usb.Serial)"
Write-Host "ADB_FALLBACK=WIFI serial=$($wifi.Serial)"
Write-Host 'CABLE_FAILOVER=ARMED'
$currentSerial = [string]$usb.Serial
$currentTransport = 'USB'

while ($true) {
    $code = Start-Scrcpy -Serial $currentSerial -Transport $currentTransport
    if (Test-AdbReady -Serial $currentSerial) { Write-Host "SCRCPY_SESSION=CLOSED transport=$currentTransport"; exit $code }
    if ($currentTransport -eq 'USB') {
        $fallback = Find-WifiFallback -Identity $identity
        if ($null -eq $fallback) { Fail 'ADB_FAILOVER=FAIL from=USB reason=wifi_not_available' }
        Ensure-AdbReverse -Serial $fallback.Serial -Ports $ports
        $currentSerial = [string]$fallback.Serial
        $currentTransport = 'WIFI'
        Write-Host "ADB_FAILOVER=PASS from=USB to=WIFI serial=$currentSerial"
        continue
    }
    $usbFallback = @(Get-AdbTransports | Where-Object { $_.Kind -eq 'USB' -and $_.State -eq 'device' })
    foreach ($candidate in $usbFallback) {
        if ((Get-DeviceIdentity -Serial $candidate.Serial) -eq $identity) {
            Ensure-AdbReverse -Serial $candidate.Serial -Ports $ports
            $currentSerial = [string]$candidate.Serial
            $currentTransport = 'USB'
            Write-Host "ADB_FAILOVER=PASS from=WIFI to=USB serial=$currentSerial"
            continue 2
        }
    }
    Fail 'ADB_FAILOVER=FAIL from=WIFI reason=no_transport_available'
}
