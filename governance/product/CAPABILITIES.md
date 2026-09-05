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

**Problem.** Administration needs precise operation/surface-scoped permissions, maker-checker separation, auditable rollback, redacted diagnostics, and delegation to the sovereign Identity and DSH owners without creating parallel administration truth.
**Target state.** Every executable administration decision has one governed maker/checker lifecycle, canonical owner readback, append-only redacted audit, and no parallel sovereign-domain projection.

**Required outcome.** Administration role and approval changes are surface-scoped, independently approved, version-fenced, auditable and reversible without moving Identity credential/access truth or DSH partner/captain/field lifecycle truth into DSH Administration.

**Primary actors.** operator-role-maker, operator-role-checker, operator-auditor, role-beneficiary.

**Canonical ownership.** DSH administration workflow and DSH-owned operational actor/partner lifecycle; Identity owns authentication/access truth.

**Material deployable surfaces.** control-panel.

**Business invariants**
- DSH Administration owns its role-definition/approval/audit workflow but not Identity authentication/credential truth or DSH-owned partner/captain/field lifecycle truth.
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
- Role definition and actor role changes use maker-checker approval with canonical role-version conflict protection.
- A failed-terminal request is recovered only by one atomic supersede-and-replace operation followed by fresh independent approval.
- Approved assignment or revocation decisions are reversed only through a separate independently approved inverse request.
- Audit writes avoid raw reason/review-note sensitive values, audit readback is redacted, and ordinary update/delete of audit history is rejected.
- Approval queues require their exact checker permissions and cannot be listed through a generic administration-read permission alone.
- The administration permission boundary has no broad operator-role bypass and does not propagate unnecessary PII.
- Partner/captain/field operational reads and mutations remain DSH-owned while credentials/access remain Identity-owned; Administration delegates to those canonical owners rather than maintaining local truth.

**Named failure classes:** direct_unapproved_role_mutation, maker_self_approval, beneficiary_self_approval, rollback_checker_not_independent, broad_role_bypass, failed_terminal_intent_replayed_or_edited, duplicate_replacement_request, audit_history_mutated, sensitive_data_in_audit_or_diagnostics, parallel_partner_or_operational_actor_truth.

**Actor responsibility envelope**
- `operator-role-maker` — Creates reasoned role-definition, assignment/revocation, rollback, and terminal-failure replacement requests without approving their own intent.; permitted: request surface-scoped role definition, request actor role assignment or revocation, request inverse action for approved decision, supersede failed-terminal request while creating one fresh version-fenced request; forbidden: self approve or reject, directly mutate canonical role truth, edit or replay failed-terminal intent, store sensitive Identity or DSH participant values in administration audit.
- `operator-role-checker` — Independently reviews and approves/rejects the governed administration requests for which the actor has exact checker permission.; permitted: approve or reject role-definition request, approve or reject role assignment/revocation, approve or reject rollback when independence rules are satisfied; forbidden: approve own request, approve a request benefiting the same actor, approve rollback when the actor was the original decision checker, use a broad role label instead of exact permission.
- `operator-auditor` — Reads append-only redacted administration audit and privacy-safe aggregate diagnostics within authorized scope.; permitted: read redacted audit, read aggregate diagnostics; forbidden: mutate role or approval state, delete or rewrite audit history, read secrets, sessions, documents, raw review notes or unnecessary PII.
- `role-beneficiary` — Receives the effect of an independently approved role assignment/revocation but does not approve the change.; permitted: consume the resulting authorized role state; forbidden: approve own assignment, self grant permissions, bypass surface or operation scope.

**Surface semantics**
- `control-panel` — required; actors: operator-role-maker, operator-role-checker, operator-auditor, role-beneficiary; states: loading, empty, ready, pending, approved, rejected, superseded, reconciling, retryable_failure, failed_terminal, forbidden, conflict, error; actions: request, approve, reject, request rollback, recover failed-terminal intent by supersede-and-replace, read audit, read diagnostics, navigate to the sovereign Identity/DSH owner surface.
- `backend` — required; actors: operator-role-maker, operator-role-checker, operator-auditor, role-beneficiary; states: not_started, pending, reconciling, retryable_failure, failed_terminal, applied, forbidden, conflict; actions: enforce exact permissions, enforce maker-checker and beneficiary separation, fence by canonical role version, delegate Identity/DSH mutations to their canonical owners, finalize only after canonical owner readback, return redacted audit and diagnostics.
- `database` — required; actors: operator-role-maker, operator-role-checker, operator-auditor; states: versioned, append_only_audit, immutable_failed_terminal_intent, auditable; actions: persist requests and decisions, enforce one fresh replacement per superseded terminal failure, retain immutable source decision history, reject audit update/delete outside explicit maintenance authority.
- technical presentation binding — required implementation evidence; actors: operator-role-maker, operator-role-checker, operator-auditor, role-beneficiary; states: loading, ready, forbidden, conflict, error; actions: map canonical administration state, coordinate mutation/readback, avoid local role or approval truth.
- `app-client` — excluded; states: not_affected_directly; exclusion reason: Consumes authorization outcomes but does not own administration controls..
- `app-partner` — excluded; states: not_affected_directly; exclusion reason: Partner lifecycle/authorization outcomes are consumed through sovereign owners; administration does not become partner lifecycle truth..
- `app-captain` — excluded; states: not_affected_directly; exclusion reason: Captain operational truth remains DSH-owned and Identity credential/access truth remains Identity-owned..
- `app-field` — excluded; states: not_affected_directly; exclusion reason: Field operational truth remains DSH-owned and Identity credential/access truth remains Identity-owned..

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

**Primary success measure.** governed administration decisions finalized only after independent approval and canonical owner readback.
**Guardrail measures.** self/beneficiary approval; broad-role bypass; mutable audit history; duplicate terminal-failure replacement; sensitive data leakage.

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

### IDENTITY_ACTIVATION_SESSIONS

**Problem.** Every BThwani surface needs one sovereign human actor and authentication/session model without role-shaped duplicate actors, speculative Identity context, OTP role self-grant, cross-role revocation, or surface-local authentication truth.
**Problem frequency.** continuous
**Problem severity.** critical
**Target state.** One normalized human identity resolves to one `actor_id`; high-level roles are explicit bindings; every session is single-role; governed role admission is server-controlled; unrelated roles survive scoped disable/revocation.
**Primary success measure.** identity_single_actor_role_isolation
**Guardrail measures.** duplicate_actor_count; governed_role_otp_self_grants; cross_role_revocations; consumer_authored_actor_ids; service_caller_header_trust; refresh_replays; false_ready_responses; session_token_leaks

**Required outcome.** One Identity actor authority serves all required surfaces. DSH/Platform Control explicitly provision only roles they own. Authentication proves the role session without turning role, context, eligibility or business scope into properties of the human actor.

**Primary actors.** customer, partner, captain, field, operator, dsh-service, platform-control-service.
**Canonical ownership.** Identity owns actor identity, credentials, Identity-wide security eligibility, high-level role admission, OTP/password authentication and role-scoped sessions. DSH owns DSH operational participant/eligibility/business scopes. WLT owns financial truth.
**Material deployable surfaces.** app-client, app-partner, app-captain, app-field, control-panel.

**Business invariants**
- Identity alone creates `actor_id`; runtime consumers cannot request a new actor identifier.
- One normalized canonical phone resolves to one actor even when the same human holds several roles.
- Actor and role are distinct durable facts. Current role admission is a direct actor↔role binding, not a generic grant/tenant/context abstraction.
- DSH manages only partner/captain/field role admission. Platform Control manages only operator role admission. Public self-service may create only client.
- Partner/captain/field OTP authenticates only an already-enabled role; OTP never grants those roles.
- Operator authenticates by password only; trusted password reset revokes operator sessions.
- Internal service principal is resolved from its credential, not a caller/context header.
- Every session has exactly one role; surface is derived from role.
- Disabling one actor-role revokes only that role's sessions/pending challenges.
- Identity-wide security disable is distinct from role/DSH lifecycle state: Platform Control may disable authentication globally for an actor, which revokes every active session/pending challenge while preserving role bindings; re-enable requires fresh authentication.
- Refresh rotates atomically; known replay compromises that session family; an unrelated random refresh cannot revoke it.
- Refresh is device-fingerprint checked; access remains a short-lived bearer token.
- Passwords use Argon2id. Login/OTP abuse controls include source throttling without creating a simple username-targeted permanent lockout.

**Forbidden/negative invariants**
- No actor-global `roles[]`, generic permissions blob, operator context, provisioning fingerprint or creator-service provenance. A minimal `security_enabled` boolean is permitted only as Identity-wide authentication eligibility and must never represent DSH operational lifecycle.
- No generic AccessGrant/Tenant/generic-human-participant authority without proven independent requirements.
- No governed role creation through OTP.
- No provisioning retry silently re-enables a disabled role or mutates another role.
- No DSH operator grant and no Platform Control DSH-role grant.
- No cross-role session revocation.
- No consumer-authored actor ID, service-caller header or Identity context header grants authority.
- No execution agent grants product, QA, security, release, or production approval.

**Acceptance expectations**
- Readiness fails closed for missing configuration/database/schema/relations, legacy actor columns and clock failure.
- Client OTP followed by captain/partner provisioning on the same phone returns exactly the same `actor_id`.
- Exact enabled-role provisioning retry is stable; a new role is an explicit mutation on the same actor; disabled role provisioning conflicts until explicit enable.
- Unknown governed-role OTP cannot create a valid role/session.
- OTP is short-lived, single-use, attempt-limited, phone/source-throttled and never exposed raw.
- Client/captain sessions may coexist; disabling captain invalidates captain only.
- Platform Control global security disable invalidates client/captain/operator sessions for the same actor, DSH cannot invoke it, role bindings remain intact, and re-enable requires new authentication.
- Operator login works even when that actor has other roles.
- Password reset invalidates old password/operator sessions but not unrelated-role sessions.
- Forged caller headers cannot change the principal resolved from a service credential.
- Generated contract/client/app/database/runtime evidence contains zero legacy Identity context/caller-header authority.

**Named failure classes:** duplicate_actor, role_shaped_actor_id, actor_role_collapse, governed_role_otp_self_grant, silent_role_reenable, cross_role_revocation, missing_global_security_kill_switch, global_security_role_deletion, global_security_session_resurrection, consumer_authored_actor_id, service_caller_header_trust, premature_identity_context_or_tenant, operator_otp, account_lockout_dos, activation_replay, refresh_reuse, secret_or_pii_leak, parallel_identity_truth.

**Actor responsibility envelope**
- `customer` — self-establishes only client role and authenticates its client session.
- `partner` — OTP-authenticates only a DSH-preprovisioned partner role; Identity role never implies store scope.
- `captain` — OTP-authenticates only a DSH-preprovisioned captain role; Identity role never implies dispatch eligibility.
- `field` — OTP-authenticates only a DSH-preprovisioned field role; Identity role never implies assignment.
- `operator` — password-authenticates operator role; fine-grained administration permission is separate from the high-level role.
- `dsh-service` — credential-authenticated manager of partner/captain/field Identity-role admission only.
- `platform-control-service` — credential-authenticated manager of operator Identity-role admission/credential reset only.

**Surface semantics**
- `app-client` — client OTP/activate/restore/refresh/logout.
- `app-partner`, `app-captain`, `app-field` — OTP/activate only after preprovisioned role; restore/refresh/logout.
- `control-panel` — operator password login/restore/refresh/logout; no operator OTP.
- `backend` — credential-derived service identity, role admission, activation and session lifecycle.
- `database` — one actor table, actor-role bindings, activation challenges, sessions, refresh history, login attempts and security audit.
- technical presentation binding — generated typed single-role identity without parallel auth truth.

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
- `app-partner` — excluded; states: not_affected; exclusion reason: No partner-owned client address/geofence mutation is part of this capability..
- `app-captain` — excluded; states: not_affected; exclusion reason: Captain navigation consumes later delivery-location projections and does not own client-address truth..
- `app-field` — excluded; states: not_affected; exclusion reason: Field onboarding/assignments do not own client delivery-address truth..

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
- `app-captain` — excluded; states: not_affected; exclusion reason: Captain enters later dispatch/fulfillment journeys, not order creation..
- `app-field` — excluded; states: not_affected; exclusion reason: Field actors do not own order creation/truth under the current model..

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

**Primary success measure.** eligible confirmed checkout intents producing exactly one canonical order with immutable accepted snapshots and owner-side readback.
**Guardrail measures.** duplicate order per checkout; order from blocked/expired checkout; snapshot repricing/rebinding; DSH financial write; success without persisted readback.

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

**Boundary/non-overlap.** FIELD_OPERATIONS_ASSIGNMENT_READINESS owns field assignment/visit/check/evidence lifecycle. This capability consumes verified field evidence and owns Partner/Store onboarding, activation/readiness decision and store publication eligibility. CENTRAL_CATALOG separately owns taxonomy/master-product/assortment/catalog publication; customer visibility requires all applicable owners to pass.

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
- technical presentation binding — required implementation evidence; actors: field-agent, partner-owner, control-operator; states: loading, ready, offline, forbidden, conflict, partial, error; actions: map contracts, coordinate mutations, normalize readback, present recovery actions.


### PLATFORM_SOVEREIGN_CONTROL_PLANE

**Problem.** Platform is the sovereign control plane for governed variables, feature flags, live health, audit, rollback, and progressive delivery.
**Problem frequency.** continuous
**Problem severity.** critical
**Target state.** Every supported platform-control operation is governed, persistent, observable, and reversible.
**Primary success measure.** governed_platform_changes_and_rollouts_with_complete_readback
**Guardrail measures.** unauthorized_exposure; role_overlap; direct_writes; stale_overwrite; health_gate_bypass; concurrent_rollout; missing_audit; rollback_without_snapshot; fake_truth

**Required outcome.** One persistent control plane provides truthful reads, separated duties, audited changes, health-gated progressive delivery, readback, and safe rollback.

**Primary actors.** platform-governor, platform-operator, platform-approver, platform-applier, platform-rollout-manager, platform-auditor, customer, partner, captain, field-agent.

**Canonical ownership.** Platform Control semantic control-plane responsibility; domain and WLT truths remain at their owners. Independent deployment as `services/platform-control` remains conditional on executable service-admission proof.


**Named subcapability — governed change sets.** Change sets are an internal workflow of this capability, not a second durable capability owner.
- lifecycle: `draft → validated → submitted → approved | rejected → applied → rolled_back | failed` as legal for the current owner state machine;
- proposer and approver are independent; an actor cannot approve/reject its own change;
- apply is version/precondition-fenced against the validated target revision/snapshot;
- secrets/credential values and existing sensitive target values are excluded from proposed values and rollback snapshots;
- rollback requires a reason, preserves audit/history, and cannot overwrite a newer revision.

**Boundary/non-overlap.** Platform-wide change-set, feature-flag, rollout, health-gate and rollback semantics are all subcapabilities of this one Platform Control semantic responsibility. No parallel `PLATFORM_CHANGE_SETS` Product owner exists.

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

**Named failure classes:** static truth, unauthorized data, role overlap, nontransactional mutation, stale overwrite, stale_change_set, sensitive_change_capture, rollback_without_reason, health gate bypass, enabled rollout baseline, missing audit, false health.

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
- technical presentation binding — required implementation evidence; actors: platform-governor, platform-operator, platform-approver, platform-applier, platform-rollout-manager, platform-auditor; states: idle, loading, success, error, restricted-resource, unavailable-resource, mutation-loading, mutation-success, mutation-error; actions: aggregate authorized reads, invoke contract operations, read back affected state.
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

**Canonical ownership.** This is a durable read-access capability with no financial writer of its own: WLT owns financial truth, DSH owns the application-facing projection/facade, and Identity owns trust context.

**Responsibility classification.** DERIVED_PROJECTION_READ_MODEL with durable multi-surface outcome; never a financial mutation authority.

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

**Boundary/non-overlap.** SETTLEMENTS_COMMISSIONS owns earning/commission calculation, policy-version application and settlement/commission lifecycle. WLT_MONEY_MOVEMENT_PAYOUT_RECONCILIATION owns common wallet/ledger money movement, Cash-In/COD/payout execution and reconciliation primitives; the same financial fact may not be independently mutable in both capability implementations.

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
- technical presentation binding — required implementation evidence; actors: partner, captain, field, finance_operator; states: idle, loading, empty, success, forbidden, conflict, offline, partial, error; actions: map canonical states, classify errors, disable duplicate actions, refresh canonical readback.

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
- `app-field` — excluded; states: not_affected; exclusion reason: Field actors do not own these special requests under the current model..
- `backend` — required; actors: client, operator, captain; states: authorized, forbidden, not_found, conflict, idempotent_replay, information_pending, information_responded, wlt_unavailable, dispatch_not_ready, exception_open, exception_resolved; actions: validate ownership, enforce stage transition, persist information exchange, create and read payment session, create assignment, read dispatch evidence, resolve eligible exception, return canonical readback.
- `database` — required; actors: client, operator, captain; states: transactional, context_scoped, versioned, audited, idempotent; actions: persist request truth, persist information rounds, enforce constraints, record workflow timestamps, link WLT dispatch proof and exception references.
- technical presentation binding — required implementation evidence; actors: client, operator, captain; states: loading, empty, success, offline, forbidden, conflict, error; actions: classify error, bind generated contract, coordinate information exchange, enforce quote stage, refresh canonical request execution and financial readback, map captain service type.

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
- `app-field` — excluded; states: not_affected; exclusion reason: Field actors have no custody role after store readiness under the current model..

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

### WLT_MONEY_MOVEMENT_PAYOUT_RECONCILIATION

**Problem.** BThwani needs one governed financial capability that preserves WLT-owned internal wallet truth while safely connecting official-wallet Cash-In, captain COD exposure, stakeholder earnings and governed external settlements without duplicate money movement, parallel ledgers, unverifiable completion, beneficiary-controlled payout master data or manual authoritative financial arithmetic.
**Problem frequency.** continuous
**Problem severity.** critical
**Target state.** Cash-In, payment allocation, captain COD, stakeholder earnings, destination master data, payout eligibility, governed manual external settlement, evidence, reconciliation and financial close use one WLT-owned financial truth.
**Primary success measure.** share of financial movements with complete automatically derived WLT ledger lineage and required external evidence and reconciliation lineage
**Guardrail measures.** beneficiary financial-master-data mutation path count; manual authoritative monetary override path count; unverified-destination payout count; duplicate financial effect count; unreconciled completed payout count; direct balance mutation path count; ambiguous-provider duplicate attempt count; blocking finance exposure at close; cross-context financial disclosure count

**Required outcome.** Every money movement and stakeholder financial view is derived from trusted operational events and approved WLT policy, attributable to one WLT-owned wallet and ledger truth and, where external money moves, to one authoritative provider or governed manual-settlement evidence chain through reconciliation and close.

**Primary actors.** client, captain, partner, field, finance-operator, system.

**Canonical ownership.** WLT financial truth; DSH application facade; Identity trust context.

**Boundary/non-overlap.** WLT_MONEY_MOVEMENT_PAYOUT_RECONCILIATION owns common wallet/ledger movement, Cash-In/COD, payout execution and reconciliation. Commission/settlement calculation policy and its evidence-derived lifecycle remain in SETTLEMENTS_COMMISSIONS; shared ledger primitives do not create two writers for the same posting.

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
- technical presentation binding — required implementation evidence; actors: client, captain, partner, field, finance-operator; states: contract_aligned, capability_driven, no_local_truth; actions: render server-owned state, submit non-authoritative user intent, refresh canonical readback.

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

## Additional durable capability coverage

The following envelopes close responsibilities proven material by the donor/current platform evidence. The capability-change law above applies equally to every entry. Generic object storage/media transport and generic search are deliberately **not** promoted to standalone Product owners: media business authorization stays with the owning domain, while object storage is technical infrastructure; search/indexes remain derived query mechanisms unless a future independent lifecycle is proven.

### CUSTOMER_PROFILE_PREFERENCES

**Problem.** Customer locale, currency preference and marketing-channel consent must not be mixed into authentication/session truth or become device-local authority.

**Required outcome.** An authenticated customer owns one versioned non-authentication profile readback containing governed locale/preferences/consents; mutations are idempotent, conflict-safe and privacy-scoped.

**Primary actors.** customer, authorized support/operator where explicitly permitted.

**Canonical ownership.** DSH customer/profile truth; Identity owns authentication/session/activation only.

**Material surfaces.** app-client; authorized control-panel/support view when required.

**Durable states/actions.**
- profile absent or present with monotonically versioned readback;
- supported locale/preference values are server validated;
- preferences and consent mutations require expected-version plus mutation identity/correlation;
- marketing consent channels are independent booleans/preferences, not inferred from notification delivery success.

**Forbidden/negative invariants.**
- No device/local storage is authoritative profile or consent truth.
- No Identity credential/session record becomes the owner of customer commerce preferences.
- No stale expected version silently overwrites a newer profile.
- No retry with a conflicting payload reuses the same idempotency identity as success.
- No consent is inferred from silence, delivery success or app installation.

**Failure/recovery.** not_found/initial creation, invalid value, version conflict, idempotency conflict, owner unavailable; recover through canonical reread and explicit retry with current version.

**Acceptance expectations.**
- profile/preferences and consents have canonical server readback;
- mutation concurrency/version conflict is explicit;
- privacy/marketing consent is enforced by downstream consumers rather than copied into parallel stores;
- app-client loading/empty/success/conflict/forbidden/offline/error states are truthful.

**Target state.** One versioned DSH profile/preferences readback owns non-authentication customer profile, locale/currency preference and communication consent with privacy-safe scoped mutation.
**Primary success measure.** successful versioned owner-side profile/preference updates with canonical readback across required customer surfaces.
**Guardrail measures.** stale-version overwrite; Identity profile duplication; consent inferred from provider delivery; cross-customer read/write; unsupported locale/currency accepted.
**Business invariants**
- authentication/session facts remain Identity-owned;
- profile/preferences are customer-scoped and versioned;
- locale/currency/consent values are validated server-side;
- delivery success/failure never fabricates consent.
**Actor responsibility envelope**
- `customer` — reads/updates only delegated own profile/preferences; forbidden: mutate authentication/privileged status or another customer.
- `operator` — reads/changes only explicitly authorized support fields with audit; forbidden: bypass privacy/scope.
- `DSH profile system` — canonical writer/readback for this capability.
**Surface semantics**
- `app-client` — required for owned profile/preferences and truthful conflict/offline/error recovery.
- `control-panel` — conditional authorized support only.
- `backend` and `database` — required scoped/versioned owner enforcement.
- technical presentation binding — implementation evidence only; no local profile truth.

### PARTNER_TEAM_MEMBERSHIP

**Problem.** Store-scoped partner team membership must have a real lifecycle and audit without becoming Identity permission truth or being conflated with captain identity/affiliation.

**Required outcome.** A published store can govern explicit partner-team membership with scoped role, lifecycle, versioned mutation and audit; Identity remains authentication/permission authority.

**Primary actors.** partner manager, partner supervisor, partner staff member, authorized operator/system.

**Canonical ownership.** DSH partner/team membership and store scope; Identity roles/permissions/session context remain separate.

**Material surfaces.** app-partner, control-panel; backend/database.

**Durable lifecycle.**
```text
invited → active
active → suspended | ended
suspended → active | ended
invited → ended
```
Resend-invite preserves `invited`; ended membership is not silently reused as active authority.

**Permitted actions.** invite within owned published store, pause/suspend, activate, block/end, resend invite, cancel invite, read canonical membership/audit according to authorization.

**Forbidden/negative invariants.**
- no implicit all-store access;
- no duplicate active/invited binding for the same scoped identity;
- no stale version update;
- no membership status grants authentication by itself;
- no partner surface edits Identity permission truth directly.

**Failure/recovery.** member/store not found, duplicate bound identity, invalid transition/action, version conflict, unauthorized scope; recover through canonical reread and valid next transition.

**Acceptance expectations.** every mutation is scoped, versioned, correlated/idempotent where retryable, audited from→to, and read back from DSH canonical membership.

**Target state.** One DSH partner-team membership lifecycle owns store-scoped operational membership while Identity remains authentication/permission/session authority.
**Primary success measure.** invited members reaching a correct scoped active/suspended/ended state with matching Identity authorization readback.
**Guardrail measures.** cross-store membership access; active membership without valid Identity binding; stale-version mutation; duplicate invite; local role authority in app.
**Business invariants**
- membership scope is explicit per partner/store;
- membership lifecycle and Identity permission/session facts remain separate owners;
- invite/activate/suspend/end transitions are versioned and auditable;
- no membership grants broader store scope than recorded.
**Actor responsibility envelope**
- `partner manager` — manages authorized team scope; forbidden: self-grant unauthorized stores/permissions.
- `member` — accepts/uses only granted scope; forbidden: infer broader access from role label.
- `Identity` — owns auth/session/permission binding; does not own DSH membership lifecycle.
**Surface semantics**
- `app-partner` and `control-panel` — required where membership management/readback is exposed.
- `backend` and `database` — required canonical membership/version/audit enforcement.
- technical presentation binding — implementation evidence only.

### CENTRAL_CATALOG — الكتالوج المركزي والاعتماد والنشر

**Problem.** Taxonomy, master-product identity, governed attributes, store assortment, proposals, digital-asset references and customer publication can diverge when partner, field, marketing, search or UI layers keep independent catalog meaning.
**Target state.** One DSH Central Catalog capability owns canonical catalog identity and lifecycle; approval/publication is a named workflow inside that owner, while search/discovery and object storage remain derived/technical consumers.
**Primary success measure.** percentage of catalog and assortment mutations that complete through one versioned owner lifecycle and produce consistent owner-side and customer-visible readback.
**Guardrail measures.** duplicate taxonomy/master-product identities; illegal lifecycle transitions; client-visible ineligible records; stale-version writes; parallel publication flags; search-index publication authority; orphaned business asset references.

**Required outcome.** Canonical category/taxonomy, master-product identity, governed attributes/relationships, store assortment/proposals and publication eligibility are versioned, auditable and owned by DSH Central Catalog, with customer visibility derived only after every applicable catalog/store/serviceability gate passes.

**Primary actors.** catalog operator, partner submitter/reviewer, field submitter, marketing reviewer, store operator, customer as read-only consumer.

**Canonical ownership.** DSH Central Catalog capability. Catalog approval/publication is a subcapability/workflow of Central Catalog; search/discovery is derived; binary object storage is a technical adapter.

**Boundary/non-overlap.** PARTNER_ONBOARDING_STORE_PUBLICATION owns Partner/Store onboarding, activation/readiness and store publication eligibility. CENTRAL_CATALOG owns taxonomy, master-product identity, governed attributes/relationships, assortment/proposals and catalog/product publication. Neither may mutate the other's lifecycle merely to force customer visibility.

**Material deployable surfaces.** app-partner, app-field where evidence/proposals are submitted, control-panel, app-client read-only discovery.

**Business invariants**
- Category/taxonomy and master-product identity have one canonical DSH owner.
- Governed attributes, option/rule relationships and master-product relationships are versioned and validated by the catalog owner.
- Store assortment and product proposals reference canonical catalog identity rather than forking product/category meaning.
- Approval/publication is part of the catalog lifecycle and cannot be bypassed by search, store-local flags, marketing presentation or client state.
- Digital-asset business references and canonical-image selection belong to the catalog/business owner; object storage owns bytes/transport only.
- Every material mutation is scoped, version-fenced, attributable and auditable.

**Durable lifecycle semantics.**
- taxonomy/node lifecycle may include active, merged and deprecated states when the governed object supports them;
- master-product review uses draft, pending_review, approved, rejected and archived;
- proposal/review flow may progress through catalog-draft, partner-proposed, partner-review, marketing-review, catalog-adopted, catalog-approved and client-visible, with needs-fix/rejected legal branches;
- store-assortment publication uses governed draft/submitted/approved/client_visible/rejected/hidden style states with pause/resume/retire only through legal owner transitions.

**Forbidden/negative invariants**
- no duplicate mutable category/master-product authority;
- no client-visible record before applicable approval/publication/serviceability gates;
- no illegal stage jump or stale-version mutation;
- no partner/field/marketing/search/UI layer independently publishes canonical catalog truth;
- no search/index result becomes eligibility or mutation authority;
- no object/bucket URL becomes business ownership truth;
- no deletion/merge loses required relationship, audit or active-assortment semantics.

**Failure/recovery.** invalid transition, stale version, duplicate identity, unresolved relationship, rejected/needs-fix proposal, invalid assortment state, asset-reference failure, derived-index lag or dependency outage; recovery rereads the canonical catalog owner, applies a legal versioned correction and rebuilds derived consumers.

**Acceptance expectations.** taxonomy/master products/attributes/relationships and assortment/proposal state have one owner; approval/publication readback is consistent across operator/partner/customer surfaces; append-only audit is retained; derived search can be rebuilt; customer visibility disappears when owner eligibility is revoked without editing the index as source truth.

**Actor responsibility envelope**
- `catalog operator` — governs taxonomy, master products, relationships, approval/publication and audit; forbidden: bypass version/review gates or make search/object storage authoritative.
- `partner submitter/reviewer` — proposes or reviews authorized store/catalog material within scope; forbidden: mutate global taxonomy/master identity without granted catalog authority or self-publish through local flags.
- `field submitter` — supplies assigned evidence/proposals; forbidden: approve its own evidence when separation is required.
- `marketing reviewer` — reviews presentation/publication stage where Product requires it; forbidden: create catalog identity or bypass catalog owner.
- `customer` — reads only customer-visible catalog/store material; forbidden: observe private review/evidence state.

**Surface semantics**
- `app-partner` — required where partner catalog/assortment proposals exist; states include loading, draft, submitted, needs_fix, approved, rejected, hidden, conflict, offline and error.
- `app-field` — required where field evidence/proposals are part of the governed workflow; states include assigned, draft, submitted, needs_fix, forbidden, offline and error.
- `control-panel` — required for authorized catalog/review/publication operations and audit.
- `app-client` — required read-only customer visibility derived from canonical eligibility.
- `backend` — required owner enforcement for identity, lifecycle, version, scope, audit and publication gates.
- `database` — required canonical persistence for versioned catalog identities/relationships/workflow/audit.
- technical presentation binding — implementation evidence only; maps canonical contracts/readback and owns no catalog truth.
### PROMOTIONS_COUPONS_FUNDING

**Problem.** Promotion/coupon eligibility and financial funding effects can diverge or double-apply across DSH, checkout and WLT.

**Required outcome.** DSH governs commercial coupon/promotion eligibility and lifecycle while WLT governs any authoritative financial reservation/posting/reversal.

**Primary actors.** authorized operator/marketing actor, customer, partner where a funded commercial program permits participation, WLT system.

**Canonical ownership.** DSH coupon/promotion terms and operational eligibility; WLT promotion funding reservation/ledger effects.

**Boundary/non-overlap.** MARKETING_CAMPAIGNS_LOYALTY owns campaign/audience/placement and non-financial loyalty/subscription/program eligibility. This capability owns coupon/promotion transactional eligibility and the correlated WLT funding lifecycle; WLT alone owns authoritative monetary posting.

**Material surfaces.** control-panel, app-client, app-partner where applicable, checkout/order readback.

**DSH commercial lifecycle.**
```text
draft → active | archived
active → paused | archived
paused → active | archived
```
Activation is governed and cannot be self-approved when maker/checker separation applies.

**WLT funding lifecycle.**
```text
reserved → committed | released
committed → reversed
```

**Forbidden/negative invariants.**
- no client-supplied authoritative discount/funding amount;
- no duplicate coupon application or funding reservation;
- no archived/expired/ineligible promotion applied;
- no same financial reservation committed/released/reversed inconsistently;
- no DSH commercial record becomes a second ledger;
- no unknown financial result is retried into duplicate money movement.

**Failure/recovery.** ineligible/expired, invalid status transition, funding unavailable, reservation conflict, released/reversed state, unknown provider/financial result; reconcile original financial identity before retry.

**Acceptance expectations.** accepted transaction snapshot is reproducible, funding source/amount is conserved, WLT postings are balanced/idempotent, refund/reversal uses the governed original funding lineage.

**Target state.** DSH commercial eligibility and WLT funding reservation/posting/reversal remain one correlated cross-owner flow with no duplicated discount or money effect.
**Primary success measure.** eligible promotion applications whose accepted transaction and WLT funding lineage reconcile exactly once.
**Guardrail measures.** duplicate application; stale/expired promotion accepted; double reservation/commit; client-authoritative discount; unreconciled funding reversal.
**Business invariants**
- DSH owns terms/eligibility/lifecycle and WLT owns monetary reservation/posting;
- accepted transaction preserves promotion version/funding lineage;
- each logical funding identity has one legal reservation→terminal path;
- refund/reversal references the original governed funding effect.
**Actor responsibility envelope**
- `marketing/operator` — governs terms/eligibility within permission; forbidden: post ledger truth or self-approve when separation applies.
- `customer` — supplies intent/code only; forbidden: supply authoritative amount/eligibility.
- `WLT system` — owns funding financial state and balanced effects.
**Surface semantics**
- `control-panel`, `app-client`, and conditional `app-partner` — canonical eligibility/readback only.
- `backend` and `database` — required DSH lifecycle plus correlated WLT boundary.
- technical presentation binding — implementation evidence only.

### RATINGS_REVIEWS_TRUST

**Problem.** Ratings must be tied to proven eligible interactions and cannot be fabricated, duplicated or used as authorization truth.

**Required outcome.** Eligible customer/partner actors submit one governed rating per eligible source/target relationship, with edit-window, moderation, dispute and aggregate readback.

**Primary actors.** customer, partner, rated captain/field provider as response/dispute participant where permitted, authorized moderator/operator.

**Canonical ownership.** DSH ratings/reviews trust capability; discovery/analytics consume derived summaries only.

**Material surfaces.** app-client, app-partner, control-panel moderation; derived provider/store discovery/analytics.

**Durable semantics.**
- client rating requires an eligible delivered order and attributed target;
- partner→field rating requires eligible partner/field attribution;
- canonical rating status is active unless retired through a governed path;
- moderation status is one of `pending | approved | rejected | disputed`;
- edits are bounded by the governed edit window and idempotency identity.

**Forbidden/negative invariants.**
- no rating for an ineligible/uncompleted source;
- no cross-actor/source spoofing;
- no duplicate logical rating through retry;
- no aggregate score edited as source truth;
- no rating score grants permission/assignment eligibility by itself.

**Failure/recovery.** not eligible, source/target not found, invalid score/data, edit window passed, idempotency conflict, moderation dispute; canonical reread resolves retry state.

**Acceptance expectations.** moderation/fraud/dispute metadata is attributable; aggregates derive only from canonical active records; customer/partner/operator readbacks agree.

**Target state.** One DSH trust capability owns eligible rating/review records, edit/moderation/dispute lifecycle and rebuildable aggregates.
**Primary success measure.** eligible interactions producing one canonical rating/review with attributable moderation and consistent derived aggregate readback.
**Guardrail measures.** ineligible rating; duplicate logical rating; cross-actor spoofing; aggregate direct edit; moderation without audit.
**Business invariants**
- rating requires a canonical eligible source interaction/target;
- logical duplicate retry is idempotent;
- moderation and edit-window rules are server-owned;
- aggregates/search projections are rebuildable derivatives.
**Actor responsibility envelope**
- `customer/partner author` — submits only eligible attributed feedback; forbidden: spoof source/target or edit aggregate truth.
- `moderator/operator` — applies authorized moderation/dispute action with audit.
- `rated actor` — receives only permitted response/dispute/readback rights.
**Surface semantics**
- `app-client`, `app-partner`, `control-panel` — required where submission/moderation/readback applies.
- `backend` and `database` — required canonical eligibility, record, moderation and audit.
- technical presentation binding — implementation evidence only.

### NOTIFICATIONS_COMMUNICATIONS

**Problem.** Domain events, inbox state, delivery preferences and provider attempts can diverge or duplicate communication.

**Required outcome.** Source domains retain business-event truth while a governed notification capability owns inbox/preference/delivery semantics and app hosts own native route translation.

**Primary actors.** customer, partner, captain, field, operator, source-domain system, notification-delivery system.

**Canonical ownership.**
- source business event/eligibility — originating domain;
- notification inbox/preferences/topic configuration/delivery-attempt record — DSH Notifications capability;
- vendor channel execution — replaceable adapter;
- native/deep-link route mapping — app host.

**Durable semantics.**
- notification item has actor identity/type, topic, localized content/action target, read/unread state and creation/read timestamps;
- preferences are actor/topic scoped, enabled/disabled, channel-set, quiet-hours, locale/timezone aware;
- platform topic config is versioned and can mark a notification mandatory where Product explicitly requires it;
- delivery retries/deduplication never repeat the source business mutation.

**Forbidden/negative invariants.**
- no provider success/failure rewrites source-domain truth;
- no channel bypasses consent/preference except an explicitly mandatory governed topic;
- no app route string becomes durable domain meaning;
- no duplicate provider attempts create duplicate user/business effects;
- no secrets/unnecessary PII in notification/audit payloads.

**Failure/recovery.** invalid destination/channel, provider unavailable/timeout, duplicate attempt, delayed delivery, app route unavailable, preference conflict; preserve inbox/business truth and reconcile delivery separately.

**Acceptance expectations.** actor can list/read owned inbox and update allowed preferences; delivery has correlation/dedupe/audit; required native routing and degraded states are truthful.

**Material deployable surfaces.** all applicable actor apps when inbox/preferences/native navigation are exposed, plus control-panel for authorized topic/configuration/diagnostics.

**Target state.** DSH Notifications owns actor inbox, preferences/topic configuration and delivery-attempt lifecycle while source domains own business-event meaning, adapters own channel execution and app hosts own native route translation.
**Primary success measure.** eligible notification intents producing at-most-once governed inbox/delivery effects with correct preference and canonical readback.
**Guardrail measures.** source mutation repeated by delivery retry; consent bypass; duplicate inbox/delivery effect; cross-actor inbox access; provider result treated as source-domain truth.
**Business invariants**
- originating domain event remains canonical business meaning;
- DSH Notifications is the concrete owner/writer for inbox/preferences/topic/delivery records;
- channel adapters are replaceable and never business owners;
- app route strings are host translation, not durable domain meaning.
**Actor responsibility envelope**
- `recipient actor` — reads own inbox and changes allowed preferences; forbidden: access another actor or disable mandatory governed topics.
- `source domain` — emits canonical semantic intent/event; forbidden: depend on provider result as business mutation truth unless explicitly governed.
- `DSH Notifications` — owns inbox/preferences/delivery correlation/dedupe/readback.
- `channel adapter/app host` — executes transport/native routing only.
**Surface semantics**
- all applicable actor apps — required when they expose inbox/preferences/native navigation.
- `control-panel` — conditional topic/config/diagnostics within permission.
- `backend` and `database` — required DSH notification owner persistence/dedupe/preferences.
- technical presentation binding — implementation evidence only.

### ANALYTICS_OPERATIONAL_READ_MODELS

**Problem.** Dashboards can silently turn stale/partial projections into transactional or financial truth.

**Required outcome.** Authorized operational analytics expose provenance, window/freshness and source-owner semantics without mutation authority.

**Primary actors.** authorized operator, partner/stakeholder for explicitly scoped summaries, system projection builder.

**Canonical ownership.** DSH operational-analytics projection responsibility owns projection build/read/rebuild lifecycle; every underlying metric fact remains owned by its canonical source domain.

**Material surfaces.** control-panel and explicitly authorized stakeholder summary views.

**Durable semantics.** metric/window/time basis/unit/currency/source owner/freshness are explicit; availability can be `available` or `no_data` rather than fabricated zero; drilldown never bypasses source authorization.

**Forbidden/negative invariants.**
- analytics cannot write transactional state;
- stale projection cannot authorize mutation;
- financial metric cannot bypass WLT-owned source;
- missing/partial data is not silently zero or “healthy”;
- cross-tenant/object leakage is forbidden.

**Failure/recovery.** lag, no data, incomplete ingestion, source mismatch, unauthorized dimension/drilldown; reconcile/rebuild from canonical sources.

**Acceptance expectations.** read model can be rebuilt, freshness is observable, source mismatch is surfaced, and operator actions navigate to canonical owner rather than mutating analytics storage.

**Target state.** A DSH operational-analytics projection owner builds authorized rebuildable read models with explicit provenance/freshness while each metric fact remains owned by its source domain.
**Primary success measure.** authorized metrics whose source owner/window/freshness are explicit and reproducible from canonical sources.
**Guardrail measures.** stale metric used to authorize mutation; financial metric not sourced from WLT; missing data rendered as zero; cross-scope drilldown leakage; non-rebuildable projection.
**Business invariants**
- DSH Analytics owns projection build/read lifecycle, not source transactional facts;
- every metric names source owner/time basis/unit/freshness;
- WLT remains source for authoritative financial facts;
- projections are rebuildable and never mutation/authorization writers.
**Actor responsibility envelope**
- `operator/stakeholder reader` — reads only authorized scoped metrics and follows owner drilldown; forbidden: mutate source through analytics storage.
- `projection builder` — ingests canonical facts with provenance/freshness; forbidden: invent missing truth.
**Surface semantics**
- `control-panel` and explicitly authorized stakeholder summaries — required where operational analytics is offered.
- `backend` and projection storage — required derived owner/readback/rebuild path.
- technical presentation binding — implementation evidence only.

### WLT_PRICING_QUOTES

**Problem.** Checkout pricing can be manipulated or overflow if client values or unsigned/unbounded evidence are trusted.

**Required outcome.** WLT produces one bounded, currency-consistent quote from authoritative pricing evidence tied to client/store/cart identity and version.

**Primary actors.** customer as intent source, DSH pricing/catalog evidence producer, WLT system, authorized operator for diagnostics only.

**Canonical ownership.** WLT quote/allocation financial computation; source commercial item evidence comes from canonical DSH owners.

**Material surfaces.** app-client checkout readback, DSH↔WLT integration, control-panel diagnostics where authorized.

**Durable semantics.** every line has canonical product identity/quantity and authoritative unit-price evidence; currency is one governed currency per quote; fee/discount figures are non-negative and bounded; quote is correlated to cart version and source evidence version.

**Forbidden/negative invariants.**
- no client-supplied unit price/fee/discount is authoritative;
- no overflow/unbounded quantity/amount;
- no mismatched product/currency evidence;
- no quote accepted without authentic source evidence;
- no quote becomes a ledger posting until the owning payment/checkout transition authorizes it.

**Failure/recovery.** invalid/bounds failure, stale/mismatched evidence, unavailable evidence verifier/owner, cart version conflict; reacquire canonical evidence and requote.

**Acceptance expectations.** quote arithmetic conserves totals, evidence provenance is verifiable, and checkout/order snapshot preserves the accepted commercial/financial basis.

**Target state.** One WLT quote lifecycle computes bounded currency-consistent totals from authenticated DSH evidence and exposes versioned readback without becoming a ledger posting by itself.
**Primary success measure.** quotes reproducible from accepted source evidence/cart version with conserved totals.
**Guardrail measures.** client-authoritative price; overflow/unbounded quantity; mismatched currency/product; stale evidence accepted; quote posted to ledger without owning transition.
**Business invariants**
- authoritative item/commercial evidence comes from canonical DSH owners;
- WLT alone computes authoritative quote allocation/financial arithmetic;
- quote is correlated to cart/evidence version and currency;
- quote is non-posting until a payment/checkout owner authorizes money movement.
**Actor responsibility envelope**
- `customer` — requests/reads quote through checkout; forbidden: author amounts.
- `DSH` — supplies authenticated commercial evidence; forbidden: duplicate WLT arithmetic.
- `WLT` — computes/version-bounds quote and canonical readback.
**Surface semantics**
- `app-client` via DSH checkout readback and authorized diagnostics.
- `backend` and `database` — required WLT quote computation/evidence/version state.
- technical presentation binding — implementation evidence only.

### WLT_CAPTAIN_COLLATERAL

**Problem.** Captain collateral/exposure can be confused with available balance, COD capacity or debt and be released while obligations remain.

**Required outcome.** WLT owns versioned collateral policy, captain collateral positions and releasable excess as financial truth backed by a proven captured captain top-up/ledger source.

**Primary actors.** captain, authorized finance/operator, WLT system.

**Canonical ownership.** WLT collateral/wallet/ledger truth; DSH only consumes eligibility/readback needed for operations.

**Material surfaces.** app-captain readback, control-panel finance, dispatch eligibility integration when applicable.

**Durable states.** collateral policy enabled/disabled and versioned; collateral position `active → released`; release records reason/time and cannot silently mutate source funding history.

**Forbidden/negative invariants.**
- no collateral position without proven eligible captured funding source;
- no client/operator direct balance edit;
- no release while pending/held/COD reserve/outstanding debt or required minimum makes it ineligible;
- no DSH writer for collateral/wallet truth;
- no released position reused as active exposure.

**Failure/recovery.** policy disabled, invalid input/source, position not found, insufficient/restricted state, conflicting obligations; canonical WLT reread/reconciliation determines next legal action.

**Acceptance expectations.** wallet summary distinguishes available/pending/held/COD/collateral/debt; release is atomic/auditable and preserves ledger/source lineage.

**Target state.** WLT owns versioned collateral policy and positions with explicit backing source, exposure constraints and atomic release eligibility.
**Primary success measure.** collateral positions whose backing, active/released state and release eligibility reconcile to wallet/ledger obligations.
**Guardrail measures.** unbacked collateral; release with pending/held/COD/debt obligations; direct balance edit; released position reused; DSH collateral writer.
**Business invariants**
- every position references eligible captured WLT funding/ledger evidence;
- collateral is distinct from available, pending, held, COD reserve and debt;
- release is atomic, versioned and blocked by current obligations/minimum policy;
- DSH consumes eligibility/readback only.
**Actor responsibility envelope**
- `captain` — reads own collateral/exposure; forbidden: mutate balance or release eligibility directly.
- `finance operator` — applies authorized policy/release actions with audit; forbidden: bypass obligations.
- `WLT` — sole collateral/wallet/ledger writer.
**Surface semantics**
- `app-captain`, `control-panel`, and dispatch integration readback when applicable.
- `backend` and `database` — required WLT policy/position/ledger lineage.
- technical presentation binding — implementation evidence only.

### WLT_PROVIDER_PENALTIES

**Problem.** Captain/field penalties can become manual arbitrary balance edits or be reversed after their debt/wallet state has materially changed.

**Required outcome.** WLT applies a governed versioned penalty policy to an eligible captain/field source, posts the monetary effect through wallet/debt plus balanced ledger, and permits only state-safe reversal.

**Primary actors.** authorized operator/system, captain or field provider as affected actor/read-only consumer.

**Canonical ownership.** WLT penalty/debt/wallet/ledger truth; DSH may supply trusted incident/actor evidence.

**Material surfaces.** control-panel finance/incident workflow and bounded captain/field financial readback.

**Durable semantics.** policy is enabled/versioned with provider actor type, amount, currency and reason; penalty records source incident and split between wallet-applied amount and debt; reversal restores exact governed financial effect only when live debt state still matches the reversible snapshot.

**Forbidden/negative invariants.**
- no generic manual balance decrement;
- no unsupported actor type;
- no duplicate posting for same mutation identity;
- no reversal after partial settlement/state drift without explicit reconciliation;
- no non-WLT ledger writer;
- no penalty without reason/audit/source evidence.

**Failure/recovery.** wallet unavailable, policy disabled/invalid, debt state conflict, duplicate/idempotency conflict, reversal state drift; reconcile live wallet/debt before any new financial mutation.

**Acceptance expectations.** original and reversal postings balance, debt/wallet split is reproducible, audit/source lineage is preserved and affected readback is consistent.

**Target state.** WLT owns versioned captain/field monetary-penalty policy, posting/debt split and state-safe reversal from trusted source evidence.
**Primary success measure.** penalty/reversal operations with exact source lineage and balanced reproducible wallet/debt/ledger effects.
**Guardrail measures.** direct balance decrement; duplicate posting; unsupported actor; reasonless penalty; reversal after incompatible debt/state drift; non-WLT ledger write.
**Business invariants**
- penalty policy is versioned and actor/type/currency/reason scoped;
- one logical mutation identity yields one financial effect;
- wallet-applied and debt portions are balanced and auditable;
- reversal is permitted only against compatible live debt/state or after explicit reconciliation.
**Actor responsibility envelope**
- `operator/system` — initiates only authorized evidence-backed penalty/reversal intent; forbidden: arbitrary balance edit.
- `captain/field actor` — reads bounded affected financial outcome; forbidden: mutate policy/posting.
- `WLT` — sole penalty/debt/wallet/ledger writer and reconciler.
**Surface semantics**
- `control-panel` and bounded `app-captain`/`app-field` readback where applicable.
- `backend` and `database` — required WLT policy/posting/debt/reversal lineage.
- technical presentation binding — implementation evidence only.

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

### MARKETING_CAMPAIGNS_LOYALTY

**Problem.** Campaign targeting, placements, loyalty/subscription programs and commercial entitlements can drift into UI flags, coupon logic or financial truth when their lifecycle and owner are not explicit.
**Target state.** One DSH marketing/commercial-program capability owns campaign/audience/placement and non-financial loyalty/subscription eligibility semantics; coupon funding remains with PROMOTIONS_COUPONS_FUNDING and monetary billing/posting remains WLT-owned.
**Primary success measure.** governed campaign/program decisions producing consistent eligible presentation/entitlement readback across required surfaces.
**Guardrail measures.** self-approved policy activation; two active exclusive earning policies; client-visible ineligible campaign; financial amount authored by marketing; archived/paused program granting new entitlement; audience/scope leakage.

**Required outcome.** Authorized operators can govern campaigns, audiences, placements, loyalty earning policy, subscription/commercial-program eligibility and entitlement presentation without creating parallel catalog, coupon-funding, wallet or ledger truth.

**Primary actors.** marketing operator/maker, independent approver where required, customer, partner, DSH system, WLT system for monetary consequences.

**Canonical ownership.** DSH marketing/commercial-program capability owns campaign/audience/placement and non-financial program eligibility/entitlement semantics; WLT owns authoritative monetary charging/funding/posting; Central Catalog owns catalog identity/publication; notification adapters only deliver selected communications.

**Boundary/non-overlap.** PROMOTIONS_COUPONS_FUNDING owns coupon/promotion transactional eligibility and funding correlation; CENTRAL_CATALOG owns catalog/product publication; DSH Notifications owns inbox/preferences/topic/delivery-attempt state; WLT owns money. Marketing owns campaign/audience/placement and non-financial loyalty/subscription/program eligibility only.

**Material deployable surfaces.** control-panel, app-client, app-partner where a program is offered, and checkout/readback when eligibility changes commerce.

**Business invariants**
- campaign lifecycle is versioned and scoped to a governed audience/placement;
- campaign activation validates the target is otherwise eligible for client visibility;
- active commercial/loyalty policy terms are immutable; changes use a new version;
- maker/checker separation applies where required, including no self-approval of governed policy activation;
- exclusive active policy classes allow at most one active governing policy when Product defines exclusivity;
- loyalty points/entitlement bounds are server-owned and cannot be supplied authoritatively by clients;
- subscription/commercial entitlement does not create a new tenant/platform instance.

**Durable lifecycle semantics.**
- campaign: draft → active → paused/completed/cancelled as legal, with cancelled/completed terminal;
- commercial program/loyalty policy: draft → active → paused → archived according to governed transitions;
- entitlement/subscription state is versioned and references its source program/policy and WLT financial reference when money is involved.

**Forbidden/negative invariants**
- no campaign/marketing flag publishes an ineligible catalog/store object;
- no client or UI owns audience eligibility or points/benefit arithmetic;
- no marketing capability posts wallet/ledger truth;
- no promotion/coupon funding lifecycle is duplicated here;
- no archived/paused program grants new entitlement contrary to policy;
- no self-approval where independent approval is required.

**Failure/recovery.** invalid audience/target, stale version, approval conflict, paused/archived policy, entitlement mismatch, WLT billing/funding unavailable or derived delivery/index lag; reread canonical program and financial owners and resume only through legal transitions.

**Acceptance expectations.** campaign/program versions and approval lineage are auditable; eligible surfaces converge on owner readback; financial consequences reconcile to WLT; catalog visibility still depends on Central Catalog/serviceability; communication delivery failure does not rewrite program truth.

**Actor responsibility envelope**
- `marketing operator/maker` — drafts campaigns/program policies and governed targeting; forbidden: self-approve when separation applies, publish ineligible catalog or author financial ledger truth.
- `approver` — independently approves/rejects governed program/policy changes within exact scope.
- `customer` — consumes eligible campaign/loyalty/subscription benefits and readback; forbidden: author eligibility/points/price.
- `partner` — consumes/participates only when the program scope permits; forbidden: override audience/funding rules.
- `WLT system` — owns monetary charge/funding/posting consequences only.

**Surface semantics**
- `control-panel` — required for campaign/program lifecycle, targeting, approval and audit.
- `app-client` — required where customer campaigns/loyalty/subscriptions are offered; shows canonical eligibility and degraded/no-data states.
- `app-partner` — conditional where partner programs/offers require participation or readback.
- `backend` — required canonical marketing/program eligibility and lifecycle enforcement.
- `database` — required versioned campaign/program/entitlement state and audit.
- technical presentation binding — implementation evidence only; maps canonical program state without local eligibility truth.

These capabilities and read models must map to journeys and exact current implementation only through evidence. Generic media/object-storage and search/index mechanisms remain explicitly non-sovereign unless a future Product/System decision proves an independent lifecycle/owner.
