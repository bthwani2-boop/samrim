#Requires -Version 7.4
[CmdletBinding()]
param(
    [Parameter(Position = 0)]
    [string]$ExpectedBranch = ''
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$Repo = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
$VerifyPath = Join-Path $PSScriptRoot 'verify-local-candidate.ps1'
$ExpectedRepository = 'bthwani2-boop/samrim'

function Fail([string]$Message) { throw "SAFE_PUSH_INTERLOCK=FAIL $Message" }

function Invoke-Git([string[]]$Arguments) {
    $output = @(& git -C $Repo @Arguments 2>&1)
    if ($LASTEXITCODE -ne 0) { Fail ("git " + ($Arguments -join ' ') + " failed: " + ($output -join [Environment]::NewLine)) }
    return $output
}

function Test-ExpectedOrigin([string]$RemoteUrl) {
    $normalized = $RemoteUrl.Trim()
    return (
        $normalized -match '^https://github\.com/bthwani2-boop/samrim(?:\.git)?$' -or
        $normalized -match '^git@github\.com:bthwani2-boop/samrim(?:\.git)?$' -or
        $normalized -match '^ssh://git@github\.com/bthwani2-boop/samrim(?:\.git)?$'
    )
}

Push-Location $Repo
try {
    $branch = ((Invoke-Git @('branch','--show-current')) -join '').Trim()
    if (-not $branch) { Fail 'detached HEAD is not push-authorized' }
    if ($branch -in @('main','master')) { Fail 'protected integration/release branches require their governed promotion path' }
    if ($ExpectedBranch -and $branch -ne $ExpectedBranch) { Fail "branch mismatch: observed=$branch expected=$ExpectedBranch" }

    $origin = ((Invoke-Git @('remote','get-url','origin')) -join '').Trim()
    if (-not (Test-ExpectedOrigin $origin)) { Fail "origin mismatch: observed=$origin expected_repository=$ExpectedRepository" }

    $status = @(Invoke-Git @('status','--porcelain=v1','--untracked-files=all'))
    if ($status.Count -gt 0) { Fail ('working tree must be clean: ' + ($status -join '; ')) }

    $localSha = ((Invoke-Git @('rev-parse','HEAD')) -join '').Trim()
    $remoteQuery = @(& git -C $Repo ls-remote --heads origin "refs/heads/$branch" 2>&1)
    if ($LASTEXITCODE -ne 0) { Fail ('unable to inspect remote branch: ' + ($remoteQuery -join [Environment]::NewLine)) }

    $remoteExists = $remoteQuery.Count -gt 0 -and -not [string]::IsNullOrWhiteSpace(($remoteQuery -join '').Trim())
    if ($remoteExists) {
        $remoteSha = (($remoteQuery[0] -split '\s+')[0]).Trim()
        if ($remoteSha -eq $localSha) {
            Write-Host "SAFE_PUSH=NOOP branch=$branch sha=$localSha"
            Write-Host "REMOTE_SHA_CONFIRMATION=PASS branch=$branch sha=$localSha"
            return
        }

        $remoteRef = "refs/remotes/origin/$branch"
        $null = Invoke-Git @('fetch','--no-tags','origin',"refs/heads/$branch`:$remoteRef")
        $remoteSha = ((Invoke-Git @('rev-parse',$remoteRef)) -join '').Trim()
        & git -C $Repo merge-base --is-ancestor $remoteSha $localSha
        if ($LASTEXITCODE -ne 0) { Fail 'remote branch is not an ancestor of local HEAD; reconcile instead of overwriting' }
        $baseSha = $remoteSha
        Write-Host "VERIFY_BASE=REMOTE_BRANCH sha=$baseSha"
    }
    else {
        $null = Invoke-Git @('fetch','--no-tags','origin','refs/heads/main:refs/remotes/origin/main')
        $baseSha = ((Invoke-Git @('merge-base','HEAD','refs/remotes/origin/main')) -join '').Trim()
        Write-Host "REMOTE_BRANCH_STATE=ABSENT branch=$branch"
        Write-Host "VERIFY_BASE=MAIN_MERGE_BASE sha=$baseSha"
    }

    Write-Host "SAFE_PUSH_VERIFY=START branch=$branch base=$baseSha sha=$localSha"
    & pwsh -NoProfile -ExecutionPolicy Bypass -File $VerifyPath -ExpectedBranch $branch -BaseSha $baseSha
    if ($LASTEXITCODE -ne 0) { Fail "candidate verification failed for sha=$localSha" }

    $verifiedSha = ((Invoke-Git @('rev-parse','HEAD')) -join '').Trim()
    if ($verifiedSha -ne $localSha) { Fail "HEAD changed during verification: before=$localSha after=$verifiedSha" }
    Write-Host "SAFE_PUSH_VERIFY=PASS sha=$localSha"

    $pushOutput = @(& git -C $Repo push --porcelain origin "HEAD:refs/heads/$branch" 2>&1)
    if ($LASTEXITCODE -ne 0) { Fail ('fast-forward/first push failed: ' + ($pushOutput -join [Environment]::NewLine)) }

    $confirmed = @(& git -C $Repo ls-remote --heads origin "refs/heads/$branch" 2>&1)
    if ($LASTEXITCODE -ne 0 -or $confirmed.Count -ne 1) { Fail 'unable to confirm exactly one remote branch SHA after push' }
    $confirmedSha = (($confirmed[0] -split '\s+')[0]).Trim()
    if ($confirmedSha -ne $localSha) { Fail "remote SHA mismatch after push: local=$localSha remote=$confirmedSha" }

    Write-Host "REMOTE_SHA_CONFIRMATION=PASS branch=$branch sha=$confirmedSha"
    Write-Host "SAFE_PUSH=PASS repository=$ExpectedRepository branch=$branch sha=$localSha"
}
finally {
    Pop-Location
}
