#Requires -Version 7.4
[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)]
    [ValidatePattern("^app-(client|partner|captain|field)$")]
    [string] $App,
    [switch] $Wait
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

function Fail([string] $Message) { throw $Message }

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

function Invoke-EasText([string[]] $Arguments) {
    Push-Location $AppRoot
    try {
        $Output = (& pnpm dlx ("eas-cli@" + $EasCliVersion) @Arguments 2>&1 | Out-String).Trim()
        $Code = $LASTEXITCODE
    }
    finally {
        Pop-Location
    }
    if ($Code -ne 0) { throw "EAS command failed (exit=$Code)." }
    return $Output
}

function Write-JsonNoSecrets([string] $Path, $Value) {
    $Json = $Value | ConvertTo-Json -Depth 20
    [IO.File]::WriteAllText($Path, $Json + [Environment]::NewLine, [Text.UTF8Encoding]::new($false))
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
$Branch = (& git -C $RepoRoot symbolic-ref --quiet --short HEAD 2> $null).Trim()
if ([string]::IsNullOrWhiteSpace($Branch)) { Fail "Remote build requires a non-detached branch." }
$UpstreamRef = (& git -C $RepoRoot rev-parse --abbrev-ref --symbolic-full-name '@{upstream}' 2> $null).Trim()
if ([string]::IsNullOrWhiteSpace($UpstreamRef) -or $UpstreamRef -notmatch '^[^/]+/.+$') { Fail "Remote build requires an upstream branch for $Branch." }
$RemoteName = ($UpstreamRef -split "/", 2)[0]
& git -C $RepoRoot fetch $RemoteName --prune *> $null
if ($LASTEXITCODE -ne 0) { Fail "Unable to fetch live upstream $UpstreamRef." }
$LocalSha = (& git -C $RepoRoot rev-parse HEAD).Trim()
$RemoteSha = (& git -C $RepoRoot rev-parse $UpstreamRef).Trim()
if ($LocalSha -ne $RemoteSha) { Fail "Local candidate is not the live upstream SHA for $UpstreamRef." }

foreach ($Required in @($CredentialVaultPath, $KeystoreVaultPath)) {
    if (-not (Test-Path -LiteralPath $Required -PathType Leaf)) { Fail "Missing target build input: $Required" }
}

$Credential = Get-Content -LiteralPath $CredentialVaultPath -Raw | ConvertFrom-Json
$Credential.android.keystore.keystorePath = "development.jks"

$CleanupNeeded = $false
try {
    Copy-Item -LiteralPath $KeystoreVaultPath -Destination $MaterializedKeystorePath -Force
    Write-JsonNoSecrets -Path $MaterializedCredentialPath -Value $Credential
    $CleanupNeeded = $true

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

    $Fingerprint = Invoke-EasJson @("fingerprint:generate", "--platform", "android", "--build-profile", "development", "--json", "--non-interactive")
    $Hash = [string]$Fingerprint.hash
    if ([string]::IsNullOrWhiteSpace($Hash)) { Fail "Unable to resolve Android fingerprint for $App." }
    Write-Host "ANDROID_FINGERPRINT=$Hash"

    $Builds = @(Invoke-EasJson @("build:list", "--platform", "android", "--build-profile", "development", "--distribution", "internal", "--fingerprint-hash", $Hash, "--limit", "50", "--json", "--non-interactive"))
    $Finished = $Builds | Where-Object { ([string]$_.status).ToUpperInvariant() -eq "FINISHED" } | Sort-Object { [DateTimeOffset]::Parse([string]$_.createdAt) } -Descending | Select-Object -First 1
    $Pending = $Builds | Where-Object { ([string]$_.status).ToUpperInvariant() -in @("IN_PROGRESS", "IN_QUEUE", "NEW") } | Sort-Object { [DateTimeOffset]::Parse([string]$_.createdAt) } -Descending | Select-Object -First 1

    if ($null -ne $Finished) {
        $ActualSourceSha = Get-BuildSourceSha $Finished
        Write-Host "BUILD_DECISION=REUSED app=$App currentCandidateSha=$LocalSha nativeFingerprint=$Hash reusedBuildId=$($Finished.id) reusedBuildActualSourceSha=$ActualSourceSha compatibilityReason=fingerprint"
    }
    elseif ($null -ne $Pending) {
        $ActualSourceSha = Get-BuildSourceSha $Pending
        Write-Host "BUILD_DECISION=REUSED_PENDING app=$App currentCandidateSha=$LocalSha nativeFingerprint=$Hash reusedBuildId=$($Pending.id) reusedBuildActualSourceSha=$ActualSourceSha compatibilityReason=fingerprint"
    }
    else {
        $BuildArgs = @("build", "--platform", "android", "--profile", "development", "--non-interactive", "--json")
        if (-not $Wait) { $BuildArgs += "--no-wait" }
        $Submitted = Invoke-EasJson $BuildArgs
        $BuildId = [string]$Submitted.id
        if ([string]::IsNullOrWhiteSpace($BuildId)) { $BuildId = [string]$Submitted.build.id }
        if ([string]::IsNullOrWhiteSpace($BuildId)) { Fail "EAS submission returned no build ID." }
        Write-Host "BUILD_DECISION=SUBMITTED app=$App currentCandidateSha=$LocalSha nativeFingerprint=$Hash submittedBuildId=$BuildId compatibilityReason=new-build"
    }
}
finally {
    if ($CleanupNeeded) {
        foreach ($Path in @($MaterializedCredentialPath, $MaterializedKeystorePath)) {
            if (Test-Path -LiteralPath $Path) { Remove-Item -LiteralPath $Path -Force }
        }
    }
    $StatusAfter = @(& git -C $RepoRoot status --porcelain --untracked-files=all)
    if (($StatusBefore -join [Environment]::NewLine) -ne ($StatusAfter -join [Environment]::NewLine)) {
        throw "mobile:build changed repository state."
    }
}

Write-Host "MOBILE_BUILD=PASS app=$App currentCandidateSha=$LocalSha"
