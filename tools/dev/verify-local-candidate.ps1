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
$runtimeProcesses = [System.Collections.Generic.List[object]]::new()
$runtimeSecretValues = [System.Collections.Generic.List[string]]::new()
$dailyRuntimeStarted = $false

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


function Read-LocalEnvMap {
    $path = Join-Path $repo "infra\local\compose\.env"
    if (-not (Test-Path -LiteralPath $path -PathType Leaf)) { Fail "Local runtime environment is missing: $path" }
    $map = @{}
    foreach ($line in Get-Content -LiteralPath $path) {
        $trimmed = $line.Trim()
        if (-not $trimmed -or $trimmed.StartsWith("#")) { continue }
        $parts = $trimmed.Split("=", 2)
        if ($parts.Count -eq 2) { $map[$parts[0].Trim()] = $parts[1].Trim() }
    }
    return $map
}

function Register-RuntimeSecrets([hashtable] $EnvMap) {
    foreach ($entry in $EnvMap.GetEnumerator()) {
        $key = [string] $entry.Key
        $value = [string] $entry.Value
        if ($value.Length -ge 8 -and $key -match "(?i)(PASSWORD|SECRET|TOKEN|HMAC|PRIVATE|KEY)") {
            if (-not $runtimeSecretValues.Contains($value)) { $runtimeSecretValues.Add($value) }
        }
    }
}

function Redact-RuntimeText([string] $Text) {
    $result = $Text
    foreach ($secret in $runtimeSecretValues) {
        if (-not [string]::IsNullOrEmpty($secret)) { $result = $result.Replace($secret, "<redacted>") }
    }
    return $result
}

function Assert-NoRuntimeSecretLeak([string] $Text, [string] $Label) {
    foreach ($secret in $runtimeSecretValues) {
        if (-not [string]::IsNullOrEmpty($secret) -and $Text.Contains($secret)) { Fail "$Label emitted a local secret value." }
    }
}

function Get-RuntimeListeners([int] $Port) {
    return @(Get-NetTCPConnection -State Listen -LocalPort $Port -ErrorAction SilentlyContinue)
}

function Assert-RuntimePortFree([int] $Port, [string] $Label) {
    $listeners = @(Get-RuntimeListeners -Port $Port)
    if ($listeners.Count -gt 0) {
        $details = ($listeners | Select-Object LocalAddress, LocalPort, OwningProcess | Format-Table -AutoSize | Out-String).Trim()
        Fail "$Label requires free port $Port.$([Environment]::NewLine)$details"
    }
}

function Assert-IPv4LoopbackListener([int] $Port, [string] $Label) {
    $listeners = @(Get-RuntimeListeners -Port $Port)
    if ($listeners.Count -eq 0) { Fail "$Label has no listener on port $Port." }
    $bad = @($listeners | Where-Object { $_.LocalAddress -ne "127.0.0.1" })
    if ($bad.Count -gt 0) {
        $details = ($bad | Select-Object LocalAddress, LocalPort, OwningProcess | Format-Table -AutoSize | Out-String).Trim()
        Fail "$Label must bind only to 127.0.0.1.$([Environment]::NewLine)$details"
    }
    Write-Host "RUNTIME_LOOPBACK=PASS label=$Label port=$Port address=127.0.0.1"
}

function Assert-LocalhostListener([int] $Port, [string] $Label) {
    $listeners = @(Get-RuntimeListeners -Port $Port)
    if ($listeners.Count -eq 0) { Fail "$Label has no listener on port $Port." }
    $bad = @($listeners | Where-Object { $_.LocalAddress -notin @("127.0.0.1", "::1") })
    if ($bad.Count -gt 0) {
        $details = ($bad | Select-Object LocalAddress, LocalPort, OwningProcess | Format-Table -AutoSize | Out-String).Trim()
        Fail "$Label is not localhost-only.$([Environment]::NewLine)$details"
    }
    Write-Host "RUNTIME_LOCALHOST=PASS label=$Label port=$Port"
}

function Start-CapturedRuntimeProcess([string] $Name, [string] $Command, [hashtable] $EnvMap, [hashtable] $ExtraEnvironment = @{}) {
    $utf8 = [Text.UTF8Encoding]::new($false)
    $processInfo = [Diagnostics.ProcessStartInfo]::new()
    $processInfo.FileName = (Get-Command pwsh -ErrorAction Stop).Source
    $processInfo.WorkingDirectory = $repo
    $processInfo.UseShellExecute = $false
    $processInfo.CreateNoWindow = $true
    $processInfo.RedirectStandardOutput = $true
    $processInfo.RedirectStandardError = $true
    $processInfo.StandardOutputEncoding = $utf8
    $processInfo.StandardErrorEncoding = $utf8
    foreach ($key in $EnvMap.Keys) { $null = $processInfo.Environment.Remove([string] $key) }
    foreach ($key in @("PORT","BTHWANI_LISTEN_HOST","BTHWANI_EXPECTED_DATABASE_HOST","BTHWANI_EXPECTED_DATABASE_PORT","BTHWANI_EXPECTED_DATABASE_NAME","BTHWANI_EXPECTED_DATABASE_USER","IDENTITY_DATABASE_URL","IDENTITY_MAINTENANCE_DATABASE_URL","IDENTITY_MIGRATION_DATABASE_URL","IDENTITY_MAILPIT_SMTP_ADDR","IDENTITY_AUTO_MIGRATE","DSH_IDENTITY_API_BASE_URL")) { $null = $processInfo.Environment.Remove($key) }
    foreach ($entry in $ExtraEnvironment.GetEnumerator()) { $processInfo.Environment[[string] $entry.Key] = [string] $entry.Value }
    $null = $processInfo.ArgumentList.Add("-NoProfile")
    $null = $processInfo.ArgumentList.Add("-NonInteractive")
    $null = $processInfo.ArgumentList.Add("-ExecutionPolicy")
    $null = $processInfo.ArgumentList.Add("Bypass")
    $null = $processInfo.ArgumentList.Add("-Command")
    $null = $processInfo.ArgumentList.Add($Command)
    $process = [Diagnostics.Process]::new()
    $process.StartInfo = $processInfo
    if (-not $process.Start()) { Fail "Unable to start runtime process: $Name" }
    $record = [pscustomobject]@{ Name=$Name; Process=$process; StdoutTask=$process.StandardOutput.ReadToEndAsync(); StderrTask=$process.StandardError.ReadToEndAsync(); Output=$null; CleanupPids=@() }
    $runtimeProcesses.Add($record)
    Write-Host "RUNTIME_PROCESS_STARTED name=$Name pid=$($process.Id)"
    return $record
}

function Stop-RuntimeProcess($Record) {
    if ($null -eq $Record) { return }
    if (-not $Record.Process.HasExited) {
        & taskkill.exe /PID $Record.Process.Id /T /F *> $null
        try { $null = $Record.Process.WaitForExit(10000) } catch {}
    }
    foreach ($processId in @($Record.CleanupPids | Sort-Object -Unique)) {
        if ($processId -gt 0 -and (Get-Process -Id $processId -ErrorAction SilentlyContinue)) {
            & taskkill.exe /PID $processId /T /F *> $null
        }
    }
}

function Get-RuntimeProcessOutput($Record) {
    if ($null -ne $Record.Output) { return [string] $Record.Output }
    if (-not $Record.Process.HasExited) { Stop-RuntimeProcess -Record $Record }
    try { $Record.Process.WaitForExit() } catch {}
    $stdout = $Record.StdoutTask.GetAwaiter().GetResult()
    $stderr = $Record.StderrTask.GetAwaiter().GetResult()
    $Record.Output = [string] $stdout + [Environment]::NewLine + [string] $stderr
    return [string] $Record.Output
}

function Fail-WithRuntimeOutput($Record, [string] $Message) {
    $output = Get-RuntimeProcessOutput -Record $Record
    $redacted = Redact-RuntimeText -Text $output
    $lines = @($redacted -split "\r?\n")
    Write-Host ""
    Write-Host "--- $($Record.Name) output tail ---"
    Write-Host (($lines | Select-Object -Last 60) -join [Environment]::NewLine)
    Fail $Message
}

function Wait-JsonRuntimeEndpoint([string] $Uri, [string] $ExpectedService, $Record, [int] $TimeoutSeconds = 120) {
    $deadline = [DateTime]::UtcNow.AddSeconds($TimeoutSeconds)
    while ([DateTime]::UtcNow -lt $deadline) {
        if ($Record.Process.HasExited) { Fail-WithRuntimeOutput -Record $Record -Message "Process exited before endpoint became ready: $Uri" }
        try {
            $response = Invoke-RestMethod -Uri $Uri -Method Get -TimeoutSec 5
            if ($response.status -eq "ok" -and $response.service -eq $ExpectedService) {
                $Record.CleanupPids = @(Get-RuntimeListeners -Port ([Uri] $Uri).Port | Select-Object -ExpandProperty OwningProcess -Unique)
                return
            }
        } catch {}
        Start-Sleep -Milliseconds 500
    }
    Fail-WithRuntimeOutput -Record $Record -Message "Timed out waiting for endpoint: $Uri"
}

function Wait-IPv4RuntimeListener([int] $Port, $Record, [int] $TimeoutSeconds = 120) {
    $deadline = [DateTime]::UtcNow.AddSeconds($TimeoutSeconds)
    while ([DateTime]::UtcNow -lt $deadline) {
        if ($Record.Process.HasExited) { Fail-WithRuntimeOutput -Record $Record -Message "Process exited before 127.0.0.1:$Port became ready." }
        $listeners = @(Get-RuntimeListeners -Port $Port)
        if (@($listeners | Where-Object { $_.LocalAddress -eq "127.0.0.1" }).Count -gt 0) {
            $Record.CleanupPids = @($listeners | Select-Object -ExpandProperty OwningProcess -Unique)
            Assert-IPv4LoopbackListener -Port $Port -Label $Record.Name
            return
        }
        Start-Sleep -Milliseconds 500
    }
    Fail-WithRuntimeOutput -Record $Record -Message "Timed out waiting for 127.0.0.1:$Port."
}

function Test-LocalhostHttp([int] $Port) {
    foreach ($uri in @("http://localhost:$Port/status","http://localhost:$Port/")) {
        try {
            $response = Invoke-WebRequest -Uri $uri -Method Get -TimeoutSec 5 -SkipHttpErrorCheck
            if ($response.StatusCode -ge 200 -and $response.StatusCode -lt 500) { return $true }
        } catch {}
    }
    return $false
}

function Wait-ExpoLocalhost([int] $Port, $Record, [int] $TimeoutSeconds = 120) {
    $deadline = [DateTime]::UtcNow.AddSeconds($TimeoutSeconds)
    while ([DateTime]::UtcNow -lt $deadline) {
        if ($Record.Process.HasExited) { Fail-WithRuntimeOutput -Record $Record -Message "Expo process exited before localhost:$Port became ready." }
        $listeners = @(Get-RuntimeListeners -Port $Port)
        $loopback = @($listeners | Where-Object { $_.LocalAddress -in @("127.0.0.1","::1") })
        if ($loopback.Count -gt 0) {
            $Record.CleanupPids = @($loopback | Select-Object -ExpandProperty OwningProcess -Unique)
            Assert-LocalhostListener -Port $Port -Label $Record.Name
            if (Test-LocalhostHttp -Port $Port) { return }
        }
        Start-Sleep -Milliseconds 500
    }
    Fail-WithRuntimeOutput -Record $Record -Message "Timed out waiting for Expo localhost server on port $Port."
}

function Resolve-RuntimeAdbSerial {
    if (-not (Get-Command adb -ErrorAction SilentlyContinue)) { Fail "adb is required for local mobile runtime proof." }
    $devices = @(& adb devices | Where-Object { $_ -match "\tdevice$" } | ForEach-Object { ($_ -split "\t",2)[0].Trim() } | Where-Object { $_ })
    if (-not [string]::IsNullOrWhiteSpace($env:BTHWANI_ADB_SERIAL)) {
        if ($env:BTHWANI_ADB_SERIAL -notin $devices) { Fail "BTHWANI_ADB_SERIAL is not online: $($env:BTHWANI_ADB_SERIAL)" }
        return $env:BTHWANI_ADB_SERIAL
    }
    $tcpDevices = @($devices | Where-Object { $_ -match "^\d{1,3}(?:\.\d{1,3}){3}:\d+$" })
    if ($tcpDevices.Count -eq 1) { return $tcpDevices[0] }
    if ($devices.Count -eq 1) { return $devices[0] }
    Fail "ADB target is not deterministic. Online devices: $($devices -join ', ')"
}

function Assert-RuntimeAdbReverse([string] $Serial,[int] $MetroPort) {
    $rows = @(& adb -s $Serial reverse --list)
    if ($LASTEXITCODE -ne 0) { Fail "adb reverse --list failed for $Serial." }
    foreach ($port in @($MetroPort,18082,58080)) {
        $needle = "tcp:$port tcp:$port"
        if (@($rows | Where-Object { $_ -like "*$needle*" }).Count -eq 0) { Fail "ADB reverse mapping missing: $needle" }
    }
}

function Assert-RuntimeFirewallHygiene {
    $temporaryGoRules = @()
    $broadNodeRules = @()
    foreach ($rule in Get-NetFirewallRule -Direction Inbound -Action Allow -ErrorAction Stop) {
        try { $program = ($rule | Get-NetFirewallApplicationFilter -ErrorAction Stop).Program } catch { continue }
        if (-not $program -or $program -eq "Any") { continue }
        $programPath = $program.Trim('"')
        if ($programPath -match "(?i)\\AppData\\Local\\Temp\\go-build[^\\]*\\.*\\api\.exe$" -or $programPath -match "(?i)\\AppData\\Local\\go-build\\.*\\api\.exe$") { $temporaryGoRules += $rule.Name }
        if ($programPath -ieq "C:\Program Files\nodejs\node.exe") {
            try {
                $portFilter = $rule | Get-NetFirewallPortFilter -ErrorAction Stop
                if ([string] $portFilter.LocalPort -eq "Any") { $broadNodeRules += $rule.Name }
            } catch {}
        }
    }
    if ($temporaryGoRules.Count -gt 0) { Fail "Temporary go-build api.exe inbound Allow rules remain: $($temporaryGoRules.Count)" }
    if ($broadNodeRules.Count -gt 0) { Fail "Broad Node.js inbound Any-port Allow rules remain: $($broadNodeRules.Count)" }
    Write-Host "FIREWALL_HYGIENE=PASS"
}

function Stop-AllRuntimeProcesses {
    foreach ($record in @($runtimeProcesses)) {
        Stop-RuntimeProcess -Record $record
        $output = Get-RuntimeProcessOutput -Record $record
        Assert-NoRuntimeSecretLeak -Text $output -Label $record.Name
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

    Run-NativeStep "Local runtime ownership" {
        node tools/dev/verify-local-runtime-ownership.mjs
    }

    Run-NativeStep "Theme authority" {
        node --loader ./tools/dev/ts-resolver.mjs tools/dev/verify-theme-authority.mjs
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
        Write-Host ""
        Write-Host "=== Local daily infrastructure readiness ==="

        $envMap = Read-LocalEnvMap
        if ([string] $envMap["BTHWANI_ENV"] -ne "development") { Fail "Local runtime proof requires BTHWANI_ENV=development." }
        Register-RuntimeSecrets -EnvMap $envMap

        $identityPort = [int] $envMap["SAMRIM_IDENTITY_PORT"]
        $dshPort = [int] $envMap["SAMRIM_DSH_PORT"]
        $postgresPort = [int] $envMap["SAMRIM_POSTGRES_PORT"]
        $mailpitSmtpPort = [int] $envMap["SAMRIM_MAILPIT_SMTP_PORT"]
        $mailpitWebPort = [int] $envMap["SAMRIM_MAILPIT_WEB_PORT"]
        $metroPorts = @{ client=18101; partner=18102; captain=18103; field=18104 }

        foreach ($port in @(13000,$identityPort,$dshPort,18101,18102,18103,18104)) { Assert-RuntimePortFree -Port $port -Label "Deterministic local runtime proof" }

        pnpm runtime:daily:up
        if ($LASTEXITCODE -ne 0) { Fail "runtime:daily:up failed." }
        $dailyRuntimeStarted = $true

        foreach ($entry in @(@{Name="PostgreSQL";Port=$postgresPort},@{Name="Mailpit SMTP";Port=$mailpitSmtpPort},@{Name="Mailpit Web";Port=$mailpitWebPort})) {
            Assert-IPv4LoopbackListener -Port ([int] $entry.Port) -Label ([string] $entry.Name)
        }

        $postgresId = (docker compose --env-file infra/local/compose/.env -f infra/local/compose/compose.yaml ps -q postgres).Trim()
        if ([string]::IsNullOrWhiteSpace($postgresId)) { Fail "Unable to resolve local PostgreSQL container." }
        $postgresHealth = (docker inspect --format "{{.State.Health.Status}}" $postgresId).Trim()
        if ($postgresHealth -ne "healthy") { Fail "runtime:daily:up returned before PostgreSQL became healthy: $postgresHealth" }
        Write-Host "POSTGRES_READINESS=PASS state=healthy"

        $unexpectedIntegrationServices = @(
            docker compose --env-file infra/local/compose/.env -f infra/local/compose/compose.yaml --profile integration ps --status running --services identity dsh
        )
        if ($LASTEXITCODE -ne 0) { Fail "Unable to census integration-only Docker services during DAILY_DEV proof." }
        if ($unexpectedIntegrationServices.Count -gt 0) {
            Fail ("DAILY_DEV unexpectedly owns domain services in Docker: " + ($unexpectedIntegrationServices -join ", "))
        }
        Write-Host "DAILY_RUNTIME_DOCKER_DOMAIN_SERVICES=0"

        Write-Host ""
        Write-Host "=== Canonical daily host commands from clean child environments ==="

        $identity = Start-CapturedRuntimeProcess -Name "identity" -Command "pnpm identity" -EnvMap $envMap
        Wait-JsonRuntimeEndpoint -Uri "http://127.0.0.1:$identityPort/identity/health" -ExpectedService "identity" -Record $identity
        Wait-JsonRuntimeEndpoint -Uri "http://127.0.0.1:$identityPort/identity/readiness" -ExpectedService "identity" -Record $identity
        Assert-IPv4LoopbackListener -Port $identityPort -Label "Identity"

        $dsh = Start-CapturedRuntimeProcess -Name "dsh" -Command "pnpm dsh" -EnvMap $envMap
        Wait-JsonRuntimeEndpoint -Uri "http://127.0.0.1:$dshPort/dsh/health" -ExpectedService "dsh" -Record $dsh
        Wait-JsonRuntimeEndpoint -Uri "http://127.0.0.1:$dshPort/dsh/readiness" -ExpectedService "dsh" -Record $dsh
        Assert-IPv4LoopbackListener -Port $dshPort -Label "DSH"

        $control = Start-CapturedRuntimeProcess -Name "control" -Command "pnpm control" -EnvMap $envMap
        Wait-IPv4RuntimeListener -Port 13000 -Record $control
        $controlReady = $false
        for ($attempt=1; $attempt -le 60; $attempt++) {
            if ($control.Process.HasExited) { Fail-WithRuntimeOutput -Record $control -Message "Control Panel exited before becoming reachable." }
            try {
                $response = Invoke-WebRequest -Uri "http://127.0.0.1:13000/" -Method Get -TimeoutSec 5 -SkipHttpErrorCheck
                if ($response.StatusCode -ge 200 -and $response.StatusCode -lt 500) {
                    $controlReady = $true
                    Write-Host "CONTROL_RUNTIME=PASS status=$($response.StatusCode)"
                    break
                }
            } catch {}
            Start-Sleep -Milliseconds 500
        }
        if (-not $controlReady) { Fail-WithRuntimeOutput -Record $control -Message "Control Panel did not become reachable." }

        Write-Host ""
        Write-Host "=== Canonical mobile runtime proof ==="
        $adbSerial = Resolve-RuntimeAdbSerial
        Write-Host "ADB_TARGET=PASS serial=$adbSerial"

        foreach ($app in @("client","partner","captain","field")) {
            $metroPort = [int] $metroPorts[$app]
            Assert-RuntimePortFree -Port $metroPort -Label "$app Metro"
            $mobile = Start-CapturedRuntimeProcess -Name ("mobile-"+$app) -Command ("pnpm "+$app) -EnvMap $envMap -ExtraEnvironment @{BTHWANI_ADB_SERIAL=$adbSerial}
            Wait-ExpoLocalhost -Port $metroPort -Record $mobile
            Assert-RuntimeAdbReverse -Serial $adbSerial -MetroPort $metroPort
            Stop-RuntimeProcess -Record $mobile
            $mobileOutput = Get-RuntimeProcessOutput -Record $mobile
            Assert-NoRuntimeSecretLeak -Text $mobileOutput -Label ("mobile-"+$app)
            if ($mobileOutput -notmatch "ADB_REVERSE=READY") { Fail "$app launcher did not report ADB_REVERSE=READY." }
            Write-Host "MOBILE_RUNTIME=PASS app=$app port=$metroPort"
        }

        Write-Host ""
        Write-Host "=== Host runtime secret-output proof and shutdown ==="
        Stop-AllRuntimeProcesses
        pnpm runtime:daily:down
        if ($LASTEXITCODE -ne 0) { Fail "runtime:daily:down failed." }
        $dailyRuntimeStarted = $false

        foreach ($port in @(13000,$identityPort,$dshPort,18101,18102,18103,18104,$postgresPort,$mailpitSmtpPort,$mailpitWebPort)) {
            if (@(Get-RuntimeListeners -Port $port).Count -gt 0) { Fail "Port remains open after daily runtime shutdown: $port" }
        }

        Write-Host "HOST_RUNTIME_SECRET_OUTPUT=PASS"
        Write-Host "DAILY_RUNTIME_FINAL_PORTS=CLOSED"

        Run-NativeStep "Integration runtime closure" {
            pwsh -NoProfile -ExecutionPolicy Bypass -File tools/dev/close-integration-runtime.ps1 -ExpectedBranch $verificationBranch
        }

        Assert-RuntimeFirewallHygiene

        foreach ($port in @(13000,$identityPort,$dshPort,18101,18102,18103,18104,$postgresPort,$mailpitSmtpPort,$mailpitWebPort)) {
            if (@(Get-RuntimeListeners -Port $port).Count -gt 0) { Fail "Port remains open after complete local candidate runtime closure: $port" }
        }
        Write-Host "LOCAL_RUNTIME_FINAL_PORTS=CLOSED"
    }

    Assert-CleanTree "local candidate proof completion"

    Write-Host ""
    Write-Host "LOCAL_CANDIDATE_WINDOWS_PROOF=PASS"
    Write-Host "LOCAL_CANDIDATE_EXPO_CONFIG=PASS"
    Write-Host "LOCAL_CANDIDATE_WORKSPACE=PASS"
    if (-not $SkipRuntime) {
        Write-Host "POSTGRES_READINESS=PASS"
        Write-Host "LOCAL_HOST_RUNTIME=PASS"
        Write-Host "LOCAL_MOBILE_RUNTIME=PASS"
        Write-Host "LOCAL_LOOPBACK_EXPOSURE=PASS"
        Write-Host "LOCAL_RUNTIME_SECRET_OUTPUT=PASS"
        Write-Host "INTEGRATION_RUNTIME_CLOSURE=PASS"
        Write-Host "FIREWALL_HYGIENE=PASS"
        Write-Host "LOCAL_RUNTIME_FINAL_PORTS=CLOSED"
        Write-Host "LOCAL_CANDIDATE_RUNTIME=PASS"
    }
}
finally {
    foreach ($record in @($runtimeProcesses)) {
        try {
            Stop-RuntimeProcess -Record $record
            $null = Get-RuntimeProcessOutput -Record $record
        } catch {}
    }
    if ($dailyRuntimeStarted) {
        try { pnpm runtime:daily:down *> $null } catch {}
    }
    Pop-Location
}
