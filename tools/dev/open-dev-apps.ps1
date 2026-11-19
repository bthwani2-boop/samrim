#Requires -Version 7.0
<#
BThwani development presentation opener (Surface only).
Does not launch Expo/Next servers, create watchers, install APKs, or alter app data.
Called by the canonical tools/dev/dev.ps1 after app tasks and tunnels are ready.
#>
[CmdletBinding()]
param(
  [ValidateSet('Browser','Android','All')]
  [string]$Mode = 'All'
)
Set-StrictMode -Version Latest
$ErrorActionPreference='Stop'
$PSNativeCommandUseErrorActionPreference=$false
$surface='BTHWANI'
$device='R5CX14S4PZW'
$chrome='C:\Program Files\Google\Chrome\Application\chrome.exe'
$chromeProfile='Profile 1' # Chrome profile signed in as bthwani2@gmail.com (verified at launch)
$urls=@(
  'http://127.0.0.1:18101/',
  'http://127.0.0.1:18102/',
  'http://127.0.0.1:13000/'
)
$android=@(
  @{Name='customer'; Package='com.bthwani.customer'; Scheme='exp+customer'; Port=18101},
  @{Name='merchant'; Package='com.bthwani.merchant'; Scheme='exp+merchant'; Port=18102},
  @{Name='captain'; Package='com.bthwani.captain'; Scheme='exp+app-captain'; Port=18103}
)

function Report([string]$key,[string]$value) { Write-Output ($key+'='+$value) }
function Require([bool]$valid,[string]$why){if(-not $valid){throw ('BLOCKED '+$why)}}
function Probe([string]$url,[string]$accept='text/html') {
  $curl=Join-Path $env:WINDIR 'System32\curl.exe'
  Require (Test-Path -LiteralPath $curl -PathType Leaf) 'WINDOWS_CURL_MISSING'
  $response=@(& $curl '--silent' '--max-time' '7' '--output' 'NUL' '--write-out' '%{http_code}|%{content_type}' '--header' ('Accept: '+$accept) $url 2>$null)
  $exitCode=$LASTEXITCODE
  $parts=($response -join '').Trim().Split('|')
  return @{ Code=$(if($parts.Count){$parts[0]}else{'000'}); Mime=$(if($parts.Count -gt 1){$parts[1]}else{''}); Exit=$exitCode }
}
function Get-AppChromeWindow {
  Add-Type -AssemblyName UIAutomationClient
  Add-Type -AssemblyName UIAutomationTypes
  if(-not ('BthwaniChromeWindowLocator' -as [type])){
    Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
using System.Text;
public static class BthwaniChromeWindowLocator {
  public delegate bool Callback(IntPtr handle, IntPtr param);
  [DllImport("user32.dll")] public static extern bool EnumWindows(Callback callback, IntPtr parameter);
  [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr handle);
  [DllImport("user32.dll")] public static extern int GetClassName(IntPtr handle, StringBuilder result, int size);
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr handle, out uint processId);
}
'@
  }
  $handles=[Collections.Generic.List[IntPtr]]::new()
  $callback=[BthwaniChromeWindowLocator+Callback] {
    param([IntPtr]$h,[IntPtr]$lp)
    $class=[Text.StringBuilder]::new(80)
    [void][BthwaniChromeWindowLocator]::GetClassName($h,$class,80)
    if($class.ToString() -eq 'Chrome_WidgetWin_1' -and [BthwaniChromeWindowLocator]::IsWindowVisible($h)){
      [uint32]$chromeProcessId=0
      [void][BthwaniChromeWindowLocator]::GetWindowThreadProcessId($h,[ref]$chromeProcessId)
      if((Get-Process -Id $chromeProcessId -ErrorAction SilentlyContinue).ProcessName -eq 'chrome'){$handles.Add($h)}
    }
    return $true
  }
  [void][BthwaniChromeWindowLocator]::EnumWindows($callback,[IntPtr]::Zero)
  $condition=[Windows.Automation.PropertyCondition]::new(
    [Windows.Automation.AutomationElement]::ControlTypeProperty,
    [Windows.Automation.ControlType]::TabItem
  )
  foreach($handle in $handles){
    try {
      $window=[Windows.Automation.AutomationElement]::FromHandle($handle)
      $tabs=$window.FindAll([Windows.Automation.TreeScope]::Descendants,$condition)
      if($tabs.Count -ne 3){continue}
      $names=@($tabs | ForEach-Object {[string]$_.Current.Name})
      if(@($names | Where-Object {$_ -match 'بثواني|bthwani'}).Count -eq 3){return $handle.ToInt64()}
    } catch {}
  }
  return 0
}
function Open-Browser {
  Require (Test-Path -LiteralPath $chrome -PathType Leaf) 'GOOGLE_CHROME_MISSING'
  $statusUrls=@(
    'http://127.0.0.1:18101/status',
    'http://127.0.0.1:18102/status',
    'http://127.0.0.1:13000/'
  )
  for($i=0;$i -lt $statusUrls.Count;$i++){
    $state=Probe $statusUrls[$i]
    Require ($state.Exit -eq 0 -and $state.Code -eq '200') ('BROWSER_APP_NOT_READY '+$urls[$i])
  }
  $localState=Join-Path $env:LOCALAPPDATA 'Google\Chrome\User Data\Local State'
  Require (Test-Path -LiteralPath $localState -PathType Leaf) 'CHROME_PROFILE_METADATA_MISSING'
  $profiles=Get-Content -LiteralPath $localState -Raw | ConvertFrom-Json
  $selectedProfile=$profiles.profile.info_cache.PSObject.Properties[$chromeProfile]
  Require ($null -ne $selectedProfile -and [string]$selectedProfile.Value.user_name -ieq 'bthwani2@gmail.com') 'CHROME_ACCOUNT_PROFILE_MISMATCH'
  # Reuse the existing three-tab app window, if present; do not create duplicates.
  $existingWindow=Get-AppChromeWindow
  if($existingWindow -ne 0){
    Report 'CHROME_APPS' ('PASS already_open window='+$existingWindow+' profile='+$chromeProfile+' tabs=customer,merchant,control-panel')
    return
  }
  # All three URLs are passed to ONE Chrome invocation: one window, three tabs.
  # Other Chrome windows and profiles are left untouched.
  $profileArg='--profile-directory="' + $chromeProfile + '"'
  $null=Start-Process -FilePath $chrome -ArgumentList (@($profileArg,'--new-window','--no-first-run')+$urls) -PassThru -ErrorAction Stop
  Start-Sleep -Seconds 2
  $actualWindow=Get-AppChromeWindow
  Require ($actualWindow -ne 0) 'CHROME_ONE_WINDOW_THREE_APP_TABS_NOT_PROVEN'
  Report 'CHROME_APPS' ('PASS opened_window='+$actualWindow+' profile='+$chromeProfile+' tabs=customer,merchant,control-panel')
  Report 'BROWSER_VISUAL' 'NOT_RUN (requires actual page inspection; HTTP 200 is not UI acceptance)'
}
function Open-Android {
  $adb=Get-Command adb.exe -ErrorAction SilentlyContinue
  Require ([bool]$adb) 'ADB_NOT_INSTALLED'
  $devices=@(& $adb.Source 'devices' | ForEach-Object {$_.ToString()})
  Require (@($devices|Where-Object{$_ -match ('^'+[regex]::Escape($device)+'\s+device\s*$')}).Count -eq 1) 'EXPECTED_SAMSUNG_NOT_CONNECTED'
  $existing=@(& $adb.Source '-s' $device 'reverse' '--list' | ForEach-Object{$_.ToString()})
  foreach($entry in $android){
    $p=$entry.Port
    $same=@($existing|Where-Object {$_ -match ('\btcp:'+$p+'\s+tcp:'+$p+'\b')}).Count -gt 0
    $collision=@($existing|Where-Object {$_ -match ('\btcp:'+$p+'\s+') -and $_ -notmatch ('\btcp:'+$p+'\s+tcp:'+$p+'\b')}).Count -gt 0
    Require (-not $collision) ('ADB_REVERSE_COLLISION '+$p)
    if(-not $same){
      $null=@(& $adb.Source '-s' $device 'reverse' ('tcp:'+$p) ('tcp:'+$p) 2>&1)
      Require ($LASTEXITCODE -eq 0) ('ADB_REVERSE_SETUP_FAILED '+$p)
      Report 'ADB_REVERSE' ('CREATED port='+$p)
    } else {Report 'ADB_REVERSE' ('REUSED port='+$p)}
  }
  $blocked=0
  foreach($entry in $android){
    $name=[string]$entry.Name
    $port=[int]$entry.Port
    # Native development builds need Expo's manifest, not merely web HTML or /status.
    $manifest=Probe ('http://127.0.0.1:'+$port+'/') 'application/expo+json'
    if($manifest.Exit -ne 0 -or $manifest.Code -ne '200' -or $manifest.Mime -notmatch '^application/expo\+json'){
      $blocked++
      Report 'ANDROID_APP' ($name+' BLOCKED native_manifest status='+$manifest.Code+' content_type='+$manifest.Mime)
      continue
    }
    $uri=[string]$entry.Scheme+'://expo-development-client/?url=http%3A%2F%2F127.0.0.1%3A'+$port
    $resolution=@(& $adb.Source '-s' $device 'shell' 'cmd' 'package' 'query-activities' '--brief' '-a' 'android.intent.action.VIEW' '-c' 'android.intent.category.BROWSABLE' '-d' $uri '-p' $entry.Package)
    Require ($LASTEXITCODE -eq 0 -and @($resolution|Where-Object {$_.ToString().Contains($entry.Package+'/.MainActivity')}).Count -eq 1) ('ANDROID_INTENT_UNAVAILABLE '+$name)
    $result=@(& $adb.Source '-s' $device 'shell' 'am' 'start' '-W' '-a' 'android.intent.action.VIEW' '-c' 'android.intent.category.BROWSABLE' '-d' $uri '-p' $entry.Package)
    $status=$LASTEXITCODE
    if($status -ne 0 -or -not (@($result|Where-Object{$_.ToString() -match 'Status:\s+ok'}).Count)){
      $blocked++
      Report 'ANDROID_APP' ($name+' FAIL app_launch')
      continue
    }
    Start-Sleep -Seconds 3
    $top=@(& $adb.Source '-s' $device 'shell' 'dumpsys' 'activity' 'activities' | Where-Object{$_.ToString() -match 'topResumedActivity'} | Select-Object -First 1)
    if(@($top|Where-Object{$_.ToString() -match 'DevLauncherErrorActivity'}).Count){
      $blocked++
      Report 'ANDROID_APP' ($name+' FAIL dev_launcher_error')
    } elseif(@($top|Where-Object {$_.ToString().Contains($entry.Package)}).Count){
      Report 'ANDROID_APP' ($name+' INTENT_ACCEPTED foreground_activity='+$entry.Package)
    } else {
      Report 'ANDROID_APP' ($name+' INTENT_ACCEPTED foreground_unverified')
    }
  }
  Report 'ANDROID_VISUAL' 'NOT_RUN (native activity launch is not proof of rendered application)'
  if($blocked -gt 0) { throw ('ANDROID_LAUNCH_INCOMPLETE blocked='+$blocked+'; inspect Expo native manifest and app logs') }
}
try {
  Require ($env:COMPUTERNAME -ieq $surface) 'SURFACE_ONLY'
  if($Mode -in @('Browser','All')){ Open-Browser }
  if($Mode -in @('Android','All')){ Open-Android }
  Report 'OPEN_DEV_SURFACES' 'DONE'
} catch {
  Write-Error ('OPEN_DEV_SURFACES_FAILED mode='+$Mode+' detail='+$_.Exception.Message) -ErrorAction Continue
  exit 1
}
