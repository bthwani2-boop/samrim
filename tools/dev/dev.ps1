#Requires -Version 7.4
param(
    [Parameter(Position=0)]
    [ValidateSet('daily','client','partner','captain','field','control','scr','up','down','status')]
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
    if(-not(Test-Path -LiteralPath $EnvPath -PathType Leaf)){
        Fail 'LOCAL_ENV_MISSING copy=infra/local/.env.example->infra/local/.env'
    }

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

function Active-Ports{
    return @([Net.NetworkInformation.IPGlobalProperties]::GetIPGlobalProperties().GetActiveTcpListeners()|ForEach-Object Port)
}

function Has-Port([int]$Port){
    return (Active-Ports)-contains$Port
}

$Map=Read-Env
$Identity=Port $Map 'SAMRIM_IDENTITY_PORT'
$Dsh=Port $Map 'SAMRIM_DSH_PORT'
$Mailpit=Port $Map 'SAMRIM_MAILPIT_WEB_PORT'
$Control=Port $Map 'SAMRIM_CONTROL_PORT'
$Metro=@{
    client=Port $Map 'SAMRIM_APP_CLIENT_METRO_PORT'
    partner=Port $Map 'SAMRIM_APP_PARTNER_METRO_PORT'
    captain=Port $Map 'SAMRIM_APP_CAPTAIN_METRO_PORT'
    field=Port $Map 'SAMRIM_APP_FIELD_METRO_PORT'
}

function Compose([string[]]$Arguments){
    & docker compose --ansi never --project-name $Project --env-file $EnvPath -f $ComposePath @Arguments
    if($LASTEXITCODE-ne0){Fail "DOCKER_COMPOSE_FAILED args=$($Arguments-join' ')"}
}

function Ensure-Backend{
    $active=Active-Ports
    $missing=@(@($Identity,$Dsh,$Mailpit)|Where-Object{$active-notcontains$_})
    if($missing.Count-eq0){return 'reused'}

    Compose @('up','-d','--wait','--wait-timeout','300','--remove-orphans')
    return 'started'
}

function Dependencies-Ready{
    foreach($name in @('client','partner','captain','field')){
        $package=Join-Path $Root "apps\app-$name\node_modules\expo\package.json"
        if(-not(Test-Path -LiteralPath $package -PathType Leaf)){return $false}
    }

    $nextPackage=Join-Path $Root 'apps\control-panel\node_modules\next\package.json'
    return Test-Path -LiteralPath $nextPackage -PathType Leaf
}

function Ensure-Dependencies{
    if(Dependencies-Ready){return 'reused'}

    & pnpm install --frozen-lockfile --prefer-offline
    if($LASTEXITCODE-ne0){Fail "PNPM_INSTALL_FAILED exit=$LASTEXITCODE"}

    if(-not(Dependencies-Ready)){Fail 'DEPENDENCIES_NOT_MATERIALIZED_AFTER_INSTALL'}
    return 'materialized'
}

function Set-Host-Environment{
    $env:BTHWANI_ENV='development'
    $env:EXPO_OFFLINE='1'
    $env:EXPO_NO_QR_CODE='1'
    $env:EXPO_NO_TYPESCRIPT_SETUP='1'
    $env:EXPO_NO_METRO_WORKSPACE_ROOT='1'
    $env:EXPO_PUBLIC_IDENTITY_API_URL=Need $Map 'EXPO_PUBLIC_IDENTITY_API_URL'
    $env:EXPO_PUBLIC_DSH_API_URL=Need $Map 'EXPO_PUBLIC_DSH_API_URL'
    $env:NEXT_TELEMETRY_DISABLED='1'
    $env:CONTROL_PANEL_PUBLIC_ORIGIN=Need $Map 'CONTROL_PANEL_PUBLIC_ORIGIN'
    $env:IDENTITY_API_BASE_URL=Need $Map 'IDENTITY_API_BASE_URL'
    $env:DSH_API_BASE_URL=Need $Map 'DSH_API_BASE_URL'
    $env:CONTROL_PANEL_SERVICE_TOKEN=Need $Map 'CONTROL_PANEL_SERVICE_TOKEN'

    if([string]$env:NODE_OPTIONS-notmatch'(?:^|\s)--dns-result-order=ipv4first(?:\s|$)'){
        $env:NODE_OPTIONS=((([string]$env:NODE_OPTIONS)+' --dns-result-order=ipv4first').Trim())
    }
}

function Read-AdbDevices{
    $output=@(adb devices 2>&1)
    if($LASTEXITCODE-ne0){Fail "ADB_FAILED args=devices exit=$LASTEXITCODE"}

    return @(
        foreach($line in $output){
            if($line-match'^(?<serial>\S+)\s+device(?:\s|$)'){
                [pscustomobject]@{
                    Serial=$Matches.serial
                    IsTcp=($Matches.serial-match':\d+$')
                }
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

function Get-TcpSerials{
    return @(
        Read-AdbDevices|
            Where-Object{$_.IsTcp}|
            ForEach-Object{[string]$_.Serial}
    )
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
        if($line-match'\bsrc\s+(?<ip>(?:\d{1,3}\.){3}\d{1,3})\b'){
            return $Matches.ip
        }
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
    if($LASTEXITCODE-ne0-or([string]$state).Trim()-ne'device'){
        Fail "ADB_TCP_UNAVAILABLE endpoint=$endpoint"
    }

    return $endpoint
}

function Get-AdbSelector{
    if($null-ne(Get-UsbSerial)){
        Disconnect-TcpDevices
        return @('-d')
    }

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

function Metro-Ready([int]$Port){
    if(-not(Has-Port $Port)){return $false}

    $client=[Net.Http.HttpClient]::new()
    $client.Timeout=[TimeSpan]::FromMilliseconds(250)
    try{
        return $client.GetStringAsync("http://127.0.0.1:$Port/status").GetAwaiter().GetResult().Trim()-eq'packager-status:running'
    }catch{
        return $false
    }finally{
        $client.Dispose()
    }
}

function Start-Node([string]$WorkingDirectory,[string]$Cli,[string[]]$Arguments){
    return Start-Process -FilePath 'node' -ArgumentList (@($Cli)+$Arguments) -WorkingDirectory $WorkingDirectory -WindowStyle Hidden -PassThru
}

function Get-OwnedNodeTreeRoot([int]$ProcessId,[string]$Surface,[int]$Port){
    $current=Get-CimInstance Win32_Process -Filter "ProcessId=$ProcessId" -ErrorAction SilentlyContinue
    if($null-eq$current){return $null}

    $command=[string]$current.CommandLine
    if($current.Name-notmatch'^node(\.exe)?

function Start-MobileServer([string]$Name,[switch]$Foreground){
    $port=[int]$Metro[$Name]

    if($Foreground-and(Has-Port $port)){
        Stop-OwnedListener -Port $port -Surface $Name
    }elseif(-not$Foreground-and(Metro-Ready $port)){
        return [pscustomobject]@{Name=$Name;Port=$port;State='reused';Process=$null}
    }elseif(Has-Port $port){
        Fail "PORT_IN_USE surface=$Name port=$port"
    }

    $AppRoot=Join-Path $Root "apps\app-$Name"
    $expoPackage=Join-Path $AppRoot 'node_modules\expo\package.json'
    if(-not(Test-Path -LiteralPath $expoPackage -PathType Leaf)){Fail "EXPO_NOT_MATERIALIZED app=app-$Name run=pnpm_bootstrap"}
    $expo=Join-Path (Split-Path -Parent $expoPackage) 'bin\cli'
    $arguments=@('start','--dev-client','--localhost','--port',"$port")

    if($Foreground){
        Write-Host "MOBILE_LIVE app=app-$Name port=$port fast_refresh=on open=manual"
        Push-Location $AppRoot
        try{
            & node $expo @arguments
            $code=$LASTEXITCODE
        }finally{
            Pop-Location
        }

        if($code-ne0-and$code-ne130){Fail "METRO_EXITED app=app-$Name exit=$code"}
        return
    }

    $process=Start-Node $AppRoot $expo $arguments
    return [pscustomobject]@{Name=$Name;Port=$port;State='started';Process=$process}
}

function Start-ControlServer([switch]$Foreground){
    if($Foreground-and(Has-Port $Control)){
        Stop-OwnedListener -Port $Control -Surface 'control'
    }elseif(-not$Foreground-and(Has-Port $Control)){
        return [pscustomobject]@{Name='control';Port=$Control;State='reused';Process=$null}
    }

    $ControlRoot=Join-Path $Root 'apps\control-panel'
    $nextPackage=Join-Path $ControlRoot 'node_modules\next\package.json'
    if(-not(Test-Path -LiteralPath $nextPackage -PathType Leaf)){Fail 'NEXT_NOT_MATERIALIZED run=pnpm_bootstrap'}
    $next=Join-Path (Split-Path -Parent $nextPackage) 'dist\bin\next'
    $arguments=@('dev','-H','127.0.0.1','-p',"$Control")

    if($Foreground){
        Write-Host "CONTROL_LIVE port=$Control hmr=on url=$(Need $Map 'CONTROL_PANEL_PUBLIC_ORIGIN')"
        Push-Location $ControlRoot
        try{
            & node $next @arguments
            $code=$LASTEXITCODE
        }finally{
            Pop-Location
        }

        if($code-ne0-and$code-ne130){Fail "CONTROL_EXITED exit=$code"}
        return
    }

    $process=Start-Node $ControlRoot $next $arguments
    return [pscustomobject]@{Name='control';Port=$Control;State='started';Process=$process}
}

function Wait-Servers([object[]]$Servers){
    $clock=[Diagnostics.Stopwatch]::StartNew()

    do{
        $missing=@()

        foreach($server in $Servers){
            if($null-ne$server.Process-and$server.Process.HasExited){
                Fail "HOST_PROCESS_EXITED surface=$($server.Name) exit=$($server.Process.ExitCode)"
            }

            $ready=if($server.Name-eq'control'){
                Has-Port ([int]$server.Port)
            }else{
                Metro-Ready ([int]$server.Port)
            }

            if(-not$ready){$missing+=$server.Name}
        }

        if($missing.Count-eq0){return}
        Start-Sleep -Milliseconds 100
    }while($clock.ElapsedMilliseconds-lt30000)

    Fail "HOST_READY_TIMEOUT missing=$($missing-join',') timeout_ms=30000"
}

function Ensure-HostServers{
    $servers=@(
        Start-MobileServer 'client'
        Start-MobileServer 'partner'
        Start-MobileServer 'captain'
        Start-MobileServer 'field'
        Start-ControlServer
    )

    Wait-Servers $servers

    $state=@{}
    foreach($server in $servers){$state[$server.Name]=$server.State}
    return $state
}

function Start-ScrcpyProcess([string[]]$Selector){
    $arguments=@($Selector)+@('--max-size=1280','--max-fps=30','--video-bit-rate=4M','--no-audio')
    return Start-Process -FilePath 'scrcpy' -ArgumentList $arguments -PassThru -NoNewWindow
}

function Ensure-Scrcpy{
    foreach($process in @(Get-Process scrcpy -ErrorAction SilentlyContinue)){
        Stop-Process -Id $process.Id -Force
    }

    $allReverse=@($Identity,$Dsh,$Metro.client,$Metro.partner,$Metro.captain,$Metro.field)

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
                if(-not$process.HasExited){Stop-Process -Id $process.Id -Force}
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
            if(-not$process.HasExited){Stop-Process -Id $process.Id -Force}
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

function Ensure-OneMobile([string]$Name){
    [void](Ensure-Dependencies)
    [void](Ensure-Backend)
    Set-Host-Environment
    Ensure-Reverse -Ports @($Identity,$Dsh,[int]$Metro[$Name])
    Start-MobileServer $Name -Foreground
}

function Ensure-ControlOnly{
    [void](Ensure-Dependencies)
    [void](Ensure-Backend)
    Set-Host-Environment
    Start-ControlServer -Foreground
}

function Stop-LocalHosts{
    foreach($port in @($Metro.client,$Metro.partner,$Metro.captain,$Metro.field,$Control)){
        if(Has-Port ([int]$port)){
            Stop-OwnedListener -Port ([int]$port) -Surface "port-$port"
        }
    }

    foreach($process in @(Get-Process scrcpy -ErrorAction SilentlyContinue)){
        Stop-Process -Id $process.Id -Force
    }

    Disconnect-TcpDevices
}

switch($Target){
    'up'{
        Write-Host "RUNTIME_UP=PASS state=$(Ensure-Backend)"
        return
    }
    'down'{
        Stop-LocalHosts
        Compose @('down','--remove-orphans')
        Write-Host 'RUNTIME_DOWN=PASS scope=all-local-dev'
        return
    }
    'status'{
        Compose @('ps','-a')
        return
    }
    'client'{Ensure-OneMobile 'client';return}
    'partner'{Ensure-OneMobile 'partner';return}
    'captain'{Ensure-OneMobile 'captain';return}
    'field'{Ensure-OneMobile 'field';return}
    'control'{Ensure-ControlOnly;return}
    'scr'{
        Write-Host "SCRCPY=PASS state=$(Ensure-Scrcpy)"
        return
    }
}

$total=[Diagnostics.Stopwatch]::StartNew()

$phase=[Diagnostics.Stopwatch]::StartNew()
$dependencyState=Ensure-Dependencies
$dependencyMs=$phase.ElapsedMilliseconds

$phase.Restart()
$backendState=Ensure-Backend
$backendMs=$phase.ElapsedMilliseconds

Set-Host-Environment

$phase.Restart()
$hostState=Ensure-HostServers
$hostMs=$phase.ElapsedMilliseconds

$total.Stop()

$started=@($hostState.GetEnumerator()|Where-Object Value -eq'started'|ForEach-Object Key|Sort-Object)
$reused=@($hostState.GetEnumerator()|Where-Object Value -eq'reused'|ForEach-Object Key|Sort-Object)

Write-Host "DEV_TIMING deps_ms=$dependencyMs backend_ms=$backendMs hosts_ms=$hostMs total_ms=$($total.ElapsedMilliseconds)"
Write-Host "DEV_STATE deps=$dependencyState backend=$backendState scrcpy=manual started=$($started-join',') reused=$($reused-join',')"
Write-Host "DEV_READY=PASS apps=manual-open live=fast-refresh control=hmr scrcpy=pnpm-scr root=$Root"
-or-not$command.Contains($Root,[StringComparison]::OrdinalIgnoreCase)){
        Fail "REFUSE_FOREIGN_PROCESS surface=$Surface port=$Port pid=$ProcessId"
    }

    $treeRoot=$current
    while($treeRoot.ParentProcessId-gt0){
        $parent=Get-CimInstance Win32_Process -Filter "ProcessId=$([int]$treeRoot.ParentProcessId)" -ErrorAction SilentlyContinue
        if($null-eq$parent){break}

        $parentCommand=[string]$parent.CommandLine
        if($parent.Name-notmatch'^node(\.exe)?

function Start-MobileServer([string]$Name,[switch]$Foreground){
    $port=[int]$Metro[$Name]

    if($Foreground-and(Has-Port $port)){
        Stop-OwnedListener -Port $port -Surface $Name
    }elseif(-not$Foreground-and(Metro-Ready $port)){
        return [pscustomobject]@{Name=$Name;Port=$port;State='reused';Process=$null}
    }elseif(Has-Port $port){
        Fail "PORT_IN_USE surface=$Name port=$port"
    }

    $AppRoot=Join-Path $Root "apps\app-$Name"
    $expoPackage=Join-Path $AppRoot 'node_modules\expo\package.json'
    if(-not(Test-Path -LiteralPath $expoPackage -PathType Leaf)){Fail "EXPO_NOT_MATERIALIZED app=app-$Name run=pnpm_bootstrap"}
    $expo=Join-Path (Split-Path -Parent $expoPackage) 'bin\cli'
    $arguments=@('start','--dev-client','--localhost','--port',"$port")

    if($Foreground){
        Write-Host "MOBILE_LIVE app=app-$Name port=$port fast_refresh=on open=manual"
        Push-Location $AppRoot
        try{
            & node $expo @arguments
            $code=$LASTEXITCODE
        }finally{
            Pop-Location
        }

        if($code-ne0-and$code-ne130){Fail "METRO_EXITED app=app-$Name exit=$code"}
        return
    }

    $process=Start-Node $AppRoot $expo $arguments
    return [pscustomobject]@{Name=$Name;Port=$port;State='started';Process=$process}
}

function Start-ControlServer([switch]$Foreground){
    if($Foreground-and(Has-Port $Control)){
        Stop-OwnedListener -Port $Control -Surface 'control'
    }elseif(-not$Foreground-and(Has-Port $Control)){
        return [pscustomobject]@{Name='control';Port=$Control;State='reused';Process=$null}
    }

    $ControlRoot=Join-Path $Root 'apps\control-panel'
    $nextPackage=Join-Path $ControlRoot 'node_modules\next\package.json'
    if(-not(Test-Path -LiteralPath $nextPackage -PathType Leaf)){Fail 'NEXT_NOT_MATERIALIZED run=pnpm_bootstrap'}
    $next=Join-Path (Split-Path -Parent $nextPackage) 'dist\bin\next'
    $arguments=@('dev','-H','127.0.0.1','-p',"$Control")

    if($Foreground){
        Write-Host "CONTROL_LIVE port=$Control hmr=on url=$(Need $Map 'CONTROL_PANEL_PUBLIC_ORIGIN')"
        Push-Location $ControlRoot
        try{
            & node $next @arguments
            $code=$LASTEXITCODE
        }finally{
            Pop-Location
        }

        if($code-ne0-and$code-ne130){Fail "CONTROL_EXITED exit=$code"}
        return
    }

    $process=Start-Node $ControlRoot $next $arguments
    return [pscustomobject]@{Name='control';Port=$Control;State='started';Process=$process}
}

function Wait-Servers([object[]]$Servers){
    $clock=[Diagnostics.Stopwatch]::StartNew()

    do{
        $missing=@()

        foreach($server in $Servers){
            if($null-ne$server.Process-and$server.Process.HasExited){
                Fail "HOST_PROCESS_EXITED surface=$($server.Name) exit=$($server.Process.ExitCode)"
            }

            $ready=if($server.Name-eq'control'){
                Has-Port ([int]$server.Port)
            }else{
                Metro-Ready ([int]$server.Port)
            }

            if(-not$ready){$missing+=$server.Name}
        }

        if($missing.Count-eq0){return}
        Start-Sleep -Milliseconds 100
    }while($clock.ElapsedMilliseconds-lt30000)

    Fail "HOST_READY_TIMEOUT missing=$($missing-join',') timeout_ms=30000"
}

function Ensure-HostServers{
    $servers=@(
        Start-MobileServer 'client'
        Start-MobileServer 'partner'
        Start-MobileServer 'captain'
        Start-MobileServer 'field'
        Start-ControlServer
    )

    Wait-Servers $servers

    $state=@{}
    foreach($server in $servers){$state[$server.Name]=$server.State}
    return $state
}

function Start-ScrcpyProcess([string[]]$Selector){
    $arguments=@($Selector)+@('--max-size=1280','--max-fps=30','--video-bit-rate=4M','--no-audio')
    return Start-Process -FilePath 'scrcpy' -ArgumentList $arguments -PassThru -NoNewWindow
}

function Ensure-Scrcpy{
    foreach($process in @(Get-Process scrcpy -ErrorAction SilentlyContinue)){
        Stop-Process -Id $process.Id -Force
    }

    $allReverse=@($Identity,$Dsh,$Metro.client,$Metro.partner,$Metro.captain,$Metro.field)

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
                if(-not$process.HasExited){Stop-Process -Id $process.Id -Force}
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
            if(-not$process.HasExited){Stop-Process -Id $process.Id -Force}
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

function Ensure-OneMobile([string]$Name){
    [void](Ensure-Dependencies)
    [void](Ensure-Backend)
    Set-Host-Environment
    Ensure-Reverse -Ports @($Identity,$Dsh,[int]$Metro[$Name])
    Start-MobileServer $Name -Foreground
}

function Ensure-ControlOnly{
    [void](Ensure-Dependencies)
    [void](Ensure-Backend)
    Set-Host-Environment
    Start-ControlServer -Foreground
}

function Stop-LocalHosts{
    foreach($port in @($Metro.client,$Metro.partner,$Metro.captain,$Metro.field,$Control)){
        if(Has-Port ([int]$port)){
            Stop-OwnedListener -Port ([int]$port) -Surface "port-$port"
        }
    }

    foreach($process in @(Get-Process scrcpy -ErrorAction SilentlyContinue)){
        Stop-Process -Id $process.Id -Force
    }

    Disconnect-TcpDevices
}

switch($Target){
    'up'{
        Write-Host "RUNTIME_UP=PASS state=$(Ensure-Backend)"
        return
    }
    'down'{
        Stop-LocalHosts
        Compose @('down','--remove-orphans')
        Write-Host 'RUNTIME_DOWN=PASS scope=all-local-dev'
        return
    }
    'status'{
        Compose @('ps','-a')
        return
    }
    'client'{Ensure-OneMobile 'client';return}
    'partner'{Ensure-OneMobile 'partner';return}
    'captain'{Ensure-OneMobile 'captain';return}
    'field'{Ensure-OneMobile 'field';return}
    'control'{Ensure-ControlOnly;return}
    'scr'{
        Write-Host "SCRCPY=PASS state=$(Ensure-Scrcpy)"
        return
    }
}

$total=[Diagnostics.Stopwatch]::StartNew()

$phase=[Diagnostics.Stopwatch]::StartNew()
$dependencyState=Ensure-Dependencies
$dependencyMs=$phase.ElapsedMilliseconds

$phase.Restart()
$backendState=Ensure-Backend
$backendMs=$phase.ElapsedMilliseconds

Set-Host-Environment

$phase.Restart()
$hostState=Ensure-HostServers
$hostMs=$phase.ElapsedMilliseconds

$total.Stop()

$started=@($hostState.GetEnumerator()|Where-Object Value -eq'started'|ForEach-Object Key|Sort-Object)
$reused=@($hostState.GetEnumerator()|Where-Object Value -eq'reused'|ForEach-Object Key|Sort-Object)

Write-Host "DEV_TIMING deps_ms=$dependencyMs backend_ms=$backendMs hosts_ms=$hostMs total_ms=$($total.ElapsedMilliseconds)"
Write-Host "DEV_STATE deps=$dependencyState backend=$backendState scrcpy=manual started=$($started-join',') reused=$($reused-join',')"
Write-Host "DEV_READY=PASS apps=manual-open live=fast-refresh control=hmr scrcpy=pnpm-scr root=$Root"
-or-not$parentCommand.Contains($Root,[StringComparison]::OrdinalIgnoreCase)){
            break
        }

        $treeRoot=$parent
    }

    return [int]$treeRoot.ProcessId
}

function Stop-OwnedListener([int]$Port,[string]$Surface){
    $clock=[Diagnostics.Stopwatch]::StartNew()

    do{
        $listeners=@(Get-NetTCPConnection -State Listen -LocalPort $Port -ErrorAction SilentlyContinue)
        if($listeners.Count-eq0){return}

        $treeRoots=@()
        foreach($listener in $listeners){
            $treeRoot=Get-OwnedNodeTreeRoot -ProcessId ([int]$listener.OwningProcess) -Surface $Surface -Port $Port
            if($null-ne$treeRoot){$treeRoots+=[int]$treeRoot}
        }

        foreach($treeRoot in @($treeRoots|Sort-Object -Unique)){
            Write-Host "STALE_RUNTIME_CLEANUP surface=$Surface port=$Port pid=$treeRoot"
            & taskkill.exe /PID "$treeRoot" /T /F 2>&1|Out-Null
            if($LASTEXITCODE-ne0-and(Has-Port $Port)){
                Fail "PROCESS_TREE_STOP_FAILED surface=$Surface port=$Port pid=$treeRoot exit=$LASTEXITCODE"
            }
        }

        Start-Sleep -Milliseconds 100
    }while($clock.ElapsedMilliseconds-lt5000)

    if(Has-Port $Port){Fail "PORT_RELEASE_TIMEOUT surface=$Surface port=$Port"}
}

function Start-MobileServer([string]$Name,[switch]$Foreground){
    $port=[int]$Metro[$Name]

    if($Foreground-and(Has-Port $port)){
        Stop-OwnedListener -Port $port -Surface $Name
    }elseif(-not$Foreground-and(Metro-Ready $port)){
        return [pscustomobject]@{Name=$Name;Port=$port;State='reused';Process=$null}
    }elseif(Has-Port $port){
        Fail "PORT_IN_USE surface=$Name port=$port"
    }

    $AppRoot=Join-Path $Root "apps\app-$Name"
    $expoPackage=Join-Path $AppRoot 'node_modules\expo\package.json'
    if(-not(Test-Path -LiteralPath $expoPackage -PathType Leaf)){Fail "EXPO_NOT_MATERIALIZED app=app-$Name run=pnpm_bootstrap"}
    $expo=Join-Path (Split-Path -Parent $expoPackage) 'bin\cli'
    $arguments=@('start','--dev-client','--localhost','--port',"$port")

    if($Foreground){
        Write-Host "MOBILE_LIVE app=app-$Name port=$port fast_refresh=on open=manual"
        Push-Location $AppRoot
        try{
            & node $expo @arguments
            $code=$LASTEXITCODE
        }finally{
            Pop-Location
        }

        if($code-ne0-and$code-ne130){Fail "METRO_EXITED app=app-$Name exit=$code"}
        return
    }

    $process=Start-Node $AppRoot $expo $arguments
    return [pscustomobject]@{Name=$Name;Port=$port;State='started';Process=$process}
}

function Start-ControlServer([switch]$Foreground){
    if($Foreground-and(Has-Port $Control)){
        Stop-OwnedListener -Port $Control -Surface 'control'
    }elseif(-not$Foreground-and(Has-Port $Control)){
        return [pscustomobject]@{Name='control';Port=$Control;State='reused';Process=$null}
    }

    $ControlRoot=Join-Path $Root 'apps\control-panel'
    $nextPackage=Join-Path $ControlRoot 'node_modules\next\package.json'
    if(-not(Test-Path -LiteralPath $nextPackage -PathType Leaf)){Fail 'NEXT_NOT_MATERIALIZED run=pnpm_bootstrap'}
    $next=Join-Path (Split-Path -Parent $nextPackage) 'dist\bin\next'
    $arguments=@('dev','-H','127.0.0.1','-p',"$Control")

    if($Foreground){
        Write-Host "CONTROL_LIVE port=$Control hmr=on url=$(Need $Map 'CONTROL_PANEL_PUBLIC_ORIGIN')"
        Push-Location $ControlRoot
        try{
            & node $next @arguments
            $code=$LASTEXITCODE
        }finally{
            Pop-Location
        }

        if($code-ne0-and$code-ne130){Fail "CONTROL_EXITED exit=$code"}
        return
    }

    $process=Start-Node $ControlRoot $next $arguments
    return [pscustomobject]@{Name='control';Port=$Control;State='started';Process=$process}
}

function Wait-Servers([object[]]$Servers){
    $clock=[Diagnostics.Stopwatch]::StartNew()

    do{
        $missing=@()

        foreach($server in $Servers){
            if($null-ne$server.Process-and$server.Process.HasExited){
                Fail "HOST_PROCESS_EXITED surface=$($server.Name) exit=$($server.Process.ExitCode)"
            }

            $ready=if($server.Name-eq'control'){
                Has-Port ([int]$server.Port)
            }else{
                Metro-Ready ([int]$server.Port)
            }

            if(-not$ready){$missing+=$server.Name}
        }

        if($missing.Count-eq0){return}
        Start-Sleep -Milliseconds 100
    }while($clock.ElapsedMilliseconds-lt30000)

    Fail "HOST_READY_TIMEOUT missing=$($missing-join',') timeout_ms=30000"
}

function Ensure-HostServers{
    $servers=@(
        Start-MobileServer 'client'
        Start-MobileServer 'partner'
        Start-MobileServer 'captain'
        Start-MobileServer 'field'
        Start-ControlServer
    )

    Wait-Servers $servers

    $state=@{}
    foreach($server in $servers){$state[$server.Name]=$server.State}
    return $state
}

function Start-ScrcpyProcess([string[]]$Selector){
    $arguments=@($Selector)+@('--max-size=1280','--max-fps=30','--video-bit-rate=4M','--no-audio')
    return Start-Process -FilePath 'scrcpy' -ArgumentList $arguments -PassThru -NoNewWindow
}

function Ensure-Scrcpy{
    foreach($process in @(Get-Process scrcpy -ErrorAction SilentlyContinue)){
        Stop-Process -Id $process.Id -Force
    }

    $allReverse=@($Identity,$Dsh,$Metro.client,$Metro.partner,$Metro.captain,$Metro.field)

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
                if(-not$process.HasExited){Stop-Process -Id $process.Id -Force}
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
            if(-not$process.HasExited){Stop-Process -Id $process.Id -Force}
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

function Ensure-OneMobile([string]$Name){
    [void](Ensure-Dependencies)
    [void](Ensure-Backend)
    Set-Host-Environment
    Ensure-Reverse -Ports @($Identity,$Dsh,[int]$Metro[$Name])
    Start-MobileServer $Name -Foreground
}

function Ensure-ControlOnly{
    [void](Ensure-Dependencies)
    [void](Ensure-Backend)
    Set-Host-Environment
    Start-ControlServer -Foreground
}

function Stop-LocalHosts{
    foreach($port in @($Metro.client,$Metro.partner,$Metro.captain,$Metro.field,$Control)){
        if(Has-Port ([int]$port)){
            Stop-OwnedListener -Port ([int]$port) -Surface "port-$port"
        }
    }

    foreach($process in @(Get-Process scrcpy -ErrorAction SilentlyContinue)){
        Stop-Process -Id $process.Id -Force
    }

    Disconnect-TcpDevices
}

switch($Target){
    'up'{
        Write-Host "RUNTIME_UP=PASS state=$(Ensure-Backend)"
        return
    }
    'down'{
        Stop-LocalHosts
        Compose @('down','--remove-orphans')
        Write-Host 'RUNTIME_DOWN=PASS scope=all-local-dev'
        return
    }
    'status'{
        Compose @('ps','-a')
        return
    }
    'client'{Ensure-OneMobile 'client';return}
    'partner'{Ensure-OneMobile 'partner';return}
    'captain'{Ensure-OneMobile 'captain';return}
    'field'{Ensure-OneMobile 'field';return}
    'control'{Ensure-ControlOnly;return}
    'scr'{
        Write-Host "SCRCPY=PASS state=$(Ensure-Scrcpy)"
        return
    }
}

$total=[Diagnostics.Stopwatch]::StartNew()

$phase=[Diagnostics.Stopwatch]::StartNew()
$dependencyState=Ensure-Dependencies
$dependencyMs=$phase.ElapsedMilliseconds

$phase.Restart()
$backendState=Ensure-Backend
$backendMs=$phase.ElapsedMilliseconds

Set-Host-Environment

$phase.Restart()
$hostState=Ensure-HostServers
$hostMs=$phase.ElapsedMilliseconds

$total.Stop()

$started=@($hostState.GetEnumerator()|Where-Object Value -eq'started'|ForEach-Object Key|Sort-Object)
$reused=@($hostState.GetEnumerator()|Where-Object Value -eq'reused'|ForEach-Object Key|Sort-Object)

Write-Host "DEV_TIMING deps_ms=$dependencyMs backend_ms=$backendMs hosts_ms=$hostMs total_ms=$($total.ElapsedMilliseconds)"
Write-Host "DEV_STATE deps=$dependencyState backend=$backendState scrcpy=manual started=$($started-join',') reused=$($reused-join',')"
Write-Host "DEV_READY=PASS apps=manual-open live=fast-refresh control=hmr scrcpy=pnpm-scr root=$Root"
