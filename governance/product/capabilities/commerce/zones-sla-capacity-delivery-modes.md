# Zones Sla Capacity Delivery Modes

ARTIFACT_CLASS: DURABLE_PRODUCT_CAPABILITY_GOVERNANCE
SEMANTIC_OWNER: governance/product/capabilities/commerce/zones-sla-capacity-delivery-modes.md
EXECUTION_AUTHORITY: NONE
CLOSURE_AUTHORITY: NONE
IMPLEMENTATION_STATE_AUTHORITY: NONE
PARENT_CAPABILITY_INDEX: governance/product/CAPABILITIES.md
CAPABILITY_ID: ZONES_SLA_CAPACITY_DELIVERY_MODES

## Scope

This file is the **sole editable durable semantic owner** of `ZONES_SLA_CAPACITY_DELIVERY_MODES`. Capability taxonomy/schema/admission law remains in `../../CAPABILITIES.md`; cross-capability journey semantics remain in `../../JOURNEYS.md`.

### ZONES_SLA_CAPACITY_DELIVERY_MODES

**Problem.** Service areas, operational zones, SLA, capacity pressure, pauses and fulfillment modes must produce one deterministic DSH decision consumed by cart, checkout, order and dispatch instead of independent surface assumptions.
**Problem frequency.** continuous
**Problem severity.** critical
**Target state.** One governed decision and audit lifecycle is used across all required surfaces.
**Primary success measure.** canonical operational-policy decision coverage
**Guardrail measures.** checkout allowed after denial count; dispatch during pause count; disabled mode selection count; stale version mutation count; rollback without audit snapshot count

**Required outcome.** Every affected surface receives one versioned DSH operational decision that combines active zone, SLA, capacity pause and pressure, fulfillment mode and service-area truth, with explicit effects for cart, checkout, order and dispatch.

**Primary actors.** operator, client, partner, captain.

**Canonical ownership.** DSH operational policy/serviceability truth.

**Material deployable surfaces.** control-panel, app-client, app-partner, app-captain.

**Business invariants**
- DSH owns operational policy and serviceability decisions.
- Service-area geofences remain the spatial boundary truth where the current model uses them.
- Every affected workflow consumes the same canonical policy decision/version.
- Policy history is append-only and rollback creates a new version.

**Forbidden/negative invariants**
- No frontend derives serviceability from local constants.
- No disabled or paused path creates checkout or dispatch success.
- No stale expected version overwrites newer policy.
- No DSH policy mutation writes WLT financial truth.

**Acceptance expectations**
- Assignment SLA is represented alongside preparation and delivery SLA where required by the current model.
- Capacity supports explicit pause and resume with a reason and version guard.
- BThwani delivery, partner delivery and client pickup are independently governed per applicable zone/policy scope.
- Evaluation fails closed for inactive zones, paused capacity, disabled modes and exhausted pressure thresholds according to current policy.
- The decision returns explicit cart, checkout, order and dispatch effects.
- Every mutation is authorized, idempotent, correlated, versioned and audited.
- Audit snapshots can rollback only the same reversible aggregate through a new governed revision.
- The control panel exposes loading, empty, success, conflict, forbidden and recovery states.
- Affected client, partner and captain integrations consume the canonical decision rather than local truth.
- Operational policy does not create WLT balance or ledger mutation.

**Named failure classes:** local serviceability truth, dispatch during pause, checkout after denial, disabled fulfillment mode, stale update, cross-aggregate rollback, DSH financial mutation.

**Actor responsibility envelope**
- `operator` — Authorized platform operations controller; permitted: manage operational zones, manage SLA and capacity, pause or resume a zone, manage fulfillment-mode eligibility, read audit history, rollback a reversible policy revision; forbidden: mutate WLT ledger truth, change policy without reason and idempotency, rollback across aggregate boundaries, hide a capacity or serviceability denial.
- `client` — Authenticated customer receiving serviceability and fulfillment eligibility; permitted: read effective serviceability, select an allowed fulfillment mode, retry after canonical policy refresh; forbidden: override zone pause, select a disabled fulfillment mode, continue checkout after a canonical denial, read operator audit data.
- `partner` — Authorized store operator consuming store-scoped policy readback; permitted: read store coverage, read effective fulfillment modes, read SLA and pause impact; forbidden: enable BThwani delivery without operator policy, mutate another store policy, override platform capacity.
- `captain` — Eligible courier receiving dispatch consequences; permitted: receive assignments allowed by effective policy, read effective assignment SLA; forbidden: receive dispatch while the effective mode or zone is paused, mutate platform policy.

**Surface semantics**
- `control-panel` — required; actors: operator; states: loading, empty, success, paused, throttled, conflict, forbidden, offline, error; actions: create, edit, pause, resume, enable mode, disable mode, inspect, rollback, refresh.
- `app-client` — required; actors: client; states: serviceable, unserviceable, paused, throttled, mode_disabled, offline, error; actions: select allowed mode, refresh, change address or store.
- `app-partner` — required; actors: partner; states: serviceable, paused, throttled, mode_disabled, offline, error; actions: read policy impact, refresh.
- `app-captain` — required; actors: captain; states: assignable, paused, capacity_blocked, mode_disabled, offline, error; actions: read assignment consequence, refresh.
- `backend` — required; actors: operator, client, partner, captain; states: authorized, forbidden, invalid, conflict, serviceable, paused, throttled, mode_disabled; actions: authorize, validate, evaluate, audit, rollback, fail closed.
- `database` — required; actors: operator; states: versioned, idempotent, append_only_audit, reversible; actions: enforce constraints, retain snapshots, prevent stale writes.
- `app-field` — excluded; actors: field; states: not_affected; exclusion reason: Field workflows may consume readiness/service-area projections when required but do not own or mutate operational routing policy under the current model.

## Capability-change law

A new capability or material capability change must prove a stable responsibility, canonical owner, affected actors/surfaces, legal state/mutation/readback semantics, authorization, failure/recovery behavior and acceptance expectations.

```text
ACTOR != CAPABILITY_OWNER
ROUTE != CAPABILITY_OWNER
SCREEN != CAPABILITY_OWNER
IMPLEMENTATION_MECHANISM != DOMAIN
```

## Additional durable capability coverage

The following envelopes close responsibilities proven material by the donor/current platform evidence. The capability-change law above applies equally to every entry. Generic object storage/media transport and generic search are deliberately **not** promoted to standalone Product owners: media business authorization stays with the owning domain, while object storage is technical infrastructure; search/indexes remain derived query mechanisms unless a future independent lifecycle is proven.
