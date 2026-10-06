#Requires -Version 7.4
[CmdletBinding()]
param(
    [switch]$Candidate,
    [string]$BaseSha = ''
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$Repo = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
Push-Location $Repo
try {
    if ($Candidate) {
        $branch = (git branch --show-current).Trim()
        if ($LASTEXITCODE -ne 0 -or -not $branch) { throw 'Candidate verification requires a named branch.' }
        $status = @(git status --porcelain=v1 --untracked-files=all)
        if ($LASTEXITCODE -ne 0 -or $status.Count -gt 0) { throw "Candidate must be clean.`n$($status -join [Environment]::NewLine)" }
        $head = (git rev-parse HEAD).Trim()
        if ($LASTEXITCODE -ne 0) { throw 'Unable to resolve candidate HEAD.' }
        if (-not $BaseSha) {
            git rev-parse --verify --quiet "refs/remotes/origin/$branch" *> $null
            if ($LASTEXITCODE -eq 0) {
                $BaseSha = (git rev-parse "refs/remotes/origin/$branch").Trim()
                git merge-base --is-ancestor $BaseSha $head *> $null
                if ($LASTEXITCODE -ne 0) { throw 'Remote branch is not an ancestor of candidate HEAD.' }
            }
            else {
                git rev-parse --verify --quiet refs/remotes/origin/main *> $null
                if ($LASTEXITCODE -ne 0) { throw 'Fetch origin/main before verifying this candidate.' }
                $BaseSha = (git merge-base $head refs/remotes/origin/main).Trim()
            }
        }
        $env:NX_BASE = $BaseSha
        $env:NX_HEAD = $head
        $env:NX_NO_CLOUD = 'true'
        Write-Host "VERIFY_SCOPE base=$BaseSha head=$head runtime=off cloud=off"
        pnpm exec nx affected -t lint format-check typecheck unit contract build vet export-smoke --base=$BaseSha --head=$head --outputStyle=static --parallel=2 --nxBail=true
        if ($LASTEXITCODE -ne 0) { throw "VERIFY=FAIL exit=$LASTEXITCODE" }
        if ((git rev-parse HEAD).Trim() -ne $head -or @(git status --porcelain=v1 --untracked-files=all).Count -gt 0) {
            throw 'Candidate changed during verification.'
        }
        Write-Host "VERIFY=PASS base=$BaseSha head=$head"
        return
    }

    $files = @(
        @(
            git diff --name-only HEAD --
            git ls-files --others --exclude-standard --
        ) | ForEach-Object { ([string]$_).Trim().Replace('\','/') } | Where-Object { $_ } | Sort-Object -Unique
    )

    if ($files.Count -eq 0) {
        Write-Host 'LOCAL_CHECK=PASS scope=no-working-tree-changes'
        return
    }

    $env:NX_NO_CLOUD = 'true'

    if (@($files | Where-Object { $_ -match '^(tools/dev/|biome\.jsonc?$)' }).Count -gt 0) {
        pnpm exec biome lint tools/dev --diagnostic-level=error
        if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
    }

    if (@($files | Where-Object { $_ -match '\.(ps1|psm1|psd1)
    if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
    $affectedProjects = @($affectedProjectJson | ConvertFrom-Json)
    if ($affectedProjects.Count -eq 0) {
        Write-Host "LOCAL_CHECK=PASS files=$($files.Count) projects=0"
        return
    }
    $projectsArg = $affectedProjects -join ','
    pnpm exec nx run-many -t lint format-check typecheck unit contract vet --projects=$projectsArg --outputStyle=static --parallel=2 --nxBail=true
    if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
    Write-Host "LOCAL_CHECK=PASS files=$($files.Count)"
}
finally {
    Pop-Location
}
 }).Count -gt 0) {
        pwsh -NoProfile -ExecutionPolicy Bypass -File tools/powershell/verify-syntax.ps1
        if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
    }

    $affectedProjectJson = pnpm exec nx show projects --affected --base=HEAD --json
    if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
    $affectedProjects = @($affectedProjectJson | ConvertFrom-Json)
    if ($affectedProjects.Count -eq 0) {
        Write-Host "LOCAL_CHECK=PASS files=$($files.Count) projects=0"
        return
    }
    $projectsArg = $affectedProjects -join ','
    pnpm exec nx run-many -t lint format-check typecheck unit contract vet --projects=$projectsArg --outputStyle=static --parallel=2 --nxBail=true
    if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
    Write-Host "LOCAL_CHECK=PASS files=$($files.Count)"
}
finally {
    Pop-Location
}
