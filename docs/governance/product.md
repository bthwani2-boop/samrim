# BThwani Product Scope

ARTIFACT_CLASS: DURABLE_PRODUCT_GOVERNANCE
SEMANTIC_OWNER: docs/governance/product.md
EXECUTION_AUTHORITY: NONE
IMPLEMENTATION_STATE_AUTHORITY: NONE

## Purpose

This file owns current Product breadth, non-goals and capability admission law.

The Human Actor/role model is owned by `docs/governance/platform.md`. Bounded system ownership is owned by `docs/governance/architecture.md`. Detailed capability truth lives in exactly one declared domain-owner section per `CAPABILITY_ID`; cross-capability, cross-surface orchestration lives only in `docs/governance/journeys.md`.

## Current approved Product target

BThwani is one multi-role delivery-commerce network with an admitted merchant-direct web storefront relation on the same canonical Store. It is a directed graph of participant, Store, commerce, fulfillment, financial and bounded collaboration outcomes rather than one global linear lifecycle. The direct Store relation never grants marketplace discovery or any checkout, wallet or delivery entitlement merely through its label. Fulfillment is independently governed per relation/Store through DSH and applicable WLT/Captain gates; neither relation creates a second Store/tenant.

```text
PARTICIPANT ADMISSION ─────────────┐
                                  │
PARTNER / STORE ─→ CATALOG ─→ STORE ORDERABILITY ─→ DISCOVERY / COMMERCE
                                  │                         │
                                  └──────────────→ STORE ORDER
                                                           │
                    ┌──────────────────────────────────────┼──────────────────────────────────────┐
                    │                                      │                                      │
          BTHWANI CAPTAIN DELIVERY               PARTNER CAPTAIN DELIVERY                 CUSTOMER PICKUP
                    │                                      │                                      │
                    └──────────────────────────────────────┴──────────────────────────────────────┘
                                                           │
                                                  OPERATIONAL COMPLETION

FINANCE ───────────────────────────── parallel / cross-owner effects and reconciliation
ORDER COMMUNICATION ───────────────── parallel order-scoped collaboration
ORDER EXCEPTIONS / ADJUSTMENTS ────── branch from the legal operational point
NOTIFICATIONS / TRACKING ───────────── derived projections
OPERATOR ───────────────────────────── authorized participant, never umbrella owner
MULTI-STORE ────────────────────────── orchestration above independent Store Orders
```

Detailed cross-capability surfaces, handoffs, branches and readbacks are owned by `docs/governance/journeys.md` as durable E2E scenario meaning; its contents do not prescribe implementation slices or assert their completion.

The active implementation slice may be narrower. Current approved Governance may intentionally lead implementation progress. Missing admitted breadth is not by itself a defect unless the authorized objective or current delivery gate requires that breadth to be complete.

Implementation must not contradict, silently reinterpret or create a parallel owner for admitted durable meaning.

## Minimum complete and evolvable model

The Product model represents every admitted material user/business truth losslessly without requiring all admitted capabilities to be delivered in the same increment.

A concept is materially required when omitting or collapsing it would lose or blur admitted meaning, ownership, lifecycle, authorization, contract, user/business behavior, commercial truth, failure/recovery or canonical readback, or would force overloaded fields, encoded naming conventions, UI-only semantics, hidden exceptions, duplicate logic or shadow truth.

A concept may remain not-yet-implemented while it is outside the active delivery gate. Future possibility alone still does not justify a concept that is not part of the current approved Product target.

For materially costly-to-reverse identity, relation, state, ownership or public-contract decisions, preserve correct semantics and a defensible migration/extension/cutover path without prebuilding unnecessary implementation machinery.

## Admitted capabilities

- `IDENTITY_ACTIVATION_SESSIONS`
- `EMPLOYEE_HR`
- `PARTNER_ONBOARDING_STORE_PUBLICATION`
- `STORE_RELATION_MODEL`
- `STORE_OPERATIONAL_AVAILABILITY`
- `CENTRAL_CATALOG`
- `SERVICEABILITY_ADDRESSES`
- `CART_CHECKOUT`
- `CUSTOMER_STORE_CATALOG`
- `ORDER_LIFECYCLE`
- `CAPTAIN_DISPATCH`
- `STORE_CAPTAIN_HANDOFF`
- `FINAL_MILE_DELIVERY`
- `ORDER_PAYMENT_COLLECTION`
- `STORE_COMMERCIAL_AGREEMENT`
- `CUSTOMER_BALANCE_FUNDING`
- `CAPTAIN_BALANCE_FUNDING`
- `PARTNER_CAPTAIN_EARNINGS_SETTLEMENT`
- `CUSTOMER_BALANCE_MANUAL_WITHDRAWAL`
- `STORE_CAPTAIN_MEMBERSHIP`
- `STORE_SCOPED_ACCESS_DELEGATION`
- `CUSTOMER_PICKUP`
- `ORDER_CONVERSATION`
- `COMMERCE_PROMOTIONS`
- `DISCOVERY_CONTENT`
- `MULTI_STORE_CHECKOUT`

Each ID has exactly one declared capability section in one routed domain-owner document; these sections are verified against the admitted list.

## Product-wide invariants

BThwani has one canonical Store and commerce engine. The `relationModel` values `BTHWANI_PARTNER` and `INDEPENDENT_STORE` express governed relation variants, not new products or engines. The approved target permits `COMMISSION` or `SUBSCRIPTION` for either Store relation, selected through WLT-owned effective policy and a Store-specific accepted, Finance-approved agreement. Store relation controls eligible discovery and commerce channels, not the financial model. WLT alone owns exact rates, accepted agreements, billing, conservation and settlements. These decisions do **not** assert that recurring subscription billing, independent direct checkout or relation conversion are ready to activate.

Client uses a compact Partner Store view inside the marketplace on Android, iOS and Expo Web; an eligible published Store of either relation can be viewed in a full Store presentation via a direct link within the **same existing Client Expo Web application**. No additional Expo app, domain owner, Store writer or checkout engine exists for the full view.

- the Platform Human Actor/role model is authoritative for participant identity semantics;
- each canonical Store has one effective Store relationship (BTHWANI_PARTNER or INDEPENDENT_STORE) and retains the same Store identity, merchant catalog, published public link and content when its approved relationship changes;
- marketplace discovery and checkout remain exclusive to eligible BTHWANI_PARTNER Stores; a DIRECT Store uses approved direct web publication and checkout through the same canonical DSH Order engine after collection, eligibility, identity and payment safety gates pass;
- one canonical Store Order belongs to exactly one Store, even when created under a parent multi-Store checkout;
- fulfillment mode is operational truth and remains distinct from payment method;
- the admitted fulfillment modes are BThwani Captain delivery, Store-affiliated Partner Captain delivery and Customer Pickup;
- an authorized DSH policy may offer any supported subset of these three modes for either Store relationship, subject to real Captain affiliation, financial terms/collection exposure, publication/readiness and current orderability; choosing a policy never creates a missing capability;
- Partner Captain affiliation never creates a sixth high-level Identity role;
- Store publication, Store operational orderability, Offer availability, geographic serviceability and selected fulfillment-mode availability are distinct truths;
- checkout never silently converts an unavailable fulfillment mode to another mode;
- a confirmed Order preserves its original transaction snapshot; a legal post-confirmation quantity/substitution/removal change is an attributable Order adjustment, never an in-place rewrite of history;
- variable-measure commerce may record an actual fulfilled quantity through the governed Order adjustment boundary when that differs from the confirmed request;
- customer payment allocation is distinct from beneficiary/settlement allocation;
- an external provider wallet or payment rail is never the internal BThwani balance or ledger;
- Store is not a tenant and Partner is not a generic organization/member hierarchy; bounded Store-scoped access delegation is a DSH relationship capability;
- `partner` role means admitted access to the Partner workspace; Store ownership and Store operational authority are separate DSH relationships/scopes;
- a delivery recipient may be different from the purchasing Client without becoming a BThwani Human Actor or gaining Order/payment authority;
- surfaces never become business owners;
- client input never grants identity, role, business scope or owner authority;
- system-owner boundaries follow `docs/governance/architecture.md`;
- derived search/cache/analytics/notification/tracking state never becomes mutation authority;
- successful user-facing mutation requires canonical committed readback;
- admitted breadth and implementation completion are separate claims;
- baseline Store ownership, Identity authorization, marketplace eligibility and safety controls never follow a subscription badge. For either Store relation, an effective WLT-owned subscription tier may govern expressly agreed, genuinely implemented capacity or optional service entitlements, enforced by the relevant canonical operational owner (such as DSH), without granting roles, Store ownership, marketplace publication, checkout readiness or financial privileges. An Operator default is not an active Store agreement; change needs exact consent, effective version and Finance approval. Transaction charges, agreements and provider costs remain governed by their own owners.

## Explicit current non-goals

Not admitted now: loyalty as a standalone Product, a social review/community network, a generic support/ticketing platform, advanced route-optimization Product, generic analytics Product, a standalone notification Product, broad customer-profile/privacy orchestration, generic Partner organization/member/team abstractions beyond bounded Store-scoped access delegation, generic multi-tenant SaaS architecture beyond the admitted bounded independent Store web hosting relation, ERP/POS replacement, speculative multi-currency breadth, scheduled customer orders, generic point-to-point courier requests, generic returns/exchanges, electronics warranty-claim management, prescription-required/specially regulated pharmacy fulfillment, paid customer membership, mandatory Store daily check-in and a predictive/numeric Store-capacity engine.

Prescription-required or specially regulated pharmacy fulfillment remains outside the current target until explicitly admitted with the required legal/operational owner model. Standard pharmacy commerce must not silently claim that regulated workflow.

Transactional notifications may exist as bounded projections of owner facts. Basic order rating/feedback may remain a bounded order fact without becoming a social review capability. Wrong, damaged or missing delivered items may enter a bounded post-order incident/refund path without admitting a generic returns/warranty platform.

## Capability admission law

A new Product capability requires authorized current-program need, stable independent responsibility, canonical owner/writer/readback, affected actors/surfaces, legal mutation/state boundaries, authorization, material failure/recovery semantics and no stronger existing capability that can own it cohesively.

Donor existence, competitor presence, OSS availability or technical possibility alone is insufficient.
