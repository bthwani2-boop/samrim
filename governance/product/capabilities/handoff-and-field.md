# Handoff And Field Capabilities

ARTIFACT_CLASS: DURABLE_PRODUCT_CAPABILITY_GOVERNANCE
SEMANTIC_OWNER: governance/product/capabilities/handoff-and-field.md
EXECUTION_AUTHORITY: NONE
CLOSURE_AUTHORITY: NONE
IMPLEMENTATION_STATE_AUTHORITY: NONE
PARENT_CAPABILITY_INDEX: governance/product/CAPABILITIES.md

## Scope

This owner defines only the durable capability semantics listed below. Capability taxonomy/schema/admission law remains in `../CAPABILITIES.md`; cross-capability journeys remain in `../JOURNEYS.md`.

### STORE_CAPTAIN_HANDOFF — العهدة الثنائية من المتجر إلى الكابتن

**Problem.** Order custody must transfer from the owning store to the assigned captain through one dual-confirmation DSH handoff truth, preventing early pickup and turning shortage/mismatch into governed operational exceptions rather than local surface state.
**Target state.** No early pickup, competing handoff attempt, stale local exception, cross-store confirmation or DSH financial side effect remains.

**Required outcome.** Custody moves from the owning store to the assigned captain only after the governed dual-confirmation handoff completes, with one DSH exception/readback truth across affected surfaces.

**Primary actors.** partner, captain, operator, system.

**Canonical ownership.** DSH custody/assignment/exception truth; WLT financial truth.

**Material deployable surfaces.** app-partner, app-captain, control-panel, app-client.

**Business invariants**
- DSH owns custody lifecycle, assignment relationship and operational handoff exceptions; WLT owns any financial truth.
- One active assignment has at most one executable handoff attempt for the governed order/store/captain scope.
- Pickup requires the canonical dual-confirmation prerequisites and absence of a blocking unresolved exception.
- Handoff mutation retries preserve one canonical identity and reject materially different payload under that identity.
- All affected surfaces read the same DSH handoff/exception state after refresh/restart.

**Forbidden/negative invariants**
- No pickup before dual handoff completion.
- No pickup while a blocking exception is open.
- No local surface block remains after DSH proves resolution.
- No store actor outside the owning store confirms handoff.
- No conflicting payload reuses the same retry/correlation identity.
- No superseded handoff remains executable after replacement assignment.
- No surface stores independent custody/exception truth or uses demo/fallback operational data.
- No DSH handoff path creates financial truth parallel to WLT.

**Acceptance expectations**
- Captain arrival creates/reads a handoff attempt bound to the current active assignment, order, store and captain.
- Only the owning-store partner scope confirms package handoff and the actor/time/version are retained.
- DSH does not allow picked_up before store confirmation plus the captain side of the dual confirmation.
- Successful arrival/partner-confirm/pickup retries are idempotent and return current canonical truth.
- An exception retry replays only when retry identity and governed payload are consistent; payload drift under the same identity is rejected.
- A prior handoff attempt becomes non-executable/superseded when a replacement assignment requires it; no competing pickup path remains.
- Partner/captain can report handoff_shortage or handoff_mismatch with attributable reporter/correlation identity.
- A blocking open exception prevents governed confirmation/pickup until authorized resolution.
- After canonical exception resolution, readback removes the block and continuation does not depend on local state.
- Partner/captain surfaces expose exception actions only when the active handoff is executable.
- Exception state survives refresh/restart because it comes from DSH.
- Control-panel reads the same DSH delivery-exception owner instead of a second subsystem.
- Client tracking never reports pickup before actual canonical handoff completion.
- DSH performs no debit/refund/ledger mutation because of handoff exception state.

**Named failure classes:** pickup_before_dual_confirmation, pickup_during_blocking_exception, local_block_stale_after_resolution, cross_store_confirmation, payload_drift_retry, competing_executable_handoff_after_reassignment, exception_lost_after_refresh, surface_local_handoff_truth, mock_or_fallback_operational_truth, dsh_financial_mutation.

**Actor responsibility envelope**
- `partner` — Confirms package handoff only for the owning store and reports governed handoff shortages/mismatches.; permitted: read active owned-store handoff, confirm store handoff, report handoff shortage or mismatch, read resolved/blocked state; forbidden: confirm another store handoff, force pickup, ignore blocking exception, mutate WLT financial truth.
- `captain` — Acts only on the currently assigned handoff, confirms pickup after required partner confirmation, and reports governed shortage/mismatch.; permitted: arrive at store, read own active handoff, complete captain pickup confirmation when legal, report handoff shortage or mismatch, refresh canonical state; forbidden: pickup before partner confirmation, pickup while a blocking exception is open, act on superseded/unassigned handoff, invent local exception truth.
- `operator` — Reads and resolves eligible DSH operational handoff exceptions without creating financial truth.; permitted: read handoff/exception state, resolve authorized operational exception, read audit/correlation; forbidden: fabricate handoff completion, resolve outside authorization, mutate WLT ledger/balance.
- `system` — Creates/supersedes handoff attempts from canonical assignment, enforces dual confirmation/idempotency and persists exception/readback state.; permitted: create attempt for active assignment, supersede obsolete attempt, enforce dual confirmation, block/unblock pickup from canonical exception state, return canonical readback; forbidden: leave competing executable attempts, accept payload-drift retry under same identity, mark pickup before prerequisites, create financial effects.

**Surface semantics**
- `app-partner` — required; actors: partner; states: loading, awaiting_partner, partner_confirmed, blocked_by_exception, completed, superseded, offline, error; actions: confirm handoff, report shortage/mismatch, refresh.
- `app-captain` — required; actors: captain; states: loading, awaiting_partner, partner_confirmed, blocked_by_exception, pickup_available, completed, superseded, offline, error; actions: arrive, complete pickup confirmation, report shortage/mismatch, refresh.
- `control-panel` — required; actors: operator; states: loading, ready, exception_open, exception_resolved, completed, superseded, forbidden, error; actions: read handoff/exception, resolve authorized exception, inspect audit.
- `app-client` — required; states: loading, pre_pickup, picked_up, in_delivery, offline, error; actions: read truthful order tracking consequence.
- `backend` — required; actors: partner, captain, operator, system; states: awaiting_partner, partner_confirmed, completed, superseded, exception_open, exception_resolved, forbidden, conflict; actions: authorize store/captain scope, enforce active assignment, persist dual confirmation, enforce idempotency/payload consistency, create/read/resolve exception, return canonical readback.
- `database` — required; actors: system, operator; states: transactional, assignment_bound, idempotent, audited, exception_governed; actions: persist handoff attempt, prevent competing executable attempt, retain actor/time/version, persist exception/correlation, enforce supersession.
- technical presentation binding — required implementation evidence; actors: partner, captain, operator; states: loading, ready, blocked, completed, superseded, offline, error; actions: map canonical handoff/exception state, avoid local custody/exception truth.
- `app-field` — excluded; states: not_affected; exclusion reason: Field actors have no custody role after store readiness under the current model.

**Additional durable semantic model**

```json
{
  "stateModel": {
    "custodyAttempt": [
      "awaiting_partner",
      "partner_confirmed",
      "completed",
      "superseded"
    ]
  }
}
```

**Primary success measure.** eligible custody handoffs completing once with attributable proof and consistent partner/captain/order readback.
**Guardrail measures.** double custody; stale/version-invalid handoff; missing required proof; unauthorized actor transition; financial mutation hidden inside custody flow.

### FIELD_OPERATIONS_ASSIGNMENT_READINESS

**Problem.** Field assignments, visits, readiness checks and escalations can become disconnected from canonical DSH field-actor eligibility and Partner/Store onboarding, creating unowned task state or evidence that can be bypassed.
**Target state.** DSH owns one scoped field-participant eligibility/assignment/visit/readiness lifecycle while Partner/Store capabilities consume verified field evidence.
**Primary success measure.** assigned field work reaching a governed completed or escalated owner-side result with attributable evidence and zero cross-scope task access.
**Guardrail measures.** unauthorized assignment reads/writes; in-progress reassignment without handoff; completed visit with missing required/critical evidence; unresolved blocking escalation at completion; stale-version transition.

**Required outcome.** Authorized field actors receive scoped assignments, perform versioned visits/checklists with location/evidence where required, escalate blockers and produce canonical DSH readiness evidence consumed by onboarding/store operations without creating a parallel field-actor truth.

**Primary actors.** field worker, field operations operator/supervisor, partner/store reviewer.

**Canonical ownership.** DSH field-operations capability owns field participant status/eligibility, assignments, visits, readiness checks, escalation and operational evidence; Partner/Store owners consume the resulting evidence.

**Boundary/non-overlap.** PARTNER_ONBOARDING_STORE_PUBLICATION consumes verified field evidence but owns Partner/Store activation/readiness/publication decisions. Field Operations cannot activate/publish a Partner or Store and Onboarding cannot rewrite assignment/visit/check history to force readiness.

**Material deployable surfaces.** app-field, control-panel, app-partner readback where the partner journey requires it.

**Business invariants**
- every assignment has trusted operator/business scope, field actor, task identity, priority/SLA and version;
- assignment lifecycle is versioned; reassignment of in-progress work requires explicit handoff;
- visit/readiness policy identifies required and critical checklist items and evidence requirements;
- visit completion is blocked while required checks/evidence or blocking escalations remain unresolved;
- location/geofence evidence is validated when the policy requires it and never grants authorization by itself;
- Field participant eligibility is canonical DSH truth and is not duplicated into a parallel actor/HR model.

**Durable state semantics.**
- assignment: assigned → in_progress → draft_linked or cancelled where legal;
- visit: in_progress → complete or escalated;
- check: pending → passed or failed;
- escalation: open → acknowledged → resolved or escalated_further.

**Forbidden/negative invariants**
- no cross-scope assignment/visit access;
- no in-progress reassignment without governed handoff;
- no completion with missing required/critical evidence;
- no parallel field-status mutation outside the canonical DSH owner;
- no field evidence silently publishes/activates Partner/Store state without owner review;
- no stale-version transition.

**Failure/recovery.** actor ineligible, assignment conflict, overdue/SLA breach, GPS/geofence evidence unavailable, required check failed, evidence missing, escalation open or dependency unavailable; preserve draft/evidence, escalate through governed state and resume from canonical readback.

**Acceptance expectations.** operator and field views agree on assignment/visit version; required evidence gates are enforced server-side; onboarding/store consumers reference canonical field evidence; audit/correlation is attributable and cross-scope leakage is absent.

**Actor responsibility envelope**
- `field worker` — performs only assigned/authorized work and captures governed evidence; forbidden: self-assign privileged work, approve owner decisions or alter unrelated canonical domain truth.
- `field operations operator/supervisor` — creates/reassigns/cancels scoped work and resolves/escalates according to permission; forbidden: bypass handoff/evidence/version rules.
- `partner/store reviewer` — consumes verified field evidence for owner decisions; forbidden: mutate field history to force readiness.

**Surface semantics**
- `app-field` — required; states include assigned, in_progress, offline_draft, blocked, escalated, complete, conflict, forbidden and error.
- `control-panel` — required for authorized assignment/readiness/escalation operations and audit.
- `app-partner` — conditional readback of owner-relevant readiness evidence.
- `backend` — required canonical operational state/authorization/version/evidence enforcement.
- `database` — required scoped assignment/visit/check/escalation persistence and audit.
- technical presentation binding — implementation evidence only; maps canonical state without local task truth.
