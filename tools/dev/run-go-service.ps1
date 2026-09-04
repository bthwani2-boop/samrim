#Requires -Version 7.4
[CmdletBinding()]
param(
    [Parameter(Mandatory)]
    [ValidateSet("identity", "dsh", "wlt")]
    [string]$Service
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$repo = (Resolve-Path (Join-Path $PSScriptRoot "..\..")).Path
$config = @{
    identity  = @{ Port = "18082"; Path = "services\identity\backend" }
    dsh       = @{ Port = "58080"; Path = "services\dsh\backend" }
    wlt       = @{ Port = "18083"; Path = "services\wlt\backend" }
}[$Service]

$oldPort = $env:PORT
try {
    if (-not $env:PORT) {
        $env:PORT = $config.Port
    }
    Push-Location (Join-Path $repo $config.Path)
    try {
        & go run ./cmd/api
        if ($LASTEXITCODE -ne 0) {
            exit $LASTEXITCODE
        }
    }
    finally {
        Pop-Location
    }
}
finally {
    $env:PORT = $oldPort
}
