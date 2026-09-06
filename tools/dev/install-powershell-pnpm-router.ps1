#Requires -Version 7.4
[CmdletBinding()]
param(
    [string] $RepoRoot = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$profilePath = $PROFILE
$profileDirectory = Split-Path -Parent $profilePath

if (-not (Test-Path -LiteralPath $profileDirectory)) {
    [void] (New-Item -ItemType Directory -Path $profileDirectory -Force)
}

$current = if (Test-Path -LiteralPath $profilePath -PathType Leaf) {
    Get-Content -LiteralPath $profilePath -Raw
}
else {
    ''
}

$startMarker = '# >>> BTHWANI PNPM ROUTER >>>'
$endMarker = '# <<< BTHWANI PNPM ROUTER <<<'
$pattern = '(?ms)^' + [regex]::Escape($startMarker) + '.*?^' + [regex]::Escape($endMarker) + '\r?\n?'
$current = [regex]::Replace($current, $pattern, '').TrimEnd()

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
        'client',
        'partner',
        'captain',
        'field',
        'control',
        'scrcpy'
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
$newContent = if ([string]::IsNullOrWhiteSpace($current)) {
    $block + [Environment]::NewLine
}
else {
    $current + [Environment]::NewLine + [Environment]::NewLine + $block + [Environment]::NewLine
}

Set-Content -LiteralPath $profilePath -Value $newContent -Encoding utf8
. $profilePath

Write-Host "POWERSHELL_PROFILE=$profilePath"
Write-Host "BTHWANI_REPO=$RepoRoot"
Write-Host 'BTHWANI_PNPM_ROUTER=INSTALLED'
Write-Host 'Commands: client, partner, captain, field, control, scrcpy'
