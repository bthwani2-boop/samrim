#Requires -Version 7.4
[CmdletBinding()]
param(
    [string] $RepoRoot = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$startMarker = '# >>> BTHWANI PNPM ROUTER >>>'
$endMarker = '# <<< BTHWANI PNPM ROUTER <<<'
$pattern = '(?ms)^' + [regex]::Escape($startMarker) + '.*?^' + [regex]::Escape($endMarker) + '\r?\n?'

$repoLiteral = $RepoRoot.Replace("'", "''")
$template = @'
# >>> BTHWANI PNPM ROUTER >>>
$global:BthwaniPnpmNative = (
    Get-Command pnpm -All -ErrorAction Stop |
        Where-Object {
            $_.CommandType -eq 'Application' -or
            $_.CommandType -eq 'ExternalScript'
        } |
        Select-Object -First 1
).Source

function global:pnpm {
    $bthwaniRepo = '__REPO__'
    $bthwaniCommands = @(
        'all',
        'client',
        'partner',
        'captain',
        'field',
        'control',
        'scr'
    )

    if ($args.Count -gt 0 -and $bthwaniCommands -contains [string] $args[0]) {
        & $global:BthwaniPnpmNative --dir $bthwaniRepo @args
        return
    }

    & $global:BthwaniPnpmNative @args
}
# <<< BTHWANI PNPM ROUTER <<<
'@

$block = $template.Replace('__REPO__', $repoLiteral)

function Install-RouterProfile([string] $ProfilePath) {
    $profileDirectory = Split-Path -Parent $ProfilePath

    if (-not (Test-Path -LiteralPath $profileDirectory)) {
        [void] (
            New-Item `
                -ItemType Directory `
                -Path $profileDirectory `
                -Force
        )
    }

    $current = if (Test-Path -LiteralPath $ProfilePath -PathType Leaf) {
        Get-Content -LiteralPath $ProfilePath -Raw
    }
    else {
        ''
    }

    $current = [regex]::Replace(
        $current,
        $pattern,
        ''
    ).TrimEnd()

    $newContent = if ([string]::IsNullOrWhiteSpace($current)) {
        $block + [Environment]::NewLine
    }
    else {
        $current +
            [Environment]::NewLine +
            [Environment]::NewLine +
            $block +
            [Environment]::NewLine
    }

    Set-Content `
        -LiteralPath $ProfilePath `
        -Value $newContent `
        -Encoding utf8

    Write-Host "POWERSHELL_PROFILE_UPDATED=$ProfilePath"
}

$documents = [Environment]::GetFolderPath(
    [Environment+SpecialFolder]::MyDocuments
)

$profileTargets = @(
    $PROFILE,
    (Join-Path $documents 'PowerShell\Microsoft.PowerShell_profile.ps1'),
    (Join-Path $documents 'WindowsPowerShell\Microsoft.PowerShell_profile.ps1')
) |
    Where-Object {
        -not [string]::IsNullOrWhiteSpace([string] $_)
    } |
    Sort-Object -Unique

foreach ($profilePath in $profileTargets) {
    Install-RouterProfile -ProfilePath $profilePath
}

Invoke-Expression $block

Write-Host "BTHWANI_REPO=$RepoRoot"
Write-Host 'BTHWANI_PNPM_ROUTER=INSTALLED'
Write-Host 'Commands: all, client, partner, captain, field, control, scr'
Write-Host 'Restart any already-open Windows PowerShell session before using the updated router there.'
