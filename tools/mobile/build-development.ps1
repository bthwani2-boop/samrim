#Requires -Version 7.4
[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)]
    [ValidatePattern("^app-(client|partner|captain)$")]
    [string] $App,
    [switch] $Submit,
    [switch] $Wait,
    [switch] $AndroidOnly,
    [switch] $OfflinePlan
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$RepoRoot = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
$AppRoot = Join-Path $RepoRoot ("apps\" + $App)
$SecretsRoot = if ($env:BTHWANI_SECRETS_ROOT) { $env:BTHWANI_SECRETS_ROOT } else { "C:\BTHWANI-Secrets\samrim" }
$EasConfig = Get-Content -LiteralPath (Join-Path $AppRoot "eas.json") -Raw | ConvertFrom-Json
$EasCliVersion = [string]$EasConfig.cli.version
if ([string]::IsNullOrWhiteSpace($EasCliVersion)) { throw "Missing CLI version in app-owned eas.json for $App." }
$Config = Get-Content -LiteralPath (Join-Path $AppRoot "mobile.config.json") -Raw | ConvertFrom-Json
$ProjectId = [string]$Config.projectId
$CredentialVaultPath = Join-Path $SecretsRoot ("expo\" + $App + "\credentials.json")
$KeystoreVaultPath = Join-Path $SecretsRoot ("eas\android\" + $App + "\development.jks")
$MaterializedCredentialPath = Join-Path $AppRoot "credentials.json"
$MaterializedKeystorePath = Join-Path $AppRoot "development.jks"
$FirebaseVaultPath = Join-Path $SecretsRoot ("firebase\" + $App + "\google-services.json")
$MaterializedFirebasePath = Join-Path $AppRoot "google-services.json"
$FirebaseMaterialized = $false
Import-Module -Name (Join-Path $PSScriptRoot "eas-credential-materialization.psm1") -Force

function Fail([string] $Message) { throw $Message }

function Invoke-EasJson([string[]] $Arguments) {
    $ErrorFile = [IO.Path]::GetTempFileName()
    try {
        Push-Location $AppRoot
        try {
            $Output = (& pnpm --config.strict-peer-dependencies=false dlx ("eas-cli@" + $EasCliVersion) @Arguments 2> $ErrorFile | Out-String).Trim()
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

function Invoke-EasText([string[]] $Arguments) {
    Push-Location $AppRoot
    try {
        $Output = (& pnpm --config.strict-peer-dependencies=false dlx ("eas-cli@" + $EasCliVersion) @Arguments 2>&1 | Out-String).Trim()
        $Code = $LASTEXITCODE
    }
    finally {
        Pop-Location
    }
    if ($Code -ne 0) { throw "EAS command failed (exit=$Code)." }
    return $Output
}

function Get-BuildSourceSha($Build) {
    if ($null -eq $Build) { return "UNKNOWN" }
    foreach ($Property in @("gitCommitHash", "gitCommit", "sourceCommit", "commitHash")) {
        $Value = [string]$Build.$Property
        if (-not [string]::IsNullOrWhiteSpace($Value)) { return $Value }
    }
    return "UNKNOWN"
}

$StatusBefore = @(& git -C $RepoRoot status --porcelain --untracked-files=all)
if ($StatusBefore.Count -gt 0) { Fail "Candidate must be clean before remote build." }
$LocalSha = (& git -C $RepoRoot rev-parse HEAD).Trim()
if ($LASTEXITCODE -ne 0 -or $LocalSha -notmatch '^[0-9a-f]{40}$') { Fail "Remote build requires a committed local source revision." }

& pnpm --dir $RepoRoot install --lockfile-only --frozen-lockfile --offline --ignore-scripts
if ($LASTEXITCODE -ne 0) { Fail "Dependency lock must match the committed manifests before EAS discovery or submission." }
& node (Join-Path $PSScriptRoot "verify-mobile-config.mjs") --app $App
if ($LASTEXITCODE -ne 0) { Fail "Mobile dependency/configuration preflight failed for $App." }

$FirebaseEnabled = $App -in @("app-client", "app-partner", "app-captain")
$IosEnabled = (-not $AndroidOnly) -and ($App -in @("app-client", "app-partner", "app-captain"))
if ($IosEnabled) {
    $IosProfile = $EasConfig.build.'ios-simulator'
    if ($null -eq $IosProfile -or [string]$IosProfile.extends -ne "development" -or -not [bool]$IosProfile.ios.simulator) {
        Fail "iOS development simulator profile is required for $App."
    }
}
if ($OfflinePlan) {
    if ($Submit -or $Wait) { Fail "OfflinePlan does not accept Submit or Wait." }
    $AndroidProfile = $EasConfig.build.development
    if ($null -eq $AndroidProfile -or [string]$AndroidProfile.extends -ne "base" -or
        -not [bool]$AndroidProfile.developmentClient -or
        [string]$AndroidProfile.android.buildType -ne "apk") {
        Fail "Android development APK profile is invalid for $App."
    }
    Write-Host "EAS_OFFLINE_PLAN=READY app=$App sourceSha=$LocalSha"
    Write-Host "EAS_PLAN app=$App platform=android profile=development output=apk"
    if ($IosEnabled) {
        Write-Host "EAS_PLAN app=$App platform=ios profile=ios-simulator output=simulator"
    }
    Write-Host "EAS_CLOUD_CALLS=0 EAS_BUILDS_SUBMITTED=0 EAS_SECRETS_MATERIALIZED=0"
    return
}
$RequiredInputs = @($CredentialVaultPath, $KeystoreVaultPath)
if ($FirebaseEnabled) { $RequiredInputs += $FirebaseVaultPath }
foreach ($Required in $RequiredInputs) {
    if (-not (Test-Path -LiteralPath $Required -PathType Leaf)) { Fail "Missing target build input: $Required" }
}

$Credential = Get-Content -LiteralPath $CredentialVaultPath -Raw | ConvertFrom-Json
$Credential.android.keystore.keystorePath = "development.jks"

$Materialization = $null
try {
    if ($FirebaseEnabled) {
        if (Test-Path -LiteralPath $MaterializedFirebasePath -PathType Leaf) {
            Fail "Existing local Firebase file must be handled outside this script before a materialized build."
        }
        $FirebaseConfig = Get-Content -LiteralPath $FirebaseVaultPath -Raw | ConvertFrom-Json
        $AndroidPackages = @($FirebaseConfig.client | ForEach-Object { [string]$_.client_info.android_client_info.package_name })
        if ([string]$Config.androidPackage -notin $AndroidPackages) {
            Fail "Firebase client package does not match app $App."
        }
        Copy-Item -LiteralPath $FirebaseVaultPath -Destination $MaterializedFirebasePath
        $FirebaseMaterialized = $true
    }
    $Materialization = New-EasCredentialMaterialization `
        -KeystoreVaultPath $KeystoreVaultPath `
        -MaterializedCredentialPath $MaterializedCredentialPath `
        -MaterializedKeystorePath $MaterializedKeystorePath `
        -Credential $Credential

    $null = Invoke-EasText @("whoami", "--non-interactive")
    Write-Host "EAS_AUTH=PASS"

    $ProjectInfoText = Invoke-EasText @("project:info")
    $ProjectIdMatch = [regex]::Match(
        $ProjectInfoText,
        "(?m)^ID\s+([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\s*$"
    )
    if (-not $ProjectIdMatch.Success) { Fail "EAS project info did not contain a project ID for $App." }
    $RemoteProjectId = $ProjectIdMatch.Groups[1].Value
    if ($RemoteProjectId -ne $ProjectId) { Fail "EAS project binding mismatch for $App." }
    Write-Host "EAS_PROJECT_BINDING=PASS app=$App projectId=$ProjectId"

    if ($FirebaseEnabled) {
        $Environment = [string]$EasConfig.build.development.environment
        if ([string]::IsNullOrWhiteSpace($Environment)) { Fail "Missing development EAS environment for $App." }
        $EnvironmentVariables = Invoke-EasText @("env:list", "--environment", $Environment, "--format", "short")
        if ($EnvironmentVariables -notmatch '\bGOOGLE_SERVICES_JSON\b') {
            Fail "Missing GOOGLE_SERVICES_JSON EAS file environment variable for $App in $Environment."
        }
        Write-Host "EAS_FIREBASE_FILE_ENV=PASS app=$App environment=$Environment"
    }

    $Fingerprint = Invoke-EasJson @("fingerprint:generate", "--platform", "android", "--build-profile", "development", "--json", "--non-interactive")
    $Hash = [string]$Fingerprint.hash
    if ([string]::IsNullOrWhiteSpace($Hash)) { Fail "Unable to resolve Android fingerprint for $App." }
    Write-Host "ANDROID_FINGERPRINT=$Hash"

    $AndroidBuilds = @(Invoke-EasJson @("build:list", "--platform", "android", "--build-profile", "development", "--distribution", "internal", "--fingerprint-hash", $Hash, "--limit", "50", "--json", "--non-interactive"))
    # Never reuse a native-compatible build from a different JS/TS revision.
    $AndroidFinished = $AndroidBuilds | Where-Object { ([string]$_.status).ToUpperInvariant() -eq "FINISHED" -and (Get-BuildSourceSha $_) -eq $LocalSha } | Sort-Object { [DateTimeOffset]::Parse([string]$_.createdAt) } -Descending | Select-Object -First 1
    $AndroidPending = $AndroidBuilds | Where-Object { ([string]$_.status).ToUpperInvariant() -in @("IN_PROGRESS", "IN_QUEUE", "NEW") -and (Get-BuildSourceSha $_) -eq $LocalSha } | Sort-Object { [DateTimeOffset]::Parse([string]$_.createdAt) } -Descending | Select-Object -First 1
    $BuildRequests = @()

    if ($null -ne $AndroidFinished) {
        Write-Host "BUILD_DECISION=REUSED app=$App platform=android currentCandidateSha=$LocalSha nativeFingerprint=$Hash reusedBuildId=$($AndroidFinished.id) reusedBuildActualSourceSha=$(Get-BuildSourceSha $AndroidFinished)"
    }
    elseif ($null -ne $AndroidPending) {
        Write-Host "BUILD_DECISION=REUSED_PENDING app=$App platform=android currentCandidateSha=$LocalSha nativeFingerprint=$Hash reusedBuildId=$($AndroidPending.id) reusedBuildActualSourceSha=$(Get-BuildSourceSha $AndroidPending)"
    }
    elseif (-not $Submit) {
        Write-Host "BUILD_DECISION=REQUIRED app=$App platform=android nativeFingerprint=$Hash submitted=false"
    }
    else {
        $BuildRequests += [pscustomobject]@{ Platform = "android"; Profile = "development" }
    }

    if ($IosEnabled) {
        $IosBuilds = @(Invoke-EasJson @("build:list", "--platform", "ios", "--build-profile", "ios-simulator", "--limit", "50", "--json", "--non-interactive"))
        $MatchingIos = $IosBuilds | Where-Object {
            (Get-BuildSourceSha $_) -eq $LocalSha -and
            [string]$_.updateChannel.name -eq "development" -and
            [bool]$_.isForIosSimulator
        }
        $IosFinished = $MatchingIos | Where-Object { ([string]$_.status).ToUpperInvariant() -eq "FINISHED" } | Sort-Object { [DateTimeOffset]::Parse([string]$_.createdAt) } -Descending | Select-Object -First 1
        $IosPending = $MatchingIos | Where-Object { ([string]$_.status).ToUpperInvariant() -in @("IN_PROGRESS", "IN_QUEUE", "NEW") } | Sort-Object { [DateTimeOffset]::Parse([string]$_.createdAt) } -Descending | Select-Object -First 1

        if ($null -ne $IosFinished) {
            Write-Host "BUILD_DECISION=REUSED app=$App platform=ios currentCandidateSha=$LocalSha reusedBuildId=$($IosFinished.id)"
        }
        elseif ($null -ne $IosPending) {
            Write-Host "BUILD_DECISION=REUSED_PENDING app=$App platform=ios currentCandidateSha=$LocalSha reusedBuildId=$($IosPending.id)"
        }
        elseif (-not $Submit) {
            Write-Host "BUILD_DECISION=REQUIRED app=$App platform=ios submitted=false"
        }
        else {
            $BuildRequests += [pscustomobject]@{ Platform = "ios"; Profile = "ios-simulator" }
        }
    }

    if ($BuildRequests.Count -gt 0) {
        # Both requests start before either is awaited; EAS schedules them independently.
        $Jobs = @()
        try {
            foreach ($Request in $BuildRequests) {
                $Jobs += Start-ThreadJob -Name $Request.Platform -ArgumentList @($AppRoot, $EasCliVersion, $Request.Platform, $Request.Profile, [bool]$Wait) -ScriptBlock {
                    param($BuildRoot, $Version, $Platform, $Profile, [bool]$MustWait)
                    $ErrorFile = [IO.Path]::GetTempFileName()
                    try {
                        Push-Location $BuildRoot
                        try {
                            $Arguments = @("--config.strict-peer-dependencies=false", "dlx", ("eas-cli@" + $Version), "build", "--platform", $Platform, "--profile", $Profile, "--non-interactive", "--json")
                            if (-not $MustWait) { $Arguments += "--no-wait" }
                            $Output = (& pnpm @Arguments 2> $ErrorFile | Out-String).Trim()
                            $Code = $LASTEXITCODE
                        }
                        finally {
                            Pop-Location
                        }
                        if ($Code -ne 0) {
                            throw ("EAS " + $Platform + " submission failed (exit=" + $Code + "): " + [IO.File]::ReadAllText($ErrorFile).Trim())
                        }
                        $Response = $Output | ConvertFrom-Json
                        $BuildId = [string]$Response.id
                        if ([string]::IsNullOrWhiteSpace($BuildId)) { $BuildId = [string]$Response.build.id }
                        if ([string]::IsNullOrWhiteSpace($BuildId)) { throw "EAS $Platform submission returned no build ID." }
                        if ($MustWait -and ([string]$Response.status).ToUpperInvariant() -ne "FINISHED") {
                            throw "EAS $Platform build ended with status $($Response.status), build ID $BuildId."
                        }
                        [pscustomobject]@{ Platform = $Platform; BuildId = $BuildId }
                    }
                    finally {
                        Remove-Item -LiteralPath $ErrorFile -Force -ErrorAction SilentlyContinue
                    }
                }
            }
            $Jobs | Wait-Job | Out-Null
            $Failures = @()
            foreach ($Job in $Jobs) {
                try {
                    $Result = Receive-Job -Job $Job -ErrorAction Stop
                    if ($null -eq $Result -or [string]::IsNullOrWhiteSpace([string]$Result.BuildId)) {
                        throw "Missing confirmed build ID."
                    }
                    Write-Host "BUILD_DECISION=SUBMITTED app=$App platform=$($Result.Platform) localSourceSha=$LocalSha submittedBuildId=$($Result.BuildId) sourceMode=clean-local-commit"
                }
                catch {
                    $Failures += "$($Job.Name): $($_.Exception.Message)"
                }
            }
            if ($Failures.Count -gt 0) { Fail ("Remote build submission failure: " + ($Failures -join "; ")) }
        }
        finally {
            $Jobs | Remove-Job -Force -ErrorAction SilentlyContinue
        }
    }
    elseif (-not $Submit) {
        Write-Host "Run with -Submit only when a new remote build for this app is intended."
    }
}
finally {
    if ($FirebaseMaterialized) {
        Remove-Item -LiteralPath $MaterializedFirebasePath -Force -ErrorAction SilentlyContinue
    }
    if ($null -ne $Materialization) {
        Remove-EasCredentialMaterialization -Materialization $Materialization
    }
    $StatusAfter = @(& git -C $RepoRoot status --porcelain --untracked-files=all)
    if (($StatusBefore -join [Environment]::NewLine) -ne ($StatusAfter -join [Environment]::NewLine)) {
        throw "mobile:build changed repository state."
    }
}

Write-Host "MOBILE_BUILD=PASS app=$App currentCandidateSha=$LocalSha"
