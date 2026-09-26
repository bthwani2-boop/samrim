#Requires -Version 7.4
[CmdletBinding()]
param(
    [string]$ExpectedBranch = '',
    [string]$BaseSha = ''
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$PSNativeCommandUseErrorActionPreference = $false

$Repo = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path

function Fail([string]$Message) { throw $Message }

function Invoke-Git([string[]]$Arguments) {
    $output = @(& git -C $Repo @Arguments 2>&1)
    if ($LASTEXITCODE -ne 0) { Fail ("git " + ($Arguments -join ' ') + " failed: " + ($output -join [Environment]::NewLine)) }
    return $output
}

function Run-QuietStep([string]$Name, [scriptblock]$Action) {
    Write-Host ''
    $clock = [Diagnostics.Stopwatch]::StartNew()
    $logPath = Join-Path ([IO.Path]::GetTempPath()) ("samrim-verify-{0}.log" -f [guid]::NewGuid().ToString('N'))
    $logPrinted = $false
    try {
        $global:LASTEXITCODE = 0
        & $Action *> $logPath
        $exitCode = $LASTEXITCODE
        if ($exitCode -ne 0) {
            $clock.Stop()
            Write-Host "=== $Name FAILED ==="
            if (Test-Path $logPath) { Get-Content -Path $logPath | ForEach-Object { Write-Host $_ } }
            $logPrinted = $true
            Fail "$Name failed with exit code $exitCode"
        }

        $clock.Stop()
        $lineCount = if (Test-Path $logPath) { @(Get-Content -Path $logPath).Count } else { 0 }
        Write-Host ("VERIFY_STEP=PASS name={0} ms={1} output_lines={2}" -f ($Name -replace '\s+','_'), $clock.ElapsedMilliseconds, $lineCount)
    }
    catch {
        if ($clock.IsRunning) { $clock.Stop() }
        if (-not $logPrinted -and (Test-Path $logPath)) {
            Write-Host "=== $Name FAILED ==="
            Get-Content -Path $logPath | ForEach-Object { Write-Host $_ }
        }
        throw
    }
    finally {
        Remove-Item -Force -ErrorAction SilentlyContinue $logPath
    }
}

function Test-ChangedPath([string[]]$Patterns, [string[]]$Paths) {
    foreach ($candidate in $Paths) {
        foreach ($pattern in $Patterns) {
            if ($candidate -match $pattern) { return $true }
        }
    }
    return $false
}

$verifyClock = [Diagnostics.Stopwatch]::StartNew()

Push-Location $Repo
try {
    $branch = ((Invoke-Git @('branch','--show-current')) -join '').Trim()
    if ([string]::IsNullOrWhiteSpace($branch)) { Fail 'Detached HEAD is not a verifiable working branch.' }
    if ($ExpectedBranch -and $branch -ne $ExpectedBranch) { Fail "Expected branch '$ExpectedBranch', found '$branch'." }

    $head = ((Invoke-Git @('rev-parse','HEAD')) -join '').Trim()
    $status = @(Invoke-Git @('status','--porcelain=v1','--untracked-files=all'))
    if ($status.Count -gt 0) { Fail ("Candidate must be clean:" + [Environment]::NewLine + ($status -join [Environment]::NewLine)) }

    if (-not $BaseSha) {
        & git -C $Repo rev-parse 'HEAD^' *> $null
        $BaseSha = if ($LASTEXITCODE -eq 0) { ((Invoke-Git @('rev-parse','HEAD^')) -join '').Trim() } else { $head }
    }

    if ($BaseSha -notmatch '^[0-9a-f]{40}$') { Fail "Invalid BaseSha: $BaseSha" }
    & git -C $Repo merge-base --is-ancestor $BaseSha $head
    if ($LASTEXITCODE -ne 0) { Fail "Verification base is not an ancestor of candidate: base=$BaseSha head=$head" }

    Write-Host "VERIFY_BASE_SHA=$BaseSha"
    Write-Host "EXACT_LOCAL_CANDIDATE_SHA=$head"

    if ((& node --version).Trim() -ne 'v24.17.0') { Fail 'Node version mismatch.' }
    if ((& pnpm --version).Trim() -ne '10.34.0') { Fail 'pnpm version mismatch.' }
    if ((& go version | Out-String).Trim() -notmatch '\bgo1\.27\.1\b') { Fail 'Go version mismatch.' }

    $changeRows = @(Invoke-Git @('diff','--name-status','-M',$BaseSha,$head))
    $changedPaths = @()
    $structuralMutation = $false
    foreach ($row in $changeRows) {
        if ([string]::IsNullOrWhiteSpace($row)) { continue }
        $parts = @($row -split "`t")
        if ($parts.Count -lt 2) { continue }
        if ($parts[0] -match '^[ADRC]') { $structuralMutation = $true }
        for ($index = 1; $index -lt $parts.Count; $index++) {
            $candidate = ($parts[$index] -replace '\\','/').Trim()
            if ($candidate) { $changedPaths += $candidate }
        }
    }
    $changedPaths = @($changedPaths | Sort-Object -Unique)

    $workspaceSensitivePatterns = @(
        '^\.github/',
        '^tools/(dev|mobile)/',
        '(^|/)project\.json$',
        '(^|/)package\.json$',
        '^(AGENTS\.md|CLAUDE\.md|GEMINI\.md|REPOSITORY-STRUCTURE\.md|README\.md|CONTRIBUTING\.md|SECURITY\.md|knowledge\.sources\.json|nx\.json|pnpm-lock\.yaml|pnpm-workspace\.yaml|go\.work|go\.work\.sum|\.node-version|\.go-version|biome\.json|\.gitattributes)$',
        '^apps/app-(client|partner|captain|field)/(app\.config\.ts|mobile\.config\.json|eas\.json|fingerprint\.config\.js|assets/)',
        '^packages/design-system/',
        '^services/identity/clients/presentation/'
    )
    $deployabilityPatterns = @(
        '^(pnpm-lock\.yaml|pnpm-workspace\.yaml|package\.json|nx\.json|tsconfig\.base\.json|\.node-version)$',
        '^apps/app-(client|partner|captain|field)/(package\.json|app\.config\.ts|mobile\.config\.json|eas\.json|fingerprint\.config\.js|index\.(js|jsx|ts|tsx)|metro\.config\.(js|cjs|mjs|ts)|babel\.config\.(js|cjs|mjs|ts)|android/|ios/)',
        '^packages/design-system/package\.json$',
        '^tools/mobile/(export-mobile-smoke\.mjs|define-samrim-expo-app\.cjs|hash-mobile-secret-input\.mjs)$'
    )
    $infraPatterns = @('^infra/local/')

    $workspaceInvariantRequired = $structuralMutation -or (Test-ChangedPath $workspaceSensitivePatterns $changedPaths)
    $deployabilityProofRequired = Test-ChangedPath $deployabilityPatterns $changedPaths
    $infraProofRequired = Test-ChangedPath $infraPatterns $changedPaths

    Write-Host ("VERIFY_SCOPE changed_files={0} structural={1} workspace_invariants={2} deployability={3} infra={4}" -f $changedPaths.Count, [int]$structuralMutation, [int]$workspaceInvariantRequired, [int]$deployabilityProofRequired, [int]$infraProofRequired)
    Write-Host 'VERIFY_OUTPUT_MODE=QUIET_SUCCESS_VERBOSE_FAILURE'

    if ($workspaceInvariantRequired) {
        Run-QuietStep 'Workspace invariant targets' {
            pnpm exec nx run-many -t donor-residue repository-structure structural-hygiene runtime-ownership removed-domain-residue cache-contracts docs-command-parity docs-config-parity knowledge-system knowledge-references agent-contract workspace-dependencies go-workspace-sync nx-project-tags mobile-config brand theme-check theme-verify powershell-syntax knip --outputStyle=static --parallel=2
        }

        Run-QuietStep 'Execution proof system' {
            pnpm exec nx run repository-ci:execution-proof-system --outputStyle=static
        }
    }
    else {
        Write-Host 'VERIFY_WORKSPACE_INVARIANTS=SKIP reason=unaffected'
        Write-Host 'VERIFY_EXECUTION_PROOF_SYSTEM=SKIP reason=unaffected'
    }

    if ($infraProofRequired) {
        Run-QuietStep 'Infrastructure invariant targets' {
            pnpm exec nx run infra:compose-config --outputStyle=static
        }
    }
    else {
        Write-Host 'VERIFY_INFRASTRUCTURE=SKIP reason=unaffected'
    }

    if ($deployabilityProofRequired) {
        Run-QuietStep 'Affected static targets with deployability proof' {
            pnpm exec nx affected -t lint format-check typecheck unit contract build vet export-smoke --base=$BaseSha --head=$head --outputStyle=static --parallel=2
        }
    }
    else {
        Run-QuietStep 'Affected static targets' {
            pnpm exec nx affected -t lint format-check typecheck unit contract build vet --base=$BaseSha --head=$head --outputStyle=static --parallel=2
        }
        Write-Host 'VERIFY_EXPORT_SMOKE=SKIP reason=no-deployability-sensitive-change'
    }

    $endHead = ((Invoke-Git @('rev-parse','HEAD')) -join '').Trim()
    if ($endHead -ne $head) { Fail "Candidate HEAD changed during verification: before=$head after=$endHead" }
    $endStatus = @(Invoke-Git @('status','--porcelain=v1','--untracked-files=all'))
    if ($endStatus.Count -gt 0) { Fail 'Verification mutated repository state.' }

    Write-Host "VERIFY=PASS base=$BaseSha head=$head"
}
finally {
    $verifyClock.Stop()
    Write-Host "VERIFY_TOTAL_MS=$($verifyClock.ElapsedMilliseconds)"
    Pop-Location
}
