#Requires -Version 7.4
[CmdletBinding()]
param([string]$ExpectedBranch = '')

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$repo = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
Push-Location $repo
try {
    function Invoke-Git([string[]]$Arguments) {
        $output = @(& git -C $repo @Arguments 2>&1)
        if ($LASTEXITCODE -ne 0) { throw "SAFE_PUSH_INTERLOCK=FAIL git $($Arguments -join ' ') failed: $($output -join [Environment]::NewLine)" }
        return $output
    }

    function Test-ExpectedOrigin([string]$Url) {
        $value = $Url.Trim()
        return (
            $value -match '^https://github\.com/bthwani2-boop/samrim(?:\.git)?$' -or
            $value -match '^git@github\.com:bthwani2-boop/samrim(?:\.git)?$' -or
            $value -match '^ssh://git@github\.com/bthwani2-boop/samrim(?:\.git)?$'
        )
    }

    $branch = ((Invoke-Git @('branch', '--show-current')) -join '').Trim()
    if (-not $branch -or $branch -in @('main', 'master')) { throw 'SAFE_PUSH_INTERLOCK=FAIL push requires a named non-protected branch.' }
    if ($ExpectedBranch -and $branch -ne $ExpectedBranch) { throw "SAFE_PUSH_INTERLOCK=FAIL expected branch=$ExpectedBranch observed=$branch" }

    $fetchOrigins = @(Invoke-Git @('remote', 'get-url', '--all', 'origin') | ForEach-Object { $_.Trim() } | Where-Object { $_ })
    $pushOrigins = @(Invoke-Git @('remote', 'get-url', '--all', '--push', 'origin') | ForEach-Object { $_.Trim() } | Where-Object { $_ })
    if ($fetchOrigins.Count -eq 0 -or @($fetchOrigins | Where-Object { -not (Test-ExpectedOrigin $_) }).Count -gt 0) {
        throw "SAFE_PUSH_INTERLOCK=FAIL origin fetch URL mismatch: observed=$($fetchOrigins -join ',') expected=bthwani2-boop/samrim"
    }
    if ($pushOrigins.Count -eq 0 -or @($pushOrigins | Where-Object { -not (Test-ExpectedOrigin $_) }).Count -gt 0) {
        throw "SAFE_PUSH_INTERLOCK=FAIL origin push URL mismatch: observed=$($pushOrigins -join ',') expected=bthwani2-boop/samrim"
    }

    if (@(Invoke-Git @('status', '--porcelain=v1', '--untracked-files=all')).Count -gt 0) {
        throw 'SAFE_PUSH_INTERLOCK=FAIL commit candidate changes before push.'
    }
    $head = ((Invoke-Git @('rev-parse', 'HEAD')) -join '').Trim()
    $remoteRows = @(Invoke-Git @('ls-remote', '--heads', 'origin', "refs/heads/$branch"))
    if ($remoteRows.Count -gt 0) {
        $remoteSha = (($remoteRows[0] -split '\s+')[0]).Trim()
        $remoteRef = "refs/remotes/origin/$branch"
        $null = Invoke-Git @('fetch', '--no-tags', 'origin', "refs/heads/$branch`:$remoteRef")
        $fetchedSha = ((Invoke-Git @('rev-parse', $remoteRef)) -join '').Trim()
        if ($fetchedSha -ne $remoteSha) { throw "SAFE_PUSH_INTERLOCK=FAIL remote branch changed during fetch: observed=$remoteSha fetched=$fetchedSha" }
        & git -C $repo merge-base --is-ancestor $fetchedSha $head
        if ($LASTEXITCODE -ne 0) { throw 'SAFE_PUSH_INTERLOCK=FAIL remote branch is not an ancestor of local HEAD; reconcile instead of overwriting.' }
        $base = $fetchedSha
        Write-Host "VERIFY_BASE=REMOTE_BRANCH sha=$base"
    }
    else {
        $null = Invoke-Git @('fetch', '--no-tags', 'origin', 'refs/heads/main:refs/remotes/origin/main')
        $base = ((Invoke-Git @('merge-base', 'HEAD', 'refs/remotes/origin/main')) -join '').Trim()
        Write-Host "REMOTE_BRANCH_STATE=ABSENT branch=$branch"
        Write-Host "VERIFY_BASE=MAIN_MERGE_BASE sha=$base"
    }

    Write-Host "SAFE_PUSH_SCOPE branch=$branch head=$head base=$base verification=caller-or-ci"

    $pushOutput = @(& git -C $repo push --porcelain origin "HEAD:refs/heads/$branch" 2>&1)
    if ($LASTEXITCODE -ne 0) { throw "SAFE_PUSH_INTERLOCK=FAIL push failed: $($pushOutput -join [Environment]::NewLine)" }
    $confirmed = @(Invoke-Git @('ls-remote', '--heads', 'origin', "refs/heads/$branch"))
    if ($confirmed.Count -ne 1) { throw 'SAFE_PUSH_INTERLOCK=FAIL unable to confirm exactly one remote branch SHA after push.' }
    $remoteSha = (($confirmed[0] -split '\s+')[0]).Trim()
    if ($remoteSha -ne $head) { throw "SAFE_PUSH_INTERLOCK=FAIL remote SHA mismatch: local=$head remote=$remoteSha" }
    Write-Host "REMOTE_SHA_CONFIRMATION=PASS branch=$branch sha=$remoteSha"
    Write-Host "SAFE_PUSH=PASS branch=$branch sha=$head"
}
finally { Pop-Location }
