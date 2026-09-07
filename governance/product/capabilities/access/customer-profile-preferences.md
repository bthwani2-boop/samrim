# Customer Profile Preferences

ARTIFACT_CLASS: DURABLE_PRODUCT_CAPABILITY_GOVERNANCE
SEMANTIC_OWNER: governance/product/capabilities/access/customer-profile-preferences.md
EXECUTION_AUTHORITY: NONE
CLOSURE_AUTHORITY: NONE
IMPLEMENTATION_STATE_AUTHORITY: NONE
PARENT_CAPABILITY_INDEX: governance/product/CAPABILITIES.md
CAPABILITY_ID: CUSTOMER_PROFILE_PREFERENCES

## Scope

This file is the **sole editable durable semantic owner** of `CUSTOMER_PROFILE_PREFERENCES`. Capability taxonomy/schema/admission law remains in `../../CAPABILITIES.md`; cross-capability journey semantics remain in `../../JOURNEYS.md`.

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
