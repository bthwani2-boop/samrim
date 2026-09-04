#Requires -Version 7.4
[CmdletBinding()]
param(
    [string[]] $Path = @(
        "tools/dev/close-foundation-runtime.ps1",
        "tools/dev/verify-foundation-runtime.ps1"
    )
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$repo = (Resolve-Path (Join-Path $PSScriptRoot "..\..")).Path
$failures = @()

foreach ($item in $Path) {
    $candidate = if ([IO.Path]::IsPathRooted($item)) {
        $item
    }
    else {
        Join-Path $repo $item
    }

    if (-not (Test-Path $candidate -PathType Leaf)) {
        $failures += "$item -> file not found"
        continue
    }

    $tokens = $null
    $errors = $null
    [void] [Management.Automation.Language.Parser]::ParseFile(
        $candidate,
        [ref] $tokens,
        [ref] $errors
    )

    if ($errors.Count -gt 0) {
        foreach ($error in $errors) {
            $line = $error.Extent.StartLineNumber
            $column = $error.Extent.StartColumnNumber
            $failures += "${item}:${line}:${column} -> $($error.Message)"
        }
    }
    else {
        Write-Host "POWERSHELL_SYNTAX=PASS $item"
    }
}

if ($failures.Count -gt 0) {
    Write-Host "POWERSHELL_SYNTAX=FAIL"
    $failures | ForEach-Object { Write-Error $_ }
    exit 1
}

Write-Host "POWERSHELL_SYNTAX_ALL=PASS"
