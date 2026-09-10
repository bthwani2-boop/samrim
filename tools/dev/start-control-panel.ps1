#Requires -Version 7.4
[CmdletBinding()]
param()

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$repo = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
$controlRoot = Join-Path $repo 'apps\control-panel'
$envPath = Join-Path $repo 'infra\local\compose\.env'
$port = 13000

foreach ($required in @(
    (Join-Path $controlRoot 'package.json'),
    $envPath
)) {
    if (-not (Test-Path -LiteralPath $required -PathType Leaf)) {
        throw "Control Panel runtime prerequisite is missing: $required"
    }
}

function Get-PortOwnerSummary([object[]] $Listeners) {
    $ownerPids = @(
        $Listeners |
            Select-Object -ExpandProperty OwningProcess -Unique
    )
    $owners = foreach ($ownerPid in $ownerPids) {
        $process = Get-Process -Id ([int] $ownerPid) -ErrorAction SilentlyContinue
        if ($null -eq $process) {
            "PID=$ownerPid (exited)"
        }
        else {
            "PID=$ownerPid $($process.ProcessName)"
        }
    }
    if ($owners.Count -eq 0) {
        return 'unknown process'
    }
    return ($owners -join ', ')
}

$listeners = @(
    Get-NetTCPConnection -State Listen -LocalPort $port -ErrorAction SilentlyContinue |
        Where-Object { $_.LocalAddress -in @('127.0.0.1', '0.0.0.0') }
)
if ($listeners.Count -gt 0) {
    $owners = Get-PortOwnerSummary -Listeners $listeners
    throw "RUNTIME_OWNERSHIP_CONFLICT=FAIL service=control-panel port=$port owner=$owners. The launcher requires exclusive ownership and will not accept a pre-existing HTTP endpoint as success. Stop the owning process before retrying."
}

foreach ($line in Get-Content -LiteralPath $envPath) {
    if ($line -match '^\s*([^#=][^=]*)=(.*)$') {
        $name = $matches[1].Trim()
        $value = $matches[2].Trim()
        [Environment]::SetEnvironmentVariable($name, $value, 'Process')
    }
}

Push-Location $controlRoot
try {
    Write-Host "Starting Control Panel from $controlRoot"
    & node '.\node_modules\next\dist\bin\next' dev -H 127.0.0.1 -p $port
    exit $LASTEXITCODE
}
finally {
    Pop-Location
}
