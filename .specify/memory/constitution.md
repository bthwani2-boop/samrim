# BThwani Spec Kit Constitution — Derived Compatibility Router

ARTIFACT_CLASS: DERIVED_SPEC_KIT_ROUTER
SEMANTIC_AUTHORITY: NONE
EXECUTION_AUTHORITY: NONE
IMPLEMENTATION_STATE_AUTHORITY: NONE
GOVERNANCE_CUTOVER: NOT_READY

Spec Kit is the workflow/scaffolding tool for bounded specifications. **This file is not another constitution, Product authority, business policy, or authorization to execute code.** It points Spec Kit to the actual BThwani owners and prevents the deleted legacy governance root from returning.

## Core Principles

### 1. Agent execution authority
The root `AGENTS.md` alone defines scope, human authorization, Git permissions, single-writer concurrency, protected data, testing, review and evidence. A Spec Kit command never authorizes Branch, Worktree, Push, PR, Merge, deployment, destructive SQL, payment, or Codex CLI.

### 2. Placement and ownership
The root `REPOSITORY-STRUCTURE.md` alone owns placement. Specs, plans and tasks are change-scoped working artifacts; never a second source for Store, Order, Wallet, owner-written contracts, policy values or deployment state.

### 3. Durable policy and single-engine design
The single intended policy root is `governance/README.md` and the **domain owner file it names**. Current cutover is `NOT_READY` until historical decisions and mandated critical-risk reviews complete. Do not treat a draft domain decision as approved or a mock/foundation CI pass as implementation. No `docs/governance/` folder is permitted in this candidate. A single DSH Store/Order engine serves both Store relations. Identity owns actors/permissions, DSH owns Stores/catalog/orders/fulfillment and WLT owns money/ledger/agreements/settlement.

### 4. Policy-driven operation and non-negotiable invariants
Commercial and operational **supported** mutable values (distance, fee bands, timeout, cancellation, refund entitlement, relation eligibility, dispatch modes, subscriptions, collection responsibility) are managed from the one Operator Policies experience through their actual DSH/WLT owner. No new generic rules engine, parallel policy database or hardcoded changeable business default in clients. Security, permission, privacy, ledger balance and integrity are never bypassable settings. A configured option is not proof its full financial/dispatch workflow has been implemented and safely admitted.

### 5. Source and evidence
Original branch `41` and the consolidated archival package are historical **donors**, not the implementation HEAD of this candidate. Preserve valid functionality and source provenance without blind copy of donor names or SQL. For every accepted code change, require contract/owner/consumer trace, real positive/negative proof where applicable, status and exact candidate SHA. A status of `NOT_RUN`, `BLOCKED` or `REVIEW_BLOCKED` cannot be rewritten as PASS by a template.

## Specification workflow
- Use `spec.md`, `plan.md` and `tasks.md` only for an explicitly authorized, coherent change that benefits from Spec Kit; no new Branch/Worktree automatically. `.specify/scripts/powershell/create-new-feature.ps1` may create a Git branch unless a safe no-branch workflow is established; do not invoke its mutating mode under current authorization.
- `specify version` and `specify check` verify CLI presence/tool discovery. The `none` integration supplies **agent-neutral shared scaffolding**, not Slash commands registered with a separate coding agent. No Codex CLI invocation or agent installation is implied.
- The CLI and its bundled templates/scripts may be updated from its verified official release with a reviewed diff and bounded authorization. Product or architectural **meaning** never migrates into the tool's generated templates or this router.
- When a Spec Kit workflow reveals a conflict, stop that affected operation and resolve it in the proper governance owner/AGENTS/REPOSITORY-STRUCTURE. Do not silently infer authorization from a prompt, workflow YAML or codegen.

## Governance
The canonical governance root and AGENTS prevail over this derived router at all times. This adapter has **no independent ratification or amendment power**; update it when those owners change. Implementation readiness is established only by actual source/contracts/data and owner-backed runtime readback, not plans.

**Status:** derived compatibility adapter for Specify CLI 1.3.0; not independently ratified.
