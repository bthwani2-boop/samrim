# BThwani Product Requirements Document

ARTIFACT_CLASS: DURABLE_PRODUCT_GOVERNANCE
SEMANTIC_OWNER: governance/product/PRD.md
EXECUTION_AUTHORITY: NONE
CLOSURE_AUTHORITY: NONE
IMPLEMENTATION_STATE_AUTHORITY: NONE

## 1. Product definition

BThwani is one BThwani-operated unified multi-surface B2B2C commerce, fulfillment, operations, and financial platform. It is not a collection of independent applications or partner-specific platform instances. The client, partner, captain, field, and control-panel surfaces are different operating views over shared governed domain truth.

The platform supports multi-vertical commerce including restaurants, groceries, pharmacy, electronics, gifts/flowers, desserts/juices, fruits/vegetables, and other catalog-governed verticals added through the same contracts.

Partner commercial relationships may use the governed models `COMMISSION`, `SUBSCRIPTION`, `HYBRID`, or `OPERATOR_MANAGED`. A subscription is a pricing/billing relationship; it does not create an independent platform instance, data-isolation authority or separate Product authority.

## 1A. Product non-goals

BThwani is not a separate platform instance per partner/store and is not a generic multi-tenant SaaS abstraction by default. Partner Organization, Store, Human Actor, Identity Role, Product Persona, organization membership, Authorization Scope and Tenant are distinct concepts.

```text
PARTNER != TENANT_BY_DEFAULT
STORE != TENANT_BY_DEFAULT
AUTHORIZATION_SCOPE != ORGANIZATION_ID
```

A tenancy boundary is admitted only when Product/System requirements prove independent isolation/lifecycle semantics. BThwani also does not adopt an external commerce, ERP, wallet or identity platform as its Product owner merely because that system is mature or available.

## 1B. Target Product vision versus delivery breadth

This PRD owns durable target Product meaning. It does **not** require every target capability, mode, surface function, or advanced workflow to be implemented in the same delivery slice.

```text
TARGET_PRODUCT_VISION != ACTIVE_PRODUCT_SLICE
ACTIVE_PRODUCT_SLICE != CURRENT_IMPLEMENTATION_STATE
QUALITY_DEPTH != PRODUCT_BREADTH
```

The Orchestrator/invocation owns which Product slice is currently authorized for implementation. A target feature outside that slice may remain deliberately deferred without being a Product defect.

A deferred target capability must not be represented by fake screens, placeholder business APIs, temporary schemas, shadow state, speculative frameworks, or alternate source-of-truth models. When activated later, it is implemented vertically against the same canonical owners and boundaries.

```text
SMALL_PRODUCT_BREADTH + CANONICAL_ARCHITECTURE + LEVEL_4_DEPTH = VALID
TEMPORARY_MVP_ARCHITECTURE_THAT_MUST_BE_REPLACED_LATER = FORBIDDEN
```

## 2. Target product surfaces

The standard product surfaces are:

- `app-client`: customer discovery, cart, checkout, orders, support, tracking, and bounded financial readback.
- `app-partner`: partner/store/catalog/order/team and authorized financial readback.
- `app-captain`: assignment, delivery lifecycle, proof/exception handling, and authorized earnings readback.
- `app-field`: assigned field onboarding, verification, readiness, and DSH operational tasks.
- `control-panel`: governed operator administration and operational control.
- backend/domain services and their service-owned persistence.
- generated/public service clients, app-owned surface-specific capability presentation, explicitly admitted host-neutral reusable presentation only when proven, design-system primitives, events/jobs and runtime infrastructure required by the above surfaces.

These are target platform surfaces. An active delivery slice may exercise only the materially required subset. A deployable host may remain technically ready (identity/session/bootstrap/build) while its business semantics are deliberately deferred; do not create fake feature screens merely to make every target surface appear functionally populated.

A target capability may exclude a surface when its durable semantics make the exclusion explicit where omission could otherwise be ambiguous. Active-slice execution additionally follows the current authorized Product breadth.

## 3. Actors, roles, personas and trust

The canonical human identity is the **Human Actor**. Customer/client, partner member, captain, field worker and operator are current Identity roles/Product personas of a human actor; they are not separate people or identity records. A **Partner** is a business organization, not a Human Actor. A partner-role actor acts for a Partner Organization only through DSH-owned membership and business authorization scope.

Current role/persona mapping is owned by `project/ACTORS-TRUST-AND-SCOPE.md`; ubiquitous terms are owned by `project/GLOSSARY.md`. This PRD does not create a parallel actor taxonomy.

Trusted identity comes from authenticated Identity/session state. Fine-grained business scope, permissions, eligibility, assignment and operational context come from the capability that owns the protected truth. Partner Organization and Store are business scopes, not platform-isolation or tenancy boundaries. No client header, query parameter, request body, cached local value, UI selector or generic context field grants identity, role, permission, scope or tenancy.


## 4. Domain ownership

Every durable fact has exactly one authoritative owner.

- Identity owns the one human actor identifier, canonical identity credentials, high-level actor-role admission, authentication/activation proofs and role-scoped sessions. Fine-grained business permissions/scopes/context remain with the capability that owns the protected truth unless a later explicit authorization owner is admitted.
- DSH owns commerce, Central Catalog, cart/checkout/order operational truth, client/partner/captain/field operational participant state, stores/partner operations, field assignments/readiness, captain eligibility/fleet/dispatch/delivery, serviceability, notifications/inbox delivery state, special requests, support/rescue, and DSH-owned derived operational projections defined by current contracts.
- WLT exclusively owns authoritative financial truth: wallet, ledger, payment, refund, settlement, payout, commission, reconciliation, and provider financial mutation.
- Platform Control is the semantic owner for explicitly admitted cross-platform governed configuration/change/rollout facts. Whether that responsibility is deployed as an independent `services/platform-control` service is an architecture/runtime admission decision that must be proven from executable evidence rather than assumed by Governance.
- External technical integrations are owned by the consuming semantic capability through explicit ports/adapters. Platform Control may own governed cross-platform integration enablement/configuration where explicitly assigned; secret values remain in approved runtime secret storage. A generic provider service/name does not become a business domain.
- Media/object-storage behavior belongs to the bounded context/capability that owns the business object; reusable storage primitives/adapters remain technical infrastructure rather than a second business owner.

A consumer may keep a cache or projection only when the owner contract permits it. A projection is never a second truth owner.

## 5. Core product requirements

### Central catalog

DSH Central Catalog owns canonical category/taxonomy, master-product identity, governed attributes/relationships, store assortment/proposals and catalog approval/publication eligibility. Approval/publication is a named workflow inside Central Catalog, not a second sovereign owner. No application, search index, marketing layer or store-local flag may maintain a competing runtime catalog, hardcoded category list, demo product authority or publication truth.

### Discovery and serviceability

Home and store discovery use canonical DSH/product data under trusted context and current serviceability/publication gates. Ranking or personalization may reorder eligible results but may not make an ineligible store/product visible. Cached discovery may not authorize checkout/order creation after a current canonical denial.

### Partner and store model

One partner may own/manage multiple stores according to current contracts. A store has one canonical operational owner unless an explicit transfer capability governs reassignment. Partner onboarding, store readiness, publication, team access, documents/evidence, and payout references must converge on canonical DSH/Identity/WLT ownership rather than surface-local state.

Partner commercial model is governed platform state and uses one of `COMMISSION`, `SUBSCRIPTION`, `HYBRID`, or `OPERATOR_MANAGED`; billing/commercial classification does not alter platform isolation or create duplicate partner/store truth.

### Cart and checkout

DSH Cart/Checkout owns the customer's versioned active cart and checkout-intent operational lifecycle. Item price/currency and assortment evidence are server-owned; address, serviceability and fulfillment mode are owner-validated; WLT owns authoritative financial quote/payment-session facts. Checkout progresses only through legal versioned/idempotent states, and a blocked/expired/financially ambiguous checkout cannot create an order.

### Order creation

ORDER_CREATION begins only after the governed checkout eligibility boundary. One canonical checkout/idempotency scope creates at most one order. Order commercial/address/item snapshots required by the contract are immutable after creation except through an explicit legal transition.

### Fulfillment and dispatch

The target supported fulfillment-policy modes are `bthwani_delivery`, `partner_delivery`, and `client_pickup`.

Support in the target model does not mean simultaneous activation. The current authorized Product slice and executable contract determine which modes are active. A mode outside the active slice must not leak into UI, contracts, branching state machines, providers, or operational dependencies merely to anticipate future breadth.

- `bthwani_delivery` uses BThwani-governed captain dispatch and delivery ownership.
- `partner_delivery` means the partner owns the fulfillment execution path under the applicable Partner/DSH contracts; partner fleet/operational-participant detail does not create a fourth platform policy mode.
- `client_pickup` keeps delivery dispatch out of the order while preserving governed readiness/handoff semantics required by the applicable contract.

Dispatch, assignment, custody/handoff, delivery progression, proof, cancellation/reassignment, and delivery exceptions remain DSH operational truth. Captain eligibility required by dispatch is DSH-owned and must not be duplicated into a parallel actor/HR owner. Financial effects caused by fulfillment remain WLT truth.

### Field operations, assignment and readiness

DSH owns field participant status/eligibility, operational assignment, visit/checklist, readiness evidence and escalation lifecycle. In-progress reassignment requires governed handoff, required/critical evidence gates completion, and Partner/Store owners consume verified field evidence without mutating field history.

### Marketing, campaigns and loyalty

DSH owns campaign/audience/placement and non-financial loyalty/subscription/commercial-program eligibility. Campaign and program policies are versioned and auditable, with maker/checker separation where required. Central Catalog remains publication/catalog identity owner, PROMOTIONS_COUPONS_FUNDING owns coupon/promotion funding semantics, WLT owns authoritative monetary charging/posting, and notification adapters only deliver selected communications.

### Financial access

Applications access financial state only through the current governed application-facing boundary. DSH may orchestrate or store bounded WLT-backed references/projections but cannot become ledger, wallet, payment, refund, settlement, payout, commission, or reconciliation truth.

Every financial mutation is server-side, authenticated, idempotent, correlated, auditable, and reconciled against WLT/provider authority. Unknown outcomes remain unknown/reconcilable; they are never converted into fabricated success.

BThwani's internal wallet is a private WLT ledger balance, not an official external electronic wallet. Each actor has one canonical internal wallet; `available`, `held`, `pending`, earned/settled totals, and withdrawal eligibility are states or projections over that one WLT truth, not parallel wallets or ledgers.

For an order that can combine internal wallet, external official-wallet payment, COD, subsidy, discount, or delivery charges, WLT owns one server-derived payment allocation that conserves the governed order total. A payment-method label alone is not sufficient financial truth, and the same delivery fee or earning must never be counted twice.

Captain COD financial authorization is order-specific and atomic against the captain's same internal wallet. Required COD exposure is reserved before assignment is allowed, released exactly once when the governed order outcome requires release, and finalized exactly once when the governed outcome requires debit. Delivery earnings are a separate WLT movement and cannot be used to fabricate pre-existing COD capacity.

Approved official electronic-wallet rails may move external money into BThwani for supported Cash-In/top-up/payment purposes. Customer or operator claims, screenshots, client-side success screens, or unverified provider responses never create internal wallet credit; authoritative provider evidence and WLT reconciliation/posting are required.

The current stakeholder Cash-Out model for partner, captain, and field is a governed manual external transfer from BThwani's official wallet accounts to a verified, versioned official-wallet destination. Funds move through hold, approval, immutable execution snapshot/batch, external execution evidence, independent verification as required, reconciliation, and only then completion. A spreadsheet/export is an execution artifact and never financial truth.

One visible internal balance does not imply that every unit is withdrawable. Withdrawal eligibility is server-owned policy. General customer withdrawal and withdrawal of externally funded principal are not enabled by implication and require explicit approved Product/legal/financial governance before activation.

Automated external payout is not implied by a generic provider adapter. It requires a separate approved capability with proven provider support, security, accounting, reconciliation, contractual and applicable regulatory evidence before it can replace the governed manual settlement path.

### Promotions and funding

Every promotion has stable identity/version, eligibility, scope, validity window and explicit funding model. Client-supplied totals/discounts are untrusted. Checkout/order captures the commercial snapshot required to reproduce the accepted transaction. WLT owns the authoritative financial consequences, reimbursement, settlement and refund effects.

### Platform variables and provider health

Cross-surface platform variables have a canonical server-side owner, type/schema, validation, version, audit/reason, rollout and readback semantics. Governed change sets are a subcapability of the Platform Control semantic control plane, not a separate Product owner. Provider health comes from current runtime/provider evidence; a configured endpoint or `enabled=true` flag is not health evidence. Secrets never become product configuration or client-visible variables.

### Operational analytics

Analytics are read models, not truth owners. Every metric identifies its source owner, aggregation/window, time basis, unit/currency, freshness behavior and allowed dimensions. Missing/stale/partial data is explicit and is not silently rendered as zero. Financial analytics derive from WLT-owned facts or governed WLT-backed projections.

### Customer profile and communication preferences

Customer non-authentication profile/preferences are DSH-owned, versioned and privacy-scoped. Identity remains credential/session/activation authority. Locale, currency preference and marketing consents are canonical server readback; device state or delivery success cannot fabricate consent.

### Partner team membership

Partner/store team membership is explicit, store-scoped, auditable and lifecycle-governed. DSH owns membership/operational scope and its business authorization facts while Identity owns authentication, high-level role admission and session truth. Membership does not imply all-store access or create a second identity system.

### Catalog approval and publication

Catalog approval/publication is a named Central Catalog subcapability. Customer visibility requires canonical DSH catalog/store approval, publication and serviceability gates. Partner, field, marketing, search and UI layers cannot independently publish content. Needs-fix/rejection/review transitions remain auditable and owner-controlled.

### Ratings and reviews

Ratings/reviews require a proven eligible source interaction and attributed actor/target, bounded edit/retry behavior, moderation/dispute semantics and canonical aggregate derivation. Ratings never become authorization or assignment truth.

### Notifications and communications

The originating domain owns the event/business meaning. Notification inbox/preferences/delivery semantics are governed separately from provider adapters, and deployable apps own native route translation. Delivery failure or duplication must not repeat/reverse the source-domain mutation unless Product explicitly defines that coupling.

### Media and object storage

Business object association/access is owned by the relevant domain. Binary object storage/presigning/proxying is technical infrastructure and never an independent Product truth owner. Asset validation, authorization, integrity and orphan/reference recovery are required where media is material.

### Derived search and analytics

Search/indexes and analytics are derived/query capabilities. They may improve discovery/operations but cannot authorize mutations, publish ineligible content, write transactional truth or replace WLT financial authority. Freshness/provenance/no-data behavior is explicit.

### WLT pricing, collateral and penalties

WLT owns authoritative financial quote/allocation, collateral/exposure and provider penalty monetary truth. Pricing evidence is server-verifiable and bounded; captain collateral remains distinct from available/COD/debt state; penalties/reversals are governed ledger/debt events rather than manual balance edits.

## 6. Multi-surface capability semantic envelope

Every material durable capability defines, when applicable:

1. problem statement, affected actors, frequency/severity when governed;
2. required outcome, target state, primary success measure and guardrails when governed;
3. actor responsibilities plus permitted/forbidden actions;
4. canonical owner(s), writer(s) and cross-domain boundaries;
5. required surfaces/consumers and explicit exclusions with reasons;
6. preconditions, trusted context and object-scope requirements;
7. durable states, legal transitions and forbidden transitions;
8. canonical mutation authority and committed readback semantics;
9. cross-surface/service handoffs and durable event/contract meaning;
10. canonical data ownership and material persistence/migration implications;
11. idempotency/concurrency/retry/replay semantics;
12. external-provider unknown-result/reconciliation/recovery semantics;
13. security/privacy/financial restrictions;
14. loading/empty/offline/forbidden/conflict/partial/error/recovery semantics;
15. acceptance criteria, failure states and negative invariants;
16. bounded unresolved durable decisions that genuinely require authorization.

Representation-only cleanup must preserve every still-valid semantic statement. Formatting/structure change is not permission to drop Product meaning.

## 7. Product-to-engineering boundary

This PRD and its routed capability/journey owners define durable Product outcomes and invariants. Durable implementation architecture belongs to the applicable `governance/architecture/**` and `governance/policies/**` owners. Execution, evidence and closure belong exclusively to the Orchestrator. This PRD does not define campaign sequencing, closure gates or implementation-state truth.


## 8. UX and accessibility baseline

All required surfaces provide truthful, actionable state. No toast/local optimistic state may stand in for committed readback where server truth is required.

Applicable surfaces support Arabic/RTL, localization, accessibility semantics, keyboard/focus behavior on web, large-text/device constraints on mobile, and recovery from weak/offline network conditions. Visual polish cannot override correctness, ownership, authorization, or persisted state.

## 9. Data and privacy baseline

PII is minimized, scoped, redacted and retained according to current policy. Secrets, credentials, tokens, payment instruments and private provider payloads are never ordinary product telemetry or general audit content. Audit/evidence uses stable identifiers and correlation metadata sufficient for investigation without copying unnecessary sensitive data.

## 10. Product acceptance semantics

Product acceptance means the implemented outcome conforms to the current durable Product/capability/journey meaning. The evidence and closure procedure for a concrete candidate is not owned here; it is resolved through the applicable engineering policies and the Orchestrator.
