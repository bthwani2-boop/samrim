#Requires -Version 7.4
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$Repo = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
Push-Location $Repo
try {
    $files = @(
        git diff --name-only HEAD --
        git ls-files --others --exclude-standard --
    ) | ForEach-Object { ([string]$_).Trim().Replace('\','/') } | Where-Object { $_ } | Sort-Object -Unique

    if ($files.Count -eq 0) {
        Write-Host 'LOCAL_CHECK=PASS scope=no-working-tree-changes'
        return
    }

    $env:NX_NO_CLOUD = 'true'
    $filesArg = '--files=' + ($files -join ',')
    Write-Host "LOCAL_CHECK_SCOPE files=$($files.Count) runtime=off cloud=off"
    pnpm exec nx affected -t lint format-check typecheck unit contract vet $filesArg --outputStyle=static --parallel=2 --nxBail=true
    if ($LASTEXITCODE -ne 0) { throw "LOCAL_CHECK=FAIL exit=$LASTEXITCODE" }
    Write-Host "LOCAL_CHECK=PASS files=$($files.Count)"
}
finally {
    Pop-Location
}
