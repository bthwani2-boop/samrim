#Requires -Version 5.1
# Run interactively on Lenovo. This does not send credentials to the repository or to chat.
param([ValidateSet('mobile','control')][string]$Scope='mobile')
$ErrorActionPreference='Stop'
$root='C:\Users\bthwa\BThwaniAppRunner\private\env'
New-Item -ItemType Directory -Force -Path $root | Out-Null
$file=Join-Path $root ($Scope+'.env')
$existing=@{}
if(Test-Path -LiteralPath $file) {
  foreach($line in Get-Content -LiteralPath $file) {
    if($line -match '^([A-Za-z0-9_]+)=(.*)$') { $existing[$Matches[1]]=$Matches[2] }
  }
}
$required = if($Scope -eq 'mobile') {
  @('GOOGLE_MAPS_ANDROID_API_KEY_APP_CLIENT','GOOGLE_MAPS_ANDROID_API_KEY_APP_PARTNER','GOOGLE_MAPS_IOS_API_KEY')
} else {
  @('CONTROL_PANEL_SERVICE_TOKEN','CONTROL_PANEL_DEVELOPMENT_PASSWORD')
}
function SecretInput([string]$label) {
  $secure = Read-Host $label -AsSecureString
  $pointer=[Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure)
  try { return [Runtime.InteropServices.Marshal]::PtrToStringBSTR($pointer) }
  finally { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($pointer) }
}
$added=@()
foreach($name in $required) {
  if($existing.ContainsKey($name) -and -not [string]::IsNullOrWhiteSpace($existing[$name])) { continue }
  $value=SecretInput $name
  if([string]::IsNullOrWhiteSpace($value) -or $value.Contains("`n") -or $value.Contains("`r")) {
    throw "SECRET_INPUT_INVALID name=$name"
  }
  $added += ($name+'='+$value)
  Remove-Variable value -ErrorAction SilentlyContinue
}
if($added.Count) { [System.IO.File]::AppendAllText($file, ([string]::Join("`n",$added)+"`n"), [System.Text.UTF8Encoding]::new($false)) }
Remove-Variable added,existing -ErrorAction SilentlyContinue
Write-Output ('LENOVO_SECRET_CONFIG=PASS scope='+$Scope)
