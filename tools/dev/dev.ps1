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

function Reverse([int[]]$Ports){
    foreach($port in @($Ports|Sort-Object -Unique)){
        & adb -d reverse "tcp:$port" "tcp:$port"
        if($LASTEXITCODE-ne0){Fail "ADB_REVERSE_FAILED port=$port"}
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

function Set-App-Environment{
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

function Open-Mobile([string]$App,$Config,[int]$Port){
    Reverse @($Identity,$Dsh,$Port)

    $url="http://127.0.0.1:$Port"
    $deep="$([string]$Config.scheme)://expo-development-client/?url=$([Uri]::EscapeDataString($url))"
    $package=[string]$Config.androidPackage

    $launch=@(& adb -d shell am start -W -a android.intent.action.VIEW -d $deep -p $package 2>&1)
    if($LASTEXITCODE-ne0){
        Fail "APP_OPEN_FAILED app=$App detail=$(($launch-join' ').Trim())"
    }

    Start-Sleep -Milliseconds 300

    $appProcess=((& adb -d shell pidof $package 2>$null|Out-String).Trim())
    if($LASTEXITCODE-ne0-or[string]::IsNullOrWhiteSpace($appProcess)){
        $errors=@(
            & adb -d logcat -d -t 200 2>&1 |
            Select-String -Pattern 'AndroidRuntime|ReactNativeJS|ReactNative|FATAL EXCEPTION' |
            Select-Object -Last 40 |
            ForEach-Object{$_.Line}
        )
        Fail "APP_EXITED app=$App package=$package log=$($errors-join' | ')"
    }

    Write-Host "APP=PASS app=$App state=reused pid=$appProcess"
}

function Mobile([string]$Name){
    [void](Ensure-Backend)
    Set-App-Environment

    $app="app-$Name"
    $appRoot=Join-Path $Root "apps\$app"
    $config=Get-Content -LiteralPath (Join-Path $appRoot 'mobile.config.json') -Raw|ConvertFrom-Json
    $port=[int]$Metro[$Name]

    if(Metro-Ready $port){
        Open-Mobile $app $config $port
        return
    }

    if(Has-Port $port){Fail "PORT_IN_USE port=$port"}

    Reverse @($Identity,$Dsh)

    $expo=Join-Path $appRoot 'node_modules\expo\bin\cli'
    if(-not(Test-Path -LiteralPath $expo -PathType Leaf)){Fail "EXPO_NOT_INSTALLED app=$app run=pnpm_install"}

    Write-Host "APP_START app=$app live=fast-refresh"
    Set-Location $appRoot
    & node $expo start --dev-client --localhost --android --scheme ([string]$config.scheme) --port $port
    exit $LASTEXITCODE
}

switch($Target){
    'up'{
        Write-Host "RUNTIME_UP=PASS state=$(Ensure-Backend)"
        return
    }
    'down'{
        Compose @('down','--remove-orphans')
        Write-Host 'RUNTIME_DOWN=PASS'
        return
    }
    'status'{
        Compose @('ps','-a')
        return
    }
    'scr'{
        & scrcpy --max-size=1280 --max-fps=30 --video-bit-rate=4M --no-audio
        exit $LASTEXITCODE
    }
    'control'{
        [void](Ensure-Backend)
        Set-App-Environment

        if(Has-Port $Control){
            Write-Host "CONTROL=PASS state=reused url=$(Need $Map 'CONTROL_PANEL_PUBLIC_ORIGIN') live=hmr"
            return
        }

        $root=Join-Path $Root 'apps\control-panel'
        $next=Join-Path $root 'node_modules\next\dist\bin\next'
        if(-not(Test-Path -LiteralPath $next -PathType Leaf)){Fail 'NEXT_NOT_INSTALLED run=pnpm_install'}

        Write-Host "CONTROL_START url=$(Need $Map 'CONTROL_PANEL_PUBLIC_ORIGIN') live=hmr"
        Set-Location $root
        & node $next dev -H 127.0.0.1 -p $Control
        exit $LASTEXITCODE
    }
    'client'{Mobile 'client';return}
    'partner'{Mobile 'partner';return}
    'captain'{Mobile 'captain';return}
    'field'{Mobile 'field';return}
}

$total=[Diagnostics.Stopwatch]::StartNew()
$backendState=Ensure-Backend
$total.Stop()

Write-Host "DEV_TIMING backend_ms=$($total.ElapsedMilliseconds) total_ms=$($total.ElapsedMilliseconds)"
Write-Host "DEV_STATE backend=$backendState"
Write-Host "DEV_READY=PASS root=$Root"
