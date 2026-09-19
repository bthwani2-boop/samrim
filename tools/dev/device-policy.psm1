Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$PSNativeCommandUseErrorActionPreference = $false

function Fail([string]$Message) { throw $Message }

function Read-EnvMap([string]$Path) {
    if (-not (Test-Path -LiteralPath $Path -PathType Leaf)) { Fail "DEVICE_NOT_READY reason=missing_environment path=$Path" }
    $map = @{}
    foreach ($line in Get-Content -LiteralPath $Path) {
        $trimmed = $line.Trim()
        if (-not $trimmed -or $trimmed.StartsWith('#')) { continue }
        $parts = $trimmed.Split('=', 2)
        if ($parts.Count -ne 2) { Fail "DEVICE_NOT_READY reason=malformed_environment path=$Path" }
        $name = $parts[0].Trim()
        if ([string]::IsNullOrWhiteSpace($name) -or $map.ContainsKey($name)) { Fail "DEVICE_NOT_READY reason=invalid_environment path=$Path" }
        $map[$name] = $parts[1].Trim()
    }
    return $map
}

function Require-TcpPort([hashtable]$Map, [string]$Name) {
    if (-not $Map.ContainsKey($Name)) { Fail "ADB_REVERSE_NOT_READY reason=missing_port name=$Name" }
    $port = 0
    if (-not [int]::TryParse([string]$Map[$Name], [ref]$port) -or $port -lt 1 -or $port -gt 65535) {
        Fail "ADB_REVERSE_NOT_READY reason=invalid_port name=$Name"
    }
    return $port
}

function Get-CanonicalBackendReversePorts([string]$EnvPath) {
    $map = Read-EnvMap -Path $EnvPath
    return @(
        Require-TcpPort -Map $map -Name 'SAMRIM_IDENTITY_PORT'
        Require-TcpPort -Map $map -Name 'SAMRIM_DSH_PORT'
    ) | Sort-Object -Unique
}

function Get-DeviceIdentity([string]$Serial) {
    $identity = ((& adb -s $Serial shell getprop ro.serialno 2>$null | Out-String).Trim())
    if ([string]::IsNullOrWhiteSpace($identity)) {
        $identity = ((& adb -s $Serial shell getprop ro.boot.serialno 2>$null | Out-String).Trim())
    }
    return $identity
}

function Get-AdbCensus {
    if (-not (Get-Command adb -ErrorAction SilentlyContinue)) { Fail 'DEVICE_NOT_READY reason=adb_unavailable' }
    & adb start-server *> $null
    if ($LASTEXITCODE -ne 0) { Fail 'DEVICE_NOT_READY reason=adb_server' }

    $items = @()
    foreach ($row in @(& adb devices -l 2>&1)) {
        if ($row -notmatch '^([^\s]+)\s+([^\s]+)(?:\s+.*)?$') { continue }
        $serial = $Matches[1]
        $state = $Matches[2]
        if ($serial -eq 'List' -or $serial -match '^emulator-') { continue }
        $kind = if ($row -match '\busb:') { 'USB' } elseif ($serial -match ':\d+$' -or $serial -match '^adb-.*_adb-tls-connect\._tcp$') { 'WIFI' } else { 'USB' }
        $identity = if ($state -eq 'device') { Get-DeviceIdentity -Serial $serial } else { '' }
        $items += [pscustomobject]@{ Serial = $serial; State = $state; Kind = $kind; Identity = $identity }
    }
    return @($items)
}

function Test-AdbReady([string]$Serial) {
    $state = ((& adb -s $Serial get-state 2>$null | Select-Object -First 1) -as [string]).Trim()
    return ($LASTEXITCODE -eq 0 -and $state -eq 'device')
}

function Wait-AdbReady([string]$Serial, [int]$TimeoutSeconds = 8) {
    $deadline = [DateTime]::UtcNow.AddSeconds($TimeoutSeconds)
    while ([DateTime]::UtcNow -lt $deadline) {
        if (Test-AdbReady -Serial $Serial) { return $true }
        Start-Sleep -Milliseconds 250
    }
    return $false
}

function Get-CanonicalAdbDevice {
    param(
        [switch]$RequireUsbPrimary
    )

    $records = @(Get-AdbCensus | Where-Object { $_.State -eq 'device' })
    if ($records.Count -eq 0) { Fail 'DEVICE_NOT_READY reason=no_authorized_physical_device' }

    $override = [string]$env:BTHWANI_ADB_SERIAL
    if (-not [string]::IsNullOrWhiteSpace($override)) {
        $selected = @($records | Where-Object { $_.Serial -eq $override })
        if ($selected.Count -ne 1) { Fail "DEVICE_NOT_READY reason=serial_override_not_ready serial=$override" }
        if ($RequireUsbPrimary -and $selected[0].Kind -ne 'USB') { Fail 'DEVICE_NOT_READY reason=serial_override_not_usb' }
        return $selected[0]
    }

    $groups = @($records | Group-Object {
        if ([string]::IsNullOrWhiteSpace([string]$_.Identity)) { "serial:$($_.Serial)" } else { "identity:$($_.Identity)" }
    })
    if ($groups.Count -ne 1) { Fail "DEVICE_NOT_READY reason=ambiguous_physical_devices count=$($groups.Count)" }

    $usb = @($groups[0].Group | Where-Object { $_.Kind -eq 'USB' })
    if ($RequireUsbPrimary -and $usb.Count -ne 1) {
        if ($usb.Count -eq 0) { Fail 'DEVICE_NOT_READY reason=usb_primary_required' }
        Fail "DEVICE_NOT_READY reason=ambiguous_usb_devices count=$($usb.Count)"
    }
    if ($usb.Count -eq 1) { return $usb[0] }
    return @($groups[0].Group | Sort-Object Serial)[0]
}

function Get-DeviceWifiIp([string]$Serial) {
    $text = ((& adb -s $Serial shell ip -4 addr show wlan0 2>$null) -join "`n")
    if ($text -match '\binet\s+(\d{1,3}(?:\.\d{1,3}){3})/') { return $Matches[1] }
    $text = ((& adb -s $Serial shell ip route 2>$null) -join "`n")
    if ($text -match '\bsrc\s+(\d{1,3}(?:\.\d{1,3}){3})\b') { return $Matches[1] }
    return ''
}

function Find-DeviceByIdentity([string]$Identity) {
    return @(Get-AdbCensus | Where-Object { $_.State -eq 'device' -and $_.Identity -eq $Identity } | Sort-Object Kind,Serial)
}

function Ensure-CanonicalWifiFallback([pscustomobject]$UsbDevice) {
    $existing = @(Find-DeviceByIdentity -Identity $UsbDevice.Identity | Where-Object { $_.Kind -eq 'WIFI' })
    if ($existing.Count -eq 1) {
        Write-Host "ADB_WIFI_FALLBACK=PASS state=existing serial=$($existing[0].Serial)"
        return $existing[0]
    }
    if ($existing.Count -gt 1) { Fail "DEVICE_NOT_READY reason=ambiguous_wifi_fallback count=$($existing.Count)" }

    $ip = Get-DeviceWifiIp -Serial $UsbDevice.Serial
    if ([string]::IsNullOrWhiteSpace($ip)) { Fail 'DEVICE_NOT_READY reason=device_wifi_ip_not_found' }
    & adb -s $UsbDevice.Serial tcpip 5555 | Out-Host
    if ($LASTEXITCODE -ne 0) { Fail 'DEVICE_NOT_READY reason=wifi_bootstrap_failed' }
    $target = "${ip}:5555"
    for ($attempt = 1; $attempt -le 12; $attempt++) {
        Start-Sleep -Milliseconds 500
        & adb connect $target *> $null
        if (Wait-AdbReady -Serial $target -TimeoutSeconds 1) {
            $wifiIdentity = Get-DeviceIdentity -Serial $target
            if ($wifiIdentity -ne $UsbDevice.Identity) { Fail 'DEVICE_NOT_READY reason=wifi_identity_mismatch' }
            Write-Host "ADB_WIFI_FALLBACK=PASS state=bootstrapped serial=$target"
            return [pscustomobject]@{ Serial = $target; State = 'device'; Kind = 'WIFI'; Identity = $wifiIdentity }
        }
    }
    Fail "DEVICE_NOT_READY reason=wifi_fallback_unavailable target=$target"
}

function Ensure-CanonicalAdbReverse([string]$Serial, [int[]]$Ports) {
    $uniquePorts = @($Ports | Sort-Object -Unique)
    if ($uniquePorts.Count -eq 0 -or @($uniquePorts | Where-Object { $_ -lt 1 -or $_ -gt 65535 }).Count -gt 0) {
        Fail 'ADB_REVERSE_NOT_READY reason=invalid_port_set'
    }

    $rows = @(& adb -s $Serial reverse --list 2>&1)
    if ($LASTEXITCODE -ne 0) { Fail "ADB_REVERSE_NOT_READY reason=readback_failed serial=$Serial" }
    $repaired = 0
    foreach ($port in $uniquePorts) {
        $exact = @($rows | Where-Object { $_ -match "(^|\s)tcp:$port\s+tcp:$port($|\s)" })
        if ($exact.Count -eq 1) { continue }
        & adb -s $Serial reverse "tcp:$port" "tcp:$port" *> $null
        if ($LASTEXITCODE -ne 0) { Fail "ADB_REVERSE_NOT_READY reason=prepare_failed serial=$Serial port=$port" }
        $repaired++
    }

    if ($repaired -gt 0) {
        $rows = @(& adb -s $Serial reverse --list 2>&1)
        if ($LASTEXITCODE -ne 0) { Fail "ADB_REVERSE_NOT_READY reason=readback_failed serial=$Serial" }
    }
    foreach ($port in $uniquePorts) {
        if (@($rows | Where-Object { $_ -match "(^|\s)tcp:$port\s+tcp:$port($|\s)" }).Count -ne 1) {
            Fail "ADB_REVERSE_NOT_READY reason=missing_port serial=$Serial port=$port"
        }
    }
    Write-Host "ADB_REVERSE=PASS serial=$Serial repaired=$repaired ports=$($uniquePorts -join ',')"
}

function Prepare-CanonicalAdbDevice {
    param(
        [string]$EnvPath,
        [int[]]$Ports = @(),
        [switch]$RequireUsbPrimary,
        [switch]$PrepareWifiFallback
    )

    $portsToPrepare = if ($Ports.Count -gt 0) { @($Ports | Sort-Object -Unique) } else { @(Get-CanonicalBackendReversePorts -EnvPath $EnvPath) }
    $device = Get-CanonicalAdbDevice -RequireUsbPrimary:$RequireUsbPrimary
    Write-Host "ADB_DEVICE=PASS serial=$($device.Serial) transport=$($device.Kind) identity=$($device.Identity)"
    if ($PrepareWifiFallback) {
        if ($device.Kind -ne 'USB') { Fail 'DEVICE_NOT_READY reason=wifi_fallback_requires_usb_primary' }
        $fallback = Ensure-CanonicalWifiFallback -UsbDevice $device
        Write-Host "ADB_FALLBACK=WIFI serial=$($fallback.Serial)"
    }
    Ensure-CanonicalAdbReverse -Serial $device.Serial -Ports $portsToPrepare
    return $device
}

Export-ModuleMember -Function @(
    'Get-CanonicalBackendReversePorts',
    'Get-CanonicalAdbDevice',
    'Find-DeviceByIdentity',
    'Ensure-CanonicalAdbReverse',
    'Prepare-CanonicalAdbDevice',
    'Ensure-CanonicalWifiFallback',
    'Test-AdbReady',
    'Get-AdbCensus'
)
