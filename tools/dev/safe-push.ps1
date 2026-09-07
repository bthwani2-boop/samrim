#Requires -Version 7.4
[CmdletBinding()]
param(
    [Parameter(Position = 0)]
    [string] $ExpectedBranch = ""
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$repo = (Resolve-Path (Join-Path $PSScriptRoot "..\..")).Path
$expectedRepository = "bthwani2-boop/samrim"

function Fail([string] $Message) {
    throw "SAFE_PUSH_INTERLOCK=FAIL $Message"
}

function Invoke-Git([string[]] $Arguments) {
    $output = @(& git -C $repo @Arguments 2>&1)
    if ($LASTEXITCODE -ne 0) {
        Fail ("git " + ($Arguments -join " ") + " failed: " + ($output -join [Environment]::NewLine))
    }
    return $output
}

function Test-ExpectedOrigin([string] $RemoteUrl) {
    $normalized = $RemoteUrl.Trim()
    return (
        $normalized -match '^https://github\.com/bthwani2-boop/samrim(?:\.git)?$' -or
        $normalized -match '^git@github\.com:bthwani2-boop/samrim(?:\.git)?$' -or
        $normalized -match '^ssh://git@github\.com/bthwani2-boop/samrim(?:\.git)?$'
    )
}

Push-Location $repo
try {
    $branch = ((Invoke-Git @("branch", "--show-current")) -join "").Trim()
    if ([string]::IsNullOrWhiteSpace($branch)) {
        Fail "detached HEAD is not push-authorized"
    }
    if ($branch -in @("main", "master")) {
        Fail "protected integration/release branches require their governed PR/promotion path"
    }
    if (-not [string]::IsNullOrWhiteSpace($ExpectedBranch) -and $branch -ne $ExpectedBranch) {
        Fail "branch mismatch: observed=$branch expected=$ExpectedBranch"
    }

    $origin = ((Invoke-Git @("remote", "get-url", "origin")) -join "").Trim()
    if (-not (Test-ExpectedOrigin $origin)) {
        Fail "origin mismatch: observed=$origin expected_repository=$expectedRepository"
    }

    $status = @(Invoke-Git @("status", "--porcelain=v1", "--untracked-files=all"))
    if ($status.Count -gt 0) {
        Fail ("working tree must be clean before push: " + ($status -join "; "))
    }

    $null = Invoke-Git @("fetch", "--no-tags", "origin", "refs/heads/d:refs/remotes/origin/d")
    $localSha = ((Invoke-Git @("rev-parse", "HEAD")) -join "").Trim()
    $remoteSha = ((Invoke-Git @("rev-parse", "refs/remotes/origin/d")) -join "").Trim()

    & git -C $repo merge-base --is-ancestor $remoteSha $localSha
    if ($LASTEXITCODE -ne 0) {
        Fail "remote branch is not an ancestor of local HEAD; reconcile instead of overwriting"
    }

    if ($localSha -eq $remoteSha) {
        Write-Host "SAFE_PUSH=NOOP branch=$branch sha=$localSha"
        exit 0
    }

    $pushOutput = @(& git -C $repo push --porcelain origin "HEAD:refs/heads/d" 2>&1)
    if ($LASTEXITCODE -ne 0) {
        Fail ("fast-forward push failed: " + ($pushOutput -join [Environment]::NewLine))
    }

    $null = Invoke-Git @("fetch", "--no-tags", "origin", "refs/heads/d:refs/remotes/origin/d")
    $confirmedRemote = ((Invoke-Git @("rev-parse", "refs/remotes/origin/d")) -join "").Trim()
    if ($confirmedRemote -ne $localSha) {
        Fail "remote SHA mismatch after push: local=$localSha remote=$confirmedRemote"
    }

    Write-Host "SAFE_PUSH=PASS repository=$expectedRepository branch=$branch sha=$localSha"
}
finally {
    Pop-Location
}
