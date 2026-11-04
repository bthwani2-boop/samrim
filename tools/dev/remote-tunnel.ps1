#Requires -Version 5.1
# Surface-only SSH loopback forwarding for the Lenovo Docker Desktop development host.
# This command never exposes Docker Engine or backend ports on the Wi-Fi interface.
$ErrorActionPreference = 'Stop'
if ($env:COMPUTERNAME -ne 'BTHWANI') { throw 'Remote tunnel must run on Surface BTHWANI' }

$ssh = Join-Path $env:WINDIR 'System32\OpenSSH\ssh.exe'
if (-not (Test-Path -LiteralPath $ssh)) { throw 'Windows OpenSSH client not found' }

$arguments = @(
    '-N',
    '-o', 'BatchMode=yes',
    '-o', 'StrictHostKeyChecking=yes',
    '-o', 'ExitOnForwardFailure=yes',
    '-o', 'ConnectTimeout=8',
    '-o', 'ServerAliveInterval=15',
    '-o', 'ServerAliveCountMax=3'
)
foreach ($port in @(18080, 18082, 18083, 18026, 18090, 18333)) {
    $arguments += @('-L', "127.0.0.1:${port}:127.0.0.1:${port}")
}
$arguments += 'bthwani-docker'

while ($true) {
    & $ssh @arguments
    Start-Sleep -Seconds 6
}
