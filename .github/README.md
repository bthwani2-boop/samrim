# BThwani GitHub checks — foundation-stage note

ARTIFACT_CLASS: NON_AUTHORITATIVE_CI_TRANSITION_NOTE
STATUS: BOOTSTRAP_ONLY / FULL_CI_NOT_RUN
SOURCE_BRANCH: 41
SOURCE_SHA: 426d67b47beb8c66b09acd8c7394086b53ac5aae
TARGET_BRANCH: refoundation/clean-house-20261112

This directory is preserved from the existing repository in the foundation-only sparse worktree. It is **not** a claim that the copied CI can run successfully against this intentionally incomplete checkout.

## Existing owners

- workflows/fast-guard.yml: repository's existing affected-scope CI and high-risk regression gates.
- workflows/fast-guard-routing.test.mjs: routing regression checks tied to Fast Guard.
- workflows/sonar-observe.yml: SonarQube Cloud Quality Gate.
- pull_request_template.md: review and evidence fields.

GitHub repository settings/rulesets, CodeQL setup and required checks may live outside these files and require separate live readback before any candidate is submitted.

## Known bootstrap limitation

At this stage the only visible source directories are .github and docs/governance. The Fast Guard workflow invokes scripts, tests and packages under apps/, services/, tools/ and .specify/ that are **not yet checked out**. Do not interpret missing files as product deletions. Do not create a permissive no-op gate that reports success for the absent source.

Sonar currently includes historical base branches 36, 37 and 38, and the routing test expects them. They require a coherent filter/test update when the canonical candidate surface and live GitHub ruleset are checked. The new branch is not pushed, no PR is opened, and no CI run is claimed.

## Target-state acceptance

1. Check every workflow action pin, trigger, branch filter, GitHub permissions, secret boundary, timeout, and concurrency behavior.
2. Align selected owner tests with actual change cones (Identity/DSH/WLT SQL, contract, design, apps and infra).
3. Ensure no skipped critical check can be mistaken for proof, and don't duplicate Sonar/CodeQL responsibilities.
4. Verify the reproducible setup for CI with exact candidate SHA and deliberately isolated SQL/runtime data. Avoid installing new local project libraries unless explicitly approved; ephemeral GitHub runner dependencies are a separate documented execution environment.
5. Preserve positive/negative authorization, money/replay, contract, RTL/browser and device proof appropriate to the candidate. Runtime proofs require evidence beyond source and mock checks.
6. Test the routing guard against positive and negative path examples before changing the workflow.
7. Verify live required checks, branch protections, CODEOWNERS permissions (if authorized), and secret policy before any PR/merge.
8. Never launch a write/destructive cleanup from a PR workflow based solely on a static unused-file result.

## Authority

Repository working law is in AGENTS.md and directory ownership in REPOSITORY-STRUCTURE.md, both present in the source Git tree but intentionally outside the initial sparse checkout. Canonical product/engineering rules are routed by docs/governance/README.md. The execution plan at docs/governance/BTHWANI-CLEAN-REFOUNDATION-EXECUTION-PLAN-20261112.md is not additional authority.

No Push, PR, Merge, deployment, ruleset change, or remote backup has been performed by this transition note.
