#Requires -Version 7.4
Set-StrictMode -Version Latest
$ErrorActionPreference='Stop'
$PSNativeCommandUseErrorActionPreference=$false

$Root=(Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
$EnvPath=Join-Path $Root 'infra\local\.env'
$StateDir=Join-Path $env:LOCALAPPDATA 'BThwani\samrim'
$EndpointFile=Join-Path $StateDir 'adb-tcp-endpoint.txt'
$Adb=(Get-Command adb -ErrorAction Stop).Source
$Scrcpy=(Get-Command scrcpy -ErrorAction Stop).Source
$env:ADB=$Adb
Set-Location $Root

function Fail([string]$Message){throw $Message}

function Read-Ports{
    if(-not(Test-Path -LiteralPath $EnvPath -PathType Leaf)){Fail 'LOCAL_ENV_MISSING copy=infra/local/.env.example->infra/local/.env'}
    $map=@{}
    foreach($raw in Get-Content -LiteralPath $EnvPath){
        $line=$raw.Trim()
        if(-not$line-or$line.StartsWith('#')){continue}
        $parts=$line.Split('=',2)
        if($parts.Count-eq2){$map[$parts[0].Trim()]=$parts[1].Trim()}
    }
    $names=@(
        'SAMRIM_IDENTITY_PORT','SAMRIM_DSH_PORT',
        'SAMRIM_APP_CLIENT_METRO_PORT','SAMRIM_APP_PARTNER_METRO_PORT',
        'SAMRIM_APP_CAPTAIN_METRO_PORT','SAMRIM_APP_FIELD_METRO_PORT'
    )
    return @($names|ForEach-Object{
        $port=0
        if(-not[int]::TryParse([string]$map[$_],[ref]$port)){Fail "LOCAL_ENV_INVALID_PORT name=$_"}
        $port
    }|Sort-Object -Unique)
}

function Read-Devices{
    $output=@(& $Adb devices 2>&1)
    if($LASTEXITCODE-ne0){Fail "ADB_FAILED args=devices exit=$LASTEXITCODE adb=$Adb"}
    return @(
        foreach($line in $output){
            if($line-match'^(?<serial>\S+)\s+device(?:\s|$)'){
                [pscustomobject]@{Serial=$Matches.serial;Tcp=($Matches.serial-match':\d+$')}
            }
        }
    )
}

function Get-Usb{
    $usb=@(Read-Devices|Where-Object{-not$_.Tcp})
    if($usb.Count-gt1){Fail "ADB_MULTIPLE_USB_DEVICES count=$($usb.Count)"}
    if($usb.Count-eq1){return [string]$usb[0].Serial}
    return $null
}

function Disconnect-Tcp{
    & $Adb disconnect 2>&1|Out-Null
    if($LASTEXITCODE-ne0){Fail "ADB_DISCONNECT_FAILED exit=$LASTEXITCODE"}
}

function Wait-Usb{
    $clock=[Diagnostics.Stopwatch]::StartNew()
    do{
        if($null-ne(Get-Usb)){return}
        Start-Sleep -Milliseconds 100
    }while($clock.ElapsedMilliseconds-lt5000)
    Fail 'ADB_USB_REATTACH_TIMEOUT'
}

function Prepare-Tcp{
    if($null-eq(Get-Usb)){Fail 'ADB_USB_REQUIRED_FOR_TCP_PREPARE'}
    $route=@(& $Adb -d shell ip route 2>&1)
    if($LASTEXITCODE-ne0){Fail "ADB_FAILED args=shell-ip-route exit=$LASTEXITCODE"}
    $ip=$null
    foreach($line in $route){if($line-match'\bsrc\s+(?<ip>(?:\d{1,3}\.){3}\d{1,3})\b'){$ip=$Matches.ip;break}}
    if(-not$ip){Fail 'ADB_USB_IP_NOT_FOUND'}

    Disconnect-Tcp
    $tcpPort=((& $Adb -d shell getprop service.adb.tcp.port 2>&1)-join'').Trim()
    if($LASTEXITCODE-ne0){Fail "ADB_FAILED args=getprop-tcp-port exit=$LASTEXITCODE"}
    if($tcpPort-ne'5555'){
        & $Adb -d tcpip 5555 2>&1|Out-Null
        if($LASTEXITCODE-ne0){Fail "ADB_FAILED args=tcpip-5555 exit=$LASTEXITCODE"}
        Wait-Usb
    }

    New-Item -ItemType Directory -Force -Path $StateDir|Out-Null
    $endpoint=('{0}:5555'-f $ip)
    Set-Content -LiteralPath $EndpointFile -Value $endpoint -Encoding ascii -NoNewline
    Disconnect-Tcp
    return $endpoint
}

function Connect-Tcp{
    if($null-ne(Get-Usb)){Fail 'ADB_REFUSE_TCP_WHILE_USB_PRESENT'}
    if(-not(Test-Path -LiteralPath $EndpointFile -PathType Leaf)){Fail 'ADB_TCP_ENDPOINT_UNKNOWN connect_usb_once'}
    $endpoint=(Get-Content -LiteralPath $EndpointFile -Raw).Trim()
    if($endpoint-notmatch'^(?:\d{1,3}\.){3}\d{1,3}:5555$'){Fail 'ADB_TCP_ENDPOINT_INVALID connect_usb_once'}
    & $Adb connect $endpoint 2>&1|Out-Null
    if($LASTEXITCODE-ne0){Fail "ADB_CONNECT_FAILED endpoint=$endpoint exit=$LASTEXITCODE"}
    $state=(& $Adb -s $endpoint get-state 2>&1)
    if($LASTEXITCODE-ne0-or([string]$state).Trim()-ne'device'){Fail "ADB_TCP_UNAVAILABLE endpoint=$endpoint"}
    return $endpoint
}

function Set-Reverse([string[]]$Selector,[int[]]$Ports){
    foreach($port in $Ports){
        & $Adb @Selector reverse "tcp:$port" "tcp:$port" 2>&1|Out-Null
        if($LASTEXITCODE-ne0){Fail "ADB_REVERSE_FAILED port=$port exit=$LASTEXITCODE"}
    }
}

function Start-Scrcpy([string[]]$Selector){
    return Start-Process -FilePath $Scrcpy -ArgumentList (@($Selector)+@(
        '--max-size=1280','--max-fps=30','--video-bit-rate=4M','--no-audio'
    )) -PassThru -NoNewWindow
}

& $Adb start-server 2>&1|Out-Null
if($LASTEXITCODE-ne0){Fail "ADB_START_FAILED exit=$LASTEXITCODE adb=$Adb"}
foreach($old in @(Get-Process scrcpy -ErrorAction SilentlyContinue)){
    Stop-Process -Id $old.Id -Force -ErrorAction SilentlyContinue
}

$ports=Read-Ports
$process=$null
$mode=$null
try{
    if($null-ne(Get-Usb)){
        [void](Prepare-Tcp)
        Set-Reverse @('-d') $ports
        $mode='usb'
        $process=Start-Scrcpy @('--select-usb')
        Write-Host "SCRCPY_LIVE transport=usb fallback=tcp adb=$Adb"
    }else{
        $endpoint=Connect-Tcp
        Set-Reverse @('-s',$endpoint) $ports
        $mode='tcp'
        $process=Start-Scrcpy @('--serial',$endpoint)
        Write-Host "SCRCPY_LIVE transport=tcp endpoint=$endpoint adb=$Adb"
    }

    while($true){
        Start-Sleep -Milliseconds 250
        if($mode-eq'usb'){
            if($null-eq(Get-Usb)){
                if(-not$process.HasExited){Stop-Process -Id $process.Id -Force -ErrorAction SilentlyContinue}
                $endpoint=Connect-Tcp
                Set-Reverse @('-s',$endpoint) $ports
                $process=Start-Scrcpy @('--serial',$endpoint)
                $mode='tcp'
                Write-Host "SCRCPY_FAILOVER transport=tcp endpoint=$endpoint"
            }elseif($process.HasExited){break}
        }else{
            if($null-ne(Get-Usb)){
                if(-not$process.HasExited){Stop-Process -Id $process.Id -Force -ErrorAction SilentlyContinue}
                Disconnect-Tcp
                [void](Prepare-Tcp)
                Set-Reverse @('-d') $ports
                $process=Start-Scrcpy @('--select-usb')
                $mode='usb'
                Write-Host 'SCRCPY_FAILBACK transport=usb'
            }elseif($process.HasExited){break}
        }
    }
}finally{
    if($process-and-not$process.HasExited){Stop-Process -Id $process.Id -Force -ErrorAction SilentlyContinue}
}
