#Requires -Version 5.1
# Enter missing development secrets on Lenovo; never print values or transfer them via chat.
param([ValidateSet('mobile','control')][string]$Scope='mobile')
$ErrorActionPreference='Stop'
$root='C:\Users\bthwa\BThwaniAppRunner\private\env'
New-Item -ItemType Directory -Force -Path $root | Out-Null
$file=Join-Path $root ($Scope+'.env')
$original=if(Test-Path -LiteralPath $file){[IO.File]::ReadAllText($file)}else{''}
$required=if($Scope -eq 'mobile'){
  @('GOOGLE_MAPS_ANDROID_API_KEY_APP_CLIENT','GOOGLE_MAPS_ANDROID_API_KEY_APP_PARTNER','GOOGLE_MAPS_IOS_API_KEY','GOOGLE_MAPS_ANDROID_API_KEY_APP_CAPTAIN','GOOGLE_MAPS_IOS_API_KEY_APP_CAPTAIN')
}else{
  @('CONTROL_PANEL_SERVICE_TOKEN','CONTROL_PANEL_DEVELOPMENT_PASSWORD')
}
function Read-MaskedSecret([string]$name){
  $secure=Read-Host $name -AsSecureString
  $handle=[Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure)
  try{ return [Runtime.InteropServices.Marshal]::PtrToStringBSTR($handle) }
  finally{ [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($handle) }
}
$add=[System.Collections.Generic.List[string]]::new()
$updated=$original
foreach($name in $required){
  $expr='(?m)^'+[Regex]::Escape($name)+'=([^\r\n]*)$'
  $foundMatches=[Regex]::Matches($updated,$expr)
  $hasValue=$false
  foreach($match in $foundMatches){ if(![string]::IsNullOrWhiteSpace($match.Groups[1].Value)){$hasValue=$true} }
  if($hasValue){continue}
  $secret=Read-MaskedSecret $name
  if([string]::IsNullOrWhiteSpace($secret) -or $secret.Contains([char]10) -or $secret.Contains([char]13)){
    throw ('SECRET_INPUT_INVALID name='+$name)
  }
  # Delete only blank copies of this same key, not unrelated user entries.
  $updated=[Regex]::Replace($updated,'(?m)^'+[Regex]::Escape($name)+'=[ \t]*(?:\r?\n|$)','')
  $add.Add($name+'='+$secret)
  Remove-Variable secret -ErrorAction SilentlyContinue
}
if($add.Count){
  $newline=if($updated.Contains("`r`n")){"`r`n"}else{"`n"}
  $separator=if($updated.Length -gt 0 -and -not $updated.EndsWith("`n")){$newline}else{''}
  $newContent=$updated+$separator+[string]::Join($newline,$add)+$newline
  [IO.File]::WriteAllText($file,$newContent,[Text.UTF8Encoding]::new($false))
  Remove-Variable newContent,updated,add -ErrorAction SilentlyContinue
}
Write-Output ('LENOVO_SECRET_CONFIG=PASS scope='+$Scope)
