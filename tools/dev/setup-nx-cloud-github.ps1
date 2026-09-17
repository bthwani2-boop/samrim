#Requires -Version 7.4
[CmdletBinding()]
param(
    [string]$Repository = 'bthwani2-boop/samrim',
    [string]$ProtectedEnvironment = 'nx-cloud-protected',
    [string]$UnprotectedEnvironment = 'nx-cloud-unprotected',
    [string]$ProtectedBranch = 'main',
    [switch]$Apply,
    [switch]$Force
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$RepoRoot = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path

function Fail([string]$Message) { throw "NX_CLOUD_GITHUB_SETUP=FAIL $Message" }

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

function Read-Token([string]$Label) {
    $secure = Read-Host -Prompt "Paste the Nx Cloud $Label CI token" -AsSecureString
    $pointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure)
    try {
        $value = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($pointer)
    }
    finally {
        [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($pointer)
    }
    if ([string]::IsNullOrWhiteSpace($value)) { Fail "$Label token cannot be empty" }
    if ($value -match '[\r\n]') { Fail "$Label token must be a single-line value" }
    return $value
}

function Set-Secret([string]$Name, [string]$Value, [string]$Environment = '') {
    $arguments = @('secret', 'set', $Name, '--repo', $Repository)
    if ($Environment) { $arguments += @('--env', $Environment) }
    $output = @($Value | & gh @arguments 2>&1)
    $exitCode = $LASTEXITCODE
    if ($exitCode -ne 0) {
        Fail "unable to set ${Name}: $($output -join [Environment]::NewLine)"
    }
}

function Ensure-GhReady {
    if (-not (Get-Command gh -ErrorAction SilentlyContinue)) { Fail 'GitHub CLI (gh) is required' }
    & gh auth status --hostname github.com *> $null
    if ($LASTEXITCODE -ne 0) { Fail 'gh is not authenticated for github.com; run gh auth login first' }
    $identity = ((Invoke-Gh @('repo', 'view', $Repository, '--json', 'nameWithOwner', '--jq', '.nameWithOwner')) -join '').Trim()
    if ($identity -ne $Repository) { Fail "repository mismatch: observed=$identity expected=$Repository" }
}

Push-Location $RepoRoot
try {
    Ensure-GhReady
    $repoSecrets = @(Get-SecretNames)
    if ($repoSecrets -contains 'NX_CLOUD_RW_TOKEN') {
        Fail 'NX_CLOUD_RW_TOKEN already exists as a repository secret; remove it manually before using the protected-environment layout'
    }

    Write-Host "NX_CLOUD_GITHUB_SETUP=PLAN repository=$Repository"
    Write-Host "NX_CLOUD_ENVIRONMENT_PROTECTED=$ProtectedEnvironment branch_policy=branch:$ProtectedBranch"
    Write-Host "NX_CLOUD_ENVIRONMENT_UNPROTECTED=$UnprotectedEnvironment branch_policy=none"
    Write-Host 'NX_CLOUD_SECRET_REPOSITORY=NX_CLOUD_RO_TOKEN'
    Write-Host "NX_CLOUD_SECRET_ENVIRONMENT=$ProtectedEnvironment/NX_CLOUD_RW_TOKEN"
    Write-Host 'NX_CLOUD_TOKEN_VALUES=NEVER_PRINTED'

    if (-not $Apply) {
        Write-Host 'NX_CLOUD_GITHUB_SETUP=DRY_RUN use -Apply to create environments and set secrets'
        return
    }

    $null = Invoke-Gh @(
        'api', '--method', 'PUT', "repos/$Repository/environments/$ProtectedEnvironment",
        '-F', 'deployment_branch_policy[protected_branches]=false',
        '-F', 'deployment_branch_policy[custom_branch_policies]=true'
    )
    $protectedPolicies = ((Invoke-Gh @('api', "repos/$Repository/environments/$ProtectedEnvironment/deployment-branch-policies")) -join '') | ConvertFrom-Json
    $policyNames = @($protectedPolicies.branch_policies | ForEach-Object { [string]$_.name })
    if ($policyNames -notcontains $ProtectedBranch) {
        $null = Invoke-Gh @(
            'api', '--method', 'POST', "repos/$Repository/environments/$ProtectedEnvironment/deployment-branch-policies",
            '-f', "name=$ProtectedBranch", '-f', 'type=branch'
        )
    }
    $null = Invoke-Gh @('api', '--method', 'PUT', "repos/$Repository/environments/$UnprotectedEnvironment")

    $existingProtected = @(Get-SecretNames $ProtectedEnvironment)
    if (-not $Force -and ($repoSecrets -contains 'NX_CLOUD_RO_TOKEN' -or $existingProtected -contains 'NX_CLOUD_RW_TOKEN')) {
        Fail 'one or more target secrets already exist; use -Force only when intentional replacement is required'
    }

    $readOnlyToken = Read-Token 'read-only'
    try { Set-Secret 'NX_CLOUD_RO_TOKEN' $readOnlyToken }
    finally { $readOnlyToken = $null }

    $readWriteToken = Read-Token 'read-write'
    try { Set-Secret 'NX_CLOUD_RW_TOKEN' $readWriteToken $ProtectedEnvironment }
    finally { $readWriteToken = $null }

    $finalRepoSecrets = @(Get-SecretNames)
    $finalProtectedSecrets = @(Get-SecretNames $ProtectedEnvironment)
    if ($finalRepoSecrets -notcontains 'NX_CLOUD_RO_TOKEN') { Fail 'repository RO secret was not readable after setting it' }
    if ($finalProtectedSecrets -notcontains 'NX_CLOUD_RW_TOKEN') { Fail 'protected RW secret was not readable after setting it' }
    if ($finalRepoSecrets -contains 'NX_CLOUD_RW_TOKEN') { Fail 'RW secret is still exposed at repository scope' }

    Write-Host 'NX_CLOUD_GITHUB_SETUP=PASS'
    Write-Host "NX_CLOUD_REPOSITORY_SECRET=PASS name=NX_CLOUD_RO_TOKEN"
    Write-Host "NX_CLOUD_PROTECTED_SECRET=PASS environment=$ProtectedEnvironment name=NX_CLOUD_RW_TOKEN"
}
finally {
    Pop-Location
}
