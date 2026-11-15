# BThwani Spec Kit + Codex CLI — execution contract

This document explains the repository-local Spec Kit integration; authoritative permissions and approval boundaries remain in `AGENTS.md`, `REPOSITORY-STRUCTURE.md`, and `governance/README.md`.

## Components

- ChatGPT GPT-6 coordinates, selects authorized remote-control channels, reviews code and test evidence, and reports final status.
- Official Spec Kit CLI 1.3.0 manages the installed `speckit` workflow. Foundation keeps the default integration `none`; the strict BThwani workflow explicitly dispatches each agent step to the installed `codex` integration.
- Codex CLI executes official `$speckit-*` skills. It has no authority to create branches/worktrees, push, open PRs, merge, deploy, alter protected data, or bypass a human review gate.
- `.codex/config.toml` requests `gpt-6-luna`, `medium`, and `fast` in a workspace-write sandbox, with `allow_login_shell=false` to skip user PowerShell profiles. Its instructions for `$speckit-*` steps prefer bounded feature reads and forbid unnecessary recursive history scans without skipping required governance checks or official hooks. The overlay pins the model, but Specify CLI 1.3.0's Codex adapter does not forward a step-level `reasoning_effort` field: Codex TOML (or an explicit override) controls actual effort. Fast service is a request, not confirmed delivery.

## Entry point

From `D:\samrim-refoundation-clean-20261112`, declare the expected write boundary before starting. This ignored, unique test directory needs no source claim:

```powershell
$env:BTHWANI_SPECKIT_WRITE_SCOPE = '.bthwani-local/speckit-my-unique-test'
$env:SPECIFY_FEATURE_DIRECTORY = $env:BTHWANI_SPECKIT_WRITE_SCOPE
$env:SPECIFY_FEATURE_NO_PERSIST = '1'
specify check
specify integration status
specify workflow resolve speckit
$specKitPython = Join-Path $env:APPDATA 'uv\tools\specify-cli\Scripts\python.exe'
& $specKitPython .specify/scripts/prepare-bthwani-speckit.py .bthwani-local/speckit-my-unique-test/reviewed.yml
& $specKitPython .specify/scripts/invoke-bthwani-speckit.py workflow run .bthwani-local/speckit-my-unique-test/reviewed.yml --input 'spec=Describe a single authorized capability with acceptance cases' --json
& $specKitPython .specify/scripts/invoke-bthwani-speckit.py workflow status <run_id> --json
# Only after human review of the actual completed specification:
& $specKitPython .specify/scripts/invoke-bthwani-speckit.py workflow resume <run_id> --input spec_approval=approve --json
# Later approvals are independent: plan_approval, implementation_approval, final_approval.
```

The overlay adds **preflight → specify → clarify → human specification review → plan → human plan review → checklist → tasks → analyze → human implementation review → implement → converge → human final review**.

The existing constitution is validated, **not regenerated automatically**. Workflow review gates require a genuine decision; never auto-approve them. Running the workflow or passing its gates does not certify a feature, authorize a release, or substitute for independent owner-backed evidence.

## Fail-closed policy

The local preflight `.specify/scripts/powershell/verify-bthwani-codex.ps1` rejects unsupported integration, missing official skills, wrong project/branch, mismatched model/effort/fast request, missing constitution, unauthenticated Codex and disabled workflow overlay. **It does not require a clean Git worktree.** It requires `BTHWANI_SPECKIT_WRITE_SCOPE`: one to eight semicolon-separated, relative, bounded paths. A unique `.bthwani-local/<run-id>` scope supports isolated tests without a source claim. The CLI must also receive `SPECIFY_FEATURE_DIRECTORY` inside the declared scope and `SPECIFY_FEATURE_NO_PERSIST=1` so it never mutates the shared `.specify/feature.json` pointer. Paths under protected tooling such as `.git`, `.specify`, `.codex` and `.agents`, broad roots, globs, traversal and symlink/junction paths are rejected.

For any **tracked-source** scope, also set `BTHWANI_SPECKIT_CLAIMS_DIR` to the existing coordination room's `claims` directory and `BTHWANI_SPECKIT_CLAIM_NAME` to the current ACTIVE feature claim folder. Preflight verifies that the named claim covers the proposed scope and that no other active claim overlaps it. For example, an existing `STORE_ORDERABILITY-02` claim can admit its `services/dsh/backend/internal/storeavailability` path even while unrelated Identity files are modified; it may not use the Identity claim's paths.

These checks are **admission and collision checks, not an operating-system write sandbox**: Codex still runs with the project's workspace-write permissions. The coordinating agent must enforce the declared path boundary, review actual file changes, and stop on unclaimed writes or conflicting ownership. A claim does not grant Git index/Commit/Push rights, protected data changes, PR/Merge or deployment. One Git writer at a time remains mandatory. A pending, failed, or rejected workflow is **not** successful implementation.

## Evidence and closure

A finished `speckit` workflow means only that its configured steps returned completion. The ChatGPT coordinator separately checks actual source/contract/database owner readback, meaningful positive/negative/concurrency tests, diff, branch/HEAD, review approvals, security and finance gates when affected. Without those, report NOT_RUN, FAIL, BLOCKED, or REVIEW_BLOCKED rather than CLOSED. Fast tier delivery cannot be guaranteed by the client if the service downgrades requests.

No Push, PR, merge, production release, or destructive action is implicitly authorized by this setup.

## Fast, strict operation

- Keep the source of truth in approved repository owners. Use `medium` as the default Codex effort for bounded, routine SDD steps; selectively request higher effort for complicated architecture, security, financial or migration decisions, then independently verify the affected behavior. Do not claim the YAML `reasoning_effort` field changes Codex CLI behavior in Specify CLI 1.3.0.
- Dispatch each phase once, use one run-status read at the transition, and reuse completed artifacts. Do not restart an active command or replay an unknown write after a timeout; inspect processes, checkpoints and actual files first.
- **Review gates are not unattended approvals.** The installed base `speckit` workflow uses an interactive gate. Under a closed stdin, Spec Kit may record a rejection on EOF. For automation, use `prepare-bthwani-speckit.py` to derive the **current resolved speckit workflow and BThwani overlay**. It adds four `verdict_input` bindings with conservative `reject` defaults and `on_reject: retry`, so missing input PAUSES even when Windows terminal EOF is misread as rejection. Resume one gate at a time only after review of that stage, using its `<stage>_approval=approve` input. Do not pass approvals for future outputs, auto-approve, alter a failed checkpoint to completed, or count a rejected/aborted run as success.
- The documented synthetic test on 2026-11-15 used the official Codex Spec Kit commands in separate bounded runs and independently confirmed 9/9 Node tests; this validates the isolated test only. It is not proof of a single uninterrupted full-cycle run, production readiness, a faster service tier, or improved latency under a production workload.

## Recovery and regression tests

- Invoke Spec Kit through `invoke-bthwani-speckit.py`: it calls the installed official CLI with `stdin=DEVNULL` so an open remote console cannot hold Codex's extra input. On Windows, **for this child process only**, it excludes `%LOCALAPPDATA%\\Microsoft\\WindowsApps` from PATH. This avoids Codex selecting a nonworking `pwsh.exe` App Execution Alias instead of installed `powershell.exe` 5.1. It does not alter the machine/user PATH, user profile, Git, or the official workflow engine. If WindowsApps has legitimate command aliases that a future feature requires, review this scoped exclusion before running that feature.
- Use a managed process session for long-running Spec Kit commands. After a tool timeout, inspect the same session, run checkpoint and actual process before any retry. Never run a duplicate workflow in parallel.
- If a run remains `running` after its executor has ended, use the official engine-state API via `& $specKitPython .specify/scripts/recover-bthwani-speckit.py <run_id>`. The script checks that the checkpoint is older than two minutes, no relevant executor is active, and the unfinished step has no result; it backs up the state and sets `paused`, preserving completed steps.
- Test the exact review bindings and resume behavior with `& $specKitPython .specify/scripts/test-bthwani-speckit.py`. These tests do not invoke Codex agents or modify tracked product source.
- The generated YAML is derivative runtime state, not another canonical workflow. A change to the installed 13-step graph or review-gate semantics blocks regeneration until inspected. For each Codex command, the generator appends phase-local scope guidance while preserving `{{ inputs.spec }}` intact; mandatory skills, hooks, approvals and acceptance checks remain required. Supply **feature requirements**, not repeated instructions to execute all 13 workflow stages, in the `spec` input. Never overwrite an active run's saved workflow definition.
- A human rejection or an absent decision blocks further stages. A synthetic gate test approval does not authorize the final review of a real capability, a Push, a PR, a merge, a release or a deployment.
- Use measured execution times and stage results to evaluate speed; merely requesting Fast or lowering reasoning effort does not prove latency improvement.
