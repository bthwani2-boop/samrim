# BThwani Spec Kit + Codex CLI — execution contract

This document explains the repository-local Spec Kit integration; authoritative permissions and approval boundaries remain in `AGENTS.md`, `REPOSITORY-STRUCTURE.md`, and `governance/README.md`.

## Components

- ChatGPT GPT-6 coordinates, selects authorized remote-control channels, reviews code and test evidence, and reports final status.
- Official Spec Kit CLI 1.3.0 manages the installed `speckit` workflow. Foundation keeps the default integration `none`; the strict BThwani workflow explicitly dispatches each agent step to the installed `codex` integration.
- Codex CLI executes official `$speckit-*` skills. It has no authority to create branches/worktrees, push, open PRs, merge, deploy, alter protected data, or bypass a human review gate.
- `.codex/config.toml` requests `gpt-6-luna`, `medium`, and `fast` in a workspace-write sandbox. This is the faster default for routine steps; use an explicitly authorized higher effort for complex reviews. The overlay pins the model, but Specify CLI 1.3.0's Codex adapter does not forward a step-level `reasoning_effort` field: Codex TOML (or an explicit Codex CLI override) controls actual effort. Fast service is a request, not confirmed delivery.

## Entry point

From `D:\samrim-refoundation-clean-20261112`, declare the expected write boundary before starting. This ignored, unique test directory needs no source claim:

```powershell
$env:BTHWANI_SPECKIT_WRITE_SCOPE = '.bthwani-local/speckit-my-unique-test'
specify check
specify integration status
specify workflow resolve speckit
specify workflow run speckit --input 'spec=Describe a single authorized capability with acceptance cases' --json
specify workflow status <run_id> --json
```

The overlay adds **preflight → specify → clarify → human specification review → plan → human plan review → checklist → tasks → analyze → human implementation review → implement → converge → human final review**.

The existing constitution is validated, **not regenerated automatically**. Workflow review gates require a genuine decision; never auto-approve them. Running the workflow or passing its gates does not certify a feature, authorize a release, or substitute for independent owner-backed evidence.

## Fail-closed policy

The local preflight `.specify/scripts/powershell/verify-bthwani-codex.ps1` rejects unsupported integration, missing official skills, wrong project/branch, mismatched model/effort/fast request, missing constitution, unauthenticated Codex and disabled workflow overlay. **It does not require a clean Git worktree.** It requires `BTHWANI_SPECKIT_WRITE_SCOPE`: one to eight semicolon-separated, relative, bounded paths. A unique `.bthwani-local/<run-id>` scope supports isolated tests without a source claim. Paths under protected tooling such as `.git`, `.specify`, `.codex` and `.agents`, broad roots, globs, traversal and symlink/junction paths are rejected.

For any **tracked-source** scope, also set `BTHWANI_SPECKIT_CLAIMS_DIR` to the existing coordination room's `claims` directory and `BTHWANI_SPECKIT_CLAIM_NAME` to the current ACTIVE feature claim folder. Preflight verifies that the named claim covers the proposed scope and that no other active claim overlaps it. For example, an existing `STORE_ORDERABILITY-02` claim can admit its `services/dsh/backend/internal/storeavailability` path even while unrelated Identity files are modified; it may not use the Identity claim's paths.

These checks are **admission and collision checks, not an operating-system write sandbox**: Codex still runs with the project's workspace-write permissions. The coordinating agent must enforce the declared path boundary, review actual file changes, and stop on unclaimed writes or conflicting ownership. A claim does not grant Git index/Commit/Push rights, protected data changes, PR/Merge or deployment. One Git writer at a time remains mandatory. A pending, failed, or rejected workflow is **not** successful implementation.

## Evidence and closure

A finished `speckit` workflow means only that its configured steps returned completion. The ChatGPT coordinator separately checks actual source/contract/database owner readback, meaningful positive/negative/concurrency tests, diff, branch/HEAD, review approvals, security and finance gates when affected. Without those, report NOT_RUN, FAIL, BLOCKED, or REVIEW_BLOCKED rather than CLOSED. Fast tier delivery cannot be guaranteed by the client if the service downgrades requests.

No Push, PR, merge, production release, or destructive action is implicitly authorized by this setup.

## Fast, strict operation

- Keep the source of truth in approved repository owners. Use `medium` as the default Codex effort for bounded, routine SDD steps; selectively request higher effort for complicated architecture, security, financial or migration decisions, then independently verify the affected behavior. Do not claim the YAML `reasoning_effort` field changes Codex CLI behavior in Specify CLI 1.3.0.
- Dispatch each phase once, use one run-status read at the transition, and reuse completed artifacts. Do not restart an active command or replay an unknown write after a timeout; inspect processes, checkpoints and actual files first.
- **Review gates are not unattended approvals.** The installed base `speckit` workflow uses an interactive gate. Under a closed stdin, Spec Kit may record a rejection on EOF. For automation, run a short, separately reviewed stage-scoped YAML with a declared `<stage>_approval` input and a matching gate `verdict_input`, supplying `approve` only after the reviewer has examined that stage. Do not pass approvals for future outputs, auto-approve, alter a failed checkpoint to completed, or count a rejected/aborted run as success.
- The documented synthetic test on 2026-11-15 used the official Codex Spec Kit commands in separate bounded runs and independently confirmed 9/9 Node tests; this validates the isolated test only. It is not proof of a single uninterrupted full-cycle run, production readiness, a faster service tier, or improved latency under a production workload.
