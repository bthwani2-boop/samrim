#Requires -Version 7.4
param(
    [Parameter(Position=0)]
    [ValidateSet('daily','scr','up','down','status')]
    [string]$Target='daily'
)

Set-StrictMode -Version Latest
$ErrorActionPreference='Stop'
$PSNativeCommandUseErrorActionPreference=$false

$Root=(Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
$EnvPath=Join-Path $Root 'infra\local\.env'
$ComposePath=Join-Path $Root 'infra\local\compose\compose.yaml'
$Project='samrim-local'
$DeviceStateDir=Join-Path $env:LOCALAPPDATA 'BThwani\samrim'
$TcpEndpointPath=Join-Path $DeviceStateDir 'adb-tcp-endpoint.txt'
Set-Location $Root

function Fail([string]$Message){throw $Message}

function Read-Env{
    if(-not(Test-Path -LiteralPath $EnvPath -PathType Leaf)){Fail 'LOCAL_ENV_MISSING copy=infra/local/.env.example->infra/local/.env'}
    $map=@{}
    foreach($raw in Get-Content -LiteralPath $EnvPath){
        $line=$raw.Trim()
        if(-not$line-or$line.StartsWith('#')){continue}
        $parts=$line.Split('=',2)
        if($parts.Count-ne2){Fail 'LOCAL_ENV_INVALID'}
        $map[$parts[0].Trim()]=$parts[1].Trim()
    }
    return $map
}

function Need([hashtable]$Map,[string]$Name){
    $value=[string]$Map[$Name]
    if([string]::IsNullOrWhiteSpace($value)){Fail "LOCAL_ENV_MISSING_VALUE name=$Name"}
    return $value
}

function Port([hashtable]$Map,[string]$Name){
    $value=0
    if(-not[int]::TryParse((Need $Map $Name),[ref]$value)){Fail "LOCAL_ENV_INVALID_PORT name=$Name"}
    return $value
}

function Read-DeviceReversePorts{
    $map=Read-Env
    return @(
        Port $map 'SAMRIM_IDENTITY_PORT'
        Port $map 'SAMRIM_DSH_PORT'
        Port $map 'SAMRIM_APP_CLIENT_METRO_PORT'
        Port $map 'SAMRIM_APP_PARTNER_METRO_PORT'
        Port $map 'SAMRIM_APP_CAPTAIN_METRO_PORT'
        Port $map 'SAMRIM_APP_FIELD_METRO_PORT'
    )
}

function Compose([string[]]$Arguments){
    & docker compose --ansi never --project-name $Project --env-file $EnvPath -f $ComposePath @Arguments
    if($LASTEXITCODE-ne0){Fail "DOCKER_COMPOSE_FAILED args=$($Arguments-join' ')"}
}

function Read-RunningBackendServices{
    return @(Compose @('ps','--status','running','--services')|ForEach-Object{$_.Trim()}|Where-Object{$_})
}

function Ensure-Backend{
    $required=@('postgres','mailpit','identity','dsh','wlt')
    Compose @('up','-d','--build','--wait','--wait-timeout','300','--remove-orphans')
    $running=@(Read-RunningBackendServices)
    $missing=@($required|Where-Object{$running-notcontains$_})
    if($missing.Count-ne0){Fail "BACKEND_NOT_READY missing=$($missing-join',')"}
    return 'reconciled'
}

function Read-AdbDevices{
    $output=@(adb devices 2>&1)
    if($LASTEXITCODE-ne0){Fail "ADB_FAILED args=devices exit=$LASTEXITCODE"}
    return @(
        foreach($line in $output){
            if($line-match'^(?<serial>\S+)\s+device(?:\s|$)'){
                [pscustomobject]@{Serial=$Matches.serial;IsTcp=($Matches.serial-match':\d+$')}
            }
        }
    )
}

function Get-UsbSerial{
    $usb=@(Read-AdbDevices|Where-Object{-not$_.IsTcp})
    if($usb.Count-gt1){Fail "ADB_MULTIPLE_USB_DEVICES count=$($usb.Count)"}
    if($usb.Count-eq1){return [string]$usb[0].Serial}
    return $null
}

function Disconnect-TcpDevices{
    & adb disconnect 2>&1|Out-Null
    if($LASTEXITCODE-ne0){Fail "ADB_DISCONNECT_FAILED exit=$LASTEXITCODE"}
}

function Save-TcpEndpoint([string]$Endpoint){
    New-Item -ItemType Directory -Force -Path $DeviceStateDir|Out-Null
    Set-Content -LiteralPath $TcpEndpointPath -Value $Endpoint -Encoding ascii -NoNewline
}

function Get-CachedTcpEndpoint{
    if(-not(Test-Path -LiteralPath $TcpEndpointPath -PathType Leaf)){return $null}
    $endpoint=(Get-Content -LiteralPath $TcpEndpointPath -Raw).Trim()
    if($endpoint-notmatch'^(?:\d{1,3}\.){3}\d{1,3}:5555$'){return $null}
    return $endpoint
}

function Get-UsbIp{
    $route=@(adb -d shell ip route 2>&1)
    if($LASTEXITCODE-ne0){Fail "ADB_FAILED args=shell ip route exit=$LASTEXITCODE"}
    foreach($line in $route){
        if($line-match'\bsrc\s+(?<ip>(?:\d{1,3}\.){3}\d{1,3})\b'){return $Matches.ip}
    }
    Fail 'ADB_USB_IP_NOT_FOUND'
}

function Wait-Usb{
    $clock=[Diagnostics.Stopwatch]::StartNew()
    do{
        if($null-ne(Get-UsbSerial)){return}
        Start-Sleep -Milliseconds 100
    }while($clock.ElapsedMilliseconds-lt5000)
    Fail 'ADB_USB_REATTACH_TIMEOUT'
}

function Prepare-TcpFallback{
    if($null-eq(Get-UsbSerial)){Fail 'ADB_USB_REQUIRED_FOR_TCP_PREPARE'}
    $ip=Get-UsbIp
    $endpoint=('{0}:5555'-f $ip)
    Disconnect-TcpDevices

    $tcpPort=((& adb -d shell getprop service.adb.tcp.port 2>&1)-join'').Trim()
    if($LASTEXITCODE-ne0){Fail "ADB_FAILED args=shell getprop service.adb.tcp.port exit=$LASTEXITCODE"}

    if($tcpPort-ne'5555'){
        Write-Host 'ADB_FALLBACK_PREPARE state=enabling-tcp port=5555'
        & adb -d tcpip 5555 2>&1|Out-Null
        if($LASTEXITCODE-ne0){Fail "ADB_FAILED args=tcpip 5555 exit=$LASTEXITCODE"}
        Wait-Usb
        Start-Sleep -Milliseconds 100
    }else{
        Write-Host 'ADB_FALLBACK_PREPARE state=reused port=5555'
    }

    Disconnect-TcpDevices
    Save-TcpEndpoint $endpoint
    return $endpoint
}

function Connect-TcpFallback{
    if($null-ne(Get-UsbSerial)){Fail 'ADB_REFUSE_TCP_WHILE_USB_PRESENT'}
    $endpoint=Get-CachedTcpEndpoint
    if([string]::IsNullOrWhiteSpace($endpoint)){Fail 'ADB_TCP_ENDPOINT_UNKNOWN connect_usb_once'}
    & adb connect $endpoint 2>&1|Out-Null
    if($LASTEXITCODE-ne0){Fail "ADB_CONNECT_FAILED endpoint=$endpoint exit=$LASTEXITCODE"}
    $state=(& adb -s $endpoint get-state 2>&1)
    if($LASTEXITCODE-ne0-or([string]$state).Trim()-ne'device'){Fail "ADB_TCP_UNAVAILABLE endpoint=$endpoint"}
    return $endpoint
}

function Get-AdbSelector{
    if($null-ne(Get-UsbSerial)){Disconnect-TcpDevices;return @('-d')}
    $endpoint=Connect-TcpFallback
    return @('-s',$endpoint)
}

function Ensure-Reverse([int[]]$Ports){
    $selector=@(Get-AdbSelector)
    foreach($port in @($Ports|Sort-Object -Unique)){
        & adb @selector reverse "tcp:$port" "tcp:$port" 2>&1|Out-Null
        if($LASTEXITCODE-ne0){Fail "ADB_REVERSE_FAILED port=$port exit=$LASTEXITCODE"}
    }
}

function Start-ScrcpyProcess([string[]]$Selector){
    $arguments=@($Selector)+@('--max-size=1280','--max-fps=30','--video-bit-rate=4M','--no-audio')
    return Start-Process -FilePath 'scrcpy' -ArgumentList $arguments -PassThru -NoNewWindow
}

function Ensure-Scrcpy{
    foreach($process in @(Get-Process scrcpy -ErrorAction SilentlyContinue)){
        Stop-Process -Id $process.Id -Force -ErrorAction SilentlyContinue
    }

    $allReverse=@(Read-DeviceReversePorts)
    if($null-ne(Get-UsbSerial)){
        Write-Host 'SCRCPY_PREP transport=usb'
        [void](Prepare-TcpFallback)
        Ensure-Reverse -Ports $allReverse
        Disconnect-TcpDevices
        $mode='usb'
        $process=Start-ScrcpyProcess @('--select-usb')
        Write-Host 'SCRCPY_LIVE transport=usb fallback=tcp'
    }else{
        $endpoint=Connect-TcpFallback
        Ensure-Reverse -Ports $allReverse
        $mode='tcp'
        $process=Start-ScrcpyProcess @('--serial',$endpoint)
        Write-Host "SCRCPY_LIVE transport=tcp endpoint=$endpoint"
    }

    while($true){
        Start-Sleep -Milliseconds 250
        if($mode-eq'usb'){
            if($null-eq(Get-UsbSerial)){
                if(-not$process.HasExited){Stop-Process -Id $process.Id -Force -ErrorAction SilentlyContinue}
                $endpoint=Connect-TcpFallback
                Ensure-Reverse -Ports $allReverse
                $process=Start-ScrcpyProcess @('--serial',$endpoint)
                $mode='tcp'
                Write-Host "SCRCPY_FAILOVER transport=tcp endpoint=$endpoint"
                continue
            }
            if($process.HasExited){return 'closed transport=usb'}
            continue
        }

        if($null-ne(Get-UsbSerial)){
            if(-not$process.HasExited){Stop-Process -Id $process.Id -Force -ErrorAction SilentlyContinue}
            Disconnect-TcpDevices
            [void](Prepare-TcpFallback)
            Ensure-Reverse -Ports $allReverse
            Disconnect-TcpDevices
            $process=Start-ScrcpyProcess @('--select-usb')
            $mode='usb'
            Write-Host 'SCRCPY_FAILBACK transport=usb'
            continue
        }
        if($process.HasExited){return 'closed transport=tcp'}
    }
}

function Stop-RepositoryHosts{
    foreach($process in @(Get-CimInstance Win32_Process -Filter "Name='node.exe'" -ErrorAction SilentlyContinue)){
        $command=[string]$process.CommandLine
        if($command.Contains($Root,[StringComparison]::OrdinalIgnoreCase)){
            Stop-Process -Id ([int]$process.ProcessId) -Force -ErrorAction SilentlyContinue
        }
    }
    foreach($process in @(Get-Process scrcpy -ErrorAction SilentlyContinue)){
        Stop-Process -Id $process.Id -Force -ErrorAction SilentlyContinue
    }
    Disconnect-TcpDevices
}

switch($Target){
    'up'{
        [void](Ensure-Backend)
        Write-Host 'RUNTIME_UP=PASS state=reconciled'
        return
    }
    'down'{
        Stop-RepositoryHosts
        Compose @('down','--remove-orphans')
        Write-Host 'RUNTIME_DOWN=PASS scope=all-local-dev'
        return
    }
    'status'{Compose @('ps','-a');return}
    'scr'{Write-Host "SCRCPY=PASS state=$(Ensure-Scrcpy)";return}
}

[void](Ensure-Backend)
Write-Host "DEV_READY=PASS backend=reconciled surfaces=direct-package-dev scrcpy=pnpm-scr root=$Root"
