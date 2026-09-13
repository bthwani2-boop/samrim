#Requires -Version 7.4
[CmdletBinding()]
param(
    [string] $SecretsRoot = $(if ($env:BTHWANI_SECRETS_ROOT) { $env:BTHWANI_SECRETS_ROOT } else { "C:\BTHWANI-Secrets\samrim" }),
    [ValidateSet("Local", "Eas", "InstallMatchingBuilds")]
    [string] $Mode = "Local"
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$RepoRoot = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
$ExpectedApps = [ordered]@{}
foreach ($AppDirectory in Get-ChildItem -LiteralPath (Join-Path $RepoRoot "apps") -Directory | Sort-Object Name) {
    $ConfigPath = Join-Path $AppDirectory.FullName "mobile.config.json"
    if (-not (Test-Path -LiteralPath $ConfigPath -PathType Leaf)) { continue }
    $Config = Get-Content -LiteralPath $ConfigPath -Raw | ConvertFrom-Json
    if ([string]::IsNullOrWhiteSpace([string]$Config.androidPackage)) { Fail "Missing androidPackage in $ConfigPath" }
    $ExpectedApps[$AppDirectory.Name] = [string]$Config.androidPackage
}
if ($ExpectedApps.Count -eq 0) { Fail "No mobile app identities were discovered under $RepoRoot\apps" }
$EasCliVersion = "22.2.0"

function Fail([string] $Message) {
    Write-Error $Message
    exit 1
}

function Write-Utf8NoBom([string] $Path, [string] $Content) {
    $Directory = Split-Path -Parent $Path
    if (-not (Test-Path -LiteralPath $Directory -PathType Container)) {
        New-Item -ItemType Directory -Path $Directory -Force | Out-Null
    }
    $Temp = Join-Path $Directory (".tmp-" + [Guid]::NewGuid().ToString("N"))
    try {
        [IO.File]::WriteAllText($Temp, $Content, [Text.UTF8Encoding]::new($false))
        Move-Item -LiteralPath $Temp -Destination $Path -Force
    }
    finally {
        if (Test-Path -LiteralPath $Temp) {
            Remove-Item -LiteralPath $Temp -Force -ErrorAction SilentlyContinue
        }
    }
}

function Write-JsonAtomic([string] $Path, $Value) {
    $Json = $Value | ConvertTo-Json -Depth 20
    Write-Utf8NoBom -Path $Path -Content ($Json + [Environment]::NewLine)
}

function Set-EnvPathBindings([string] $Path, [hashtable] $Bindings) {
    if (-not (Test-Path -LiteralPath $Path -PathType Leaf)) {
        Fail "Missing mobile environment vault file: $Path"
    }

    $Content = [IO.File]::ReadAllText($Path)
    foreach ($Entry in $Bindings.GetEnumerator()) {
        $Pattern = "(?m)^" + [Regex]::Escape([string] $Entry.Key) + "=.*$"
        $Replacement = ([string] $Entry.Key) + "=" + ([string] $Entry.Value)
        if ([Regex]::IsMatch($Content, $Pattern)) {
            $Content = [Regex]::Replace($Content, $Pattern, [System.Text.RegularExpressions.MatchEvaluator]{ param($m) $Replacement }, 1)
        }
        else {
            if (-not $Content.EndsWith([Environment]::NewLine)) {
                $Content += [Environment]::NewLine
            }
            $Content += $Replacement + [Environment]::NewLine
        }
    }
    Write-Utf8NoBom -Path $Path -Content $Content
}

function Invoke-EasJson([string] $WorkingDirectory, [string[]] $Arguments) {
    $ErrorFile = [IO.Path]::GetTempFileName()
    try {
        Push-Location $WorkingDirectory
        try {
            $Output = (& pnpm dlx ("eas-cli@" + $EasCliVersion) @Arguments 2> $ErrorFile | Out-String).Trim()
            $Code = $LASTEXITCODE
        }
        finally {
            Pop-Location
        }

        if ($Code -ne 0) {
            $ErrorText = [IO.File]::ReadAllText($ErrorFile).Trim()
            throw "EAS command failed (exit=$Code): $ErrorText"
        }
        if ([string]::IsNullOrWhiteSpace($Output)) {
            throw "EAS command returned empty JSON."
        }
        return $Output | ConvertFrom-Json
    }
    finally {
        Remove-Item -LiteralPath $ErrorFile -Force -ErrorAction SilentlyContinue
    }
}

$StatusBefore = @(& git -C $RepoRoot status --porcelain --untracked-files=all)
if ($LASTEXITCODE -ne 0) { Fail "Unable to inspect repository state before mobile preparation." }

Write-Host "Repository: $RepoRoot"
Write-Host "Secrets root: $SecretsRoot"

if (-not (Test-Path -LiteralPath $SecretsRoot -PathType Container)) {
    Fail "Canonical secrets root is missing: $SecretsRoot"
}

$RequiredDirectories = @("local-bindings", "sentry", "eas", "env", "expo", "firebase")
foreach ($Name in $RequiredDirectories) {
    $Path = Join-Path $SecretsRoot $Name
    if (-not (Test-Path -LiteralPath $Path -PathType Container)) {
        Fail "Missing canonical secrets directory: $Path"
    }
}
Write-Host "SECRETS_DIRECTORY_CENSUS=PASS"

$FirebaseBindings = [ordered]@{}
$MobileEnvBindings = @{}
foreach ($Entry in $ExpectedApps.GetEnumerator()) {
    $App = [string] $Entry.Key
    $PackageName = [string] $Entry.Value
    $GoogleServices = Join-Path $SecretsRoot ("firebase\" + $App + "\google-services.json")
    if (-not (Test-Path -LiteralPath $GoogleServices -PathType Leaf)) {
        Fail "Missing Firebase file for ${App}: $GoogleServices"
    }

    $Firebase = Get-Content -LiteralPath $GoogleServices -Raw | ConvertFrom-Json
    $Packages = @(
        $Firebase.client |
            ForEach-Object { $_.client_info.android_client_info.package_name } |
            Where-Object { -not [string]::IsNullOrWhiteSpace([string] $_) }
    )
    if ($PackageName -notin $Packages) {
        Fail "Firebase file for $App does not contain Android package $PackageName"
    }

    $FirebaseBindings[$App] = $GoogleServices
    $Suffix = $App.Replace("-", "_").ToUpperInvariant()
    $MobileEnvBindings["GOOGLE_SERVICES_JSON_" + $Suffix] = $GoogleServices
}
Write-Host "FIREBASE_BINDINGS=PASS apps=$($ExpectedApps.Count)"

$LocalBindingsPath = Join-Path $SecretsRoot "local-bindings\secrets.local.mobile.json"
Write-JsonAtomic -Path $LocalBindingsPath -Value $FirebaseBindings
Write-Host "EXTERNAL_LOCAL_BINDINGS=CANONICAL"

$RepoLocalBindingsPath = Join-Path $RepoRoot "secrets.local.mobile.json"
Write-JsonAtomic -Path $RepoLocalBindingsPath -Value $FirebaseBindings
& git -C $RepoRoot check-ignore -q -- $RepoLocalBindingsPath
if ($LASTEXITCODE -ne 0) {
    Fail "Repository-local mobile binding map is not ignored by Git: $RepoLocalBindingsPath"
}
Write-Host "REPOSITORY_LOCAL_BINDING_MAP=PASS"

$MobileEnvPath = Join-Path $SecretsRoot "env\mobile.env"
Set-EnvPathBindings -Path $MobileEnvPath -Bindings $MobileEnvBindings
Write-Host "MOBILE_ENV_FIREBASE_PATHS=CANONICAL"

foreach ($Entry in $ExpectedApps.GetEnumerator()) {
    $App = [string] $Entry.Key
    $CredentialPath = Join-Path $SecretsRoot ("expo\" + $App + "\credentials.json")
    $KeystorePath = Join-Path $SecretsRoot ("eas\android\" + $App + "\development.jks")

    if (-not (Test-Path -LiteralPath $CredentialPath -PathType Leaf)) {
        Fail "Missing local EAS credential descriptor for ${App}: $CredentialPath"
    }
    if (-not (Test-Path -LiteralPath $KeystorePath -PathType Leaf)) {
        Fail "Missing Android development keystore for ${App}: $KeystorePath"
    }

    $Credential = Get-Content -LiteralPath $CredentialPath -Raw | ConvertFrom-Json
    if (
        [string]::IsNullOrWhiteSpace([string] $Credential.android.keystore.keystorePassword) -or
        [string]::IsNullOrWhiteSpace([string] $Credential.android.keystore.keyAlias) -or
        [string]::IsNullOrWhiteSpace([string] $Credential.android.keystore.keyPassword)
    ) {
        Fail "Incomplete Android credential descriptor for $App"
    }

    $Credential.android.keystore.keystorePath = $KeystorePath
    Write-JsonAtomic -Path $CredentialPath -Value $Credential
}
Write-Host "EAS_LOCAL_CREDENTIAL_VAULT_PATHS=CANONICAL"

$SentryEnvPath = Join-Path $SecretsRoot "sentry\sentry.env"
if (-not (Test-Path -LiteralPath $SentryEnvPath -PathType Leaf)) {
    Fail "Missing Sentry vault file: $SentryEnvPath"
}
Write-Host "SENTRY_VAULT=PRESENT_INACTIVE"
Write-Host "MOBILE_ENV_IMPORT=SELECTIVE"
Write-Host "MOBILE_PROVIDER_POLICY=NO_STALE_MINIO_TRANSPORT_OR_SENTRY_IMPORT"

$MatchedBuilds = [ordered]@{}
if ($Mode -eq "Local") {
    Write-Host "EAS_COMPATIBILITY=SKIPPED mode=Local"
    Write-Host "DEVICE_INSTALLATION=SKIPPED mode=Local"
}
else {
    if (-not (Get-Command pnpm -ErrorAction SilentlyContinue)) { Fail "pnpm is required for EAS remote build discovery." }
    $WhoAmI = (& pnpm dlx ("eas-cli@" + $EasCliVersion) whoami 2>&1 | Out-String).Trim()
    if ($LASTEXITCODE -ne 0) {
        Write-Host "EAS_AUTH=REQUIRED"
        Write-Host "Run: pnpm dlx eas-cli@$EasCliVersion login"
        exit 2
    }
    Write-Host "EAS_AUTH=PASS"

    foreach ($Entry in $ExpectedApps.GetEnumerator()) {
        $App = [string] $Entry.Key
        $AppRoot = Join-Path $RepoRoot ("apps\" + $App)
        $Fingerprint = Invoke-EasJson -WorkingDirectory $AppRoot -Arguments @("fingerprint:generate", "--platform", "android", "--build-profile", "development", "--json", "--non-interactive")
        $Hash = [string] $Fingerprint.hash
        if ([string]::IsNullOrWhiteSpace($Hash)) { Fail "Unable to resolve Android fingerprint for $App" }
        $Builds = @(Invoke-EasJson -WorkingDirectory $AppRoot -Arguments @("build:list", "--platform", "android", "--build-profile", "development", "--status", "finished", "--distribution", "internal", "--fingerprint-hash", $Hash, "--limit", "10", "--json", "--non-interactive"))
        if ($Builds.Count -eq 0) { Write-Host "EAS_COMPATIBLE_BUILD=MISS app=$App"; continue }
        $Build = $Builds | Sort-Object { [DateTimeOffset]::Parse([string] $_.createdAt) } -Descending | Select-Object -First 1
        $MatchedBuilds[$App] = $Build
        Write-Host "EAS_COMPATIBLE_BUILD=PASS app=$App buildId=$($Build.id) fingerprint=$Hash"
    }

    if ($MatchedBuilds.Count -ne $ExpectedApps.Count) {
        Write-Host "EAS_REUSE_READY=NO matched=$($MatchedBuilds.Count)/$($ExpectedApps.Count)"
        exit 3
    }
    Write-Host "EAS_REUSE_READY=PASS matched=$($ExpectedApps.Count)/$($ExpectedApps.Count)"
}

if ($Mode -eq "InstallMatchingBuilds") {
    Import-Module -Name (Join-Path $PSScriptRoot "..\dev\device-policy.psm1") -Force -WarningAction SilentlyContinue
    $AdbSerial = [string](Get-CanonicalAdbDevice).Serial

    $DownloadRoot = Join-Path ([IO.Path]::GetTempPath()) ("bthwani-eas-" + [Guid]::NewGuid().ToString("N"))
    New-Item -ItemType Directory -Path $DownloadRoot -Force | Out-Null

    try {
        foreach ($Entry in $ExpectedApps.GetEnumerator()) {
            $App = [string] $Entry.Key
            $PackageName = [string] $Entry.Value
            $Build = $MatchedBuilds[$App]
            $AppRoot = Join-Path $RepoRoot ("apps\" + $App)
            $BuildView = Invoke-EasJson -WorkingDirectory $AppRoot -Arguments @(
                "build:view",
                [string] $Build.id,
                "--json"
            )
            $BuildUrl = [string] $BuildView.artifacts.buildUrl
            if ([string]::IsNullOrWhiteSpace($BuildUrl)) {
                Fail "Compatible EAS build has no downloadable Android artifact: $App"
            }

            $Apk = Join-Path $DownloadRoot ($App + ".apk")
            Invoke-WebRequest -Uri $BuildUrl -OutFile $Apk -UseBasicParsing
            if (-not (Test-Path -LiteralPath $Apk -PathType Leaf) -or (Get-Item -LiteralPath $Apk).Length -le 0) {
                Fail "Downloaded EAS artifact is empty: $App"
            }

            & adb -s $AdbSerial install -r $Apk | Out-Host
            if ($LASTEXITCODE -ne 0) {
                Fail "ADB install failed for matching EAS development build: $App"
            }

            & adb -s $AdbSerial shell pm path $PackageName *> $null
            if ($LASTEXITCODE -ne 0) {
                Fail "Installed EAS development build package is not visible on device: $PackageName"
            }
            Write-Host "EAS_DEVICE_INSTALL=PASS app=$App package=$PackageName"
        }
    }
    finally {
        Remove-Item -LiteralPath $DownloadRoot -Recurse -Force -ErrorAction SilentlyContinue
    }

    Write-Host "EAS_MATCHING_BUILDS_INSTALLED=PASS"
}

$StatusAfter = @(& git -C $RepoRoot status --porcelain --untracked-files=all)
if ($LASTEXITCODE -ne 0) { Fail "Unable to inspect repository state after mobile preparation." }
if (($StatusAfter -join [Environment]::NewLine) -ne ($StatusBefore -join [Environment]::NewLine)) {
    Fail ("Mobile preparation mutated tracked or unignored repository state:" + [Environment]::NewLine + "before=" + ($StatusBefore -join [Environment]::NewLine) + [Environment]::NewLine + "after=" + ($StatusAfter -join [Environment]::NewLine))
}

Write-Host "MOBILE_LOCAL_DEVELOPMENT_PREP=PASS"
