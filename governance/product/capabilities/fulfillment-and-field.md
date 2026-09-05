# Fulfillment and Field Capabilities

ARTIFACT_CLASS: DURABLE_PRODUCT_CAPABILITY_GOVERNANCE
SEMANTIC_OWNER: governance/product/capabilities/fulfillment-and-field.md
EXECUTION_AUTHORITY: NONE
CLOSURE_AUTHORITY: NONE
IMPLEMENTATION_STATE_AUTHORITY: NONE
PARENT_CAPABILITY_INDEX: governance/product/CAPABILITIES.md

## Scope

This owner defines only the durable capability semantics listed in this file. Cross-cutting capability schema/admission rules are owned by `../CAPABILITIES.md`; journeys remain owned by `../JOURNEYS.md`.

### CAPTAIN_DISPATCH — إسناد الكابتن والتوزيع

**Problem.** A ready BThwani-delivery order needs one governed dispatch offer/assignment truth with eligibility, capacity, timeout, captain decision, cancellation/reassignment and cross-surface readback that cannot fork under retry or concurrency.
**Target state.** Eligibility, capacity, timeout, assignment and reassignment are DSH-governed, idempotent and consistent across operator, captain and client surfaces.

**Required outcome.** Each eligible ready order has at most one active concurrency-safe DSH dispatch offer/assignment, with truthful captain decision and customer/operator readback.

**Primary actors.** operator, captain, client, system.

**Canonical ownership.** DSH operational dispatch and captain eligibility; WLT financial effects.

**Material deployable surfaces.** control-panel, app-captain, app-client.

**Business invariants**
- DSH owns dispatch offer, assignment and reassignment operational truth.
- Eligibility combines current order readiness, service area, captain accreditation/availability and capacity required by the active model.
- One order has at most one active assignment and one captain cannot exceed governed capacity under concurrency.
- Offer expiry and captain rejection are durable dispatch decisions with canonical readback.
- WLT remains the owner of any financial consequence associated with assignment/delivery.

**Forbidden/negative invariants**
- No assignment is created from captainId alone without the governed scope/identity required by current contracts.
- No frontend computes final eligibility or capacity authority.
- No acceptance occurs after offer expiry.
- No two active assignments exist for one order.
- No concurrent dispatch exceeds captain capacity.
- No cross-context assignment read/write is permitted.
- No non-atomic reassignment leaves zero or two live assignment truths.
- No customer/captain surface uses hardcoded or fabricated order/address/financial truth.
- No DSH dispatch path mutates WLT balance, commission or settlement truth.

**Acceptance expectations**
- An offer is created only for a BThwani-delivery order that is ready_for_pickup and service-area eligible.
- Only an eligible available captain with required service-area affiliation and remaining capacity is offered the order.
- Offer creation and reassignment are protected by idempotency plus transactional/concurrency controls.
- The captain receives the governed order/zone/distance/priority/reason/response-window data required for the decision.
- Only the authenticated captain can accept or reject that captain's live offer, and rejection records a reason.
- An expired offer cannot be accepted and returns the order to its governed ready-for-dispatch state when applicable.
- Cancellation/reassignment is forbidden after pickup execution begins.
- The operator sees active assignment, eligible alternatives and real decision history.
- The client sees only customer-safe tracking consequences, not internal eligibility/capacity/operations decisions.

**Named failure classes:** offer_for_ineligible_order, ineligible_captain_offered, duplicate_active_assignment, captain_capacity_exceeded, expired_offer_accepted, cross_captain_action, cross_context_assignment_read, non_atomic_reassignment, reassignment_after_pickup, frontend_or_local_dispatch_truth, dsh_financial_truth.

**Actor responsibility envelope**
- `operator` — Operates governed dispatch for eligible ready orders and reads active/alternative assignment state.; permitted: read active assignments, read eligible alternatives, initiate governed assignment or reassignment before pickup when allowed, inspect decision history; forbidden: bypass eligibility or capacity, create two active assignments for one order, reassign after pickup has begun, mutate WLT financial truth.
- `captain` — Receives an offer assigned to the authenticated captain and accepts or rejects it within the governed response window.; permitted: read own offer, accept valid own offer, reject valid own offer with reason, read resulting assignment state; forbidden: act on another captain offer, accept after expiry, bypass capacity/eligibility, mutate financial truth.
- `client` — Reads customer-safe tracking consequences after assignment without seeing captain eligibility or internal dispatch decisions.; permitted: read governed tracking state; forbidden: read internal eligibility/capacity data, assign or reassign captain, mutate dispatch state.
- `system` — Evaluates eligibility/capacity/zone/readiness and enforces one concurrency-safe active dispatch outcome.; permitted: evaluate eligibility, reserve assignment atomically, expire offers, return order to ready_for_pickup when an offer expires, audit decisions; forbidden: dispatch an ineligible captain, create concurrent active assignments, treat expired offer as accepted, create financial truth.

**Surface semantics**
- `control-panel` — required; actors: operator; states: loading, empty, ready, offered, assigned, expired, rejected, conflict, forbidden, error; actions: inspect assignment, inspect eligible alternatives, assign or reassign when legal, inspect decision history.
- `app-captain` — required; actors: captain; states: loading, empty, offered, accepted, rejected, expired, forbidden, offline, error; actions: read offer, accept, reject with reason, refresh.
- `app-client` — required; actors: client; states: loading, tracking_waiting_assignment, tracking_assigned, tracking_in_progress, offline, error; actions: read customer-safe tracking state, refresh.
- `backend` — required; actors: operator, captain, client, system; states: ready_for_pickup, offered, assigned, expired, rejected, picked_up, conflict, forbidden; actions: authorize, evaluate eligibility/capacity, create one offer, accept or reject, expire, reassign when legal, audit, return canonical readback.
- `database` — required; actors: system; states: transactional, idempotent, single_active_assignment, capacity_guarded, audited; actions: enforce uniqueness, lock concurrent assignment, persist offer deadline and decision, retain decision history.
- technical presentation binding — required implementation evidence; actors: operator, captain, client; states: loading, ready, expired, conflict, forbidden, offline, error; actions: map canonical state, coordinate mutation/readback, avoid local eligibility or assignment truth.

**Primary success measure.** eligible dispatch attempts resolving to one concurrency-safe assignment or explicit timeout/decline with canonical cross-surface readback.
**Guardrail measures.** concurrent active assignments; expired offer accepted; ineligible captain assigned; stale-version decision; dispatch-created financial truth.

### PARTNER_FLEET_CONNECTION

**Problem.** Partner couriers must bind to an authenticated captain identity through a short-lived one-time code without leaking trusted context data or creating a second local fleet truth.
**Problem frequency.** continuous
**Problem severity.** critical
**Target state.** All required surfaces use the same DSH state and all lifecycle transitions are scoped, versioned, audited, and notified.
**Primary success measure.** authoritative_fleet_bindings_with_readback
**Guardrail measures.** cross_context_fleet_access; plaintext_code_persisted; expired_code_redeemed; stale_version_overwrite; duplicate_same_store_membership; unbound_operator_mutation

**Required outcome.** Partner, captain, and operator surfaces observe one versioned DSH fleet truth while code material remains secret and every lifecycle mutation is scoped, audited, notified, and recoverable.

**Primary actors.** partner-operator, captain, control-panel-operator.

**Canonical ownership.** DSH partner-fleet operational truth; Identity authenticates actors.

**Material deployable surfaces.** app-partner, app-captain, control-panel.

**Business invariants**
- DSH owns partner fleet membership truth.
- Identity authenticates actors while DSH authorizes store and team scope.
- Every surface reads the same persisted membership and connection lifecycle.
- Every mutation is versioned, trusted-scope checked, audited, and notified.
- Captain identity uniqueness is scoped to one store so governed multi-store membership remains possible.
- Fleet lifecycle audit facts remain durable even when a transition does not change team-member status.

**Forbidden/negative invariants**
- no plaintext code persistence
- no code hash exposure
- no cross-partner/store trusted-scope access
- no cross-captain membership access
- no duplicate captain membership inside one store
- no inactive-store binding
- no expired or revoked code reuse
- no unaudited lifecycle transition
- no stale overwrite
- no operator mutation through the readback surface

**Acceptance expectations**
- Only an authenticated partner for the owned store can issue list or revoke a code.
- Partner surfaces visibly render pending redeemed revoked and expired connection states.
- Only an authenticated captain can redeem a valid pending code or disconnect an owned membership.
- A captain may hold memberships in multiple stores but cannot hold duplicate memberships inside one store.
- Plaintext codes are returned once and never persisted.
- Expired codes become durably expired, create an audit action and partner notification, and cannot be redeemed.
- Inactive stores and ineligible courier records fail closed.
- Optimistic versions protect revoke redeem and disconnect transitions.
- Disconnect suspends the member, records the governed lifecycle event, revokes the redeemed connection, and notifies both actors.
- Control-panel readback is redacted and requires current operator/partner read authorization.
- OpenAPI responses are typed and do not expose code hashes or plaintext outside issuance.

**Named failure classes:** cross-store partner access, cross-captain membership access, plaintext or hash leakage, expired or revoked code redemption, inactive-store binding, duplicate captain membership inside one store, unaudited lifecycle transition, missing lifecycle notification, stale overwrite, local surface fleet truth.

**Actor responsibility envelope**
- `partner-operator` — Owns courier team records and one-time connection-code lifecycle for the authenticated store.; permitted: issue one-time code, list owned-store connections, revoke pending owned-store code, observe expiry redemption and disconnect outcomes; forbidden: read another store fleet, see stored code hash, bind a captain directly, revoke another trusted-context connection.
- `captain` — Consumes a one-time code and owns the decision to disconnect each resulting store membership.; permitted: redeem valid code, list own memberships across stores, disconnect own membership; forbidden: redeem expired or revoked code, bind another captain, read another captain memberships, connect to an inactive store, hold duplicate memberships in one store.
- `control-panel-operator` — Reads a redacted operational snapshot for support, diagnostics, and audit.; permitted: read store fleet members, read connection lifecycle, inspect versions and assignment scope; forbidden: read plaintext code, read code hash, impersonate partner or captain, mutate membership from readback panel.

**Surface semantics**
- `app-partner` — required; actors: partner-operator; states: loading, ready, empty, error, pending, redeemed, revoked, expired, version-conflict; actions: issue code, list authoritative connection lifecycle, revoke pending code, reload authoritative state.
- `app-captain` — required; actors: captain; states: loading, empty, active, suspended, error, expired, ineligible, already-bound, version-conflict; actions: redeem code, list memberships across stores, disconnect one membership, refresh.
- `control-panel` — required; actors: control-panel-operator; states: loading, empty, ready, error, redacted; actions: read redacted store fleet snapshot, retry readback.
- technical presentation binding — required implementation evidence; actors: partner-operator, captain, control-panel-operator; states: loading, success, error, conflict; actions: call sovereign DSH routes, carry optimistic versions, remove superseded pending projections, avoid local fleet truth.
- `backend` — required; actors: partner-operator, captain, control-panel-operator; states: pending, redeemed, revoked, expired, active, suspended, version-conflict, forbidden; actions: enforce role and store scope, enforce active-store eligibility, hash code, lock mutations, audit lifecycle actions, notify partner and captain, return redacted operator readback.
- `database` — required; actors: partner-operator, captain, control-panel-operator; states: transactional, versioned, audited, trusted-context-scoped, single-use, store-scoped-multi-membership; actions: store digest only, enforce one pending code, persist and audit expiry, prevent duplicate identity binding inside one store, permit governed multi-store membership, retain lifecycle audit and notifications.

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
