# Partner Fleet Connection

ARTIFACT_CLASS: DURABLE_PRODUCT_CAPABILITY_GOVERNANCE
SEMANTIC_OWNER: governance/product/capabilities/fulfillment/partner-fleet-connection.md
EXECUTION_AUTHORITY: NONE
CLOSURE_AUTHORITY: NONE
IMPLEMENTATION_STATE_AUTHORITY: NONE
PARENT_CAPABILITY_INDEX: governance/product/CAPABILITIES.md
CAPABILITY_ID: PARTNER_FLEET_CONNECTION

## Scope

This file is the **sole editable durable semantic owner** of `PARTNER_FLEET_CONNECTION`. Capability taxonomy/schema/admission law remains in `../../CAPABILITIES.md`; cross-capability journey semantics remain in `../../JOURNEYS.md`.

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
