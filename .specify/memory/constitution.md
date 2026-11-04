# BThwani Spec Kit Constitution — Derived Router

ARTIFACT_CLASS: DERIVED_SPEC_KIT_ROUTER
SEMANTIC_AUTHORITY: NONE
EXECUTION_AUTHORITY: NONE
IMPLEMENTATION_STATE_AUTHORITY: NONE

This file exists so Spec Kit can discover BThwani's **existing** rules without creating a second constitution. It introduces no new Product, engineering, security, financial, deployment, or permission policy.

## Core Principles

### 1. Agent execution authority
`AGENTS.md` is the sole repository agent-execution law. Follow it for authorized scope, Git, concurrent work, tests, safety, delegation and closure.

### 2. Placement and ownership
`REPOSITORY-STRUCTURE.md` is the sole repository placement router. Keep implementation, tests and artifacts with their correct owners.

### 3. Approved durable meaning
`docs/governance/README.md` routes approved Product, architecture, role and policy meaning to canonical documents under `docs/governance/`. Follow the relevant owner; do not restate or silently amend its decisions here.

### 4. Implementation evidence
Current source, contracts, schemas, configuration, tests and authoritative runtime readback establish implementation state. A Spec Kit plan or task is not proof of implementation.

## Specification Workflow

- `spec.md`, `plan.md` and `tasks.md` describe the bounded, authorized change being developed; they are working artifacts, not independent business or execution authority.
- Reconcile any proposed change to canonical governance with its responsible owner before treating it as approved.
- Use only the relevant Spec Kit workflow for substantial work. A routine small fix does not require new ceremony.
- No Spec Kit command grants permission to push, merge, deploy, delete data, alter security settings or run Codex CLI.

## Governance

If this adapter conflicts with an authoritative owner, that owner prevails. Update or remove this adapter rather than creating a parallel rule. Changes to approved durable meaning belong in their one canonical governance owner, not here.

**Status**: derived compatibility router; not independently ratified.
