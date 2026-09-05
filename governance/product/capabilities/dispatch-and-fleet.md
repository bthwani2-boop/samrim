# Dispatch And Fleet Capabilities

ARTIFACT_CLASS: DURABLE_PRODUCT_CAPABILITY_GOVERNANCE
SEMANTIC_OWNER: governance/product/capabilities/dispatch-and-fleet.md
EXECUTION_AUTHORITY: NONE
CLOSURE_AUTHORITY: NONE
IMPLEMENTATION_STATE_AUTHORITY: NONE
PARENT_CAPABILITY_INDEX: governance/product/CAPABILITIES.md

## Scope

This owner defines only the durable capability semantics listed below. Capability taxonomy/schema/admission law remains in `../CAPABILITIES.md`; cross-capability journeys remain in `../JOURNEYS.md`.

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
