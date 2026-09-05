# Field Operations Assignment Readiness

ARTIFACT_CLASS: DURABLE_PRODUCT_CAPABILITY_GOVERNANCE
SEMANTIC_OWNER: governance/product/capabilities/fulfillment/field-operations-assignment-readiness.md
EXECUTION_AUTHORITY: NONE
CLOSURE_AUTHORITY: NONE
IMPLEMENTATION_STATE_AUTHORITY: NONE
PARENT_CAPABILITY_INDEX: governance/product/CAPABILITIES.md
CAPABILITY_ID: FIELD_OPERATIONS_ASSIGNMENT_READINESS

## Scope

This file is the **sole editable durable semantic owner** of `FIELD_OPERATIONS_ASSIGNMENT_READINESS`. Capability taxonomy/schema/admission law remains in `../../CAPABILITIES.md`; cross-capability journey semantics remain in `../../JOURNEYS.md`.

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
