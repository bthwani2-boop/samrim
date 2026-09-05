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

Current role/persona mapping is owned by `../project/ACTORS-TRUST-AND-SCOPE.md`; ubiquitous terms are owned by `../project/GLOSSARY.md`. This PRD does not create a parallel actor taxonomy.

Trusted identity comes from authenticated Identity/session state. Fine-grained business scope, permissions, eligibility, assignment and operational context come from the capability that owns the protected truth. Partner Organization and Store are business scopes, not platform-isolation or tenancy boundaries. No client header, query parameter, request body, cached local value, UI selector or generic context field grants identity, role, permission, scope or tenancy.

## 4. Product ownership orientation

This PRD owns product-level orientation only. Exact durable owner/writer/readback boundaries are owned by:

- `../architecture/OWNERSHIP-AND-SOURCE-OF-TRUTH.md` for the canonical owner map;
- `CAPABILITIES.md` and `capabilities/**` for capability-specific Product semantics;
- `JOURNEYS.md` for cross-capability actor/system journeys;
- `FINANCIAL-MODEL.md` for financial Product truth and WLT sovereignty;
- `COMMERCIAL-AND-PARTNER-MODEL.md` for partner/commercial semantics;
- `EXPERIENCE-AND-DESIGN.md` for durable UX/design meaning.

At the platform level:

```text
IDENTITY → human identity, high-level role admission, credentials/proofs/sessions
DSH      → commerce/fulfillment/partner/customer/captain/field operational truth
WLT      → authoritative financial truth
PLATFORM CONTROL → only explicitly admitted cross-platform governed control-plane facts
```

No surface, integration adapter, search/index, analytics view, cache/projection or documentation artifact becomes a parallel Product owner merely because it renders or transports owner truth.

## 5. Product-wide requirements

The detailed behavior of catalog, cart, checkout, orders, partner/store lifecycle, dispatch, handoff, field operations, support, communications, analytics, promotions, ratings and financial operations is defined only in the applicable capability owner. This PRD does not maintain a second capability registry.

The target supported fulfillment-policy modes are `bthwani_delivery`, `partner_delivery`, and `client_pickup`. Target support does not activate all modes simultaneously; the active Product slice and current executable contracts determine implemented breadth.

Product-wide invariants are:

- one durable fact has one canonical semantic owner and governed writer;
- one Human Actor may hold multiple Identity roles without creating duplicate human identities;
- Partner Organization, Partner Member, Store, Human Actor, Identity Role, Product Persona, authorization scope and tenancy are distinct concepts;
- customer/client-controlled data never grants trusted identity, role, business scope, financial truth or platform isolation;
- WLT remains the only authoritative owner of wallet/ledger/payment/refund/settlement/payout/commission/reconciliation truth;
- derived search, analytics, projections and caches never become mutation authority;
- external providers implement semantic ports and never become business-domain owners;
- inactive future Product breadth remains absent rather than represented by fake screens, tables, APIs, state machines or compatibility structures.

## 6. Capability and journey routing

Use `CAPABILITIES.md` as the capability index and load only the semantic owner required by the task:

```text
pnpm knowledge:query -- list capabilities
pnpm knowledge:query -- capability <CAPABILITY_ID>
pnpm knowledge:query -- journey <J_ID>
```

The capability semantic-envelope schema and capability-admission law live in `CAPABILITIES.md`. Individual capability meaning lives only in `capabilities/**`. Cross-capability sequence/handoff meaning lives in `JOURNEYS.md`.

## 7. Product-to-engineering boundary

Product semantics do not define repository execution order, current implementation state, verification procedure or closure.

- durable architecture belongs to the applicable `governance/architecture/**` owner;
- engineering constraints belong to the applicable `governance/policies/**` owner;
- current implementation/configuration/runtime truth belongs to executable source;
- execution, recovery, evidence and closure belong exclusively to the Orchestrator.

## 8. Experience, accessibility, privacy and security routing

Durable UX, RTL, localization, accessibility and Design-System meaning belong to `EXPERIENCE-AND-DESIGN.md`.

Security/privacy controls belong to `../policies/security.md`; data lifecycle/migration rules belong to `../policies/data-and-migrations.md`; frontend/client engineering behavior belongs to `../policies/frontend-and-client.md`.

This PRD requires truthful and actionable user/operator outcomes but does not duplicate those specialized policies.

## 9. Product acceptance semantics

A Product outcome is semantically acceptable only when it conforms to its current PRD orientation plus every applicable capability, journey, financial/commercial, experience and policy owner.

Concrete candidate evidence, release authorization and closure are not owned by this PRD.
