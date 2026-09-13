$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

$Processes = @(
    Get-CimInstance Win32_Process |
        Where-Object {
            $_.Name -eq 'biome.exe' -and
            $_.CommandLine -match '\\biomejs\.biome\\samrim\\'
        }
)

$Proxies = @(
    $Processes |
        Where-Object {
            $_.CommandLine -match '\blsp-proxy\b'
        }
)

$Servers = @(
    $Processes |
        Where-Object {
            $_.CommandLine -match '\b__run_server\b'
        }
)

Write-Host "BIOME_PROXY_COUNT=$($Proxies.Count)"
Write-Host "BIOME_SERVER_COUNT=$($Servers.Count)"

if ($Proxies.Count -eq 0 -and $Servers.Count -eq 0) {
    Write-Host 'BIOME_STATE=INACTIVE'
    Write-Host 'BIOME_DOCTOR=PASS'
    exit 0
}

if ($Proxies.Count -ne 1 -or $Servers.Count -ne 1) {
    Write-Host 'BIOME_STATE=ABNORMAL'
    Write-Host 'BIOME_DOCTOR=FAIL'
    Write-Host 'ACTION=Close all VS Code windows, then run pnpm biome:reset from an external PowerShell.'
    exit 1
}

if ($Servers[0].ParentProcessId -ne $Proxies[0].ProcessId) {
    Write-Host 'BIOME_STATE=INVALID_PROCESS_TREE'
    Write-Host "BIOME_PROXY_PID=$($Proxies[0].ProcessId)"
    Write-Host "BIOME_SERVER_PID=$($Servers[0].ProcessId)"
    Write-Host "BIOME_SERVER_PARENT_PID=$($Servers[0].ParentProcessId)"
    Write-Host 'BIOME_DOCTOR=FAIL'
    exit 1
}

Write-Host "BIOME_PROXY_PID=$($Proxies[0].ProcessId)"
Write-Host "BIOME_SERVER_PID=$($Servers[0].ProcessId)"
Write-Host 'BIOME_STATE=NORMAL'
Write-Host 'BIOME_DOCTOR=PASS'