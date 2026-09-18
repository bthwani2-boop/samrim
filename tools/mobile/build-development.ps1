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
$EasCliVersion = "24.7.0"
$Config = Get-Content -LiteralPath (Join-Path $AppRoot "mobile.config.json") -Raw | ConvertFrom-Json
$PackageName = [string]$Config.androidPackage
$ProjectId = [string]$Config.projectId
$FirebasePath = Join-Path $SecretsRoot ("firebase\" + $App + "\google-services.json")
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

$StatusBefore = @(& git -C $RepoRoot status --porcelain --untracked-files=all)
if ($StatusBefore.Count -gt 0) { Fail "Candidate must be clean before remote build." }
$Branch = (& git -C $RepoRoot branch --show-current).Trim()
if ($Branch -ne "r") { Fail "Remote build is authorized only from branch r." }
$LocalSha = (& git -C $RepoRoot rev-parse HEAD).Trim()
$RemoteLine = @(& git -C $RepoRoot ls-remote --heads origin refs/heads/r)
if ($LASTEXITCODE -ne 0 -or $RemoteLine.Count -ne 1) { Fail "Unable to read live origin/r." }
$RemoteSha = ($RemoteLine[0] -split "\s+")[0].Trim()
if ($LocalSha -ne $RemoteSha) { Fail "Local candidate is not the live remote r SHA." }

foreach ($Required in @($FirebasePath, $CredentialVaultPath, $KeystoreVaultPath)) {
    if (-not (Test-Path -LiteralPath $Required -PathType Leaf)) { Fail "Missing target build input: $Required" }
}

$Firebase = Get-Content -LiteralPath $FirebasePath -Raw | ConvertFrom-Json
$FirebasePackages = @($Firebase.client | ForEach-Object { $_.client_info.android_client_info.package_name })
if ($PackageName -notin $FirebasePackages) { Fail "Firebase registration does not match $PackageName." }

$env:GOOGLE_SERVICES_JSON = $FirebasePath
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

    $EnvText = Invoke-EasText @("env:list", "development", "--format", "long", "--scope", "project")
    $GoogleEnvBlocks = @(
        $EnvText -split '(?m)(?=^ID\s{2,})' |
            Where-Object {
                $_ -match '(?m)^Name\s{2,}GOOGLE_SERVICES_JSON\s*$'
            }
    )
    if ($GoogleEnvBlocks.Count -ne 1) {
        Fail "EAS development GOOGLE_SERVICES_JSON variable count was $($GoogleEnvBlocks.Count) for $App."
    }
    $GoogleEnvType = [regex]::Match(
        $GoogleEnvBlocks[0],
        '(?m)^type\s{2,}(\S+)\s*$'
    )
    if (-not $GoogleEnvType.Success -or $GoogleEnvType.Groups[1].Value.ToLowerInvariant() -ne "file") {
        Fail "EAS GOOGLE_SERVICES_JSON is not a File environment variable for $App."
    }
    Write-Host "GOOGLE_SERVICES_REMOTE_BUILD=PASS app=$App variable=GOOGLE_SERVICES_JSON type=File"

    $CredentialReadback = Invoke-EasText @("credentials", "--platform", "android", "--non-interactive")
    if ($CredentialReadback -notmatch "(?i)FCM|service.account|google.*key") {
        Fail "FCM V1 service-account credential was not proven by EAS credentials readback for $App."
    }
    Write-Host "FCM_V1_CREDENTIAL=PASS app=$App"

    $Fingerprint = Invoke-EasJson @("fingerprint:generate", "--platform", "android", "--build-profile", "development", "--json", "--non-interactive")
    $Hash = [string]$Fingerprint.hash
    if ([string]::IsNullOrWhiteSpace($Hash)) { Fail "Unable to resolve Android fingerprint for $App." }
    Write-Host "ANDROID_FINGERPRINT=$Hash"

    $Builds = @(Invoke-EasJson @("build:list", "--platform", "android", "--build-profile", "development", "--distribution", "internal", "--fingerprint-hash", $Hash, "--limit", "50", "--json", "--non-interactive"))
    $Finished = $Builds | Where-Object { ([string]$_.status).ToUpperInvariant() -eq "FINISHED" } | Sort-Object { [DateTimeOffset]::Parse([string]$_.createdAt) } -Descending | Select-Object -First 1
    $Pending = $Builds | Where-Object { ([string]$_.status).ToUpperInvariant() -in @("IN_PROGRESS", "IN_QUEUE", "NEW") } | Sort-Object { [DateTimeOffset]::Parse([string]$_.createdAt) } -Descending | Select-Object -First 1

    if ($null -ne $Finished) {
        Write-Host "BUILD_DECISION=REUSED app=$App buildId=$($Finished.id) fingerprint=$Hash sourceSha=$LocalSha"
    }
    elseif ($null -ne $Pending) {
        Write-Host "BUILD_DECISION=REUSED_PENDING app=$App buildId=$($Pending.id) fingerprint=$Hash sourceSha=$LocalSha"
    }
    else {
        $BuildArgs = @("build", "--platform", "android", "--profile", "development", "--non-interactive", "--json")
        if (-not $Wait) { $BuildArgs += "--no-wait" }
        $Submitted = Invoke-EasJson $BuildArgs
        $BuildId = [string]$Submitted.id
        if ([string]::IsNullOrWhiteSpace($BuildId)) { $BuildId = [string]$Submitted.build.id }
        if ([string]::IsNullOrWhiteSpace($BuildId)) { Fail "EAS submission returned no build ID." }
        Write-Host "BUILD_DECISION=SUBMITTED app=$App buildId=$BuildId fingerprint=$Hash sourceSha=$LocalSha"
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

Write-Host "MOBILE_BUILD=PASS app=$App sourceSha=$LocalSha"
