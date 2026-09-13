$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

$Code = @(
    Get-Process Code -ErrorAction SilentlyContinue
)

if ($Code.Count -gt 0) {
    Write-Host 'VSCODE_RUNNING=1'
    Write-Host 'BIOME_RESET=BLOCKED'
    throw 'Close all VS Code windows, then run pnpm biome:reset from an external PowerShell.'
}

$Processes = @(
    Get-CimInstance Win32_Process |
        Where-Object {
            $_.Name -eq 'biome.exe' -and
            $_.CommandLine -match '\\biomejs\.biome\\samrim\\'
        }
)

Write-Host "BIOME_PROCESSES_FOUND=$($Processes.Count)"

foreach ($Process in $Processes) {
    Write-Host "STOPPING_BIOME_PID=$($Process.ProcessId)"

    Stop-Process `
        -Id $Process.ProcessId `
        -Force `
        -ErrorAction SilentlyContinue
}

Start-Sleep -Seconds 1

$Remaining = @(
    Get-CimInstance Win32_Process |
        Where-Object {
            $_.Name -eq 'biome.exe' -and
            $_.CommandLine -match '\\biomejs\.biome\\samrim\\'
        }
)

if ($Remaining.Count -ne 0) {
    throw "BIOME_PROCESS_CLEANUP=FAIL count=$($Remaining.Count)"
}

$WorkspaceStorage = Join-Path `
    $env:APPDATA `
    'Code\User\workspaceStorage'

$RemovedStates = 0

if (Test-Path -LiteralPath $WorkspaceStorage) {
    $BiomeStates = @(
        Get-ChildItem `
            -LiteralPath $WorkspaceStorage `
            -Directory `
            -ErrorAction SilentlyContinue |
            ForEach-Object {
                Join-Path $_.FullName 'biomejs.biome\samrim'
            } |
            Where-Object {
                Test-Path -LiteralPath $_
            }
    )

    foreach ($State in $BiomeStates) {
        Remove-Item `
            -LiteralPath $State `
            -Recurse `
            -Force

        $RemovedStates++
        Write-Host "REMOVED=$State"
    }
}

Write-Host "BIOME_WORKSPACE_STATES_REMOVED=$RemovedStates"
Write-Host 'BIOME_PROCESSES=0'
Write-Host 'BIOME_RESET=PASS'