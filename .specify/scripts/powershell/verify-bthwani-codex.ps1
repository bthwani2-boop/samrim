# Fail-closed preflight for BThwani's Spec Kit -> Codex command workflow.
# This checks a shared worktree before an agent is allowed to mutate code.
# It does not grant Git, protected-data, network or deployment authority.
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

function Fail([string]$Reason) {
    [Console]::Error.WriteLine("SPECKIT_PRECHECK_BLOCKED: $Reason")
    exit 3
}
function Require-ExitZero([string]$Name) {
    if ($LASTEXITCODE -ne 0) { Fail "$Name returned exit code $LASTEXITCODE" }
}

try {
    $project = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot '..\..\..')).Path
    Set-Location -LiteralPath $project
    if (-not (Test-Path -LiteralPath '.specify/integration.json' -PathType Leaf)) { Fail 'Spec Kit integration state is missing' }
    foreach ($tool in @('specify', 'codex', 'git', 'python')) {
        if (-not (Get-Command $tool -ErrorAction SilentlyContinue)) { Fail "$tool not installed or not on PATH" }
    }
    $gitRoot = (& git rev-parse --show-toplevel).Trim()
    Require-ExitZero 'git rev-parse'
    if ([IO.Path]::GetFullPath($gitRoot).TrimEnd('\').ToLowerInvariant() -ne [IO.Path]::GetFullPath($project).TrimEnd('\').ToLowerInvariant()) {
        Fail 'The current Git root is not the approved refoundation worktree'
    }
    $branch = (& git branch --show-current).Trim()
    Require-ExitZero 'git branch'
    if ($branch -ne 'refoundation/clean-house-20261112') { Fail "Branch is not approved: $branch" }
    $integration = Get-Content -LiteralPath '.specify/integration.json' -Raw | ConvertFrom-Json
    if ($integration.default_integration -ne 'none' -or @($integration.installed_integrations) -notcontains 'codex') {
        Fail 'Foundation requires a neutral default while Codex remains installed for explicit workflow dispatch'
    }
    if (-not (Test-Path -LiteralPath '.specify/memory/constitution.md' -PathType Leaf) -or (Get-Item -LiteralPath '.specify/memory/constitution.md').Length -eq 0) {
        Fail 'Nonempty existing Spec Kit constitution is required; do not rewrite governance automatically'
    }
    foreach ($skill in @('speckit-specify','speckit-clarify','speckit-plan','speckit-tasks','speckit-checklist','speckit-analyze','speckit-implement','speckit-converge')) {
        if (-not (Test-Path -LiteralPath ".agents/skills/$skill/SKILL.md" -PathType Leaf)) { Fail "Missing official agent skill: $skill" }
    }
    $cfgFile = Join-Path $project '.codex/config.toml'
    if (-not (Test-Path -LiteralPath $cfgFile -PathType Leaf)) { Fail 'Project-scoped Codex settings missing' }
    $python = "import json,sys,tomllib; d=tomllib.load(open(sys.argv[1],'rb')); print(json.dumps({'model':d.get('model'),'effort':d.get('model_reasoning_effort'),'tier':d.get('service_tier'),'fast':d.get('features',{}).get('fast_mode'),'sandbox':d.get('sandbox_mode')}))"
    $raw = & python -c $python $cfgFile
    Require-ExitZero 'TOML configuration parse'
    $cfg = $raw | ConvertFrom-Json
    if ($cfg.model -ne 'gpt-6-luna' -or $cfg.effort -ne 'medium' -or $cfg.tier -ne 'fast' -or $cfg.fast -ne $true -or $cfg.sandbox -ne 'workspace-write') {
        Fail 'Codex model/medium/fast/workspace sandbox settings do not match approved configuration'
    }
    $status = & specify integration status
    Require-ExitZero 'specify integration status'
    if (($status -join ' ') -notmatch 'Default integration:\s*none' -or ($status -join ' ') -notmatch 'Integration status:\s*OK') {
        Fail 'Spec Kit integration status is not ready or its default violates Foundation'
    }
    $layers = & specify workflow resolve speckit
    Require-ExitZero 'specify workflow resolve'
    if (($layers -join ' ') -notmatch 'project:bthwani-codex-strict') {
        Fail 'Mandatory BThwani workflow overlay is not active'
    }
    $savedPreference = $ErrorActionPreference
    $ErrorActionPreference = 'Continue'
    try { $login = & codex login status 2>&1 } finally { $ErrorActionPreference = $savedPreference }
    Require-ExitZero 'codex login status'
    if (($login -join ' ') -notmatch 'Logged in') { Fail 'Codex is not authenticated' }

    # Scope admission, not a global clean-tree lock. Every workflow must declare
    # the exact paths it may change. Ownership claims are checked for tracked
    # source; ignored local test runs have an exclusive named subdirectory.
    $scopeRaw = $env:BTHWANI_SPECKIT_WRITE_SCOPE
    if ([string]::IsNullOrWhiteSpace($scopeRaw)) {
        Fail 'Set BTHWANI_SPECKIT_WRITE_SCOPE to a bounded relative directory before running Spec Kit'
    }
    $scopes = @()
    foreach ($candidate in @($scopeRaw -split ';')) {
        $scope = $candidate.Trim().Replace('\', '/').TrimEnd('/')
        if ($scope -eq '' -or $scope.StartsWith('/') -or $scope -match '^[A-Za-z]:' -or $scope.Contains('//')) {
            Fail "Invalid relative write scope: $candidate"
        }
        $parts = @($scope -split '/')
        if ($parts.Count -lt 2) { Fail "Write scope is too broad: $candidate" }
        foreach ($part in $parts) {
            if ($part -eq '.' -or $part -eq '..' -or $part -notmatch '\A[\p{L}\p{N}._-]+\z') {
                Fail "Write scope contains traversal or unsupported characters: $candidate"
            }
        }
        if ($parts[0] -in @('.git','.specify','.agents','.codex','node_modules')) {
            Fail "Autonomous workflow cannot rewrite protected tooling: $candidate"
        }
        if ($parts[0] -in @('services','apps','packages','tools','infra') -and $parts.Count -lt 3) {
            Fail "Write scope is too broad for shared source: $candidate"
        }
        $probe = $project
        foreach ($part in $parts) {
            $probe = Join-Path $probe $part
            if (Test-Path -LiteralPath $probe) {
                $item = Get-Item -LiteralPath $probe -Force
                if (($item.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) {
                    Fail "Write scope crosses a symlink or junction: $candidate"
                }
            }
        }
        $scope = $scope.ToLowerInvariant()
        if ($scopes -contains $scope) { Fail "Duplicate write scope: $candidate" }
        $scopes += $scope
    }
    if ($scopes.Count -gt 8) { Fail 'At most eight distinct write scopes may be declared' }

    # Spec Kit's feature resolver must use the same bounded write scope, not
    # an unrelated, mutable .specify/feature.json shared across sessions.
    $feature = $env:SPECIFY_FEATURE_DIRECTORY
    if ([string]::IsNullOrWhiteSpace($feature)) {
        Fail 'Set SPECIFY_FEATURE_DIRECTORY to a feature directory inside the declared write scope'
    }
    $feature = $feature.Trim().Replace('\','/').TrimEnd('/').ToLowerInvariant()
    if ($feature.StartsWith('/') -or $feature -match '^[A-Za-z]:' -or $feature.Contains('//') -or
        @($feature.Split('/') | Where-Object { $_ -eq '.' -or $_ -eq '..' -or $_ -notmatch '\A[\p{L}\p{N}._-]+\z' }).Count -gt 0) {
        Fail 'SPECIFY_FEATURE_DIRECTORY must be a safe repository-relative path'
    }
    if (@($scopes | Where-Object { $feature -eq $_ -or $feature.StartsWith($_ + '/') }).Count -eq 0) {
        Fail "SPECIFY_FEATURE_DIRECTORY is outside the declared write scope: $feature"
    }
    if ($env:SPECIFY_FEATURE_NO_PERSIST -notin @('1','true')) {
        Fail 'SPECIFY_FEATURE_NO_PERSIST=1 is required to avoid writing shared .specify/feature.json'
    }

    $trackedScopes = @($scopes | Where-Object { -not $_.StartsWith('.bthwani-local/') })
    if ($trackedScopes.Count -gt 0) {
        $claimsDir = $env:BTHWANI_SPECKIT_CLAIMS_DIR
        $claimName = $env:BTHWANI_SPECKIT_CLAIM_NAME
        if ([string]::IsNullOrWhiteSpace($claimsDir) -or [string]::IsNullOrWhiteSpace($claimName) -or
            $claimName -notmatch '\A[A-Za-z0-9_-]+\z') {
            Fail 'Tracked source requires an existing feature owner claim: BTHWANI_SPECKIT_CLAIMS_DIR and BTHWANI_SPECKIT_CLAIM_NAME'
        }
        if (-not (Test-Path -LiteralPath $claimsDir -PathType Container)) { Fail 'Feature claims directory is unavailable' }
        $ownsScope = @()
        $ownerPresent = $false
        foreach ($claim in @(Get-ChildItem -LiteralPath $claimsDir -Directory)) {
            $claimFile = Join-Path $claim.FullName 'owner.md'
            if (-not (Test-Path -LiteralPath $claimFile -PathType Leaf)) { Fail "Claim has no owner.md: $($claim.Name)" }
            $content = Get-Content -LiteralPath $claimFile -Raw
            $statusValue = [regex]::Match($content, '(?im)^STATUS:\s*([^\r\n]+)').Groups[1].Value.Trim()
            if ($statusValue -match '\A(RELEASED|CLOSED|COMPLETE|CANCELLED)') { continue }
            $worktreeValue = [regex]::Match($content, '(?im)^WORKTREE:\s*([^\r\n]+)').Groups[1].Value.Trim()
            if ($worktreeValue -and ([IO.Path]::GetFullPath($worktreeValue).TrimEnd('\') -ine [IO.Path]::GetFullPath($project).TrimEnd('\'))) { continue }
            $declaredScope = [regex]::Match($content, '(?im)^SCOPE:\s*([^\r\n]+)').Groups[1].Value
            if ([string]::IsNullOrWhiteSpace($declaredScope)) { Fail "Active claim has no scope: $($claim.Name)" }
            $claimPaths = @()
            foreach ($match in [regex]::Matches($declaredScope.Replace('\','/'), '[A-Za-z0-9._-]+(?:/[A-Za-z0-9._{}*,\-]+)+')) {
                $claimPath = $match.Value.ToLowerInvariant()
                $claimPath = ($claimPath -split '[{*]')[0].TrimEnd('/')
                if ($claimPath -and $claimPaths -notcontains $claimPath) { $claimPaths += $claimPath }
            }
            if ($claimPaths.Count -eq 0) { Fail "Cannot read claim scope: $($claim.Name)" }
            if ($claim.Name -ieq $claimName) {
                $ownerPresent = $true
                $ownsScope = $claimPaths
            } else {
                foreach ($scope in $trackedScopes) {
                    foreach ($claimPath in $claimPaths) {
                        if ($scope -eq $claimPath -or $scope.StartsWith($claimPath + '/') -or $claimPath.StartsWith($scope + '/')) {
                            Fail "Scope '$scope' conflicts with active claim $($claim.Name): $claimPath"
                        }
                    }
                }
            }
        }
        if (-not $ownerPresent) { Fail "Named active feature claim does not exist: $claimName" }
        foreach ($scope in $trackedScopes) {
            if (@($ownsScope | Where-Object { $scope -eq $_ -or $scope.StartsWith($_ + '/') }).Count -eq 0) {
                Fail "Scope '$scope' is not covered by claim $claimName"
            }
        }
    }

    # Read Git status for diagnostics, but preserve all peer edits. Scope
    # ownership does not grant index writes, commits, push or protected actions.
    $changes = @(& git status --porcelain=v1 --untracked-files=normal)
    Require-ExitZero 'git status'
    $dirtyCount = @($changes | Where-Object { $_ }).Count
    Write-Output ("SPECKIT_PRECHECK_PASS: branch=$branch; integration=codex; model=gpt-6-luna; effort=medium; requested_tier=fast; scope=$($scopes -join ';'); worktree_dirty_paths=$dirtyCount; other_work_preserved=true")
    exit 0
}
catch {
    Fail $_.Exception.Message
}
