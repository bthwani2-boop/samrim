# Serviceability Capabilities

ARTIFACT_CLASS: DURABLE_PRODUCT_CAPABILITY_GOVERNANCE
SEMANTIC_OWNER: governance/product/capabilities/serviceability.md
EXECUTION_AUTHORITY: NONE
CLOSURE_AUTHORITY: NONE
IMPLEMENTATION_STATE_AUTHORITY: NONE
PARENT_CAPABILITY_INDEX: governance/product/CAPABILITIES.md

## Scope

This owner defines only the durable capability semantics listed below. Capability taxonomy/schema/admission law remains in `../CAPABILITIES.md`; cross-capability journeys remain in `../JOURNEYS.md`.

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
