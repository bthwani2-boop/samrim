# BThwani Durable Capability Catalog

ARTIFACT_CLASS: DURABLE_PRODUCT_CAPABILITY_GOVERNANCE
SEMANTIC_OWNER: governance/product/CAPABILITIES.md
EXECUTION_AUTHORITY: NONE
CLOSURE_AUTHORITY: NONE
IMPLEMENTATION_STATE_AUTHORITY: NONE

## Purpose

This file owns stable capability-level Product/System meaning: outcome, actors, canonical owner boundaries, business invariants, forbidden outcomes and acceptance expectations.

It deliberately excludes current route names, operation IDs, database table names, screen/component filenames and generated-client inventories. Those are implementation state and must be derived from executable source.

```text
CAPABILITY_MEANING != IMPLEMENTATION_INVENTORY
```

Cross-capability financial rules are owned by `FINANCIAL-MODEL.md`; cross-surface UX rules are owned by `EXPERIENCE-AND-DESIGN.md`.

## Catalog

### ADMINISTRATION_ROLES_APPROVALS_AUDIT — الإدارة والأدوار والاعتمادات والتدقيق

**Problem.** Administration needs precise operation/surface-scoped permissions, maker-checker separation, auditable rollback, redacted diagnostics, and delegation to sovereign Identity/Workforce/Partner owners without creating parallel administration truth.
**Target state.** Every executable administration decision has one governed maker/checker lifecycle, canonical owner readback, append-only redacted audit, and no parallel sovereign-domain projection.

**Required outcome.** Administration role and approval changes are surface-scoped, independently approved, version-fenced, auditable and reversible without moving Identity, Workforce, partner lifecycle or credential truth into DSH Administration.

**Primary actors.** operator-role-maker, operator-role-checker, operator-auditor, role-beneficiary.

**Canonical ownership.** DSH administration workflow; Identity owns authentication; Workforce owns workforce truth; DSH owns partner lifecycle.

**Material deployable surfaces.** control-panel.

**Business invariants**
- DSH Administration owns its role-definition/approval/audit workflow but not Identity authentication truth, Workforce profile/credential truth, or partner lifecycle truth.
- Approved means the canonical downstream mutation succeeded, canonical owner readback proved the resulting truth, and administration finalization committed.
- Pending execution states are non-applied and must not be consumed as effective RBAC truth.
- Rejected requests have no executable canonical mutation intent.
- A failed-terminal request is immutable; recovery supersedes it and creates exactly one fresh pending request against current canonical version.
- Rollback appends an independently approved inverse decision and never deletes the source decision or audit trail.

**Forbidden/negative invariants**
- No direct role creation/assignment/revocation without governed approval.
- No maker, beneficiary, or disallowed previous checker approves the affected decision.
- No broad identity role label bypasses exact administration operation permission.
- No approval queue is readable through unrelated generic permission.
- No failed-terminal request is replayed, reset, edited, or replaced more than once.
- No phone, document, session, secret, partner review note, captain license number or equivalent sensitive sovereign data becomes administration truth.
- No partner activation/captain credential projection or mutation is owned by Administration.
- No audit history is deleted or rewritten through ordinary application paths.

**Acceptance expectations**
- Role definitions persist normalized operation permissions and explicit surface scope with control-panel mandatory for administration capability.
- Role definition and staff role changes use maker-checker approval with canonical role-version conflict protection.
- A failed-terminal request is recovered only by one atomic supersede-and-replace operation followed by fresh independent approval.
- Approved assignment or revocation decisions are reversed only through a separate independently approved inverse request.
- Audit writes avoid raw reason/review-note sensitive values, audit readback is redacted, and ordinary update/delete of audit history is rejected.
- Approval queues require their exact checker permissions and cannot be listed through a generic administration-read permission alone.
- The administration permission boundary has no broad operator-role bypass and does not propagate unnecessary PII.
- Partner lifecycle and captain credential/workforce reads and mutations remain at their sovereign owners; administration delegates to those owner surfaces/contracts rather than maintaining local truth.

**Named failure classes:** direct_unapproved_role_mutation, maker_self_approval, beneficiary_self_approval, rollback_checker_not_independent, broad_role_bypass, failed_terminal_intent_replayed_or_edited, duplicate_replacement_request, audit_history_mutated, sensitive_data_in_audit_or_diagnostics, parallel_partner_or_workforce_truth.

**Actor responsibility envelope**
- `operator-role-maker` — Creates reasoned role-definition, assignment/revocation, rollback, and terminal-failure replacement requests without approving their own intent.; permitted: request surface-scoped role definition, request staff role assignment or revocation, request inverse action for approved decision, supersede failed-terminal request while creating one fresh version-fenced request; forbidden: self approve or reject, directly mutate canonical role truth, edit or replay failed-terminal intent, store sensitive identity/workforce values in administration audit.
- `operator-role-checker` — Independently reviews and approves/rejects the governed administration requests for which the actor has exact checker permission.; permitted: approve or reject role-definition request, approve or reject role assignment/revocation, approve or reject rollback when independence rules are satisfied; forbidden: approve own request, approve a request benefiting the same actor, approve rollback when the actor was the original decision checker, use a broad role label instead of exact permission.
- `operator-auditor` — Reads append-only redacted administration audit and privacy-safe aggregate diagnostics within authorized scope.; permitted: read redacted audit, read aggregate diagnostics; forbidden: mutate role or approval state, delete or rewrite audit history, read secrets, sessions, documents, raw review notes or unnecessary PII.
- `role-beneficiary` — Receives the effect of an independently approved role assignment/revocation but does not approve the change.; permitted: consume the resulting authorized role state; forbidden: approve own assignment, self grant permissions, bypass surface or operation scope.

**Surface semantics**
- `control-panel` — required; actors: operator-role-maker, operator-role-checker, operator-auditor, role-beneficiary; states: loading, empty, ready, pending, approved, rejected, superseded, reconciling, retryable_failure, failed_terminal, forbidden, conflict, error; actions: request, approve, reject, request rollback, recover failed-terminal intent by supersede-and-replace, read audit, read diagnostics, navigate to sovereign partner/workforce owner surface.
- `backend` — required; actors: operator-role-maker, operator-role-checker, operator-auditor, role-beneficiary; states: not_started, pending, reconciling, retryable_failure, failed_terminal, applied, forbidden, conflict; actions: enforce exact permissions, enforce maker-checker and beneficiary separation, fence by canonical role version, delegate Identity/Workforce/Partner mutations to their owners, finalize only after canonical owner readback, return redacted audit and diagnostics.
- `database` — required; actors: operator-role-maker, operator-role-checker, operator-auditor; states: versioned, append_only_audit, immutable_failed_terminal_intent, auditable; actions: persist requests and decisions, enforce one fresh replacement per superseded terminal failure, retain immutable source decision history, reject audit update/delete outside explicit maintenance authority.
- `shared` — required; actors: operator-role-maker, operator-role-checker, operator-auditor, role-beneficiary; states: loading, ready, forbidden, conflict, error; actions: map canonical administration state, coordinate mutation/readback, avoid local role or approval truth.
- `app-client` — excluded; states: not_affected_directly; exclusion reason: Consumes authorization outcomes but does not own administration controls..
- `app-partner` — excluded; states: not_affected_directly; exclusion reason: Partner lifecycle/authorization outcomes are consumed through sovereign owners; administration does not become partner lifecycle truth..
- `app-captain` — excluded; states: not_affected_directly; exclusion reason: Captain credential/workforce truth remains with Workforce and is only affected indirectly by authorized outcomes..
- `app-field` — excluded; states: not_affected_directly; exclusion reason: Field workforce truth remains with Workforce and is only affected indirectly by authorized outcomes..

**Additional durable semantic model**

```json
{
  "stateModel": {
    "approval": [
      "pending",
      "approved",
      "rejected",
      "superseded"
    ],
    "execution": [
      "not_started",
      "pending",
      "reconciling",
      "retryable_failure",
      "failed_terminal",
      "applied"
    ],
    "role": [
      "active",
      "inactive"
    ],
    "diagnostics": [
      "healthy",
      "attention"
    ],
    "allowedApprovalExecutionPairs": [
      {
        "approval": "pending",
        "execution": "not_started"
      },
      {
        "approval": "pending",
        "execution": "pending"
      },
      {
        "approval": "pending",
        "execution": "reconciling"
      },
      {
        "approval": "pending",
        "execution": "retryable_failure"
      },
      {
        "approval": "pending",
        "execution": "failed_terminal"
      },
      {
        "approval": "superseded",
        "execution": "failed_terminal"
      },
      {
        "approval": "approved",
        "execution": "applied"
      },
      {
        "approval": "rejected",
        "execution": "not_started"
      }
    ]
  }
}
```

### CAPTAIN_DISPATCH — إسناد الكابتن والتوزيع

**Problem.** A ready BThwani-delivery order needs one governed dispatch offer/assignment truth with eligibility, capacity, timeout, captain decision, cancellation/reassignment and cross-surface readback that cannot fork under retry or concurrency.
**Target state.** Eligibility, capacity, timeout, assignment and reassignment are DSH-governed, idempotent and consistent across operator, captain and client surfaces.

**Required outcome.** Each eligible ready order has at most one active concurrency-safe DSH dispatch offer/assignment, with truthful captain decision and customer/operator readback.

**Primary actors.** operator, captain, client, system.

**Canonical ownership.** DSH operational dispatch; Workforce eligibility; WLT financial effects.

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
- `shared` — required; actors: operator, captain, client; states: loading, ready, expired, conflict, forbidden, offline, error; actions: map canonical state, coordinate mutation/readback, avoid local eligibility or assignment truth.

### IDENTITY_ACTIVATION_SESSIONS

**Problem.** Every BThwani surface needs one sovereign actor, activation, and session model without duplicate identities, client-selected trust context, or surface-local authentication truth.
**Problem frequency.** continuous
**Problem severity.** critical
**Target state.** Zero duplicate actors, context overrides, cross-actor reads, activation replays, false readiness, and parallel Identity truth.
**Primary success measure.** identity_truth_and_cross_actor_violations
**Guardrail measures.** duplicate_actor_count; cross_context_actor_reads; activation_replays; false_ready_responses; session_token_leaks

**Required outcome.** One Identity actor and session source serves every required surface with governed provisioning, exact idempotency, trusted context, and durable readback.

**Primary actors.** customer, partner, captain, field, operator, workforce-service.

**Canonical ownership.** Identity.

**Material deployable surfaces.** app-client, app-partner, app-captain, app-field, control-panel.

**Business invariants**
- Identity exclusively owns actor accounts, canonical identifiers, authentication state, and sessions.
- Workforce supplies professional intent but never writes Identity persistence directly.
- Internal callers authenticate as a service and cannot become the source of operator context.
- Every actor provisioning and session mutation has durable owner readback.

**Forbidden/negative invariants**
- No browser or mobile client calls internal actor administration routes.
- No idempotent provisioning retry expands roles or permissions.
- No actor identifier or header supplied by a client grants object access.
- No mock, fixture, local storage value, or Markdown declaration becomes production Identity truth.
- No execution agent grants product, QA, security, release, or production approval.

**Acceptance expectations**
- Health remains liveness-only and readiness fails closed for configuration, database, migration, relation, and clock failures.
- An exact canonical phone, username, role, and trusted operator-context provisioning retry returns one durable actor.
- A retry that changes any provisioning fingerprint field fails without role or permission expansion.
- Internal search and direct read are stable, paginated, service-authenticated, and operator-context isolated.
- Activation is typed, surface-bound, short-lived, single-use, attempt-limited, and never logged in raw form.
- Refresh rotates atomically, reuse is rejected, and logout or deactivation revokes applicable sessions.
- Every required surface exposes explicit loading, expired, forbidden, blocked, unavailable, and recovery states.

**Named failure classes:** duplicate_actor, provisioning_fingerprint_mutation, client_context_override, cross_context_read, stale_migration_ready, activation_replay, refresh_reuse, secret_or_pii_leak, parallel_identity_truth.

**Actor responsibility envelope**
- `customer` — Uses app-client with an owned Identity actor and session.; permitted: activate or authenticate the owned actor, manage owned sessions; forbidden: select operator context, read another actor or session.
- `partner` — Uses app-partner after governed partner actor provisioning and activation.; permitted: activate the provisioned partner actor, manage owned sessions; forbidden: self-provision an internal actor, reuse another actor activation.
- `captain` — Uses app-captain after Workforce-governed provisioning and readiness.; permitted: activate the assigned captain actor, manage owned sessions; forbidden: change the provisioned role, bypass Workforce readiness.
- `field` — Uses app-field after Workforce-governed provisioning and assignment.; permitted: activate the assigned field actor, manage owned sessions; forbidden: change the provisioned role, access another field actor.
- `operator` — Uses Control Panel and authorized administrative identity operations.; permitted: authenticate to Control Panel, perform explicitly authorized actor administration; forbidden: self-approve privileged access, provision outside trusted service context.
- `workforce-service` — Trusted service caller for Workforce-managed actor provisioning and readback.; permitted: provision an exact actor fingerprint, search and read within trusted operator context; forbidden: override runtime operator context, expand a role through an idempotent retry.

**Surface semantics**
- `app-client` — required; actors: customer; states: loading, active, expired, blocked, failure; actions: authenticate and recover the owned session.
- `app-partner` — required; actors: partner; states: loading, pending_activation, active, blocked, failure; actions: activate and authenticate the governed partner actor.
- `app-captain` — required; actors: captain; states: loading, pending_activation, active, blocked, failure; actions: activate and authenticate the governed captain actor.
- `app-field` — required; actors: field; states: loading, pending_activation, active, blocked, failure; actions: activate and authenticate the governed field actor.
- `control-panel` — required; actors: operator; states: loading, authenticated, forbidden, not_found, failure; actions: authenticate and use authorized actor administration.
- `backend` — required; actors: workforce-service, operator, customer, partner, captain, field; states: healthy, degraded, not_ready, authorized, forbidden, conflict; actions: enforce trust boundaries and persist Identity-owned truth.
- `database` — required; actors: workforce-service, operator, customer, partner, captain, field; states: transactional, isolated, audited, migration_governed; actions: store sovereign actor, activation, session, and lifecycle truth.
- `shared` — required; actors: workforce-service, operator, customer, partner, captain, field; states: typed, bound, fail_closed; actions: consume generated Identity contracts without parallel auth truth.

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
- `shared` — required; actors: authenticated_client, authorized_operator; states: loading, ready, unserviceable, forbidden, offline, error; actions: map canonical map/address/serviceability state, avoid local geofence/provider truth.
- `providers` — required; actors: authenticated_client, authorized_operator; states: healthy, unavailable, not_configured, uncertain_result; actions: resolve governed external map/search/reverse-geocoding data through the provider boundary.
- `app-partner` — excluded; states: not_affected; exclusion reason: No partner-owned client address/geofence mutation is part of this capability..
- `app-captain` — excluded; states: not_affected; exclusion reason: Captain navigation consumes later delivery-location projections and does not own client-address truth..
- `app-field` — excluded; states: not_affected; exclusion reason: Field onboarding/assignments do not own client delivery-address truth..

### ORDER_CREATION — إنشاء الطلب وحقيقة الطلب

**Problem.** A valid checkout intent must create at most one auditable DSH order whose accepted commercial/address/item snapshots and operational truth cannot be silently repriced, rebound or duplicated under retry/concurrency.
**Target state.** Retries/concurrency cannot duplicate the order, accepted snapshots remain stable, all affected surfaces read the same authorized operational truth, and no DSH/frontend financial authority is created.

**Required outcome.** One eligible checkout intent yields one canonical DSH order with durable accepted snapshots, authorized multi-surface readback and WLT-owned financial projection semantics.

**Primary actors.** client, partner, operator, system.

**Canonical ownership.** DSH operational order truth; WLT financial truth.

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
- `shared` — required; actors: client, partner, operator; states: loading, success, forbidden, conflict, offline, error; actions: map canonical contract state, coordinate readback, avoid local order/payment authority.
- `app-captain` — excluded; states: not_affected; exclusion reason: Captain enters later dispatch/fulfillment journeys, not order creation..
- `app-field` — excluded; states: not_affected; exclusion reason: Field workforce does not own order creation/truth under the current model..

**Additional durable semantic model**

```json
{
  "preconditions": [
    "Checkout intent belongs to the same trusted platform/operator context and client required by the current contract.",
    "Checkout intent is in the financial/operational state allowed for order creation, including COD when applicable.",
    "Cart is active/non-empty and each item has a valid accepted commercial snapshot.",
    "Address, fulfillment mode and serviceability are proven in the checkout intent.",
    "Any WLT reference required by checkout remains a reference and does not grant DSH financial ownership."
  ]
}
```

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
- `shared` — required; actors: partner-operator, captain, control-panel-operator; states: loading, success, error, conflict; actions: call sovereign DSH routes, carry optimistic versions, remove superseded pending projections, avoid local fleet truth.
- `backend` — required; actors: partner-operator, captain, control-panel-operator; states: pending, redeemed, revoked, expired, active, suspended, version-conflict, forbidden; actions: enforce role and store scope, enforce active-store eligibility, hash code, lock mutations, audit lifecycle actions, notify partner and captain, return redacted operator readback.
- `database` — required; actors: partner-operator, captain, control-panel-operator; states: transactional, versioned, audited, trusted-context-scoped, single-use, store-scoped-multi-membership; actions: store digest only, enforce one pending code, persist and audit expiry, prevent duplicate identity binding inside one store, permit governed multi-store membership, retain lifecycle audit and notifications.

### PARTNER_ONBOARDING_STORE_PUBLICATION

**Problem.** Partner onboarding, first-store readiness, approval, publication and payout setup must form one governed journey with trusted platform/operator context and explicit Partner/Store ownership instead of disconnected surface-specific records and manual checks.
**Problem frequency.** continuous
**Problem severity.** critical
**Target state.** Every mutation is trusted-context derived, Partner/Store scoped, authorization-scoped, concurrency-safe, idempotent, audited and readable on required surfaces.
**Primary success measure.** percentage of submitted partner drafts reaching a governed terminal decision without manual cross-system reconciliation
**Guardrail measures.** zero cross-scope partner, store, document, visit or audit reads/writes; zero stores reassigned between partners outside an explicit transfer journey; zero raw payout account identifiers returned by DSH; zero client-visible stores failing any publication gate; zero duplicate transition audit events for identical retries

**Required outcome.** A partner can be onboarded from field draft to a client-visible first store through one traceable trusted-context-aware state model, while Partner/Store business ownership is explicit and WLT exclusively owns raw payout details.

**Primary actors.** field-agent, partner-owner, control-operator, client.

**Canonical ownership.** DSH partner/store operational truth; WLT payout-destination truth; Identity trusted context.

**Material deployable surfaces.** app-client, app-partner, app-field, control-panel.

**Business invariants**
- Every partner/onboarding child record belongs to the trusted platform/operator context and explicit Partner/Store business scope required by the current model.
- One partner may own multiple stores, but one store has at most one onboarding owner unless an explicit transfer model says otherwise.
- Control-panel approval is distinct from field evidence capture.
- WLT is the sole owner of raw payout destination data.
- Client visibility is a store publication outcome, not merely a partner status label.
- Every material transition records the actor, trusted context, business scope, correlation, retry and audit data required by current contracts.

**Forbidden/negative invariants**
- Client-controlled input cannot select trusted platform/operator context.
- Missing required trusted context cannot silently fall back inside partner handlers.
- One Partner/Store scope cannot enumerate, read, link, mutate or infer another unauthorized business scope.
- A field agent cannot approve their own evidence where separation is required.
- A partner cannot bypass store publication gates.
- A store cannot be reassigned by the generic link operation.
- DSH cannot persist raw payout account data after binding a WLT reference.
- A stale version cannot mutate partner state.
- A reused idempotency key cannot represent a different payload.
- A store failing any applicable publication gate cannot appear to clients.

**Acceptance expectations**
- Platform/operator context is derived only from trusted Identity/server-side context; browser headers, query parameters and request bodies cannot select or override it.
- Requests requiring trusted context fail closed when it is absent and do not reach partner persistence.
- Partner lists, details, documents, visits, stores, assignments/scopes, transitions and audit records are read or mutated only within trusted context plus object/business authorization.
- Cross-scope partner/store identifiers do not disclose ownership details.
- Field agents can create, resume, save and submit only assigned or authorized onboarding drafts.
- Submission is blocked until current legal, first-store and WLT payout-reference prerequisites are complete.
- Required documents and evidence satisfy the current independent review policy before activation.
- Client publication requires every applicable partner, store, catalog, marketing and serviceability gate.
- A store already owned by one partner cannot be linked to another through the generic onboarding link operation.
- Identical transition and payout retries replay the original result; payload changes under the same idempotency identity are rejected.
- DSH persists and returns only WLT payout references or masked compatibility values allowed by the current contract.
- Partner and control-panel surfaces read back committed activation and readiness state.

**Named failure classes:** trusted context selected from client-controlled input, missing trusted context accepted, cross-scope record disclosure/mutation, raw payout data stored or returned by DSH, store ownership silently changed, publication without all applicable gates, approval without required evidence, payload-divergent retry accepted, surface reports success before committed readback.

**Actor responsibility envelope**
- `field-agent` — Captures and maintains an assigned partner and first-store onboarding draft with governed evidence inside trusted session/assignment scope.; permitted: create assigned partner draft, edit assigned partner draft, capture first-store profile, upload partner documents, submit evidence-bearing field visit, submit assigned draft for review; forbidden: approve own evidence, publish store to client, reassign a store owned by another partner, write financial ledger or settlement truth, select or override trusted platform/operator context.
- `partner-owner` — Reads governed activation, readiness, store scope and team state for the authenticated partner business scope.; permitted: read own activation state, read own readiness, read own store scope, manage authorized store team; forbidden: self-approve onboarding, override store publication gates, read raw payout identifiers from DSH, read another partner or store outside authorized scope.
- `control-operator` — Reviews documents and evidence, links eligible unowned stores, and applies governed activation/publication decisions through trusted operator context.; permitted: review partner documents, read field-visit evidence, link an eligible unowned store, apply allowed partner transitions, read immutable onboarding audit; forbidden: bypass readiness gates, reassign a store owned by another partner, persist raw payout identifiers in DSH, mutate WLT ledger truth, read or mutate records outside trusted operator/business scope.
- `client` — Discovers a store only after all applicable publication gates are satisfied.; permitted: discover client-visible store, read public store profile; forbidden: discover hidden or unready store, read partner-private onboarding data.

**Surface semantics**
- `app-client` — required; actors: client; states: loading, empty, ready, offline, error; actions: discover published store, open public store detail.
- `app-partner` — required; actors: partner-owner; states: loading, blocked, in-review, active, hidden, deactivated, error; actions: read own status, read own readiness, manage authorized team.
- `app-captain` — excluded; states: out-of-scope; exclusion reason: Captain assignment and fulfillment begin in later order/dispatch journeys after store publication..
- `app-field` — required; actors: field-agent; states: blank, draft, saving, conflict, offline, blocked, submitted, error; actions: create draft, save draft, capture store, upload document, capture visit, submit for review.
- `control-panel` — required; actors: control-operator; states: loading, empty, ready, forbidden, conflict, readiness-blocked, error; actions: review evidence, link eligible unowned store, apply allowed transition, read audit.
- `backend` — required; actors: field-agent, partner-owner, control-operator, client; states: authorized, trusted-context-required, not-found, forbidden, conflict, readiness-blocked, idempotent-replay, service-unavailable; actions: authenticate, derive trusted context, authorize, validate, persist, audit, handoff to WLT, read back.
- `database` — required; actors: control-operator; states: trusted-context-scoped, business-scope-isolated, consistent, conflict-rejected, single-active-payout, audit-retained; actions: enforce trusted-context scope, enforce Partner/Store ownership, enforce version, enforce idempotency, retain audit.
- `shared` — required; actors: field-agent, partner-owner, control-operator; states: loading, ready, offline, forbidden, conflict, partial, error; actions: map contracts, coordinate mutations, normalize readback, present recovery actions.

### PLATFORM_CHANGE_SETS

**Problem.** Platform configuration changes need one governed maker-checker workflow with explicit validation, conflict detection, audit, apply, and rollback boundaries.
**Problem frequency.** occasional
**Problem severity.** high
**Target state.** The governed lifecycle prevents unauthorized, stale, conflicting, or sensitive platform mutations and provides auditable rollback.
**Primary success measure.** unreviewed_platform_mutations
**Guardrail measures.** stale_change_set_applications; sensitive_values_captured; rollback_without_reason
**Observation window.** Per governed mutation

**Required outcome.** Every platform configuration mutation follows one contract-bound, maker-checker, auditable, conflict-safe lifecycle with explicit rollback evidence.

**Primary actors.** platform_operator, platform_approver, projection_reader.

**Canonical ownership.** Platform Control.

**Material deployable surfaces.** control-panel.

**Business invariants**
- A change set has one proposer and an independent approver.
- Apply uses the validated revision and precondition snapshot.
- Rollback records a mandatory reason and restores only governed non-sensitive state.
- Every transition is persisted and auditable.

**Forbidden/negative invariants**
- No actor approves or rejects its own change set.
- No stale or conflicting change set is applied.
- No secret or credential value is stored in a change set.
- No existing sensitive target value is snapshotted.
- No rollback occurs without a reason.

**Acceptance expectations**
- The OpenAPI contract is the canonical source for generated client types.
- Maker-checker separation prevents self-approval and self-rejection.
- Validation and apply reject stale or conflicting target revisions.
- Sensitive and confidential values never enter snapshots or proposed values.
- Rollback requires a reason and produces auditable readback.

**Named failure classes:** manual_generated_type_drift, self_approval_allowed, stale_change_applied, sensitive_value_persisted, rollback_without_reason, runtime_readback_missing.

**Actor responsibility envelope**
- `platform_operator` — Creates, validates, submits, applies, and rolls back governed platform change sets within granted scope.; permitted: create_change_set, validate_change_set, submit_change_set, apply_approved_change_set, rollback_applied_change_set; forbidden: approve_or_reject_own_change_set, apply_stale_or_conflicting_change_set, rollback_without_reason, store_secret_or_credential_values_in_change_sets, snapshot_existing_sensitive_target_values.
- `platform_approver` — Independently approves or rejects submitted platform change sets.; permitted: approve_change_set, reject_change_set; forbidden: approve_or_reject_own_change_set, apply_stale_or_conflicting_change_set, rollback_without_reason, store_secret_or_credential_values_in_change_sets, snapshot_existing_sensitive_target_values.
- `projection_reader` — Reads only explicitly authorized outcomes projected by the platform owner.; permitted: read_authorized_projection; forbidden: approve_or_reject_own_change_set, apply_stale_or_conflicting_change_set, rollback_without_reason, store_secret_or_credential_values_in_change_sets, snapshot_existing_sensitive_target_values.

**Surface semantics**
- `control-panel` — required; actors: platform_operator, platform_approver; states: loading, empty, ready, blocked, error; actions: create, validate, submit, approve, reject, apply, rollback.
- `backend` — required; actors: platform_operator, platform_approver; states: draft, validated, submitted, approved, rejected, applied, rolled_back, failed; actions: authorize, validate_preconditions, persist_transition, audit_transition.
- `database` — required; actors: platform_operator, platform_approver; states: transaction_open, committed, rolled_back; actions: reserve_target, enforce_sensitive_boundary, persist_audit, enforce_version.
- `shared` — required; actors: platform_operator, platform_approver; states: loading, ready, blocked, error; actions: map_contract, orchestrate_readback, map_errors.

### PLATFORM_SOVEREIGN_CONTROL_PLANE

**Problem.** Platform is the sovereign control plane for governed variables, feature flags, live health, audit, rollback, and progressive delivery.
**Problem frequency.** continuous
**Problem severity.** critical
**Target state.** Every supported platform-control operation is governed, persistent, observable, and reversible.
**Primary success measure.** governed_platform_changes_and_rollouts_with_complete_readback
**Guardrail measures.** unauthorized_exposure; role_overlap; direct_writes; stale_overwrite; health_gate_bypass; concurrent_rollout; missing_audit; rollback_without_snapshot; fake_truth

**Required outcome.** One persistent control plane provides truthful reads, separated duties, audited changes, health-gated progressive delivery, readback, and safe rollback.

**Primary actors.** platform-governor, platform-operator, platform-approver, platform-applier, platform-rollout-manager, platform-auditor, customer, partner, captain, field-agent.

**Canonical ownership.** Platform Control; domain and WLT truths remain at their owners.

**Material deployable surfaces.** control-panel.

**Business invariants**
- Platform-Control owns the sovereign platform control plane.
- Domain administration may project role workflows but cannot become a second platform policy authority.
- WLT owns financial truth.
- Displayed state comes from live owners.
- Supported platform-control operations are governed and reversible.

**Forbidden/negative invariants**
- no mobile controls
- no fake local truth
- no self approval
- no rollout role overlap
- no transaction bypass
- no rollback without baseline and revision
- no advance without passing gate
- no routine or financial ownership

**Acceptance expectations**
- Permissions and surface scope are enforced.
- All displayed resources use live owner APIs.
- Operator, approver, applier, and rollout manager are separated.
- Change and rollout state machines persist readback.
- Health and revision gates block unsafe progress.
- Every transition is audited.
- Routine and financial operations stay outside Platform.

**Named failure classes:** static truth, unauthorized data, role overlap, nontransactional mutation, stale overwrite, health gate bypass, enabled rollout baseline, missing audit, false health.

**Actor responsibility envelope**
- `platform-governor` — Reads complete posture and governs platform control-plane authority.; permitted: read authorized posture; forbidden: bypass workflows, perform routine domain operations.
- `platform-operator` — Drafts, validates, and submits governed changes.; permitted: propose, validate, submit; forbidden: approve, apply, rollback, manage rollout.
- `platform-approver` — Independently approves or rejects governed changes.; permitted: approve another actor proposal, reject with reason; forbidden: approve own proposal, apply, manage rollout.
- `platform-applier` — Applies and rolls back approved governed changes.; permitted: apply, rollback, read affected state; forbidden: approve, manage rollout, overwrite newer revision.
- `platform-rollout-manager` — Operates health-gated progressive delivery.; permitted: create rollout, advance, pause, abort, rollback rollout; forbidden: participate in source change roles, advance on failed gate, start from enabled baseline, overwrite newer revision.
- `platform-auditor` — Reads immutable platform evidence.; permitted: read audit and posture; forbidden: mutate platform state.
- `customer` — Consumes effective platform outcomes through the client surface.; permitted: consume effective platform outcomes; forbidden: access sovereign controls, mutate platform state.
- `partner` — Consumes effective platform outcomes through the partner surface.; permitted: consume effective platform outcomes; forbidden: access sovereign controls, mutate platform state.
- `captain` — Consumes effective platform outcomes through the captain surface.; permitted: consume effective platform outcomes; forbidden: access sovereign controls, mutate platform state.
- `field-agent` — Consumes authorized effective outcomes through the field surface.; permitted: consume authorized effective platform outcomes; forbidden: access sovereign controls, mutate platform state.

**Surface semantics**
- `control-panel` — required; actors: platform-governor, platform-operator, platform-approver, platform-applier, platform-rollout-manager, platform-auditor; states: loading, success, partial-read, permission-denied, unavailable, draft, validated, submitted, approved, rejected, applied, rolled_back, running, paused, completed, aborted, health-gate-failed, version-conflict; actions: read live posture, operate authorized changes, operate authorized rollouts.
- `shared` — required; actors: platform-governor, platform-operator, platform-approver, platform-applier, platform-rollout-manager, platform-auditor; states: idle, loading, success, error, restricted-resource, unavailable-resource, mutation-loading, mutation-success, mutation-error; actions: aggregate authorized reads, invoke contract operations, read back affected state.
- `backend` — required; actors: platform-governor, platform-operator, platform-approver, platform-applier, platform-rollout-manager, platform-auditor; states: OPERATIONAL, PARTIALLY_BOUND, FIX_REQUIRED, draft, validated, submitted, approved, rejected, applied, rolled_back, running, paused, completed, aborted, failed; actions: enforce permissions and separated duties, evaluate health gates, enforce revisions, persist atomically, audit and read back, restore baselines.
- `database` — required; actors: platform-operator, platform-approver, platform-applier, platform-rollout-manager, platform-auditor; states: persistent, transactional, revisioned, audited, health-gated, progressive, rollback-capable; actions: store workflows, capture baselines, reject stale operations, prevent concurrent active rollout.
- `app-client` — excluded; actors: customer; states: excluded; exclusion reason: Consumes effective outcomes only and cannot access sovereign controls..
- `app-partner` — excluded; actors: partner; states: excluded; exclusion reason: Consumes effective outcomes only and cannot access sovereign controls..
- `app-captain` — excluded; actors: captain; states: excluded; exclusion reason: Consumes effective outcomes only and cannot access sovereign controls..
- `app-field` — excluded; actors: field-agent; states: excluded; exclusion reason: Consumes authorized effective outcomes only and cannot access sovereign controls..

### REPRESENTATIVE_WALLETS_REFERENCE_FINANCE

**Problem.** Client, partner, captain and field actors need one authenticated and operator-context-isolated read-only view of their WLT-owned wallet, balances and ledger references through DSH BFF, while finance operators need permission-scoped lookup without transferring financial ownership to DSH or any frontend.
**Problem frequency.** continuous
**Problem severity.** critical
**Target state.** All actor surfaces use canonical Identity and operator-context-scoped DSH reads backed by WLT financial truth.
**Primary success measure.** operator-context and actor-scoped wallet and ledger read coverage across required surfaces
**Guardrail measures.** cross-operator-context financial disclosure count; cross-actor wallet disclosure count; frontend direct WLT financial read count; DSH wallet balance mutation path count; hardcoded actor identifier count; route-contract drift count

**Required outcome.** Every representative sees an authenticated operator-context-bound WLT-owned wallet and permission-scoped ledger view through DSH, while operators can inspect supported wallets and matching ledgers only inside their Identity operator context without any DSH or frontend balance mutation path.

**Primary actors.** client, partner, captain, field, operator.

**Canonical ownership.** WLT financial truth; DSH application facade; Identity trust context.

**Material deployable surfaces.** app-client, app-partner, app-captain, app-field, control-panel.

**Business invariants**
- WLT is the sole owner of wallet and ledger truth.
- DSH is an authenticated and authorized application facade only.
- Identity resolves actor and operator context trust.
- Every self-service wallet read is scoped to the resolved actor.
- Ledger history is append-only financial evidence.

**Forbidden/negative invariants**
- No DSH table or handler mutates representative wallet balances.
- No frontend calls internal WLT financial routes directly.
- No user-facing surface supplies an arbitrary self-service actor id or operator context id.
- No operator lookup crosses the Identity operator-context boundary.
- No settlement summary is labeled as a wallet balance.
- No read permission authorizes a money-moving action.

**Acceptance expectations**
- WLT accepts only supported wallet actor types.
- DSH derives self-service actor identity and operator context from the authenticated session and never from client-controlled input.
- Client partner captain and field have canonical own-wallet and own-ledger routes.
- Control-panel lookup requires finance.read and uses Identity-resolved operator context.
- WLT repositories scope by operator context before actor type and actor id.
- Cross-context wallet and ledger reads fail closed without disclosure.
- Balances are rendered from WLT without local derivation.
- No DSH or frontend route writes wallet balances or appends ledger truth for this journey.
- Human-facing surfaces represent loading empty partial forbidden offline error and retry states.

**Named failure classes:** cross_context_read, cross_actor_read, unsupported_actor, hardcoded_actor, direct_wlt_browser_call, local_balance_derivation, wallet_mutation_in_dsh, missing_permission, missing_context, stale_financial_display.

**Actor responsibility envelope**
- `client` — Authenticated customer reading only their own operator-context-bound wallet and ledger references; permitted: read own wallet status, read own available pending and held balances, read own ledger references, refresh; forbidden: select another actor id, select operator context, mutate balance, append ledger entries, call WLT directly.
- `partner` — Authenticated partner reading only their own operator-context-bound wallet and reference finance; permitted: read own wallet, read own ledger references, read own settlements commissions and payouts, refresh; forbidden: derive wallet balance from settlements, use a hardcoded partner id, select operator context, mutate balance in DSH, read another partner wallet.
- `captain` — Authenticated captain reading their operator-context-bound wallet, earnings references, payouts and COD liability; permitted: read own wallet, read own ledger references, read own commissions and payouts, submit governed payout request, perform authorized COD handoff actions; forbidden: read another captain wallet, read another operator-context wallet, mutate balance, complete payout locally, call a provider directly.
- `field` — Authenticated field actor reading their operator-context-bound wallet, commissions, ledger and payout requests; permitted: read own wallet, read own commissions, read own ledger references, read and submit own payout requests, refresh; forbidden: supply beneficiary identity, select operator context, request more than available balance, mutate wallet balance, read another field actor wallet.
- `operator` — Permission-scoped finance operator reading representative wallets and ledger references inside the operator context resolved by Identity; permitted: lookup a supported actor wallet in own operator context, filter ledger by actor in own operator context, inspect reference commissions settlements and payouts, audit correlation and update timestamps; forbidden: lookup without finance.read, supply or override operator context id, read another operator-context wallet or ledger, mutate wallet balance, use read permission for a money-moving action, treat DSH as financial truth owner.

**Surface semantics**
- `app-client` — required; actors: client; states: loading, success, empty, suspended, frozen, offline, forbidden, error; actions: refresh, inspect ledger.
- `app-partner` — required; actors: partner; states: loading, success, empty, suspended, frozen, offline, forbidden, error; actions: refresh, inspect ledger, open settlement reference.
- `app-captain` — required; actors: captain; states: loading, success, empty, suspended, frozen, offline, forbidden, error; actions: refresh, inspect ledger, inspect COD, request payout.
- `app-field` — required; actors: field; states: loading, success, empty, partial, suspended, frozen, offline, forbidden, validation_error, error; actions: refresh, inspect ledger, inspect commissions, submit payout request.
- `control-panel` — required; actors: operator; states: idle, loading, success, empty, partial, not_found, forbidden, invalid_actor, offline, error; actions: select actor type, enter actor id, lookup, inspect ledger, refresh.
- `backend` — required; actors: client, partner, captain, field, operator; states: authenticated, authorized, operator_context_resolved, unsupported_actor, not_found, wlt_unavailable, success; actions: resolve identity, resolve operator context, scope actor, authorize, proxy read, propagate correlation, fail closed.
- `database` — required; actors: operator; states: operator_context_isolated, unique_actor_wallet, append_only_ledger, currency_bound, auditable; actions: enforce operator-context actor lookup, enforce actor uniqueness, preserve ledger lineage, prevent duplicate payout requests.

### SETTLEMENTS_COMMISSIONS

**Problem.** Partner settlements and representative commissions require one auditable WLT-owned financial lifecycle backed by durable DSH operational evidence, versioned policies, deterministic calculation, explicit adjustments and read-only multi-surface readback.
**Problem frequency.** continuous
**Problem severity.** critical
**Target state.** WLT owns one evidence-backed idempotent settlement and commission lifecycle with policy versions, refund-aware calculation, adjustments, audit and scoped readback.
**Primary success measure.** verified evidence to canonical settlement or commission readback rate
**Guardrail measures.** caller supplied financial amount count; duplicate source settlement count; unverified completion evidence count; completed refund omitted from settlement count; commission without policy version count; reasonless adjustment count; negative wallet bucket count; cross-actor read count; unbalanced ledger transaction count

**Required outcome.** Every settlement and commission is deterministically calculated by WLT from durable evidence and a retained policy version, every adjustment has a reason and balanced financial effect, and every required surface reads only canonical scoped references.

**Primary actors.** partner, captain, field, finance_operator, dsh_service, wlt_service.

**Canonical ownership.** WLT financial truth; DSH provides operational evidence.

**Material deployable surfaces.** app-partner, app-captain, app-field, control-panel.

**Business invariants**
- WLT exclusively owns settlement commission wallet ledger refund and adjustment truth.
- DSH exclusively owns operational completion cancellation order store visit and representative evidence.
- Every financial mutation carries service authentication correlation and idempotency.
- Every visible success is read back from WLT or a governed DSH application projection backed by WLT.
- Every policy change and adjustment is append-only auditable.

**Forbidden/negative invariants**
- No DSH or frontend code calculates authoritative settlement fees or commission amounts.
- No caller supplied monetary value becomes commission truth.
- No completed refund remains in the payable settlement basis when policy requires its exclusion.
- No cancelled or unverified source is settled.
- No idempotency key represents different inputs.
- No wallet balance violates current financial invariants.
- No actor reads another actor financial detail.

**Acceptance expectations**
- DSH sends operational identities and immutable evidence only; it never sends an authoritative fee, settlement amount or commission amount.
- WLT verifies operational evidence and its own refund truth before calculation.
- A deterministic idempotency key cannot create duplicate financial effects for the same evidence.
- Every settlement and commission retains the exact policy version used for calculation.
- Every commission amount is calculated by the applicable WLT policy and is never accepted from an untrusted caller.
- Lifecycle transitions enforce legal source states and balanced wallet or ledger effects.
- Every deduction or adjustment is reasoned, operator-attributed and auditable.
- Partner captain and field reads are actor-scoped and mutation-free.
- No runtime mock fixture local financial calculation or duplicate financial truth owner remains.

**Named failure classes:** caller supplied amount, unverified evidence, cancelled source settled, completed refund ignored, duplicate settlement, duplicate commission, missing policy, stale policy ambiguity, reasonless adjustment, negative wallet bucket, cross-actor financial read, unbalanced ledger, frontend-only success.

**Actor responsibility envelope**
- `partner` — Authenticated partner viewing only its WLT settlement and commission references; permitted: read own settlement cycles, read own deductions and adjustments, read own commission references, refresh canonical WLT readback; forbidden: calculate commission locally, post or reverse a settlement, change a financial policy, read another partner financial record.
- `captain` — Authenticated captain viewing only personal commission lifecycle and adjustment reasons; permitted: read own commissions, read own pending confirmed settled rejected and reversed states, refresh canonical readback; forbidden: submit an amount, confirm settle reject reverse or adjust a commission, read another beneficiary record.
- `field` — Authenticated field representative viewing only personal visit commission lifecycle; permitted: read own visit commissions, read policy-derived amount and adjustment reasons, refresh canonical readback; forbidden: submit an amount, change visit evidence, mutate a commission state, read another representative record.
- `finance_operator` — Authorized control-panel operator managing policies and governed financial lifecycle actions; permitted: create or update a versioned policy with reason, initiate a settlement from DSH evidence, confirm reject settle or reverse an eligible commission, create a reasoned adjustment, read audit and reconciliation references; forbidden: supply settlement or commission truth amounts, approve an action created by the same actor where maker-checker applies, erase audit evidence, bypass mutation or service authentication gates.
- `dsh_service` — Operational truth owner providing durable completion and cancellation evidence; permitted: deliver immutable order and visit evidence, carry correlation and idempotency identifiers, proxy authorized read-only references; forbidden: calculate a WLT fee or commission, write WLT tables, declare refund completion, send mutable or unverifiable evidence.
- `wlt_service` — Sole financial truth owner for policy application settlement commission wallet ledger adjustment and audit; permitted: verify DSH evidence, verify WLT refund truth, calculate governed amounts, post balanced ledger effects, retain policy and adjustment versions, return canonical readback; forbidden: trust caller supplied financial amounts, settle unverified evidence, allow negative wallet buckets, reuse an idempotency key for different inputs.

**Surface semantics**
- `app-partner` — required; actors: partner; states: loading, empty, success, pending, settled, rejected, reversed, forbidden, offline, partial, error; actions: refresh, inspect cycle, inspect adjustment reason.
- `app-captain` — required; actors: captain; states: loading, empty, success, pending, confirmed, settled, rejected, reversed, forbidden, offline, error; actions: refresh, inspect commission, inspect adjustment reason.
- `app-field` — required; actors: field; states: loading, empty, success, pending, confirmed, settled, rejected, reversed, forbidden, offline, error; actions: refresh, inspect visit source, inspect adjustment reason.
- `control-panel` — required; actors: finance_operator; states: loading, empty, success, draft, active, inactive, pending, confirmed, settled, rejected, reversed, forbidden, conflict, offline, error; actions: create policy version, initiate settlement, confirm, settle, reject, reverse, adjust, inspect audit.
- `backend` — required; actors: finance_operator, dsh_service, wlt_service; states: authorized, forbidden, invalid, conflict, pending, confirmed, settled, rejected, reversed; actions: authenticate, validate evidence, calculate, enforce idempotency, post ledger, audit, read back.
- `database` — required; actors: wlt_service; states: versioned, immutable, idempotent, balanced, auditable, trusted-context-scoped; actions: enforce uniqueness, retain evidence, retain reasoned adjustment, prevent negative amount, retain policy version.
- `shared` — required; actors: partner, captain, field, finance_operator; states: idle, loading, empty, success, forbidden, conflict, offline, partial, error; actions: map canonical states, classify errors, disable duplicate actions, refresh canonical readback.

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
- `app-partner` — excluded; states: not_affected; exclusion reason: Special requests are client/operator/captain journeys under the current model..
- `app-field` — excluded; states: not_affected; exclusion reason: Field workforce does not own these special requests under the current model..
- `backend` — required; actors: client, operator, captain; states: authorized, forbidden, not_found, conflict, idempotent_replay, information_pending, information_responded, wlt_unavailable, dispatch_not_ready, exception_open, exception_resolved; actions: validate ownership, enforce stage transition, persist information exchange, create and read payment session, create assignment, read dispatch evidence, resolve eligible exception, return canonical readback.
- `database` — required; actors: client, operator, captain; states: transactional, context_scoped, versioned, audited, idempotent; actions: persist request truth, persist information rounds, enforce constraints, record workflow timestamps, link WLT dispatch proof and exception references.
- `shared` — required; actors: client, operator, captain; states: loading, empty, success, offline, forbidden, conflict, error; actions: classify error, bind generated contract, coordinate information exchange, enforce quote stage, refresh canonical request execution and financial readback, map captain service type.

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
- `shared` — required; actors: partner, captain, operator; states: loading, ready, blocked, completed, superseded, offline, error; actions: map canonical handoff/exception state, avoid local custody/exception truth.
- `app-field` — excluded; states: not_affected; exclusion reason: Field workforce has no custody role after store readiness under the current model..

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
- `shared` — required; actors: client, partner, captain, operator; states: loading, empty, success, error, offline, conflict; actions: map contract, preserve mutation identity, refresh readback, classify error.

### WLT_MONEY_MOVEMENT_SETTLEMENT

**Problem.** BThwani needs one governed financial capability that preserves WLT-owned internal wallet truth while safely connecting official-wallet Cash-In, captain COD exposure, stakeholder earnings and governed external settlements without duplicate money movement, parallel ledgers, unverifiable completion, beneficiary-controlled payout master data or manual authoritative financial arithmetic.
**Problem frequency.** continuous
**Problem severity.** critical
**Target state.** Cash-In, payment allocation, captain COD, stakeholder earnings, destination master data, payout eligibility, governed manual external settlement, evidence, reconciliation and financial close use one WLT-owned financial truth.
**Primary success measure.** share of financial movements with complete automatically derived WLT ledger lineage and required external evidence and reconciliation lineage
**Guardrail measures.** beneficiary financial-master-data mutation path count; manual authoritative monetary override path count; unverified-destination payout count; duplicate financial effect count; unreconciled completed payout count; direct balance mutation path count; ambiguous-provider duplicate attempt count; blocking finance exposure at close; cross-context financial disclosure count

**Required outcome.** Every money movement and stakeholder financial view is derived from trusted operational events and approved WLT policy, attributable to one WLT-owned wallet and ledger truth and, where external money moves, to one authoritative provider or governed manual-settlement evidence chain through reconciliation and close.

**Primary actors.** client, captain, partner, field, finance-operator, system.

**Canonical ownership.** WLT financial truth; DSH application facade; Identity trust context.

**Material deployable surfaces.** app-client, app-captain, app-partner, app-field, control-panel.

**Business invariants**
- WLT is the sole internal financial truth owner and every value-changing movement is represented by the canonical double-entry ledger.
- Authoritative monetary values are system-derived from trusted events and versioned policy; human actions express governed intent or evidence, not accounting arithmetic.
- Official external wallets move external money but do not own internal BThwani balances, liabilities or settlement state.
- There is one internal wallet per actor and one canonical payout engine for partner, captain and field.
- Payout destination data is read-only on beneficiary surfaces and controlled as WLT-owned Finance master data.
- Order payment composition and COD exposure are server-owned financial facts.
- The current production Cash-Out model is governed manual external official-wallet settlement; automated payout requires a separately approved capability.
- Unknown or conflicting external outcomes remain reconcilable until authoritative evidence resolves them.

**Forbidden/negative invariants**
- No DSH or frontend component writes WLT balances or ledger truth.
- No beneficiary surface mutates official-wallet destination master data.
- No client or finance surface directly supplies an authoritative earning commission fee balance hold payable settlement total or full-payout amount.
- No provider name determines the internal ledger account or stakeholder entitlement.
- No screenshot spreadsheet or unverified file row creates financial success.
- No unverified or silently changed destination receives payout.
- No frozen batch or approved payout snapshot is edited in place.
- No second provider is invoked for the same ambiguous external mutation before reconciliation.
- No legacy COD custody/remit path and captain-wallet debit path both account for the same order value.
- No daily financial close hides unresolved blocking exposure or mismatched control totals.

**Acceptance expectations**
- WLT remains the sole writer of wallet balances, ledger transactions, payments, refunds, commissions, payouts, settlements and reconciliation truth.
- Authoritative monetary values are derived server-side from trusted events, canonical state and versioned policy; no beneficiary or finance UI directly overrides them.
- Each actor has one canonical internal WLT wallet; held pending earned settled and withdrawal-eligibility values are states or projections, not parallel wallets.
- Cash-In credits an internal wallet only after authoritative provider evidence is verified and normalized.
- Mock or sandbox provider behavior cannot be selected as a production fallback.
- Every applicable order has one server-owned payment allocation that conserves the governed order total and prevents duplicate delivery-fee treatment.
- Captain COD authorization is order-specific, atomic and idempotent; cancellation releases once and finalization debits once.
- The current captain-funded COD path cannot simultaneously create a second remittance liability for the same order value; any alternate custody model requires a separately approved Product/financial governance decision.
- Customer withdrawal and cash-out of externally funded principal remain disabled unless a separately approved product, legal and financial policy enables them.
- Partner, captain and field payouts use one WLT-owned payout engine with stakeholder-specific eligibility expressed as policy rather than separate ledgers.
- Beneficiary surfaces expose payout destination information read-only and cannot create, update, deactivate, replace or select destination master data.
- Official-wallet destination master data is WLT-owned, versioned, encrypted and masked; only an independently verified active version is eligible for payout.
- Beneficiary payout intent contains only amount mode, optional specified amount, and idempotency context; WLT resolves beneficiary, eligible funds and current verified destination transactionally.
- Approved payout facts and frozen settlement batches are immutable; later destination changes cannot rewrite them.
- The current production Cash-Out model is governed manual external official-wallet settlement; automated payout requires a separately approved capability.
- Manual external execution records required reference and evidence and cannot expose a bare mark-paid transition.
- Final completion requires agreement between approved payout, frozen batch row, execution evidence and authoritative external statement; mismatch creates a blocking reconciliation exception.
- Financial separation of duties is enforced server-side according to active policy.
- Legitimate adjustments are typed governed WLT events with reason, evidence and authorization; there is no direct balance edit or generic monetary override.
- Blocking finance exceptions, missing required evidence, control-total mismatch or unresolved material reconciliation exposure prevent affected completion.
- Refund routing follows the authoritative original money source unless an explicit product policy states otherwise.
- An ambiguous external mutation result is reconciled before any new provider or route attempt can move the same money again.
- External official-wallet account balances are treasury control facts and never a second internal wallet ledger.

**Named failure classes:** parallel_financial_truth, direct_balance_mutation, manual_authoritative_financial_value, beneficiary_destination_mutation, beneficiary_selected_destination, client_asserted_success, client_computed_full_payout_amount, payment_allocation_mismatch, delivery_fee_double_count, cod_overcommit, cod_double_effect, unverified_destination, approved_snapshot_mutation, frozen_batch_mutation, bare_mark_paid, duplicate_external_reference, ambiguous_result_retried_elsewhere, unreconciled_completion, spreadsheet_as_truth, self_approval_bypass, blocking_exception_ignored, mock_in_production, source_unaware_refund, financial_close_with_unresolved_exposure.

**Actor responsibility envelope**
- `client` — Customer funding or paying through supported WLT-governed payment paths and reading only owned internal financial state.; permitted: create governed Cash-In intent, use supported order payment allocation, read own internal wallet and ledger references; forbidden: assert top-up success, directly mutate wallet balance, select provider credentials, supply authoritative financial totals, withdraw internal balance unless a separately approved capability permits it.
- `captain` — Captain using one WLT internal wallet for approved funding, order-specific COD exposure, automatically derived earnings and governed settlement requests.; permitted: top up through approved Cash-In, accept financially authorized COD assignment, receive governed earnings, read masked current official-wallet destination state, request eligible payout as FULL_AVAILABLE or SPECIFIED, read own wallet and ledger; forbidden: accept uncovered COD exposure, mutate COD reserve or balance locally, create or edit earning amount, create update deactivate or select payout destination, treat future earnings as existing COD capacity, assume visible balance is fully withdrawable, complete external settlement locally.
- `partner` — Partner receiving WLT-calculated governed proceeds and requesting settlement to the current server-resolved approved official-wallet destination.; permitted: read own wallet and settlement references, read masked current official-wallet destination state, request eligible payout as FULL_AVAILABLE or SPECIFIED; forbidden: create update deactivate or select payout destination, select an arbitrary external provider, activate an unverified destination, supply authoritative payable totals, edit an approved payout snapshot, mark settlement paid.
- `field` — Field actor receiving automatically derived governed commissions and requesting eligible settlement to the current server-resolved approved official-wallet destination.; permitted: read own commissions and wallet, read masked current official-wallet destination state, request eligible payout as FULL_AVAILABLE or SPECIFIED; forbidden: self-create or edit commission value, create update deactivate or select payout destination, activate an unverified destination, request more than server-owned withdrawal eligibility, complete external settlement.
- `finance-operator` — Permission-scoped operator reviewing automatically calculated financial truth and performing governed master-data, approval, execution, evidence, reconciliation and close transitions assigned to the role.; permitted: initiate governed official-wallet destination provisioning or change, verify or approve destination according to separation-of-duties policy, prepare or review payout according to role, freeze approved settlement batch, execute assigned manual transfer, record execution reference and evidence, reconcile authoritative external statement, resolve governed finance exception, close a business date only when gates pass; forbidden: directly edit wallet or ledger balances, manually override authoritative monetary truth, change destination master data without governed reason evidence authorization and approval, change approved beneficiary destination or amount in place, use a bare mark-paid transition, silently bypass separation of duties, treat spreadsheets or screenshots as financial truth, close blocking unresolved exposure.
- `system` — WLT-owned financial engine, provider adapters, reconciliation and policy enforcement producing canonical automatic ledger, payout and audit truth from trusted operational events and approved policies.; permitted: derive payment allocation, derive earnings commissions fees holds balances and withdrawal eligibility, reserve release and finalize governed COD exposure, resolve current verified active payout destination, resolve FULL_AVAILABLE and validate SPECIFIED payout amount transactionally, normalize authoritative provider evidence, post double-entry ledger transactions, enforce idempotency and legal state transitions, create reconciliation exceptions, enforce financial close gates; forbidden: route an ambiguous money mutation to a second provider before the first outcome is authoritative, credit from client claims or screenshots, trust client or operator supplied financial totals over canonical events and policy, use mock or sandbox as production fallback, create parallel provider or stakeholder ledgers, silently mutate historical financial evidence.

**Surface semantics**
- `app-client` — required; actors: client; states: loading, ready, pending, authoritative_success, reconciliation_required, failed, offline, forbidden, error; actions: create Cash-In intent, select supported payment route, read canonical result, inspect wallet history.
- `app-captain` — required; actors: captain; states: loading, eligible, insufficient_balance, cod_reserved, cod_released, cod_finalized, earning_posted, destination_unavailable, destination_verified, payout_held, payout_pending, error; actions: top up, read balance, accept eligible order, read automatic COD and earning effects, read masked payout destination, request FULL_AVAILABLE or SPECIFIED payout.
- `app-partner` — required; actors: partner; states: loading, destination_unavailable, destination_verified, available, held, payout_pending, completed, error; actions: read wallet, read masked payout destination, request FULL_AVAILABLE or SPECIFIED payout, read payout state.
- `app-field` — required; actors: field; states: loading, commission_candidate, earned, destination_unavailable, destination_verified, held, payout_pending, completed, error; actions: read wallet, read commission, read masked payout destination, request FULL_AVAILABLE or SPECIFIED payout, read payout state.
- `control-panel` — required; actors: finance-operator; states: loading, ready, blocked, needs_action, awaiting_approval, awaiting_execution, awaiting_evidence, awaiting_verification, awaiting_reconciliation, exception, closed, forbidden, error; actions: inspect server-calculated truth, initiate governed destination provision or change, verify or approve when authorized, prepare, approve or reject when authorized, freeze batch, record execution, verify independently, reconcile, resolve exception, close day when gates pass.
- `backend` — required; actors: client, captain, partner, field, finance-operator, system; states: authenticated, authorized, idempotent, reserved, held, approved, frozen, executed, evidenced, verified, reconciled, completed, unknown_external_result, blocked, exception; actions: derive trusted financial purpose, derive monetary effects from canonical events and policy, resolve payout amount and current verified destination, enforce policy, lock or reserve atomically, post ledger, normalize provider evidence, hold payout, freeze immutable batch, record external execution, reconcile, audit, fail closed.
- `database` — required; actors: system, finance-operator; states: balanced, append_only, versioned, immutable_when_frozen, reconcilable, auditable, operator_context_isolated; actions: enforce uniqueness, enforce balance invariants, preserve history, reject contradictory replay, prevent in-place mutation of approved or frozen financial facts, preserve destination version provenance.
- `shared` — required; actors: client, captain, partner, field, finance-operator; states: contract_aligned, capability_driven, no_local_truth; actions: render server-owned state, submit non-authoritative user intent, refresh canonical readback.

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
- `app-field` — excluded; actors: operator; states: not_affected; exclusion reason: Field workflows may consume readiness/service-area projections when required but do not own or mutate operational routing policy under the current model..

## Capability-change law

A new capability or material capability change must prove a stable responsibility, canonical owner, affected actors/surfaces, legal state/mutation/readback semantics, authorization, failure/recovery behavior and acceptance expectations.

```text
ACTOR != CAPABILITY_OWNER
ROUTE != CAPABILITY_OWNER
SCREEN != CAPABILITY_OWNER
IMPLEMENTATION_MECHANISM != DOMAIN
```
