#Requires -Version 7.4
[CmdletBinding()]
param(
    [string]$ExpectedBranch = '',
    [string]$BaseSha = ''
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$Repo = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path

function Git([string[]]$Arguments) {
    $out = @(& git -C $Repo @Arguments 2>&1)
    if ($LASTEXITCODE -ne 0) { throw "git $($Arguments -join ' ') failed: $($out -join [Environment]::NewLine)" }
    return $out
}

Push-Location $Repo
try {
    $branch = ((Git @('branch','--show-current')) -join '').Trim()
    if (-not $branch) { throw 'Detached HEAD is not verifiable.' }
    if ($ExpectedBranch -and $branch -ne $ExpectedBranch) { throw "Expected branch '$ExpectedBranch', found '$branch'." }

    $status = @(Git @('status','--porcelain=v1','--untracked-files=all'))
    if ($status.Count -gt 0) { throw "Candidate must be clean.`n$($status -join [Environment]::NewLine)" }

    $head = ((Git @('rev-parse','HEAD')) -join '').Trim()
    if (-not $BaseSha) {
        & git -C $Repo rev-parse --verify --quiet "refs/remotes/origin/$branch" *> $null
        if ($LASTEXITCODE -eq 0) {
            $remote = ((Git @('rev-parse',"refs/remotes/origin/$branch")) -join '').Trim()
            & git -C $Repo merge-base --is-ancestor $remote $head *> $null
            if ($LASTEXITCODE -eq 0) { $BaseSha = $remote }
        }
        if (-not $BaseSha) {
            & git -C $Repo rev-parse --verify --quiet 'refs/remotes/origin/main' *> $null
            if ($LASTEXITCODE -ne 0) { throw 'origin/main is unavailable; fetch origin first.' }
            $BaseSha = ((Git @('merge-base',$head,'refs/remotes/origin/main')) -join '').Trim()
        }
    }

    $env:NX_NO_CLOUD = 'true'
    pnpm exec biome lint tools/dev --diagnostic-level=error
    if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
    pwsh -NoProfile -ExecutionPolicy Bypass -File tools/dev/verify-powershell-syntax.ps1
    if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
    node --test tools/dev/check-go-format.test.mjs tools/dev/runtime-proof/trusted-executables.test.mjs
    if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
    pnpm exec nx affected -t lint,format-check,typecheck,unit,contract,build,vet,export-smoke --base=$BaseSha --head=$head --outputStyle=static --parallel=2 --nxBail=true
    if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

    if (((Git @('rev-parse','HEAD')) -join '').Trim() -ne $head) { throw 'HEAD changed during verification.' }
    if (@(Git @('status','--porcelain=v1','--untracked-files=all')).Count -gt 0) { throw 'Verification mutated repository state.' }
    Write-Host "VERIFY=PASS base=$BaseSha head=$head"
}
finally {
    Pop-Location
}
