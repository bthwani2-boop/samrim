# BThwani Spec Kit + Codex CLI — execution contract

This document explains the repository-local Spec Kit integration; authoritative permissions and approval boundaries remain in `AGENTS.md`, `REPOSITORY-STRUCTURE.md`, and `governance/README.md`.

## Components

- ChatGPT GPT-6 coordinates, selects authorized remote-control channels, reviews code and test evidence, and reports final status.
- Official Spec Kit CLI 1.3.0 manages the installed `speckit` workflow. Foundation keeps the default integration `none`; the strict BThwani workflow explicitly dispatches each agent step to the installed `codex` integration.
- Codex CLI executes official `$speckit-*` skills. It has no authority to create branches/worktrees, push, open PRs, merge, deploy, alter protected data, or bypass a human review gate.
- `.codex/config.toml` requests `gpt-6-luna`, `high`, and `fast` in a workspace-write sandbox. The workflow overlay explicitly pins model and reasoning on every agent command. Fast service is a request and must not be described as verified from config alone.

## Entry point

From `D:\samrim-refoundation-clean-20261112`:

```powershell
specify check
specify integration status
specify workflow resolve speckit
specify workflow run speckit --input 'spec=Describe a single authorized capability with acceptance cases' --json
specify workflow status <run_id> --json
```

The overlay adds **preflight → specify → clarify → human specification review → plan → human plan review → checklist → tasks → analyze → human implementation review → implement → converge → human final review**.

The existing constitution is validated, **not regenerated automatically**. Workflow review gates require a genuine decision; never auto-approve them. Running the workflow or passing its gates does not certify a feature, authorize a release, or substitute for independent owner-backed evidence.

## Fail-closed policy

The local preflight `.specify/scripts/powershell/verify-bthwani-codex.ps1` rejects an unsupported integration, missing official skills, wrong project/branch, mismatched model/effort/fast request, missing constitution, unauthenticated Codex, disabled workflow overlay, and a working tree containing changes from concurrent owners. The local Spec Kit workflow run-state directory is exempt from the clean-tree check. Do not bypass this check or run the agent on a shared dirty worktree.

The preflight blocks code execution when other sessions have uncommitted work. Resume only after coordination and clean, approved ownership. A pending/failed workflow is **not** a successful implementation.

## Evidence and closure

A finished `speckit` workflow means only that its configured steps returned completion. The ChatGPT coordinator separately checks actual source/contract/database owner readback, meaningful positive/negative/concurrency tests, diff, branch/HEAD, review approvals, security and finance gates when affected. Without those, report NOT_RUN, FAIL, BLOCKED, or REVIEW_BLOCKED rather than CLOSED. Fast tier delivery cannot be guaranteed by the client if the service downgrades requests.

No Push, PR, merge, production release, or destructive action is implicitly authorized by this setup.
