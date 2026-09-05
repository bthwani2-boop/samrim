# Special Requests And Support Capabilities

ARTIFACT_CLASS: DURABLE_PRODUCT_CAPABILITY_GOVERNANCE
SEMANTIC_OWNER: governance/product/capabilities/special-requests-and-support.md
EXECUTION_AUTHORITY: NONE
CLOSURE_AUTHORITY: NONE
IMPLEMENTATION_STATE_AUTHORITY: NONE
PARENT_CAPABILITY_INDEX: governance/product/CAPABILITIES.md

## Scope

This owner defines only the durable capability semantics listed below. Capability taxonomy/schema/admission law remains in `../CAPABILITIES.md`; cross-capability journeys remain in `../JOURNEYS.md`.

### SPECIAL_REQUESTS

**Problem.** Awnak errands and SHEIN assisted purchases require one governed journey from client intake through missing-information exchange, quote, WLT approval, operator execution, captain assignment, delivery evidence, exception resolution and client readback.
**Problem frequency.** frequent
**Problem severity.** high
**Target state.** Client, operator and captain surfaces consume the same DSH operational state and WLT-owned financial readback.
**Primary success measure.** successful special-request mutation and evidence readback rate
**Guardrail measures.** duplicate request count; invalid stage transition count; quote approval during customer_information count; premature SHEIN dispatch count; DSH-originated financial mutation count; cross-client data leakage count; special-request exception without source count

**Required outcome.** Each Awnak or SHEIN request has one versioned DSH lifecycle, governed information rounds, WLT-owned payment truth when quoted, one DSH dispatch linkage, and proof/exception readback on every affected surface.

**Primary actors.** client, operator, captain.

**Canonical ownership.** DSH operational truth; WLT financial truth.

**Material deployable surfaces.** app-client, control-panel, app-captain.

**Business invariants**
- DSH owns special-request, assignment, delivery-proof and operational-exception truth.
- WLT owns payment truth.
- Every operator mutation requiring optimistic concurrency uses the current expectedVersion contract.
- Every successful write is followed by canonical readback.
- customer_information and customer_approval are separate stages with separate client actions.
- SHEIN cannot dispatch before its governed prerequisites are complete.
- Partner settlement is not created without a canonical partner-settlement source.

**Forbidden/negative invariants**
- No client can read or mutate another client request.
- No surface can calculate or persist authoritative financial truth.
- No local array, mock or fallback can represent runtime request, evidence or exception truth.
- No operator can bypass the workflow-stage model or use rejectionReason for missing information.
- No captain can receive a request before governed dispatch prerequisites are satisfied.
- No second special-request exception subsystem may exist outside DSH operational truth.

**Acceptance expectations**
- Client creation is idempotent and validates required SHEIN or Awnak data through governed fields.
- Operator can request missing information with expectedVersion and the client can answer the pending exchange.
- Quote approval is available only at customer_approval and unavailable at customer_information.
- Client can list, refresh, approve an eligible quote, refuse a prepared quote through the governed cancellation mutation, and cancel an eligible owned request.
- Operational rejection remains operator-owned and does not create a second financial truth.
- SHEIN dispatch is rejected before ready_for_delivery with structured blocking reasons.
- Captain assignment, proof and delivery exception truth remain within DSH operational ownership.
- WLT remains the only financial truth owner and DSH exposes only governed WLT payment readback.
- Every mutation is followed by canonical owner readback.

**Named failure classes:** frontend-only success, stale version overwrite, cross-client read, information question stored as rejection reason, quote approval during customer_information, premature dispatch, missing WLT handoff or readback, local surface business state, duplicate exception truth, runtime mock truth.

**Actor responsibility envelope**
- `client` — Owner of an Awnak errand or SHEIN assisted-purchase request; permitted: create owned special request with an idempotency key, list and read owned requests, answer a pending governed operator information request, approve a prepared quote through the governed WLT handoff, refuse a prepared quote through the governed cancellation mutation, cancel an eligible owned request, read assignment delivery proof exception and WLT-owned financial status; forbidden: read another client request, set operator-only workflow stages, assign or reassign a captain, mutate WLT financial truth directly, approve a quote while the request is in customer_information.
- `operator` — Authorized special-request operations operator; permitted: inspect the special-request queue, request missing client information with expectedVersion, read the client response, prepare a quote after information review, apply valid expected-version transitions, assign an eligible request to a captain, read dispatch proof and exception evidence, record operational rejection and resolve eligible delivery exceptions; forbidden: skip optimistic concurrency, dispatch SHEIN before ready_for_delivery, create a local-only request or exception state, mutate WLT ledger or balance, use rejectionReason as a substitute for an information question.
- `captain` — Captain assigned to Awnak or SHEIN final-mile work; permitted: receive an offered special-request assignment, identify Awnak and SHEIN final-mile service type, execute the governed delivery lifecycle, submit proof of delivery and report a governed exception; forbidden: read unassigned special requests, change quote or payment state, bypass assignment acceptance rules, invent local proof or exception truth.

**Surface semantics**
- `app-client` — required; actors: client; states: loading, empty, success, offline, forbidden, conflict, error, submitted, quote_pending, customer_information, customer_approval, assigned, in_progress, completed, cancelled, rejected; actions: create, list, refresh, answer information request, approve quote, refuse quote through cancellation, cancel, read execution proof exception and WLT status.
- `control-panel` — required; actors: operator; states: loading, empty, success, offline, forbidden, conflict, error, under_review, customer_information, needs_customer_input, approved, assigned, in_progress, completed, cancelled, rejected; actions: inspect, request information, read response, prepare quote, transition, record operational rejection, assign captain, read execution proof exception and WLT status.
- `app-captain` — required; actors: captain; states: offered, accepted, assigned, picked_up, arrived_customer, completed, exception_open, exception_resolved; actions: recognize service type, accept assignment, execute delivery, submit proof, report exception.
- `app-partner` — excluded; states: not_affected; exclusion reason: Special requests are client/operator/captain journeys under the current model.
- `app-field` — excluded; states: not_affected; exclusion reason: Field actors do not own these special requests under the current model.
- `backend` — required; actors: client, operator, captain; states: authorized, forbidden, not_found, conflict, idempotent_replay, information_pending, information_responded, wlt_unavailable, dispatch_not_ready, exception_open, exception_resolved; actions: validate ownership, enforce stage transition, persist information exchange, create and read payment session, create assignment, read dispatch evidence, resolve eligible exception, return canonical readback.
- `database` — required; actors: client, operator, captain; states: transactional, context_scoped, versioned, audited, idempotent; actions: persist request truth, persist information rounds, enforce constraints, record workflow timestamps, link WLT dispatch proof and exception references.
- technical presentation binding — required implementation evidence; actors: client, operator, captain; states: loading, empty, success, offline, forbidden, conflict, error; actions: classify error, bind generated contract, coordinate information exchange, enforce quote stage, refresh canonical request execution and financial readback, map captain service type.

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
