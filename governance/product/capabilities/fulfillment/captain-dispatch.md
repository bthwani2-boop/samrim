# Captain Dispatch

ARTIFACT_CLASS: DURABLE_PRODUCT_CAPABILITY_GOVERNANCE
SEMANTIC_OWNER: governance/product/capabilities/fulfillment/captain-dispatch.md
EXECUTION_AUTHORITY: NONE
CLOSURE_AUTHORITY: NONE
IMPLEMENTATION_STATE_AUTHORITY: NONE
PARENT_CAPABILITY_INDEX: governance/product/CAPABILITIES.md
CAPABILITY_ID: CAPTAIN_DISPATCH

## Scope

This file is the **sole editable durable semantic owner** of `CAPTAIN_DISPATCH`. Capability taxonomy/schema/admission law remains in `../../CAPABILITIES.md`; cross-capability journey semantics remain in `../../JOURNEYS.md`.

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
