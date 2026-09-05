# Support Incidents Order Rescue

ARTIFACT_CLASS: DURABLE_PRODUCT_CAPABILITY_GOVERNANCE
SEMANTIC_OWNER: governance/product/capabilities/commerce/support-incidents-order-rescue.md
EXECUTION_AUTHORITY: NONE
CLOSURE_AUTHORITY: NONE
IMPLEMENTATION_STATE_AUTHORITY: NONE
PARENT_CAPABILITY_INDEX: governance/product/CAPABILITIES.md
CAPABILITY_ID: SUPPORT_INCIDENTS_ORDER_RESCUE

## Scope

This file is the **sole editable durable semantic owner** of `SUPPORT_INCIDENTS_ORDER_RESCUE`. Capability taxonomy/schema/admission law remains in `../../CAPABILITIES.md`; cross-capability journey semantics remain in `../../JOURNEYS.md`.

### SUPPORT_INCIDENTS_ORDER_RESCUE

**Problem.** Support conversations, operational incidents and order rescue require one governed DSH truth instead of disconnected or local-only controls.
**Problem frequency.** frequent
**Problem severity.** high
**Target state.** Support, incidents and rescue use retry-safe state machines, append-only audit and role-scoped readback.
**Primary success measure.** successful governed readback rate
**Guardrail measures.** cross-actor data leakage incidents; duplicate mutation count; unresolved conflict count; DSH-originated WLT mutation count

**Required outcome.** Every support, incident and order rescue action produces one authorized DSH effect and an immediate governed readback without local operational truth.

**Primary actors.** client, partner, captain, operator.

**Canonical ownership.** DSH support/incident/rescue operational truth; WLT financial truth.

**Material deployable surfaces.** app-client, app-partner, app-captain, control-panel.

**Business invariants**
- DSH owns support, incident and order-rescue operational truth.
- One active rescue case exists per order under the current state model.
- Every mutation preserves idempotency and correlation identity where required.
- All transitions produce canonical readback and an audit event where required.
- Internal support notes are visible only to authorized operators.
- WLT remains the sole owner of financial truth.

**Forbidden/negative invariants**
- No actor can read another actor support ticket.
- No closed rescue case reopens unless the state machine explicitly defines a legal transition.
- No incident or rescue transition silently overwrites stale state.
- No production mock or local array represents support, incident or rescue truth.
- No DSH rescue action mutates WLT ledger, balance, refund or settlement truth.

**Acceptance expectations**
- Actor support access is owner scoped and internal notes do not leak.
- Support message attachments and read receipts follow the current contract.
- Incident mutations require idempotency context and valid expected-state transitions.
- Order rescue cases are linked to a real order and reject duplicate active cases.
- Resolution and closure require governed operator evidence.
- Incident and rescue audit events are append-only and readable by authorized operators.
- WLT access from rescue is visibility-only and cannot mutate financial truth.

**Named failure classes:** local-only rescue state, cross-actor support leakage, duplicate active rescue case, invalid status transition, missing audit event, DSH financial mutation.

**Actor responsibility envelope**
- `client` — Customer support requester; permitted: create owned support ticket, read owned support ticket, send message to owned ticket, read non-internal messages and attachments; forbidden: read another actor ticket, read internal operator notes, change incident or rescue state.
- `partner` — Store support requester; permitted: create support ticket for owned store or order, read owned support conversation, send support message; forbidden: read another store ticket, mutate incident or rescue state, mutate WLT financial truth.
- `captain` — Assigned delivery support requester; permitted: open support conversation for assigned order, send delivery support messages, read owned conversation and attachments; forbidden: open conversation for unassigned order, read internal operator notes, mutate rescue or financial truth.
- `operator` — Authorized support and operations operator; permitted: manage support queue, record incident transitions, open and resolve order rescue case, read append-only audit events, open read-only WLT visibility; forbidden: skip expected-state conflict checks, create local-only rescue state, mutate WLT ledger or balance from DSH.

**Surface semantics**
- `app-client` — required; actors: client; states: loading, empty, error, open, resolved, closed, offline; actions: create ticket, send message, retry, read attachment.
- `app-partner` — required; actors: partner; states: loading, empty, error, open, resolved, closed, offline; actions: create ticket, send message, retry, read attachment.
- `app-captain` — required; actors: captain; states: loading, empty, error, open, resolved, closed, offline; actions: open assigned-order conversation, send message, retry.
- `control-panel` — required; actors: operator; states: loading, empty, error, open, investigating, action_required, resolved, closed, conflict; actions: reply, transition ticket, transition incident, open rescue case, resolve rescue case, read audit.
- `backend` — required; actors: client, partner, captain, operator; states: authorized, forbidden, conflict, not_found, idempotent_replay; actions: validate ownership, enforce transition, write event, return readback.
- `database` — required; actors: operator; states: transactional, constrained, audited, idempotent; actions: persist support truth, persist incident truth, persist rescue truth, append audit event.
- technical presentation binding — required implementation evidence; actors: client, partner, captain, operator; states: loading, empty, success, error, offline, conflict; actions: map contract, preserve mutation identity, refresh readback, classify error.
