# BThwani Current Product

ARTIFACT_CLASS: DURABLE_PRODUCT_GOVERNANCE
SEMANTIC_OWNER: docs/governance/product/overview.md
EXECUTION_AUTHORITY: NONE
IMPLEMENTATION_STATE_AUTHORITY: NONE

## Purpose

This file owns current Product breadth, non-goals and capability admission law.

The Human Actor/role model is owned by `docs/governance/platform.md`. Bounded system ownership is owned by `docs/governance/architecture.md`. Detailed capability truth lives only in `capabilities/**`; cross-capability, cross-surface orchestration lives only in `docs/governance/product/journeys.md`.

## Current approved Product target

BThwani is one multi-role delivery-commerce network. It is a directed graph of participant, Store, commerce, fulfillment, financial and bounded collaboration outcomes rather than one global linear lifecycle.

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

Detailed cross-capability surfaces, handoffs, branches and readbacks are owned by `docs/governance/product/journeys.md` as durable E2E scenario meaning; its contents do not prescribe implementation slices or assert their completion.

The active implementation slice may be narrower. Current approved Governance may intentionally lead implementation progress. Missing admitted breadth is not by itself a defect unless the authorized objective or current delivery gate requires that breadth to be complete.

Implementation must not contradict, silently reinterpret or create a parallel owner for admitted durable meaning.

## Minimum complete and evolvable model

The Product model represents every admitted material user/business truth losslessly without requiring all admitted capabilities to be delivered in the same increment.

A concept is materially required when omitting or collapsing it would lose or blur admitted meaning, ownership, lifecycle, authorization, contract, user/business behavior, commercial truth, failure/recovery or canonical readback, or would force overloaded fields, encoded naming conventions, UI-only semantics, hidden exceptions, duplicate logic or shadow truth.

A concept may remain not-yet-implemented while it is outside the active delivery gate. Future possibility alone still does not justify a concept that is not part of the current approved Product target.

For materially costly-to-reverse identity, relation, state, ownership or public-contract decisions, preserve correct semantics and a defensible migration/extension/cutover path without prebuilding unnecessary implementation machinery.

## Admitted capabilities

- `IDENTITY_ACTIVATION_SESSIONS`
- `PARTNER_ONBOARDING_STORE_PUBLICATION`
- `STORE_OPERATIONAL_AVAILABILITY`
- `CENTRAL_CATALOG`
- `SERVICEABILITY_ADDRESSES`
- `CART_CHECKOUT`
- `ORDER_LIFECYCLE`
- `CAPTAIN_DISPATCH`
- `STORE_CAPTAIN_HANDOFF`
- `FINAL_MILE_DELIVERY`
- `ORDER_PAYMENT_COLLECTION`
- `STORE_COMMERCIAL_AGREEMENT`
- `CUSTOMER_BALANCE_FUNDING`
- `CAPTAIN_BALANCE_FUNDING`
- `PARTNER_CAPTAIN_FIELD_EARNINGS_SETTLEMENT`
- `CUSTOMER_BALANCE_MANUAL_WITHDRAWAL`
- `STORE_CAPTAIN_MEMBERSHIP`
- `STORE_SCOPED_ACCESS_DELEGATION`
- `CUSTOMER_PICKUP`
- `ORDER_CONVERSATION`
- `COMMERCE_PROMOTIONS`
- `DISCOVERY_CONTENT`
- `MULTI_STORE_CHECKOUT`

Each ID has exactly one capability owner under `capabilities/**`.

## Product-wide invariants

- the Platform Human Actor/role model is authoritative for participant identity semantics;
- one canonical Store Order belongs to exactly one Store, even when created under a parent multi-Store checkout;
- fulfillment mode is operational truth and remains distinct from payment method;
- the admitted fulfillment modes are BThwani Captain delivery, Store-affiliated Partner Captain delivery and Customer Pickup;
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
- admitted breadth and implementation completion are separate claims.

## Explicit current non-goals

Not admitted now: loyalty as a standalone Product, a social review/community network, a generic support/ticketing platform, advanced route-optimization Product, generic analytics Product, a standalone notification Product, broad customer-profile/privacy orchestration, generic Partner organization/member/team abstractions beyond bounded Store-scoped access delegation, generic multi-tenant SaaS architecture, ERP/POS replacement, speculative multi-currency breadth, scheduled customer orders, generic point-to-point courier requests, generic returns/exchanges, electronics warranty-claim management, prescription-required/specially regulated pharmacy fulfillment, paid membership/subscription Product, mandatory Store daily check-in and a predictive/numeric Store-capacity engine.

Prescription-required or specially regulated pharmacy fulfillment remains outside the current target until explicitly admitted with the required legal/operational owner model. Standard pharmacy commerce must not silently claim that regulated workflow.

Transactional notifications may exist as bounded projections of owner facts. Basic order rating/feedback may remain a bounded order fact without becoming a social review capability. Wrong, damaged or missing delivered items may enter a bounded post-order incident/refund path without admitting a generic returns/warranty platform.

## Capability admission law

A new Product capability requires authorized current-program need, stable independent responsibility, canonical owner/writer/readback, affected actors/surfaces, legal mutation/state boundaries, authorization, material failure/recovery semantics and no stronger existing capability that can own it cohesively.

Donor existence, competitor presence, OSS availability or technical possibility alone is insufficient.
