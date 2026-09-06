#Requires -Version 7.4
[CmdletBinding()]
param(
    [ValidateRange(1, 120)]
    [int] $Attempts = 45,

    [ValidateRange(1, 30)]
    [int] $DelaySeconds = 2
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$checks = @(
    @{ Name = "identity";  Base = "http://127.0.0.1:18082/identity" },
    @{ Name = "dsh";       Base = "http://127.0.0.1:58080/dsh" }
)

function Test-Endpoint([string] $Service, [string] $Uri) {
    try {
        $response = Invoke-RestMethod -Uri $Uri -Method Get -TimeoutSec 5
        return (
            $null -ne $response -and
            $response.status -eq "ok" -and
            $response.service -eq $Service
        )
    }
    catch {
        return $false
    }
}

$pending = [System.Collections.Generic.HashSet[string]]::new()

foreach ($service in $checks) {
    foreach ($endpoint in @("health", "readiness")) {
        $null = $pending.Add("$($service.Name)|$($service.Base)/$endpoint")
    }
}

for ($attempt = 1; $attempt -le $Attempts -and $pending.Count -gt 0; $attempt++) {
    foreach ($entry in @($pending)) {
        $parts = $entry.Split("|", 2)
        $serviceName = $parts[0]
        $uri = $parts[1]

        if (Test-Endpoint -Service $serviceName -Uri $uri) {
            Write-Host "PASS $uri"
            $null = $pending.Remove($entry)
        }
    }

    if ($pending.Count -gt 0 -and $attempt -lt $Attempts) {
        Write-Host "WAIT runtime endpoints pending=$($pending.Count) attempt=$attempt/$Attempts"
        Start-Sleep -Seconds $DelaySeconds
    }
}

if ($pending.Count -gt 0) {
    Write-Error "Integration runtime endpoints did not become ready:"
    foreach ($entry in ($pending | Sort-Object)) {
        $parts = $entry.Split("|", 2)
        Write-Error "  $($parts[1])"
    }
    exit 1
}

Write-Host "INTEGRATION_RUNTIME=PASS"

$composeArgs = @(
    "compose", "--env-file", "infra/local/compose/.env",
    "-f", "infra/local/compose/compose.yaml", "--profile", "integration",
    "exec", "-T", "identity", "/schema-verify"
)
& docker @composeArgs
if ($LASTEXITCODE -ne 0) {
    Write-Error "Identity exact schema verification failed"
    exit 1
}
Write-Host "IDENTITY_SCHEMA_EXACT=PASS"
