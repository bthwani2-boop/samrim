# Commerce and Serviceability Capabilities

ARTIFACT_CLASS: DURABLE_PRODUCT_CAPABILITY_GOVERNANCE
SEMANTIC_OWNER: governance/product/capabilities/commerce-and-serviceability.md
EXECUTION_AUTHORITY: NONE
CLOSURE_AUTHORITY: NONE
IMPLEMENTATION_STATE_AUTHORITY: NONE
PARENT_CAPABILITY_INDEX: governance/product/CAPABILITIES.md

## Scope

This owner defines only the durable capability semantics listed in this file. Cross-cutting capability schema/admission rules are owned by `../CAPABILITIES.md`; journeys remain owned by `../JOURNEYS.md`.

### MAPS_SERVICE_AREA_ADDRESS_PRIVACY — الخرائط ومناطق الخدمة وخصوصية العناوين

**Problem.** Map resolution, service-area/geofence policy, client delivery addresses and address-privacy lifecycle need one governed flow so provider data or local surface assumptions never become operational truth and deleted-address PII is handled deterministically.
**Target state.** No direct-provider/local-geofence authority, invalid service-area geometry, cross-actor address access, duplicate anonymization result or raw PII in privacy audit remains.

**Required outcome.** Clients and operators use one DSH-governed service-area/address truth backed by normalized provider data, valid geometry and a deterministic privacy lifecycle.

**Primary actors.** authenticated_client, authorized_operator, privacy_worker.

**Canonical ownership.** DSH service-area/address/privacy truth; maps are an external integration adapter.

**Material deployable surfaces.** app-client, control-panel.

**Business invariants**
- External map resolution is normalized at the provider boundary; DSH owns service-area/geofence and client-address operational truth.
- Address privacy retention/anonymization/audit is governed by DSH-owned policy/state for this capability.
- A client address is serviceable only when canonical coordinates resolve to an active applicable service area.
- Privacy audit/read models intentionally exclude raw client/address PII.

**Forbidden/negative invariants**
- No client surface calls a map provider directly as canonical Product/System truth.
- No malformed/incomplete provider result becomes operational truth.
- No client-supplied service-area identifier is trusted without active geofence resolution.
- No active address write succeeds without required coordinates.
- No invalid polygon topology reaches service-area truth.
- No privacy-policy mutation bypasses version/idempotency checks.
- No anonymization retry creates a second run result.
- No raw client ID, recipient name, phone, address text, instructions or coordinates appear in privacy audit responses.
- No cross-actor address PII access is permitted.
- No runtime mock/fallback establishes map, address, service-area or privacy truth.

**Acceptance expectations**
- Search input and provider results are normalized and malformed/incomplete results fail closed.
- Reverse geocoding validates coordinates/results before DSH service-area resolution.
- Provider health distinguishes unavailable, not-configured and uncertain-result states instead of treating configuration as health.
- Service areas expose governed polygon coordinates/bounds/state/priority/version needed by authorized operations.
- Service-area writes are versioned, idempotent, audited and reject zero-area, duplicate-edge and self-intersecting polygons through authoritative application/data invariants.
- Client address create/update requires coordinates resolving to the supplied/expected active canonical geofence.
- Deleted-address PII follows a versioned retention policy with observable due-work status.
- Due anonymization uses one stable run identity and is retry-safe/concurrency-safe.
- Privacy audit/readback structurally excludes raw client and address PII.

**Named failure classes:** direct_provider_client_truth, malformed_provider_result_accepted, client_selected_service_area_without_resolution, address_without_coordinates, invalid_polygon_persisted, privacy_policy_without_version_or_idempotency, duplicate_anonymization_result, raw_address_pii_in_privacy_audit, cross_actor_address_access, runtime_mock_or_fallback_truth.

**Actor responsibility envelope**
- `authenticated_client` — Searches/resolves locations and creates or updates only owned delivery addresses that pass canonical DSH service-area validation.; permitted: search location through governed map boundary, reverse-geocode coordinates, create owned address, update owned address, read owned address/serviceability; forbidden: call provider directly as operational authority, supply trusted service-area truth, read another actor address PII, bypass active geofence validation.
- `authorized_operator` — Reads provider health and manages versioned service-area/geofence and privacy-policy state within authorized scope.; permitted: read provider health, list/read service areas, create or update valid service area, manage versioned retention/privacy policy, read privacy-safe audit/projection; forbidden: persist invalid polygon topology, bypass version/idempotency, read unnecessary raw client-address PII, treat provider health configuration as runtime success.
- `privacy_worker` — Executes due address anonymization deterministically from the governed retention queue/policy.; permitted: claim due anonymization work, anonymize eligible address data, record stable run identity and privacy-safe audit; forbidden: anonymize outside governed policy, create duplicate result on retry, emit raw address/client PII into privacy audit, cross actor/context scope.

**Surface semantics**
- `app-client` — required; actors: authenticated_client; states: loading, searching, resolved, serviceable, unserviceable, forbidden, offline, error; actions: search, reverse geocode, create/update owned address, read serviceability.
- `control-panel` — required; actors: authorized_operator; states: loading, ready, empty, provider_unavailable, provider_not_configured, provider_uncertain, conflict, forbidden, error; actions: read provider health, manage service areas, manage privacy policy, read privacy-safe queue/audit status.
- `backend` — required; actors: authenticated_client, authorized_operator, privacy_worker; states: authorized, forbidden, invalid_provider_result, serviceable, unserviceable, conflict, idempotent_replay; actions: normalize provider result, resolve active service area, validate address ownership/geofence, validate polygons, enforce version/idempotency, schedule privacy work, return redacted readback.
- `database` — required; actors: authorized_operator, privacy_worker; states: transactional, versioned, geospatially_constrained, retention_governed, privacy_audited; actions: enforce service-area geometry/invariants, persist address/service-area truth, queue due anonymization, support retry-safe SKIP LOCKED processing, exclude raw PII from privacy-audit projection.
- technical presentation binding — required implementation evidence; actors: authenticated_client, authorized_operator; states: loading, ready, unserviceable, forbidden, offline, error; actions: map canonical map/address/serviceability state, avoid local geofence/provider truth.
- `providers` — required; actors: authenticated_client, authorized_operator; states: healthy, unavailable, not_configured, uncertain_result; actions: resolve governed external map/search/reverse-geocoding data through the provider boundary.
- `app-partner` — excluded; states: not_affected; exclusion reason: No partner-owned client address/geofence mutation is part of this capability.
- `app-captain` — excluded; states: not_affected; exclusion reason: Captain navigation consumes later delivery-location projections and does not own client-address truth.
- `app-field` — excluded; states: not_affected; exclusion reason: Field onboarding/assignments do not own client delivery-address truth.

**Primary success measure.** owned address/serviceability decisions producing consistent privacy-safe canonical readback across commerce surfaces.
**Guardrail measures.** cross-customer address access; client-authoritative serviceability; stale geometry decision; precise-location overexposure; provider result treated as domain truth.

### ORDER_CREATION — إنشاء الطلب وحقيقة الطلب

**Problem.** A valid checkout intent must create at most one auditable DSH order whose accepted commercial/address/item snapshots and operational truth cannot be silently repriced, rebound or duplicated under retry/concurrency.
**Target state.** Retries/concurrency cannot duplicate the order, accepted snapshots remain stable, all affected surfaces read the same authorized operational truth, and no DSH/frontend financial authority is created.

**Required outcome.** One eligible checkout intent yields one canonical DSH order with durable accepted snapshots, authorized multi-surface readback and WLT-owned financial projection semantics.

**Primary actors.** client, partner, operator, system.

**Canonical ownership.** DSH operational order truth; WLT financial truth.

**Boundary/non-overlap.** CART_CHECKOUT owns cart mutation, checkout validation, checkout-intent state and the eligibility handoff. ORDER_CREATION begins only after that boundary and owns atomic order creation plus immutable accepted order snapshots; it does not re-own cart or checkout state.

**Material deployable surfaces.** app-client, app-partner, control-panel.

**Business invariants**
- DSH owns order operational truth; WLT owns financial truth.
- A canonical eligible checkout/idempotency scope yields at most one order.
- Accepted commercial/address/item snapshots required by the contract remain stable after creation unless a later explicit legal transition governs a change.
- All required surfaces consume one authorized DSH order truth and bounded WLT-backed financial projection.
- Required operational event/outbox state follows the same transactional consistency guarantees as order creation.

**Forbidden/negative invariants**
- No order is created from an invalid/ineligible checkout intent.
- No duplicate order is created for one canonical checkout/idempotency scope.
- No accepted snapshot is silently re-derived from live catalog/address state.
- No frontend derives allowed business actions solely from a local status label.
- No surface exposes full address PII to an actor that does not operationally require it.
- No DSH/frontend path performs debit, refund, settlement or balance mutation as order-creation truth.

**Acceptance expectations**
- One checkout intent/canonical idempotency scope creates at most one order even under concurrent retry.
- The created order carries the governed identifiers/versioning required for subsequent concurrency-safe transitions.
- Order items, prices, currency, address and fulfillment snapshots required by the contract are fixed at creation and are not re-derived from live catalog state.
- Client, partner and operator readbacks expose the same operational truth with actor-appropriate redaction.
- Payment state is a read-only WLT-owned projection and DSH performs no authoritative financial mutation for order creation.
- Required operational event/outbox effects are persisted with the order under the required transactional discipline and remain retry/reconciliation safe.
- Affected surfaces expose truthful loading/empty/offline/forbidden/conflict/partial/error/retry states without mock/local truth.
- Every read/write is scoped by trusted context plus actor/object authorization and produces attributable correlation/audit evidence where required.

**Named failure classes:** ineligible_checkout_created, duplicate_order_for_checkout, snapshot_repriced_or_rebound, frontend_status_authority, cross_scope_order_access, address_pii_overexposed, dsh_financial_mutation, success_without_canonical_readback.

**Actor responsibility envelope**
- `client` — Creates an order from an owned eligible checkout intent and reads only authorized customer order truth.; permitted: submit eligible checkout intent for order creation, read owned order, retry with governed idempotency semantics; forbidden: supply authoritative price/financial truth, create from another client checkout intent, change immutable order snapshots after creation.
- `partner` — Reads/operates store-scoped order truth after creation according to later legal transitions.; permitted: read authorized owned-store order, consume immutable order snapshot; forbidden: reprice the created order, change client address snapshot, read another store order, mutate WLT financial truth.
- `operator` — Reads or performs separately authorized order operations without changing canonical creation truth outside legal transitions.; permitted: read authorized order truth, perform explicitly governed later order operations; forbidden: create duplicate order, rewrite immutable commercial/address/item snapshot, mutate WLT financial truth through DSH.
- `system` — Validates the checkout intent and atomically persists one DSH order plus required operational event/outbox effects.; permitted: validate checkout eligibility, enforce one-order-per-canonical-idempotency scope, persist immutable snapshots, emit required operational event/outbox, return canonical readback; forbidden: rederive accepted price from live catalog after creation, create duplicate order on retry, treat WLT projection as DSH-owned finance.

**Surface semantics**
- `app-client` — required; actors: client; states: loading, success, offline, forbidden, conflict, partial, error; actions: create order from eligible checkout, read order, retry/recover.
- `app-partner` — required; actors: partner; states: loading, empty, ready, forbidden, offline, error; actions: read owned-store order truth.
- `control-panel` — required; actors: operator; states: loading, ready, not_found, forbidden, error; actions: read authorized order truth.
- `backend` — required; actors: client, partner, operator, system; states: authorized, forbidden, invalid_checkout, conflict, idempotent_replay, created; actions: authorize, validate checkout, persist order snapshot, persist required event/outbox, return canonical readback.
- `database` — required; actors: system; states: transactional, idempotent, snapshot_persisted, auditable; actions: enforce one order per canonical checkout/idempotency identity, persist immutable required snapshot, atomically retain required operational event/outbox state.
- technical presentation binding — required implementation evidence; actors: client, partner, operator; states: loading, success, forbidden, conflict, offline, error; actions: map canonical contract state, coordinate readback, avoid local order/payment authority.
- `app-captain` — excluded; states: not_affected; exclusion reason: Captain enters later dispatch/fulfillment journeys, not order creation.
- `app-field` — excluded; states: not_affected; exclusion reason: Field actors do not own order creation/truth under the current model.

**Additional durable semantic model**

```json
{
  "preconditions": [
    "Checkout intent belongs to the same server-resolved business scope and client required by the current contract.",
    "Checkout intent is in the financial/operational state allowed for order creation, including COD when applicable.",
    "Cart is active/non-empty and each item has a valid accepted commercial snapshot.",
    "Address, fulfillment mode and serviceability are proven in the checkout intent.",
    "Any WLT reference required by checkout remains a reference and does not grant DSH financial ownership."
  ]
}
```

**Primary success measure.** eligible confirmed checkout intents producing exactly one canonical order with immutable accepted snapshots and owner-side readback.
**Guardrail measures.** duplicate order per checkout; order from blocked/expired checkout; snapshot repricing/rebinding; DSH financial write; success without persisted readback.

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

### CART_CHECKOUT

**Problem.** Cart mutation, checkout validation and WLT handoff can diverge when item price, serviceability, address, fulfillment, quote or idempotency state is recomputed independently across client/order/payment layers.
**Target state.** DSH owns one versioned cart and checkout-intent lifecycle whose accepted evidence is server-derived, concurrency-safe and financially gated by WLT quote/session references before Order Creation can begin.
**Primary success measure.** eligible checkout intents reaching one canonical ready/confirmed result without duplicate cart mutation, stale pricing or ambiguous financial handoff.
**Guardrail measures.** client-authoritative price count; duplicate logical cart mutation; stale-version acceptance; checkout-ready after serviceability denial; duplicate WLT session/reference; order creation from blocked/expired checkout.

**Required outcome.** A customer can build one owned store cart, receive canonical current pricing/serviceability/fulfillment validation, and progress through one checkout intent to a confirmed/eligible handoff for Order Creation without duplicating money or operational truth.

**Primary actors.** customer, DSH cart/checkout system, WLT pricing/payment system, authorized operator for diagnostics.

**Canonical ownership.** DSH owns cart and checkout operational truth; canonical catalog/store/address/serviceability owners provide evidence; WLT owns authoritative financial quote/payment-session truth; Order Creation begins only after the governed checkout eligibility boundary.

**Boundary/non-overlap.** ORDER_CREATION owns only creation of the canonical order from an eligible confirmed checkout. CART_CHECKOUT owns the cart and checkout-intent lifecycle up to that handoff and cannot mutate the created order as if it were checkout state.

**Material deployable surfaces.** app-client and authorized control-panel diagnostics when operationally required.

**Business invariants**
- one active logical cart is scoped to the authenticated customer/store/current commerce flow;
- item product identity, quantity bounds, unit-price/currency evidence and assortment eligibility come from canonical server owners, never client totals;
- cart mutation is versioned and idempotent; the same mutation identity cannot represent a different payload;
- fulfillment mode must be one currently allowed by DSH policy, including bthwani_delivery, partner_delivery or client_pickup where eligible;
- non-empty checkout cannot be financially ready without the required current WLT quote/payment evidence;
- checkout intent snapshots the governed address/serviceability/fulfillment/commercial evidence needed for downstream Order Creation;
- validation does not silently mutate unrelated owner state.

**Durable state semantics.**
- cart is active until explicitly abandoned/cleared by the governed lifecycle;
- checkout intent progresses through draft, validating, ready or blocked, confirming, then confirmed, cancelled or expired;
- ready/confirmed is invalidated by materially stale cart/address/serviceability/quote evidence according to current contract/version rules.

**Forbidden/negative invariants**
- no client-supplied price, fee, discount, currency or eligibility becomes authoritative;
- no stale cart version mutates current state;
- no blocked/expired checkout creates an order;
- no duplicate WLT session or financial effect from retry;
- no DSH cart/checkout row becomes WLT financial truth;
- no cached discovery/serviceability result authorizes checkout after canonical denial.

**Failure/recovery.** stale version, item/assortment invalidation, address/serviceability denial, disabled fulfillment mode, quote unavailable/stale, WLT timeout/unknown, idempotency conflict or checkout expiry; reread canonical owners, preserve the original logical operation identity and reconcile ambiguous WLT outcomes before retry.

**Acceptance expectations.** cart totals are reproducible from authoritative evidence; checkout readiness reports exact blocking reasons; canonical readback survives retry/restart; confirmed checkout carries the immutable evidence required by Order Creation; no duplicate order/payment effect is possible from a replayed intent.

**Actor responsibility envelope**
- `customer` — mutates only the owned cart, selects allowed fulfillment/address intent and confirms checkout; forbidden: supply authoritative money/eligibility, select another actor/cart or bypass blockers.
- `DSH cart/checkout system` — validates owner evidence, versions/idempotency, snapshots checkout evidence and orchestrates WLT references; forbidden: post ledger truth or fabricate WLT success.
- `WLT system` — produces authoritative quote/payment-session facts and reconciles unknown financial outcomes; forbidden: own DSH cart/order operational lifecycle.
- `operator` — reads scoped diagnostics/recovery state only through governed interfaces.

**Surface semantics**
- `app-client` — required; states include empty, active, validating, ready, blocked, confirming, confirmed, expired, conflict, offline, partial and error; actions include add/update/remove, select allowed fulfillment/address, refresh/requote, confirm and resume.
- `control-panel` — conditional diagnostics only; no normal customer mutation authority.
- `backend` — required canonical cart/checkout owner and cross-service orchestration.
- `database` — required version/idempotency/snapshot persistence and audit where applicable.
- technical presentation binding — implementation evidence only; maps contract state and canonical readback without local commerce truth.
