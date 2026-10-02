#Requires -Version 7.4
[CmdletBinding()]
param([string]$ExpectedBranch = '')

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$repo = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
Push-Location $repo
try {
    $branch = (git branch --show-current).Trim()
    if ($LASTEXITCODE -ne 0 -or -not $branch -or $branch -in @('main', 'master')) { throw 'Push requires a non-main named branch.' }
    if ($ExpectedBranch -and $branch -ne $ExpectedBranch) { throw "Expected branch $ExpectedBranch; found $branch." }
    if (@(git status --porcelain=v1 --untracked-files=all).Count -gt 0) { throw 'Commit all candidate changes before safe push.' }

    git fetch --no-tags origin "refs/heads/$branch`:refs/remotes/origin/$branch"
    if ($LASTEXITCODE -ne 0) { throw 'Unable to fetch the remote branch.' }
    $head = (git rev-parse HEAD).Trim()
    $base = (git rev-parse "refs/remotes/origin/$branch").Trim()
    git merge-base --is-ancestor $base $head
    if ($LASTEXITCODE -ne 0) { throw 'Remote branch is not an ancestor of local HEAD; reconcile first.' }

    & pwsh -NoProfile -ExecutionPolicy Bypass -File (Join-Path $PSScriptRoot 'check-local.ps1') -Candidate -BaseSha $base
    if ($LASTEXITCODE -ne 0) { throw 'Candidate verification failed.' }
    git push origin "HEAD:refs/heads/$branch"
    if ($LASTEXITCODE -ne 0) { throw 'Push failed.' }
    $remote = (git ls-remote --heads origin "refs/heads/$branch").Split("`t")[0]
    if ($LASTEXITCODE -ne 0 -or $remote -ne $head) { throw "Remote SHA confirmation failed: local=$head remote=$remote" }
    Write-Host "SAFE_PUSH=PASS branch=$branch sha=$head"
}
finally { Pop-Location }
