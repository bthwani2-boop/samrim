#Requires -Version 7.4
[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)]
    [ValidatePattern("^app-(client|partner|captain|field)$")]
    [string] $App,
    [string] $SecretsRoot = $(if ($env:BTHWANI_SECRETS_ROOT) { $env:BTHWANI_SECRETS_ROOT } else { "C:\BTHWANI-Secrets\samrim" }),
    [ValidateSet("Local", "Eas", "InstallMatchingBuilds")]
    [string] $Mode = "Local"
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$RepoRoot = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
$AppRoot = Join-Path $RepoRoot ("apps\" + $App)
$EasConfig = Get-Content -LiteralPath (Join-Path $AppRoot "eas.json") -Raw | ConvertFrom-Json
$EasCliVersion = [string]$EasConfig.cli.version
if ([string]::IsNullOrWhiteSpace($EasCliVersion)) { throw "Missing CLI version in app-owned eas.json for $App." }
$ConfigPath = Join-Path $AppRoot "mobile.config.json"
$StatusBefore = @(& git -C $RepoRoot status --porcelain --untracked-files=all)

function Fail([string] $Message) {
    throw $Message
}

function Invoke-EasJson([string[]] $Arguments) {
    $ErrorFile = [IO.Path]::GetTempFileName()
    try {
        Push-Location $AppRoot
        try {
            $Output = (& pnpm dlx ("eas-cli@" + $EasCliVersion) @Arguments 2> $ErrorFile | Out-String).Trim()
            $Code = $LASTEXITCODE
        }
        finally {
            Pop-Location
        }
        if ($Code -ne 0) {
            throw ("EAS command failed (exit=" + $Code + "): " + [IO.File]::ReadAllText($ErrorFile).Trim())
        }
        if ([string]::IsNullOrWhiteSpace($Output)) { throw "EAS command returned empty JSON." }
        return $Output | ConvertFrom-Json
    }
    finally {
        Remove-Item -LiteralPath $ErrorFile -Force -ErrorAction SilentlyContinue
    }
}

if (-not (Test-Path -LiteralPath $ConfigPath -PathType Leaf)) { Fail "Missing mobile config: $ConfigPath" }
if (-not (Test-Path -LiteralPath $SecretsRoot -PathType Container)) { Fail "Missing canonical secrets root: $SecretsRoot" }

$Config = Get-Content -LiteralPath $ConfigPath -Raw | ConvertFrom-Json
$PackageName = [string]$Config.androidPackage
if ([string]::IsNullOrWhiteSpace($PackageName)) { Fail "Missing Android identity for $App" }

$CredentialPath = Join-Path $SecretsRoot ("expo\" + $App + "\credentials.json")
$KeystorePath = Join-Path $SecretsRoot ("eas\android\" + $App + "\development.jks")
foreach ($Required in @($CredentialPath, $KeystorePath)) {
    if (-not (Test-Path -LiteralPath $Required -PathType Leaf)) { Fail "Missing target input for \${App}: $Required" }
}

$Credential = Get-Content -LiteralPath $CredentialPath -Raw | ConvertFrom-Json
if (
    [string]::IsNullOrWhiteSpace([string]$Credential.android.keystore.keystorePassword) -or
    [string]::IsNullOrWhiteSpace([string]$Credential.android.keystore.keyAlias) -or
    [string]::IsNullOrWhiteSpace([string]$Credential.android.keystore.keyPassword)
) {
    Fail "Incomplete local Android credential descriptor for $App"
}

Write-Host "TARGET_APP=$App"
Write-Host "TARGET_ANDROID_PACKAGE=$PackageName"
Write-Host "LOCAL_CREDENTIAL_INPUT=PASS"
Write-Host "EAS_CLI_VERSION=$EasCliVersion"

if ($Mode -eq "Local") {
    Write-Host "EAS_COMPATIBILITY=SKIPPED mode=Local"
    Write-Host "DEVICE_INSTALLATION=SKIPPED mode=Local"
}
else {
    $WhoAmI = (& pnpm dlx ("eas-cli@" + $EasCliVersion) whoami --non-interactive 2>&1 | Out-String).Trim()
    if ($LASTEXITCODE -ne 0) {
        Write-Host "EAS_AUTH=REQUIRED"
        Write-Host "Run: pnpm dlx eas-cli@$EasCliVersion login"
        exit 2
    }
    Write-Host "EAS_AUTH=PASS"

    $Fingerprint = Invoke-EasJson @("fingerprint:generate", "--platform", "android", "--build-profile", "development", "--json", "--non-interactive")
    $Hash = [string]$Fingerprint.hash
    if ([string]::IsNullOrWhiteSpace($Hash)) { Fail "Unable to resolve Android fingerprint for $App" }
    Write-Host "ANDROID_FINGERPRINT=$Hash"

    $Builds = @(Invoke-EasJson @("build:list", "--platform", "android", "--build-profile", "development", "--status", "finished", "--distribution", "internal", "--fingerprint-hash", $Hash, "--limit", "10", "--json", "--non-interactive"))
    if ($Builds.Count -eq 0) {
        Write-Host "EAS_COMPATIBLE_BUILD=MISS app=$App fingerprint=$Hash"
        if ($Mode -eq "InstallMatchingBuilds") { Fail "No finished compatible build exists for $App" }
    }
    else {
        $Build = $Builds | Sort-Object { [DateTimeOffset]::Parse([string]$_.createdAt) } -Descending | Select-Object -First 1
        Write-Host "EAS_COMPATIBLE_BUILD=PASS app=$App buildId=$($Build.id) fingerprint=$Hash"
        if ($Mode -eq "InstallMatchingBuilds") {
            Import-Module -Name (Join-Path $PSScriptRoot "..\dev\device-policy.psm1") -Force -WarningAction SilentlyContinue
            $AdbSerial = [string](Get-CanonicalAdbDevice).Serial
            $DownloadRoot = Join-Path ([IO.Path]::GetTempPath()) ("bthwani-eas-" + [Guid]::NewGuid().ToString("N"))
            New-Item -ItemType Directory -Path $DownloadRoot -Force | Out-Null
            try {
                $BuildView = Invoke-EasJson @("build:view", [string]$Build.id, "--json")
                $BuildUrl = [string]$BuildView.artifacts.buildUrl
                if ([string]::IsNullOrWhiteSpace($BuildUrl)) { Fail "Compatible build has no downloadable Android artifact: $App" }
                $Apk = Join-Path $DownloadRoot ($App + ".apk")
                Invoke-WebRequest -Uri $BuildUrl -OutFile $Apk -UseBasicParsing
                & adb -s $AdbSerial install -r $Apk | Out-Host
                if ($LASTEXITCODE -ne 0) { Fail "ADB install failed for $App" }
                & adb -s $AdbSerial shell pm path $PackageName *> $null
                if ($LASTEXITCODE -ne 0) { Fail "Installed package readback failed for $App" }
                Write-Host "DEVICE_INSTALLATION=PASS app=$App buildId=$($Build.id)"
            }
            finally {
                if (Test-Path -LiteralPath $DownloadRoot) {
                    Remove-Item -LiteralPath $DownloadRoot -Recurse -Force
                }
            }
        }
    }
}

$StatusAfter = @(& git -C $RepoRoot status --porcelain --untracked-files=all)
if (($StatusBefore -join [Environment]::NewLine) -ne ($StatusAfter -join [Environment]::NewLine)) {
    Fail "mobile:prepare changed repository state."
}
Write-Host "MOBILE_PREPARE=PASS app=$App mode=$Mode"
