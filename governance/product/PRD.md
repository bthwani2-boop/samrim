# BThwani Product Requirements Document

ARTIFACT_CLASS: DURABLE_PRODUCT_GOVERNANCE
SEMANTIC_OWNER: governance/product/PRD.md
EXECUTION_AUTHORITY: NONE
CLOSURE_AUTHORITY: NONE
IMPLEMENTATION_STATE_AUTHORITY: NONE

## 1. Product definition

BThwani is one BThwani-operated unified multi-surface B2B2C commerce, fulfillment, operations, workforce, and financial platform. It is not a collection of independent applications or partner-specific platform instances. The client, partner, captain, field, and control-panel surfaces are different operating views over shared governed domain truth.

The platform supports multi-vertical commerce including restaurants, groceries, pharmacy, electronics, gifts/flowers, desserts/juices, fruits/vegetables, and other catalog-governed verticals added through the same contracts.

Partner commercial relationships may use the governed models `COMMISSION`, `SUBSCRIPTION`, `HYBRID`, or `OPERATOR_MANAGED`. A subscription is a pricing/billing relationship; it does not create an independent platform instance, data-isolation authority or separate Product authority.

## 1A. Product non-goals

BThwani is not a separate platform instance per partner/store and is not a generic multi-tenant SaaS abstraction by default. Partner, Store, Actor, Role, Engagement, Organization, Authorization Scope, Operator Context and Tenant are distinct concepts.

```text
PARTNER != TENANT_BY_DEFAULT
STORE != TENANT_BY_DEFAULT
OPERATOR_CONTEXT != TENANT
AUTHORIZATION_SCOPE != ORGANIZATION_ID
```

A tenancy boundary is admitted only when Product/System requirements prove independent isolation/lifecycle semantics. BThwani also does not adopt an external commerce, ERP, wallet or identity platform as its Product owner merely because that system is mature or available.

## 2. Required surfaces

The standard product surfaces are:

- `app-client`: customer discovery, cart, checkout, orders, support, tracking, and bounded financial readback.
- `app-partner`: partner/store/catalog/order/team and authorized financial readback.
- `app-captain`: assignment, delivery lifecycle, proof/exception handling, and authorized earnings readback.
- `app-field`: assigned field onboarding, verification, readiness, and workforce-linked operational tasks.
- `control-panel`: governed operator administration and operational control.
- backend/domain services and their service-owned persistence.
- generated clients, service-owned capability presentation, design-system primitives, events/jobs and runtime infrastructure required by the above surfaces.

A capability may exclude a surface only when the applicable capability governance makes the exclusion explicit when omission could otherwise be ambiguous.

## 3. Actors and trust model

Primary actors are customer, partner, captain, field worker, and operator. Authentication identity, business scope, workforce affiliation, operational ownership, and financial ownership are separate concepts and must not be conflated.

Captain professional affiliation may be BThwani-affiliated or partner-affiliated. Workforce owns workforce affiliation/eligibility truth; DSH may own the operational fleet membership/assignment state needed by fulfillment. Those facts are related but not interchangeable authorities.

### Platform context

- Platform Context is the platform isolation boundary.
- Operator Context is trusted operational/data context within the platform boundary.
- Partner Organization and Store are business authorization scopes, not platform-isolation contexts.
- Trusted platform/operator context is server-derived from authenticated identity or governed server-side delegation.
- A client header, query parameter, request body, cached local value, or UI selection cannot grant or override trusted context.

## 4. Domain ownership

Every durable fact has exactly one authoritative owner.

- Identity owns actors, credentials, authentication, sessions, activation, roles/permissions, and trusted identity context.
- Workforce owns employment/workforce profiles, status, supervisor/shift/affiliation and workforce-specific evidence.
- DSH owns commerce, stores, catalog consumption, checkout/order operational truth, partner operational state, dispatch, delivery, serviceability, special requests, support/rescue, and application-facing bounded projections defined by current contracts.
- WLT exclusively owns authoritative financial truth: wallet, ledger, payment, refund, settlement, payout, commission, reconciliation, and provider financial mutation.
- Platform Control owns platform-wide governed configuration/rollout state assigned to it by current contracts.
- External technical integrations are owned by the consuming semantic capability through explicit ports/adapters. Platform Control may own governed cross-platform integration enablement/configuration where explicitly assigned; secret values remain in approved runtime secret storage. A generic provider service/name does not become a business domain.
- Media/object-storage behavior belongs to the bounded context/capability that owns the business object; reusable storage primitives/adapters remain technical infrastructure rather than a second business owner.

A consumer may keep a cache or projection only when the owner contract permits it. A projection is never a second truth owner.

## 5. Core product requirements

### Central catalog

Canonical category, product, taxonomy, visibility, and commercial catalog identity must come from the central catalog owner. No application may maintain a competing runtime catalog, hardcoded category list, demo product authority, or surface-local publication truth.

### Discovery and serviceability

Home and store discovery use canonical DSH/product data under trusted context and current serviceability/publication gates. Ranking or personalization may reorder eligible results but may not make an ineligible store/product visible. Cached discovery may not authorize checkout/order creation after a current canonical denial.

### Partner and store model

One partner may own/manage multiple stores according to current contracts. A store has one canonical operational owner unless an explicit transfer capability governs reassignment. Partner onboarding, store readiness, publication, team access, documents/evidence, and payout references must converge on canonical DSH/Identity/Workforce/WLT ownership rather than surface-local state.

Partner commercial model is governed platform state and uses one of `COMMISSION`, `SUBSCRIPTION`, `HYBRID`, or `OPERATOR_MANAGED`; billing/commercial classification does not alter platform isolation or create duplicate partner/store truth.

### Checkout and orders

Checkout validates canonical cart/item snapshots, owned address, serviceability, fulfillment mode, promotion/commercial eligibility, and required WLT references. One canonical checkout/idempotency scope creates at most one order. Order commercial/address/item snapshots required by the contract are immutable after creation except through an explicit legal transition.

### Fulfillment and dispatch

The current operational fulfillment-policy modes are `bthwani_delivery`, `partner_delivery`, and `client_pickup`.

- `bthwani_delivery` uses BThwani-governed captain dispatch and delivery ownership.
- `partner_delivery` means the partner owns the fulfillment execution path under the applicable Partner/DSH contracts; partner workforce/fleet detail does not create a fourth platform policy mode.
- `client_pickup` keeps delivery dispatch out of the order while preserving governed readiness/handoff semantics required by the applicable contract.

Dispatch, assignment, custody/handoff, delivery progression, proof, cancellation/reassignment, and delivery exceptions remain DSH operational truth. Workforce eligibility may be consumed from Workforce but must not become a parallel assignment owner. Financial effects caused by fulfillment remain WLT truth.

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

Cross-surface platform variables have a canonical server-side owner, type/schema, validation, version, audit/reason, rollout and readback semantics. Provider health comes from current runtime/provider evidence; a configured endpoint or `enabled=true` flag is not health evidence. Secrets never become product configuration or client-visible variables.

### Operational analytics

Analytics are read models, not truth owners. Every metric identifies its source owner, aggregation/window, time basis, unit/currency, freshness behavior and allowed dimensions. Missing/stale/partial data is explicit and is not silently rendered as zero. Financial analytics derive from WLT-owned facts or governed WLT-backed projections.

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

## 7. Unified full-stack implementation rule

A product outcome is implemented vertically through the complete materially affected path:

`surface interaction → controller/view-model → contract adapter/generated client → canonical contract → backend/domain owner → persistence/event/provider effect → canonical readback → affected consumers`

Work is not complete when only one horizontal layer succeeds. When one action changes state consumed by another surface, both the mutation and affected readbacks belong to the same outcome verification.

## 8. UX and accessibility baseline

All required surfaces provide truthful, actionable state. No toast/local optimistic state may stand in for committed readback where server truth is required.

Applicable surfaces support Arabic/RTL, localization, accessibility semantics, keyboard/focus behavior on web, large-text/device constraints on mobile, and recovery from weak/offline network conditions. Visual polish cannot override correctness, ownership, authorization, or persisted state.

## 9. Data and privacy baseline

PII is minimized, scoped, redacted and retained according to current policy. Secrets, credentials, tokens, payment instruments and private provider payloads are never ordinary product telemetry or general audit content. Audit/evidence uses stable identifiers and correlation metadata sufficient for investigation without copying unnecessary sensitive data.

## 10. Acceptance model

A capability is accepted only against its current durable capability governance and the exact implementation/runtime candidate being claimed. Static success proves only static claims. Runtime, visual, accessibility, security, finance, isolation, data-migration, CI, release and production claims require their own applicable evidence.

Product acceptance does not itself authorize merge, release or production; delivery authority remains separate.
