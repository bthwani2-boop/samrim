#Requires -Version 7.4
[CmdletBinding()]
param(
    [string]$Repository = 'bthwani2-boop/samrim',
    [ValidateSet('ci-static.yml', 'ci-runtime.yml')]
    [string]$Workflow = 'ci-static.yml',
    [string]$Ref = 'main',
    [switch]$Wait
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$RepoRoot = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
$VerifyScript = Join-Path $PSScriptRoot 'verify-nx-cloud-github.ps1'

function Fail([string]$Message) { throw "NX_CLOUD_DISPATCH=FAIL $Message" }

function Invoke-Gh([string[]]$Arguments) {
    $output = @(& gh @Arguments 2>&1)
    if ($LASTEXITCODE -ne 0) {
        Fail "gh $($Arguments -join ' ') failed: $($output -join [Environment]::NewLine)"
    }
    return $output
}

Push-Location $RepoRoot
try {
    if (-not (Get-Command gh -ErrorAction SilentlyContinue)) { Fail 'GitHub CLI (gh) is required' }
    & gh auth status --hostname github.com *> $null
    if ($LASTEXITCODE -ne 0) { Fail 'gh is not authenticated for github.com' }

    & pwsh -NoProfile -ExecutionPolicy Bypass -File $VerifyScript -Repository $Repository -Ref $Ref
    if ($LASTEXITCODE -ne 0) { Fail 'Nx Cloud/GitHub preflight failed; no workflow was dispatched' }

    $existingRunsRaw = ((Invoke-Gh @('run', 'list', '--repo', $Repository, '--workflow', $Workflow, '--branch', $Ref, '--event', 'workflow_dispatch', '--limit', '20', '--json', 'databaseId,createdAt,url,headBranch,status,conclusion')) -join '')
    $existingRuns = if ($existingRunsRaw.Trim()) { @($existingRunsRaw | ConvertFrom-Json) } else { @() }
    $existingRunIds = [System.Collections.Generic.HashSet[long]]::new()
    foreach ($existingRun in $existingRuns) {
        $null = $existingRunIds.Add([long]$existingRun.databaseId)
    }

    $null = Invoke-Gh @('workflow', 'run', $Workflow, '--repo', $Repository, '--ref', $Ref)
    Write-Host "NX_CLOUD_DISPATCH=REQUESTED workflow=$Workflow ref=$Ref"

    $run = $null
    for ($attempt = 0; $attempt -lt 15 -and $null -eq $run; $attempt++) {
        $rawRuns = ((Invoke-Gh @('run', 'list', '--repo', $Repository, '--workflow', $Workflow, '--branch', $Ref, '--event', 'workflow_dispatch', '--limit', '20', '--json', 'databaseId,createdAt,url,headBranch,status,conclusion')) -join '')
        $runs = if ($rawRuns.Trim()) { @($rawRuns | ConvertFrom-Json) } else { @() }
        $candidates = @($runs |
            Where-Object {
                $_.headBranch -eq $Ref -and
                -not $existingRunIds.Contains([long]$_.databaseId)
            } |
            Sort-Object { [DateTime]::Parse([string]$_.createdAt) } -Descending |
            Select-Object -First 1)
        if ($candidates.Count -gt 0) { $run = $candidates[0] }
        if ($null -eq $run -and $attempt -lt 14) { Start-Sleep -Seconds 2 }
    }

    if ($null -eq $run) {
        if ($Wait) { Fail 'workflow was dispatched but its run record was not found within 30 seconds' }
        Write-Host 'NX_CLOUD_RUN=DISPATCHED_URL_PENDING'
        return
    }

    Write-Host "NX_CLOUD_RUN_URL=$($run.url)"
    Write-Host "NX_CLOUD_RUN_ID=$($run.databaseId)"
    if (-not $Wait) { return }

    & gh run watch $run.databaseId --repo $Repository --compact --interval 5 --exit-status
    if ($LASTEXITCODE -ne 0) { Fail "workflow run failed: $($run.url)" }
    Write-Host "NX_CLOUD_RUN=PASS url=$($run.url)"
}
finally {
    Pop-Location
}
