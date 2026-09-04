#Requires -Version 7.4
[CmdletBinding()]
param()

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$checks = @(
    @{ Name = "identity";  Base = "http://127.0.0.1:18082/identity" },
    @{ Name = "workforce"; Base = "http://127.0.0.1:18086/workforce" },
    @{ Name = "dsh";       Base = "http://127.0.0.1:58080/dsh" },
    @{ Name = "wlt";       Base = "http://127.0.0.1:18083/wlt" }
)

$failed = @()
foreach ($service in $checks) {
    foreach ($endpoint in @("health", "readiness")) {
        $uri = "$($service.Base)/$endpoint"
        try {
            $response = Invoke-RestMethod -Uri $uri -Method Get -TimeoutSec 5
            if ($response.status -ne "ok" -or $response.service -ne $service.Name) {
                $failed += "$uri returned unexpected payload"
            }
            else {
                Write-Host "PASS $uri"
            }
        }
        catch {
            $failed += "$uri -> $($_.Exception.Message)"
        }
    }
}

if ($failed.Count -gt 0) {
    $failed | ForEach-Object { Write-Error $_ }
    exit 1
}

Write-Host "FOUNDATION_RUNTIME=PASS"
