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
$Tools=@{}
Set-Location $Root

function Fail([string]$Message){throw $Message}

function Tool([string]$Name){
    if($Tools.ContainsKey($Name)){return $Tools[$Name]}
    $cmd=Get-Command $Name -CommandType Application -ErrorAction SilentlyContinue|Select-Object -First 1
    if($null-eq$cmd){Fail "TOOL_NOT_FOUND name=$Name"}
    $Tools[$Name]=$cmd.Source
    return $cmd.Source
}

function Run([string]$File,[string[]]$Arguments,[int]$TimeoutMs=10000){
    $start=[Diagnostics.ProcessStartInfo]::new()
    $start.FileName=$File
    $start.WorkingDirectory=$Root
    $start.UseShellExecute=$false
    $start.RedirectStandardOutput=$true
    $start.RedirectStandardError=$true
    foreach($argument in $Arguments){$start.ArgumentList.Add($argument)}

    $p=[Diagnostics.Process]::new()
    $p.StartInfo=$start
    if(-not$p.Start()){Fail "PROCESS_START_FAILED file=$File"}

    $stdout=$p.StandardOutput.ReadToEndAsync()
    $stderr=$p.StandardError.ReadToEndAsync()

    if(-not$p.WaitForExit($TimeoutMs)){
        try{$p.Kill($true)}catch{}
        Fail "PROCESS_TIMEOUT file=$File timeout_ms=$TimeoutMs"
    }

    $out=$stdout.GetAwaiter().GetResult()
    $err=$stderr.GetAwaiter().GetResult()
    if($p.ExitCode-ne0){
        Fail "PROCESS_FAILED file=$File exit=$($p.ExitCode) detail=$(($out+' '+$err).Trim())"
    }
    return $out.Trim()
}

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

function Wait-Ports([int[]]$Ports,[int]$TimeoutMs=15000){
    $clock=[Diagnostics.Stopwatch]::StartNew()
    do{
        $active=Active-Ports
        $missing=@($Ports|Where-Object{$active-notcontains$_})
        if($missing.Count-eq0){return}
        Start-Sleep -Milliseconds 100
    }while($clock.ElapsedMilliseconds-lt$TimeoutMs)
    Fail "PORT_READY_TIMEOUT missing=$($missing-join',') timeout_ms=$TimeoutMs"
}

function Compose-Args([string[]]$Arguments){
    return @('compose','--ansi','never','--project-name',$Project,'--env-file',$EnvPath,'-f',$ComposePath)+$Arguments
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

function Ensure-Backend{
    $required=@($Identity,$Dsh,$Mailpit)
    $active=Active-Ports
    if(@($required|Where-Object{$active-notcontains$_}).Count-eq0){return 'reused'}

    [void](Run (Tool 'docker') (Compose-Args @('up','-d','--wait','--wait-timeout','300','--remove-orphans')) 300000)
    return 'started'
}

function Ensure-Adb([int[]]$Ports){
    $adb=Tool 'adb'
    [void](Run $adb @('start-server') 5000)
    $existing=@((Run $adb @('reverse','--list') 5000)-split"\r?\n"|Where-Object{$_})

    foreach($port in @($Ports|Sort-Object -Unique)){
        if(@($existing|Where-Object{$_-match"(^|\s)tcp:$port\s+tcp:$port($|\s)"}).Count-gt0){continue}
        [void](Run $adb @('reverse',"tcp:$port","tcp:$port") 5000)
    }
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

function Start-HiddenNode([string]$WorkingDirectory,[string]$Cli,[string[]]$Arguments){
    Start-Process -FilePath (Tool 'node') -ArgumentList (@($Cli)+$Arguments) -WorkingDirectory $WorkingDirectory -WindowStyle Hidden|Out-Null
}

function Metro-Ready([int]$Port){
    if(-not(Has-Port $Port)){return $false}
    $client=[Net.Http.HttpClient]::new()
    $client.Timeout=[TimeSpan]::FromMilliseconds(300)
    try{
        return $client.GetStringAsync("http://127.0.0.1:$Port/status").GetAwaiter().GetResult().Trim()-eq'packager-status:running'
    }catch{
        return $false
    }finally{
        $client.Dispose()
    }
}

function Clear-Stale-Node([int]$Port){
    foreach($listener in @(Get-NetTCPConnection -State Listen -LocalPort $Port -ErrorAction SilentlyContinue)){
        $ownerProcessId=[int]$listener.OwningProcess
        $process=Get-Process -Id $ownerProcessId -ErrorAction SilentlyContinue
        if($null-eq$process-or$process.ProcessName-ne'node'){Fail "PORT_IN_USE port=$Port pid=$ownerProcessId"}
        Stop-Process -Id $ownerProcessId -Force
    }
    Start-Sleep -Milliseconds 150
    if(Has-Port $Port){Fail "PORT_STILL_IN_USE port=$Port"}
}

function Start-Metro([string]$Name){
    $port=[int]$Metro[$Name]
    if(Metro-Ready $port){return 'reused'}
    if(Has-Port $port){Clear-Stale-Node $port}

    $root=Join-Path $Root "apps\app-$Name"
    $expo=Join-Path $root 'node_modules\expo\bin\cli'
    if(-not(Test-Path -LiteralPath $expo -PathType Leaf)){Fail "EXPO_NOT_INSTALLED app=app-$Name run=pnpm_install"}

    Start-HiddenNode $root $expo @('start','--dev-client','--localhost','--port',"$port")
    return 'started'
}

function Start-Control{
    if(Has-Port $Control){return 'reused'}

    $root=Join-Path $Root 'apps\control-panel'
    $next=Join-Path $root 'node_modules\next\dist\bin\next'
    if(-not(Test-Path -LiteralPath $next -PathType Leaf)){Fail 'NEXT_NOT_INSTALLED run=pnpm_install'}

    Start-HiddenNode $root $next @('dev','-H','127.0.0.1','-p',"$Control")
    return 'started'
}

function Open-Mobile([string]$Name){
    $config=Get-Content -LiteralPath (Join-Path $Root "apps\app-$Name\mobile.config.json") -Raw|ConvertFrom-Json
    $port=[int]$Metro[$Name]
    $url="http://127.0.0.1:$port"
    $deep="$([string]$config.scheme)://expo-development-client/?url=$([Uri]::EscapeDataString($url))"

    [void](Run (Tool 'adb') @('shell','am','start','-a','android.intent.action.VIEW','-d',$deep,'-p',[string]$config.androidPackage) 5000)
}

function Ensure-Scrcpy{
    if(@(Get-Process scrcpy -ErrorAction SilentlyContinue).Count-gt0){return 'reused'}
    Start-Process -FilePath (Tool 'scrcpy') -ArgumentList @('--max-size=1280','--max-fps=30','--video-bit-rate=4M','--no-audio')|Out-Null
    return 'started'
}

function Ensure-One-Mobile([string]$Name){
    Set-Host-Environment
    Ensure-Adb @($Identity,$Dsh,[int]$Metro[$Name])
    $state=Start-Metro $Name
    Wait-Ports @([int]$Metro[$Name])
    if(-not(Metro-Ready ([int]$Metro[$Name]))){Fail "METRO_NOT_READY app=app-$Name"}
    Open-Mobile $Name
    Write-Host "APP=PASS app=app-$Name state=$state"
}

switch($Target){
    'up'{
        Write-Host "RUNTIME_UP=PASS state=$(Ensure-Backend)"
        return
    }
    'down'{
        [void](Run (Tool 'docker') (Compose-Args @('down','--remove-orphans')) 120000)
        Write-Host 'RUNTIME_DOWN=PASS'
        return
    }
    'status'{
        $out=Run (Tool 'docker') (Compose-Args @('ps','-a')) 15000
        if($out){Write-Host $out}
        return
    }
    'scr'{
        Ensure-Adb @()
        Write-Host "SCRCPY=PASS state=$(Ensure-Scrcpy)"
        return
    }
    'control'{
        Set-Host-Environment
        $state=Start-Control
        Wait-Ports @($Control)
        Write-Host "CONTROL=PASS state=$state url=$(Need $Map 'CONTROL_PANEL_PUBLIC_ORIGIN')"
        return
    }
    'client'{Ensure-One-Mobile 'client';return}
    'partner'{Ensure-One-Mobile 'partner';return}
    'captain'{Ensure-One-Mobile 'captain';return}
    'field'{Ensure-One-Mobile 'field';return}
}

$total=[Diagnostics.Stopwatch]::StartNew()

$phase=[Diagnostics.Stopwatch]::StartNew()
$backendState=Ensure-Backend
$dockerMs=$phase.ElapsedMilliseconds

$phase.Restart()
Ensure-Adb @($Identity,$Dsh)
$adbMs=$phase.ElapsedMilliseconds

$phase.Restart()
$scrcpyState=Ensure-Scrcpy
$scrcpyMs=$phase.ElapsedMilliseconds

$total.Stop()

Write-Host "DEV_TIMING docker_ms=$dockerMs adb_ms=$adbMs scrcpy_ms=$scrcpyMs total_ms=$($total.ElapsedMilliseconds)"
Write-Host "DEV_STATE backend=$backendState scrcpy=$scrcpyState"
Write-Host "DEV_READY=PASS root=$Root"
