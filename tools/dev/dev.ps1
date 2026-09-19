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

function Invoke-Adb([string[]]$Arguments){
    & adb -d @Arguments
    if($LASTEXITCODE-ne0){Fail "ADB_FAILED args=$($Arguments-join' ') exit=$LASTEXITCODE"}
}

function Ensure-Reverse([int[]]$Ports){
    $existing=@(adb -d reverse --list 2>&1)
    if($LASTEXITCODE-ne0){Fail "ADB_FAILED args=reverse --list exit=$LASTEXITCODE"}

    foreach($port in @($Ports|Sort-Object -Unique)){
        if(@($existing|Where-Object{$_-match"\btcp:$port\s+tcp:$port\b"}).Count-gt0){continue}
        Invoke-Adb @('reverse',"tcp:$port","tcp:$port")
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

function Start-MobileServer([string]$Name){
    $port=[int]$Metro[$Name]

    if(Metro-Ready $port){
        return [pscustomobject]@{Name=$Name;Port=$port;State='reused';Process=$null}
    }
    if(Has-Port $port){Fail "PORT_IN_USE surface=$Name port=$port"}

    $AppRoot=Join-Path $Root "apps\app-$Name"
    $expoPackage=Join-Path $AppRoot 'node_modules\expo\package.json'
    if(-not(Test-Path -LiteralPath $expoPackage -PathType Leaf)){Fail "EXPO_NOT_MATERIALIZED app=app-$Name run=pnpm_bootstrap"}
    $expo=Join-Path (Split-Path -Parent $expoPackage) 'bin\cli'

    $process=Start-Node $AppRoot $expo @('start','--dev-client','--localhost','--port',"$port")
    return [pscustomobject]@{Name=$Name;Port=$port;State='started';Process=$process}
}

function Start-ControlServer{
    if(Has-Port $Control){
        return [pscustomobject]@{Name='control';Port=$Control;State='reused';Process=$null}
    }

    $ControlRoot=Join-Path $Root 'apps\control-panel'
    $nextPackage=Join-Path $ControlRoot 'node_modules\next\package.json'
    if(-not(Test-Path -LiteralPath $nextPackage -PathType Leaf)){Fail 'NEXT_NOT_MATERIALIZED run=pnpm_bootstrap'}
    $next=Join-Path (Split-Path -Parent $nextPackage) 'dist\bin\next'

    $process=Start-Node $ControlRoot $next @('dev','-H','127.0.0.1','-p',"$Control")
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

function Ensure-Scrcpy{
    if(@(Get-Process scrcpy -ErrorAction SilentlyContinue).Count-gt0){return 'reused'}

    Start-Process -FilePath 'scrcpy' -ArgumentList @('--max-size=1280','--max-fps=30','--video-bit-rate=4M','--no-audio')|Out-Null
    return 'started'
}

function Ensure-OneMobile([string]$Name){
    [void](Ensure-Dependencies)
    [void](Ensure-Backend)
    Set-Host-Environment
    Ensure-Reverse -Ports @($Identity,$Dsh,[int]$Metro[$Name])

    $server=Start-MobileServer $Name
    Wait-Servers @($server)

    Write-Host "MOBILE_SERVER=PASS app=app-$Name state=$($server.State) live=fast-refresh open=manual"
}

function Ensure-ControlOnly{
    [void](Ensure-Dependencies)
    [void](Ensure-Backend)
    Set-Host-Environment

    $server=Start-ControlServer
    Wait-Servers @($server)

    Write-Host "CONTROL_SERVER=PASS state=$($server.State) live=hmr url=$(Need $Map 'CONTROL_PANEL_PUBLIC_ORIGIN')"
}

function Stop-LocalHosts{
    foreach($port in @($Metro.client,$Metro.partner,$Metro.captain,$Metro.field,$Control)){
        foreach($listener in @(Get-NetTCPConnection -State Listen -LocalPort $port -ErrorAction SilentlyContinue)){
            $ownerProcessId=[int]$listener.OwningProcess
            $process=Get-CimInstance Win32_Process -Filter "ProcessId=$ownerProcessId" -ErrorAction SilentlyContinue
            if($null-eq$process){continue}

            $command=[string]$process.CommandLine
            if($process.Name-notmatch'^node(\.exe)?$'-or-not$command.Contains($Root,[StringComparison]::OrdinalIgnoreCase)){
                Fail "REFUSE_FOREIGN_PROCESS port=$port pid=$ownerProcessId"
            }

            Stop-Process -Id $ownerProcessId -Force
        }
    }

    foreach($process in @(Get-Process scrcpy -ErrorAction SilentlyContinue)){
        Stop-Process -Id $process.Id -Force
    }
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

$phase.Restart()
Ensure-Reverse -Ports @($Identity,$Dsh,$Metro.client,$Metro.partner,$Metro.captain,$Metro.field)
$adbMs=$phase.ElapsedMilliseconds

Set-Host-Environment

$phase.Restart()
$hostState=Ensure-HostServers
$hostMs=$phase.ElapsedMilliseconds

$phase.Restart()
$scrcpyState=Ensure-Scrcpy
$scrcpyMs=$phase.ElapsedMilliseconds

$total.Stop()

$started=@($hostState.GetEnumerator()|Where-Object Value -eq'started'|ForEach-Object Key|Sort-Object)
$reused=@($hostState.GetEnumerator()|Where-Object Value -eq'reused'|ForEach-Object Key|Sort-Object)

Write-Host "DEV_TIMING deps_ms=$dependencyMs backend_ms=$backendMs adb_ms=$adbMs hosts_ms=$hostMs scrcpy_ms=$scrcpyMs total_ms=$($total.ElapsedMilliseconds)"
Write-Host "DEV_STATE deps=$dependencyState backend=$backendState scrcpy=$scrcpyState started=$($started-join',') reused=$($reused-join',')"
Write-Host "DEV_READY=PASS apps=manual-open live=fast-refresh control=hmr root=$Root"
