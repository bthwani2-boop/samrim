# Administration And Control Capabilities

ARTIFACT_CLASS: DURABLE_PRODUCT_CAPABILITY_GOVERNANCE
SEMANTIC_OWNER: governance/product/capabilities/administration-and-control.md
EXECUTION_AUTHORITY: NONE
CLOSURE_AUTHORITY: NONE
IMPLEMENTATION_STATE_AUTHORITY: NONE
PARENT_CAPABILITY_INDEX: governance/product/CAPABILITIES.md

## Scope

This owner defines only the durable capability semantics listed below. Capability taxonomy/schema/admission law remains in `../CAPABILITIES.md`; cross-capability journeys remain in `../JOURNEYS.md`.

### ADMINISTRATION_ROLES_APPROVALS_AUDIT — الإدارة والأدوار والاعتمادات والتدقيق

**Problem.** Administration needs precise operation/surface-scoped permissions, maker-checker separation, auditable rollback, redacted diagnostics, and delegation to the sovereign Identity and DSH owners without creating parallel administration truth.
**Target state.** Every executable administration decision has one governed maker/checker lifecycle, canonical owner readback, append-only redacted audit, and no parallel sovereign-domain projection.

**Required outcome.** Administration role and approval changes are surface-scoped, independently approved, version-fenced, auditable and reversible without moving Identity credential/access truth or DSH partner/captain/field lifecycle truth into DSH Administration.

**Primary actors.** operator-role-maker, operator-role-checker, operator-auditor, role-beneficiary.

**Canonical ownership.** DSH administration workflow and DSH-owned operational actor/partner lifecycle; Identity owns authentication/access truth.

**Material deployable surfaces.** control-panel.

**Business invariants**
- DSH Administration owns its role-definition/approval/audit workflow but not Identity authentication/credential truth or DSH-owned partner/captain/field lifecycle truth.
- Approved means the canonical downstream mutation succeeded, canonical owner readback proved the resulting truth, and administration finalization committed.
- Pending execution states are non-applied and must not be consumed as effective RBAC truth.
- Rejected requests have no executable canonical mutation intent.
- A failed-terminal request is immutable; recovery supersedes it and creates exactly one fresh pending request against current canonical version.
- Rollback appends an independently approved inverse decision and never deletes the source decision or audit trail.

**Forbidden/negative invariants**
- No direct role creation/assignment/revocation without governed approval.
- No maker, beneficiary, or disallowed previous checker approves the affected decision.
- No broad identity role label bypasses exact administration operation permission.
- No approval queue is readable through unrelated generic permission.
- No failed-terminal request is replayed, reset, edited, or replaced more than once.
- No phone, document, session, secret, partner review note, captain license number or equivalent sensitive sovereign data becomes administration truth.
- No partner activation/captain credential projection or mutation is owned by Administration.
- No audit history is deleted or rewritten through ordinary application paths.

**Acceptance expectations**
- Role definitions persist normalized operation permissions and explicit surface scope with control-panel mandatory for administration capability.
- Role definition and actor role changes use maker-checker approval with canonical role-version conflict protection.
- A failed-terminal request is recovered only by one atomic supersede-and-replace operation followed by fresh independent approval.
- Approved assignment or revocation decisions are reversed only through a separate independently approved inverse request.
- Audit writes avoid raw reason/review-note sensitive values, audit readback is redacted, and ordinary update/delete of audit history is rejected.
- Approval queues require their exact checker permissions and cannot be listed through a generic administration-read permission alone.
- The administration permission boundary has no broad operator-role bypass and does not propagate unnecessary PII.
- Partner/captain/field operational reads and mutations remain DSH-owned while credentials/access remain Identity-owned; Administration delegates to those canonical owners rather than maintaining local truth.

**Named failure classes:** direct_unapproved_role_mutation, maker_self_approval, beneficiary_self_approval, rollback_checker_not_independent, broad_role_bypass, failed_terminal_intent_replayed_or_edited, duplicate_replacement_request, audit_history_mutated, sensitive_data_in_audit_or_diagnostics, parallel_partner_or_operational_actor_truth.

**Actor responsibility envelope**
- `operator-role-maker` — Creates reasoned role-definition, assignment/revocation, rollback, and terminal-failure replacement requests without approving their own intent.; permitted: request surface-scoped role definition, request actor role assignment or revocation, request inverse action for approved decision, supersede failed-terminal request while creating one fresh version-fenced request; forbidden: self approve or reject, directly mutate canonical role truth, edit or replay failed-terminal intent, store sensitive Identity or DSH participant values in administration audit.
- `operator-role-checker` — Independently reviews and approves/rejects the governed administration requests for which the actor has exact checker permission.; permitted: approve or reject role-definition request, approve or reject role assignment/revocation, approve or reject rollback when independence rules are satisfied; forbidden: approve own request, approve a request benefiting the same actor, approve rollback when the actor was the original decision checker, use a broad role label instead of exact permission.
- `operator-auditor` — Reads append-only redacted administration audit and privacy-safe aggregate diagnostics within authorized scope.; permitted: read redacted audit, read aggregate diagnostics; forbidden: mutate role or approval state, delete or rewrite audit history, read secrets, sessions, documents, raw review notes or unnecessary PII.
- `role-beneficiary` — Receives the effect of an independently approved role assignment/revocation but does not approve the change.; permitted: consume the resulting authorized role state; forbidden: approve own assignment, self grant permissions, bypass surface or operation scope.

**Surface semantics**
- `control-panel` — required; actors: operator-role-maker, operator-role-checker, operator-auditor, role-beneficiary; states: loading, empty, ready, pending, approved, rejected, superseded, reconciling, retryable_failure, failed_terminal, forbidden, conflict, error; actions: request, approve, reject, request rollback, recover failed-terminal intent by supersede-and-replace, read audit, read diagnostics, navigate to the sovereign Identity/DSH owner surface.
- `backend` — required; actors: operator-role-maker, operator-role-checker, operator-auditor, role-beneficiary; states: not_started, pending, reconciling, retryable_failure, failed_terminal, applied, forbidden, conflict; actions: enforce exact permissions, enforce maker-checker and beneficiary separation, fence by canonical role version, delegate Identity/DSH mutations to their canonical owners, finalize only after canonical owner readback, return redacted audit and diagnostics.
- `database` — required; actors: operator-role-maker, operator-role-checker, operator-auditor; states: versioned, append_only_audit, immutable_failed_terminal_intent, auditable; actions: persist requests and decisions, enforce one fresh replacement per superseded terminal failure, retain immutable source decision history, reject audit update/delete outside explicit maintenance authority.
- technical presentation binding — required implementation evidence; actors: operator-role-maker, operator-role-checker, operator-auditor, role-beneficiary; states: loading, ready, forbidden, conflict, error; actions: map canonical administration state, coordinate mutation/readback, avoid local role or approval truth.
- `app-client` — excluded; states: not_affected_directly; exclusion reason: Consumes authorization outcomes but does not own administration controls.
- `app-partner` — excluded; states: not_affected_directly; exclusion reason: Partner lifecycle/authorization outcomes are consumed through sovereign owners; administration does not become partner lifecycle truth.
- `app-captain` — excluded; states: not_affected_directly; exclusion reason: Captain operational truth remains DSH-owned and Identity credential/access truth remains Identity-owned.
- `app-field` — excluded; states: not_affected_directly; exclusion reason: Field operational truth remains DSH-owned and Identity credential/access truth remains Identity-owned.

**Additional durable semantic model**

```json
{
  "stateModel": {
    "approval": [
      "pending",
      "approved",
      "rejected",
      "superseded"
    ],
    "execution": [
      "not_started",
      "pending",
      "reconciling",
      "retryable_failure",
      "failed_terminal",
      "applied"
    ],
    "role": [
      "active",
      "inactive"
    ],
    "diagnostics": [
      "healthy",
      "attention"
    ],
    "allowedApprovalExecutionPairs": [
      {
        "approval": "pending",
        "execution": "not_started"
      },
      {
        "approval": "pending",
        "execution": "pending"
      },
      {
        "approval": "pending",
        "execution": "reconciling"
      },
      {
        "approval": "pending",
        "execution": "retryable_failure"
      },
      {
        "approval": "pending",
        "execution": "failed_terminal"
      },
      {
        "approval": "superseded",
        "execution": "failed_terminal"
      },
      {
        "approval": "approved",
        "execution": "applied"
      },
      {
        "approval": "rejected",
        "execution": "not_started"
      }
    ]
  }
}
```

**Primary success measure.** governed administration decisions finalized only after independent approval and canonical owner readback.
**Guardrail measures.** self/beneficiary approval; broad-role bypass; mutable audit history; duplicate terminal-failure replacement; sensitive data leakage.

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
