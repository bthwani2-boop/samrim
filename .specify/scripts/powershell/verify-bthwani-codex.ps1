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

    # Strict shared-worktree protection: other agents' changes must not be
    # included in an autonomous workflow. Run-state metadata is excluded.
    $changes = @(& git status --porcelain=v1 --untracked-files=normal)
    Require-ExitZero 'git status'
    $unowned = @($changes | Where-Object { $_ -and ($_ -notmatch '^\?\? \.specify/workflows/runs/') })
    if ($unowned.Count -gt 0) {
        Fail "Shared worktree has $($unowned.Count) changed path(s). Coordinate the Git writer and preserve other sessions before executing the automated workflow"
    }
    Write-Output ("SPECKIT_PRECHECK_PASS: branch=$branch; integration=codex; model=gpt-6-luna; effort=medium; requested_tier=fast; worktree=clean")
    exit 0
}
catch {
    Fail $_.Exception.Message
}
