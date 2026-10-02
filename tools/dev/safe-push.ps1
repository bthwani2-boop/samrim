#Requires -Version 7.4
[CmdletBinding()]
param(
    [Parameter(Position = 0)]
    [string]$ExpectedBranch = ''
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$Repo = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
$Verify = Join-Path $PSScriptRoot 'verify-local-candidate.ps1'

function Invoke-Git([string[]]$Arguments) {
    $out = @(& git -C $Repo @Arguments 2>&1)
    if ($LASTEXITCODE -ne 0) { throw "git $($Arguments -join ' ') failed: $($out -join [Environment]::NewLine)" }
    return $out
}

Push-Location $Repo
try {
    $branch = ((Invoke-Git @('branch','--show-current')) -join '').Trim()
    if (-not $branch) { throw 'Detached HEAD is not push-authorized.' }
    if ($branch -in @('main','master')) { throw 'Push main/master through the governed PR path.' }
    if ($ExpectedBranch -and $branch -ne $ExpectedBranch) { throw "Branch mismatch: expected=$ExpectedBranch actual=$branch" }

    $status = @(Invoke-Git @('status','--porcelain=v1','--untracked-files=all'))
    if ($status.Count -gt 0) { throw "Working tree must be clean.`n$($status -join [Environment]::NewLine)" }

    $head = ((Invoke-Git @('rev-parse','HEAD')) -join '').Trim()
    $remote = @(& git -C $Repo ls-remote --heads origin "refs/heads/$branch")
    if ($LASTEXITCODE -ne 0) { throw 'Unable to inspect remote branch.' }

    if ($remote.Count -gt 0 -and ($remote -join '').Trim()) {
        Invoke-Git @('fetch','--no-tags','origin',"refs/heads/$branch`:refs/remotes/origin/$branch") | Out-Null
        $base = ((Invoke-Git @('rev-parse',"refs/remotes/origin/$branch")) -join '').Trim()
        & git -C $Repo merge-base --is-ancestor $base $head
        if ($LASTEXITCODE -ne 0) { throw 'Remote branch is not an ancestor of local HEAD; reconcile first.' }
    } else {
        Invoke-Git @('fetch','--no-tags','origin','main') | Out-Null
        $base = ((Invoke-Git @('merge-base',$head,'refs/remotes/origin/main')) -join '').Trim()
    }

    & pwsh -NoProfile -ExecutionPolicy Bypass -File $Verify -ExpectedBranch $branch -BaseSha $base
    if ($LASTEXITCODE -ne 0) { throw 'Candidate verification failed.' }

    Invoke-Git @('push','origin',"HEAD:refs/heads/$branch") | Out-Host
    $confirmed = @(& git -C $Repo ls-remote --heads origin "refs/heads/$branch")
    if ($LASTEXITCODE -ne 0 -or $confirmed.Count -ne 1) { throw 'Unable to confirm remote SHA.' }
    $remoteSha = (($confirmed[0] -split '\s+')[0]).Trim()
    if ($remoteSha -ne $head) { throw "Remote SHA mismatch: local=$head remote=$remoteSha" }

    Write-Host "SAFE_PUSH=PASS branch=$branch sha=$head"
}
finally {
    Pop-Location
}
