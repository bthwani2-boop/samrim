#Requires -Version 7.4
[CmdletBinding()]
param(
    [string]$Repository = 'bthwani2-boop/samrim',
    [string]$ProtectedEnvironment = 'nx-cloud-protected',
    [string]$UnprotectedEnvironment = 'nx-cloud-unprotected',
    [string]$Ref = 'main',
    [string]$ProtectedBranch = 'main'
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$RepoRoot = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path

function Fail([string]$Message) { throw "NX_CLOUD_GITHUB_VERIFY=FAIL $Message" }

function Invoke-Gh([string[]]$Arguments) {
    $output = @(& gh @Arguments 2>&1)
    if ($LASTEXITCODE -ne 0) {
        Fail "gh $($Arguments -join ' ') failed: $($output -join [Environment]::NewLine)"
    }
    return $output
}

function Get-SecretNames([string]$Environment = '') {
    $arguments = @('secret', 'list', '--repo', $Repository, '--json', 'name', '--jq', '.[].name')
    if ($Environment) { $arguments += @('--env', $Environment) }
    return @(Invoke-Gh $arguments | ForEach-Object { $_.ToString().Trim() } | Where-Object { $_ })
}

function Read-Environment([string]$Name) {
    $json = ((Invoke-Gh @('api', "repos/$Repository/environments/$Name")) -join [Environment]::NewLine)
    return $json | ConvertFrom-Json
}

function Read-Workflow([string]$Path) {
    return ((Invoke-Gh @('workflow', 'view', $Path, '--repo', $Repository, '--ref', $Ref, '--yaml')) -join [Environment]::NewLine)
}

Push-Location $RepoRoot
try {
    if (-not (Get-Command gh -ErrorAction SilentlyContinue)) { Fail 'GitHub CLI (gh) is required' }
    & gh auth status --hostname github.com *> $null
    if ($LASTEXITCODE -ne 0) { Fail 'gh is not authenticated for github.com' }

    $identity = ((Invoke-Gh @('repo', 'view', $Repository, '--json', 'nameWithOwner', '--jq', '.nameWithOwner')) -join '').Trim()
    if ($identity -ne $Repository) { Fail "repository mismatch: observed=$identity expected=$Repository" }

    $nx = Get-Content -LiteralPath (Join-Path $RepoRoot 'nx.json') -Raw | ConvertFrom-Json
    if ([string]::IsNullOrWhiteSpace([string]$nx.nxCloudId)) { Fail 'nx.json does not contain nxCloudId' }

    $protected = Read-Environment $ProtectedEnvironment
    $unprotected = Read-Environment $UnprotectedEnvironment
    $repoSecrets = @(Get-SecretNames)
    $protectedSecrets = @(Get-SecretNames $ProtectedEnvironment)
    if ($repoSecrets -notcontains 'NX_CLOUD_RO_TOKEN') { Fail 'missing repository secret NX_CLOUD_RO_TOKEN' }
    if ($repoSecrets -contains 'NX_CLOUD_RW_TOKEN') { Fail 'NX_CLOUD_RW_TOKEN must not exist at repository scope' }
    if ($protectedSecrets -notcontains 'NX_CLOUD_RW_TOKEN') { Fail "missing protected environment secret $ProtectedEnvironment/NX_CLOUD_RW_TOKEN" }

    $policy = $protected.deployment_branch_policy
    if ($null -eq $policy -or $policy.protected_branches -ne $false -or $policy.custom_branch_policies -ne $true) {
        Fail "protected environment policy is not configured for an explicit branch allowlist: $ProtectedEnvironment"
    }
    if ($null -eq $unprotected) { Fail "unprotected environment is not readable: $UnprotectedEnvironment" }
    $protectedPolicies = ((Invoke-Gh @('api', "repos/$Repository/environments/$ProtectedEnvironment/deployment-branch-policies")) -join '') | ConvertFrom-Json
    $policyNames = @($protectedPolicies.branch_policies | ForEach-Object { [string]$_.name })
    if ($policyNames -notcontains $ProtectedBranch) { Fail "protected environment does not allow the expected branch: $ProtectedBranch" }

    $workflowJson = ((Invoke-Gh @('workflow', 'list', '--repo', $Repository, '--all', '--json', 'path,name,state')) -join '') | ConvertFrom-Json
    $workflowPaths = @($workflowJson | ForEach-Object { [string]$_.path })
    $requiredWorkflows = @(
        '.github/workflows/ci-static.yml',
        '.github/workflows/ci-runtime.yml',
        '.github/workflows/ci-security.yml',
        '.github/workflows/ci-policy.yml'
    )
    foreach ($requiredWorkflow in $requiredWorkflows) {
        if ($workflowPaths -notcontains $requiredWorkflow) { Fail "canonical workflow is not registered on GitHub: $requiredWorkflow" }
    }

    $static = Read-Workflow '.github/workflows/ci-static.yml'
    if ($static -notmatch 'workflow_dispatch\s*:') { Fail 'ci-static.yml has no workflow_dispatch trigger' }
    if ($static -notmatch 'NX_CLOUD_RO_TOKEN' -or $static -notmatch 'NX_CLOUD_RW_TOKEN' -or $static -notmatch 'nx-cloud-protected' -or $static -notmatch 'nx-cloud-unprotected') {
        Fail 'ci-static.yml does not contain the expected Nx Cloud trust-boundary mapping'
    }
    if ($static -notmatch 'nrwl/nx-set-shas@') { Fail 'ci-static.yml does not use canonical Nx SHA resolution' }

    $runtime = Read-Workflow '.github/workflows/ci-runtime.yml'
    if ($runtime -notmatch 'workflow_dispatch\s*:') { Fail 'ci-runtime.yml has no workflow_dispatch trigger' }
    if ($runtime -notmatch 'NX_NO_CLOUD:\s*["'']?true' -or $runtime -notmatch '--projects=repository-ci' -or $runtime -notmatch 'repository-ci:runtime-integration') {
        Fail 'ci-runtime.yml must remain affected-selected and explicitly uncached'
    }

    $controlProject = (Get-Content -LiteralPath (Join-Path $RepoRoot 'apps/control-panel/project.json') -Raw) | ConvertFrom-Json
    if ($null -eq $controlProject.targets.e2e -or $controlProject.targets.e2e.cache -ne $false) {
        Fail 'control-panel:e2e must be intrinsically uncached'
    }
    if ($null -eq $controlProject.targets.'browser-live-proof' -or $controlProject.targets.'browser-live-proof'.cache -ne $false) {
        Fail 'control-panel:browser-live-proof must be intrinsically uncached'
    }

    Write-Host 'NX_CLOUD_GITHUB_VERIFY=PASS'
    Write-Host 'NX_CLOUD_WORKSPACE_ID=present'
    Write-Host 'NX_CLOUD_REPOSITORY_RO=present'
    Write-Host "NX_CLOUD_PROTECTED_RW=present environment=$ProtectedEnvironment"
    Write-Host 'CANONICAL_CI_WORKFLOWS=4'
    Write-Host 'CI_STATIC_NX_CLOUD=trusted-cache-boundary'
    Write-Host 'CI_RUNTIME_NX_CLOUD=disabled'
    Write-Host 'CI_RUNTIME_AFFECTED_OWNER=repository-ci'
    Write-Host 'CONTROL_PANEL_RUNTIME_TARGETS=uncached'
    Write-Host "NX_CLOUD_REF_VERIFIED=$Ref"
}
finally {
    Pop-Location
}
