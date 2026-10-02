#Requires -Version 7.4

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$PSNativeCommandUseErrorActionPreference = $false

$Repo = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path

function Fail([string]$Message) { throw "LOCAL_CHECK=FAIL $Message" }

function Invoke-Git([string[]]$Arguments) {
    $output = @(& git -C $Repo @Arguments 2>&1)
    if ($LASTEXITCODE -ne 0) { Fail ("git " + ($Arguments -join ' ') + " failed: " + ($output -join [Environment]::NewLine)) }
    return $output
}

Push-Location $Repo
try {
    $changed = [System.Collections.Generic.HashSet[string]]::new([StringComparer]::OrdinalIgnoreCase)
    foreach ($path in @(Invoke-Git @('diff', '--name-only', 'HEAD', '--'))) {
        $normalized = ([string]$path).Trim().Replace('\', '/')
        if ($normalized) { [void]$changed.Add($normalized) }
    }
    foreach ($path in @(Invoke-Git @('ls-files', '--others', '--exclude-standard', '--'))) {
        $normalized = ([string]$path).Trim().Replace('\', '/')
        if ($normalized) { [void]$changed.Add($normalized) }
    }

    $files = @($changed | Sort-Object)
    if ($files.Count -eq 0) {
        Write-Host 'LOCAL_CHECK=PASS scope=no-working-tree-changes work=none'
        return
    }

    $env:NX_NO_CLOUD = 'true'
    $env:NX_DAEMON = 'true'
    $targets = 'lint,format-check,typecheck,unit,contract,vet'
    $filesArgument = '--files=' + ($files -join ',')

    Write-Host "LOCAL_CHECK_SCOPE files=$($files.Count) targets=$targets cloud=off runtime=off"
    & pnpm exec nx affected -t $targets $filesArgument '--outputStyle=static' '--parallel=2' '--nxBail=true'
    if ($LASTEXITCODE -ne 0) { Fail "affected static proof failed exit=$LASTEXITCODE" }

    Write-Host "LOCAL_CHECK=PASS files=$($files.Count) runtime=not-run cloud=off"
}
finally {
    Pop-Location
}
