# Platform Sovereign Control Plane

ARTIFACT_CLASS: DURABLE_PRODUCT_CAPABILITY_GOVERNANCE
SEMANTIC_OWNER: governance/product/capabilities/access/platform-sovereign-control-plane.md
EXECUTION_AUTHORITY: NONE
CLOSURE_AUTHORITY: NONE
IMPLEMENTATION_STATE_AUTHORITY: NONE
PARENT_CAPABILITY_INDEX: governance/product/CAPABILITIES.md
CAPABILITY_ID: PLATFORM_SOVEREIGN_CONTROL_PLANE

## Scope

This file is the **sole editable durable semantic owner** of `PLATFORM_SOVEREIGN_CONTROL_PLANE`. Capability taxonomy/schema/admission law remains in `../../CAPABILITIES.md`; cross-capability journey semantics remain in `../../JOURNEYS.md`.

### PLATFORM_SOVEREIGN_CONTROL_PLANE

**Problem.** Platform is the sovereign control plane for governed variables, feature flags, live health, audit, rollback, and progressive delivery.
**Problem frequency.** continuous
**Problem severity.** critical
**Target state.** Every supported platform-control operation is governed, persistent, observable, and reversible.
**Primary success measure.** governed_platform_changes_and_rollouts_with_complete_readback
**Guardrail measures.** unauthorized_exposure; role_overlap; direct_writes; stale_overwrite; health_gate_bypass; concurrent_rollout; missing_audit; rollback_without_snapshot; fake_truth

**Required outcome.** One persistent control plane provides truthful reads, separated duties, audited changes, health-gated progressive delivery, readback, and safe rollback.

**Primary actors.** platform-governor, platform-operator, platform-approver, platform-applier, platform-rollout-manager, platform-auditor, customer, partner, captain, field-agent.

**Canonical ownership.** Platform Control semantic control-plane responsibility; domain and WLT truths remain at their owners. Independent deployment as `services/platform-control` remains conditional on executable service-admission proof.


**Named subcapability — governed change sets.** Change sets are an internal workflow of this capability, not a second durable capability owner.
- lifecycle: `draft → validated → submitted → approved | rejected → applied → rolled_back | failed` as legal for the current owner state machine;
- proposer and approver are independent; an actor cannot approve/reject its own change;
- apply is version/precondition-fenced against the validated target revision/snapshot;
- secrets/credential values and existing sensitive target values are excluded from proposed values and rollback snapshots;
- rollback requires a reason, preserves audit/history, and cannot overwrite a newer revision.

**Boundary/non-overlap.** Platform-wide change-set, feature-flag, rollout, health-gate and rollback semantics are all subcapabilities of this one Platform Control semantic responsibility. No parallel `PLATFORM_CHANGE_SETS` Product owner exists.

**Material deployable surfaces.** control-panel.

**Business invariants**
- Platform-Control owns the sovereign platform control plane.
- Domain administration may project role workflows but cannot become a second platform policy authority.
- WLT owns financial truth.
- Displayed state comes from live owners.
- Supported platform-control operations are governed and reversible.

**Forbidden/negative invariants**
- no mobile controls
- no fake local truth
- no self approval
- no rollout role overlap
- no transaction bypass
- no rollback without baseline and revision
- no advance without passing gate
- no routine or financial ownership

**Acceptance expectations**
- Permissions and surface scope are enforced.
- All displayed resources use live owner APIs.
- Operator, approver, applier, and rollout manager are separated.
- Change and rollout state machines persist readback.
- Health and revision gates block unsafe progress.
- Every transition is audited.
- Routine and financial operations stay outside Platform.

**Named failure classes:** static truth, unauthorized data, role overlap, nontransactional mutation, stale overwrite, stale_change_set, sensitive_change_capture, rollback_without_reason, health gate bypass, enabled rollout baseline, missing audit, false health.

**Actor responsibility envelope**
- `platform-governor` — Reads complete posture and governs platform control-plane authority.; permitted: read authorized posture; forbidden: bypass workflows, perform routine domain operations.
- `platform-operator` — Drafts, validates, and submits governed changes.; permitted: propose, validate, submit; forbidden: approve, apply, rollback, manage rollout.
- `platform-approver` — Independently approves or rejects governed changes.; permitted: approve another actor proposal, reject with reason; forbidden: approve own proposal, apply, manage rollout.
- `platform-applier` — Applies and rolls back approved governed changes.; permitted: apply, rollback, read affected state; forbidden: approve, manage rollout, overwrite newer revision.
- `platform-rollout-manager` — Operates health-gated progressive delivery.; permitted: create rollout, advance, pause, abort, rollback rollout; forbidden: participate in source change roles, advance on failed gate, start from enabled baseline, overwrite newer revision.
- `platform-auditor` — Reads immutable platform evidence.; permitted: read audit and posture; forbidden: mutate platform state.
- `customer` — Consumes effective platform outcomes through the client surface.; permitted: consume effective platform outcomes; forbidden: access sovereign controls, mutate platform state.
- `partner` — Consumes effective platform outcomes through the partner surface.; permitted: consume effective platform outcomes; forbidden: access sovereign controls, mutate platform state.
- `captain` — Consumes effective platform outcomes through the captain surface.; permitted: consume effective platform outcomes; forbidden: access sovereign controls, mutate platform state.
- `field-agent` — Consumes authorized effective outcomes through the field surface.; permitted: consume authorized effective platform outcomes; forbidden: access sovereign controls, mutate platform state.

**Surface semantics**
- `control-panel` — required; actors: platform-governor, platform-operator, platform-approver, platform-applier, platform-rollout-manager, platform-auditor; states: loading, success, partial-read, permission-denied, unavailable, draft, validated, submitted, approved, rejected, applied, rolled_back, running, paused, completed, aborted, health-gate-failed, version-conflict; actions: read live posture, operate authorized changes, operate authorized rollouts.
- technical presentation binding — required implementation evidence; actors: platform-governor, platform-operator, platform-approver, platform-applier, platform-rollout-manager, platform-auditor; states: idle, loading, success, error, restricted-resource, unavailable-resource, mutation-loading, mutation-success, mutation-error; actions: aggregate authorized reads, invoke contract operations, read back affected state.
- `backend` — required; actors: platform-governor, platform-operator, platform-approver, platform-applier, platform-rollout-manager, platform-auditor; states: OPERATIONAL, PARTIALLY_BOUND, FIX_REQUIRED, draft, validated, submitted, approved, rejected, applied, rolled_back, running, paused, completed, aborted, failed; actions: enforce permissions and separated duties, evaluate health gates, enforce revisions, persist atomically, audit and read back, restore baselines.
- `database` — required; actors: platform-operator, platform-approver, platform-applier, platform-rollout-manager, platform-auditor; states: persistent, transactional, revisioned, audited, health-gated, progressive, rollback-capable; actions: store workflows, capture baselines, reject stale operations, prevent concurrent active rollout.
- `app-client` — excluded; actors: customer; states: excluded; exclusion reason: Consumes effective outcomes only and cannot access sovereign controls.
- `app-partner` — excluded; actors: partner; states: excluded; exclusion reason: Consumes effective outcomes only and cannot access sovereign controls.
- `app-captain` — excluded; actors: captain; states: excluded; exclusion reason: Consumes effective outcomes only and cannot access sovereign controls.
- `app-field` — excluded; actors: field-agent; states: excluded; exclusion reason: Consumes authorized effective outcomes only and cannot access sovereign controls.
