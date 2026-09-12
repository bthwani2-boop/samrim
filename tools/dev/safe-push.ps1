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

function Invoke-Git {
    param([string[]] $Arguments)

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
    $branchName = ((Invoke-Git -Arguments @("branch", "--show-current")) -join "").Trim()
    if ([string]::IsNullOrWhiteSpace($branchName)) {
        Fail "detached HEAD is not push-authorized"
    }
    if ($branchName -in @("main", "master")) {
        Fail "protected integration/release branches require their governed PR/promotion path"
    }
    if (-not [string]::IsNullOrWhiteSpace($ExpectedBranch) -and $branchName -ne $ExpectedBranch) {
        Fail "branch mismatch: observed=$branchName expected=$ExpectedBranch"
    }

    $origin = ((Invoke-Git -Arguments @("remote", "get-url", "origin")) -join "").Trim()
    if (-not (Test-ExpectedOrigin $origin)) {
        Fail "origin mismatch: observed=$origin expected_repository=$expectedRepository"
    }

    $status = @(Invoke-Git -Arguments @("status", "--porcelain=v1", "--untracked-files=all"))
    if ($status.Count -gt 0) {
        Fail ("working tree must be clean before push: " + ($status -join "; "))
    }

    $remoteRef = "refs/remotes/origin/$($branchName)"
    $fetchRefspec = "refs/heads/$($branchName):$remoteRef"

    $null = Invoke-Git -Arguments @("fetch", "--no-tags", "origin", $fetchRefspec)
    $localSha = ((Invoke-Git -Arguments @("rev-parse", "HEAD")) -join "").Trim()
    $remoteSha = ((Invoke-Git -Arguments @("rev-parse", $remoteRef)) -join "").Trim()

    & git -C $repo merge-base --is-ancestor $remoteSha $localSha
    if ($LASTEXITCODE -ne 0) {
        Fail "remote branch is not an ancestor of local HEAD; reconcile instead of overwriting"
    }

    if ($localSha -eq $remoteSha) {
        Write-Host "SAFE_PUSH=NOOP branch=$branchName sha=$localSha"
        return
    }

    $pushOutput = @(& git -C $repo push --porcelain origin "HEAD:refs/heads/$($branchName)" 2>&1)
    if ($LASTEXITCODE -ne 0) {
        Fail ("fast-forward push failed: " + ($pushOutput -join [Environment]::NewLine))
    }

    $null = Invoke-Git -Arguments @("fetch", "--no-tags", "origin", $fetchRefspec)
    $confirmedRemote = ((Invoke-Git -Arguments @("rev-parse", $remoteRef)) -join "").Trim()
    if ($confirmedRemote -ne $localSha) {
        Fail "remote SHA mismatch after push: local=$localSha remote=$confirmedRemote"
    }

    Write-Host "SAFE_PUSH=PASS repository=$expectedRepository branch=$branchName sha=$localSha"
}
finally {
    Pop-Location
}
