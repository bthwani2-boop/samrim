#Requires -Version 7.4
[CmdletBinding()]
param(
    [string] $ExpectedBranch = "",
    [switch] $SkipFetch,
    [switch] $SkipRuntime
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$repo = (Resolve-Path (Join-Path $PSScriptRoot "..\..")).Path

function Fail([string] $Message) {
    Write-Error $Message
    exit 1
}

function Run-NativeStep([string] $Name, [scriptblock] $Action) {
    Write-Host ""
    Write-Host "=== $Name ==="
    $global:LASTEXITCODE = 0
    & $Action
    if ($LASTEXITCODE -ne 0) {
        Fail "$Name failed with exit code $LASTEXITCODE"
    }
}

function Assert-CleanTree([string] $Context) {
    $status = @(& git status --porcelain --untracked-files=all)
    if ($LASTEXITCODE -ne 0) {
        Fail "Unable to inspect Git status during $Context."
    }

    if ($status.Count -gt 0) {
        Fail (
            "Repository must remain clean during ${Context}:" +
            [Environment]::NewLine +
            ($status -join [Environment]::NewLine)
        )
    }
}

function Assert-Equal(
    [string] $Label,
    [AllowNull()] $Actual,
    [AllowNull()] $Expected
) {
    if ([string] $Actual -ne [string] $Expected) {
        Fail "$Label mismatch: actual='$Actual' expected='$Expected'"
    }
}

function Verify-ExpoConfig([string] $App) {
    $appRoot = Join-Path $repo ("apps\" + $App)
    $mobileConfigPath = Join-Path $appRoot "mobile.config.json"

    if (-not (Test-Path $mobileConfigPath -PathType Leaf)) {
        Fail "$App mobile.config.json is missing."
    }

    $mobile = Get-Content $mobileConfigPath -Raw | ConvertFrom-Json

    $utf8 = [Text.UTF8Encoding]::new($false)
    $processInfo = [Diagnostics.ProcessStartInfo]::new()
    $processInfo.FileName = "cmd.exe"
    $processInfo.WorkingDirectory = $appRoot
    $processInfo.UseShellExecute = $false
    $processInfo.CreateNoWindow = $true
    $processInfo.RedirectStandardOutput = $true
    $processInfo.RedirectStandardError = $true
    $processInfo.StandardOutputEncoding = $utf8
    $processInfo.StandardErrorEncoding = $utf8
    $null = $processInfo.ArgumentList.Add("/d")
    $null = $processInfo.ArgumentList.Add("/s")
    $null = $processInfo.ArgumentList.Add("/c")
    $null = $processInfo.ArgumentList.Add("pnpm exec expo config --type public --json")

    $process = [Diagnostics.Process]::new()
    $process.StartInfo = $processInfo

    try {
        if (-not $process.Start()) {
            Fail "$App Expo config process failed to start."
        }

        $stdoutTask = $process.StandardOutput.ReadToEndAsync()
        $stderrTask = $process.StandardError.ReadToEndAsync()
        $process.WaitForExit()

        $jsonText = $stdoutTask.GetAwaiter().GetResult().Trim()
        $stderr = $stderrTask.GetAwaiter().GetResult().Trim()

        if ($process.ExitCode -ne 0) {
            if (-not [string]::IsNullOrWhiteSpace($stderr)) {
                Write-Host $stderr
            }
            Fail "$App Expo config resolution failed with exit code $($process.ExitCode)."
        }
    }
    finally {
        $process.Dispose()
    }

    if ([string]::IsNullOrWhiteSpace($jsonText)) {
        Fail "$App Expo config returned empty output."
    }

    try {
        $resolved = $jsonText | ConvertFrom-Json
    }
    catch {
        Fail "$App Expo config did not return valid JSON: $($_.Exception.Message)"
    }

    Assert-Equal "$App name" $resolved.name $mobile.name
    Assert-Equal "$App slug" $resolved.slug $mobile.slug
    Assert-Equal "$App owner" $resolved.owner $mobile.owner
    Assert-Equal "$App scheme" $resolved.scheme $mobile.scheme
    Assert-Equal "$App version" $resolved.version $mobile.version
    Assert-Equal "$App Android package" $resolved.android.package $mobile.androidPackage
    Assert-Equal "$App iOS bundleIdentifier" $resolved.ios.bundleIdentifier $mobile.iosBundleIdentifier
    Assert-Equal "$App EAS projectId" $resolved.extra.eas.projectId $mobile.projectId
    Assert-Equal "$App update URL" $resolved.updates.url ("https://u.expo.dev/" + $mobile.projectId)

    Write-Host "EXPO_CONFIG=PASS $App"
}

Push-Location $repo
try {
    Write-Host "Repository: $repo"

    $branch = (& git branch --show-current).Trim()
    if ($LASTEXITCODE -ne 0 -or [string]::IsNullOrWhiteSpace($branch)) {
        Fail "Unable to determine current Git branch."
    }

    Write-Host "Branch: $branch"

    $verificationBranch = if ([string]::IsNullOrWhiteSpace($ExpectedBranch)) {
        $branch
    }
    else {
        $ExpectedBranch
    }

    if (-not [string]::IsNullOrWhiteSpace($ExpectedBranch) -and $branch -ne $ExpectedBranch) {
        Fail "Expected branch '$ExpectedBranch', found '$branch'."
    }

    Assert-CleanTree "local candidate proof start"

    if (-not $SkipFetch) {
        Run-NativeStep "Fetch exact remote candidate" {
            git fetch origin $verificationBranch --prune
        }

        $localHead = (& git rev-parse HEAD).Trim()
        $remoteHead = (& git rev-parse ("origin/" + $verificationBranch)).Trim()

        if ($LASTEXITCODE -ne 0) {
            Fail "Unable to resolve exact local/remote candidate."
        }

        Assert-Equal "Exact candidate HEAD" $localHead $remoteHead
        Write-Host "EXACT_HEAD_SHA=$localHead"
    }

    $nodeVersion = (& node --version).Trim()
    $pnpmVersion = (& pnpm --version).Trim()
    $goVersion = (& go version | Out-String).Trim()

    Assert-Equal "Node" $nodeVersion "v24.17.0"
    Assert-Equal "pnpm" $pnpmVersion "10.34.0"
    if ($goVersion -notmatch "\bgo1\.27\.1\b") {
        Fail "Expected Go 1.27.1, found '$goVersion'."
    }

    Run-NativeStep "Docker daemon availability" {
        docker version *> $null
    }

    Run-NativeStep "Repository structure" {
        node tools/dev/verify-repository-structure.mjs
    }

    Run-NativeStep "Structural hygiene" {
        node tools/dev/verify-structural-hygiene.mjs
    }

    Run-NativeStep "Docs parity" {
        pnpm run docs:verify:all
    }

    Run-NativeStep "Knowledge-system invariants" {
        pnpm run knowledge:verify:all
    }

    Run-NativeStep "PowerShell syntax" {
        pwsh -NoProfile -ExecutionPolicy Bypass -File tools/dev/verify-powershell-syntax.ps1
    }

    Run-NativeStep "Frozen workspace install" {
        pnpm install --frozen-lockfile
    }

    Run-NativeStep "Mobile deployable identity schema" {
        pnpm run mobile:verify-config
    }

    Run-NativeStep "Workspace dependency references" {
        node tools/dev/verify-workspace-dependencies.mjs
    }

    Run-NativeStep "Nx project tags" {
        pnpm run nx:verify-tags
    }

    Run-NativeStep "Nx project discovery" {
        pnpm run nx:projects
    }

    foreach ($app in @("app-client", "app-partner", "app-captain", "app-field")) {
        Write-Host ""
        Write-Host "=== Resolve Expo host config: $app ==="
        Verify-ExpoConfig -App $app
    }

    Run-NativeStep "Developer doctor" {
        pwsh -NoProfile -ExecutionPolicy Bypass -File tools/dev/doctor.ps1 -ExpectedBranch $verificationBranch
    }

    Run-NativeStep "Developer bootstrap" {
        pwsh -NoProfile -ExecutionPolicy Bypass -File tools/dev/bootstrap.ps1
    }

    Assert-CleanTree "developer bootstrap"

    Run-NativeStep "Workspace verification" {
        pnpm run workspace:verify
    }

    Run-NativeStep "Integration compose config" {
        docker compose --env-file infra/local/compose/.env.example -f infra/local/compose/compose.yaml --profile integration config *> $null
    }

    Assert-CleanTree "pre-runtime integration proof"

    if (-not $SkipRuntime) {
        Run-NativeStep "Integration runtime closure" {
            pwsh -NoProfile -ExecutionPolicy Bypass -File tools/dev/close-integration-runtime.ps1 -ExpectedBranch $verificationBranch
        }
    }

    Assert-CleanTree "local candidate proof completion"

    Write-Host ""
    Write-Host "LOCAL_CANDIDATE_WINDOWS_PROOF=PASS"
    Write-Host "LOCAL_CANDIDATE_EXPO_CONFIG=PASS"
    Write-Host "LOCAL_CANDIDATE_WORKSPACE=PASS"
    if (-not $SkipRuntime) {
        Write-Host "LOCAL_CANDIDATE_RUNTIME=PASS"
    }
}
finally {
    Pop-Location
}
