#Requires -Version 7.4
[CmdletBinding()]
param()

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$repo = (Resolve-Path (Join-Path $PSScriptRoot "..\..")).Path
$controlRoot = Join-Path $repo "apps\control-panel"
$envPath = Join-Path $repo "infra\local\compose\.env"
$ensureLocalEnvPath = Join-Path $PSScriptRoot "ensure-local-env.ps1"

foreach ($required in @(
    (Join-Path $controlRoot "package.json"),
    $ensureLocalEnvPath
)) {
    if (-not (Test-Path -LiteralPath $required -PathType Leaf)) {
        throw "Control Panel runtime prerequisite is missing: $required"
    }
}

& $ensureLocalEnvPath
if (-not (Test-Path -LiteralPath $envPath -PathType Leaf)) {
    throw "Canonical local runtime environment is missing after ensure-local-env: $envPath"
}

function Read-EnvMap([string]$Path) {
    $map = @{}

    foreach ($line in Get-Content -LiteralPath $Path) {
        $trimmed = $line.Trim()
        if (-not $trimmed -or $trimmed.StartsWith("#")) {
            continue
        }

        $parts = $trimmed.Split("=", 2)
        if ($parts.Count -ne 2) {
            throw "Malformed local runtime environment line in ${Path}: $line"
        }

        $name = $parts[0].Trim()
        $value = $parts[1].Trim()
        if ($map.ContainsKey($name)) {
            throw "Duplicate local runtime environment key '$name' in ${Path}."
        }

        $map[$name] = $value
    }

    return $map
}

function Require-EnvValue([hashtable]$Map, [string]$Name) {
    if (-not $Map.ContainsKey($Name) -or [string]::IsNullOrWhiteSpace([string]$Map[$Name])) {
        throw "Required Control Panel runtime setting is missing: $Name"
    }

    return [string]$Map[$Name]
}

function Get-PortOwnerSummary([object[]]$Listeners) {
    $ownerPids = @(
        $Listeners |
            Select-Object -ExpandProperty OwningProcess -Unique
    )
    $owners = foreach ($ownerPid in $ownerPids) {
        $process = Get-Process -Id ([int]$ownerPid) -ErrorAction SilentlyContinue
        if ($null -eq $process) {
            "PID=$ownerPid (exited)"
        }
        else {
            "PID=$ownerPid $($process.ProcessName)"
        }
    }

    if ($owners.Count -eq 0) {
        return "unknown process"
    }

    return ($owners -join ", ")
}

$envMap = Read-EnvMap -Path $envPath
if ((Require-EnvValue -Map $envMap -Name "BTHWANI_ENV") -ne "development") {
    throw "Control Panel LOCAL_INTEGRATION runtime requires BTHWANI_ENV=development."
}

$originRaw = Require-EnvValue -Map $envMap -Name "CONTROL_PANEL_PUBLIC_ORIGIN"
try {
    $origin = [Uri]::new($originRaw, [UriKind]::Absolute)
}
catch {
    throw "CONTROL_PANEL_PUBLIC_ORIGIN is not a valid absolute URI: $originRaw"
}

$originAuthority = $origin.GetLeftPart([UriPartial]::Authority)
if (
    $origin.Scheme -ne "http" -or
    $origin.Host -ne "127.0.0.1" -or
    $origin.IsDefaultPort -or
    $origin.AbsolutePath -ne "/" -or
    -not [string]::IsNullOrEmpty($origin.Query) -or
    -not [string]::IsNullOrEmpty($origin.Fragment) -or
    $originAuthority -ne $originRaw.TrimEnd("/")
) {
    throw "CONTROL_PANEL_ORIGIN_CONTRACT=FAIL expected=http://127.0.0.1:<port> observed=$originRaw"
}

$corsRaw = Require-EnvValue -Map $envMap -Name "IDENTITY_CORS_ALLOWED_ORIGINS"
$corsOrigins = @(
    $corsRaw.Split(",") |
        ForEach-Object { $_.Trim().TrimEnd("/") } |
        Where-Object { $_ }
)
if ($corsOrigins.Count -ne 1 -or $corsOrigins[0] -ne $originAuthority) {
    throw "CONTROL_PANEL_CORS_CONTRACT=FAIL control_origin=$originAuthority identity_cors=$corsRaw"
}

$port = $origin.Port
$listeners = @(
    Get-NetTCPConnection -State Listen -LocalPort $port -ErrorAction SilentlyContinue
)
if ($listeners.Count -gt 0) {
    $owners = Get-PortOwnerSummary -Listeners $listeners
    throw "RUNTIME_OWNERSHIP_CONFLICT=FAIL service=control-panel port=$port owner=$owners. The launcher requires exclusive ownership and will not accept a pre-existing HTTP endpoint as success. Stop the owning process before retrying."
}

foreach ($entry in $envMap.GetEnumerator()) {
    [Environment]::SetEnvironmentVariable(
        [string]$entry.Key,
        [string]$entry.Value,
        [EnvironmentVariableTarget]::Process
    )
}

Push-Location $controlRoot
try {
    Write-Host "CONTROL_PANEL_ORIGIN=PASS origin=$originAuthority"
    Write-Host "Starting Control Panel from $controlRoot"
    & node ".\node_modules\next\dist\bin\next" dev -H $origin.Host -p $port
    exit $LASTEXITCODE
}
finally {
    Pop-Location
}
