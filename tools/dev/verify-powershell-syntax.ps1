#Requires -Version 7.4
[CmdletBinding()]
param(
    [string[]] $Path
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$repo = (Resolve-Path (Join-Path $PSScriptRoot "..\..")).Path
$failures = @()

if (-not $Path -or $Path.Count -eq 0) {
    Push-Location $repo
    try {
        $Path = @(
            & git ls-files -- "*.ps1"
        )
        if ($LASTEXITCODE -ne 0) {
            throw "Unable to enumerate tracked PowerShell files."
        }
    }
    finally {
        Pop-Location
    }
}

if (-not $Path -or $Path.Count -eq 0) {
    Write-Host "POWERSHELL_SYNTAX=FAIL"
    Write-Error "No tracked PowerShell files were discovered."
    exit 1
}

foreach ($item in ($Path | Sort-Object -Unique)) {
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

Write-Host "POWERSHELL_SYNTAX_ALL=PASS count=$($Path.Count)"
