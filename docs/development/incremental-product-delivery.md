# Incremental Product Delivery Strategy

DOCUMENT_CLASS: HUMAN_DEVELOPMENT_GUIDANCE
EXECUTION_AUTHORITY: NONE
PRODUCT_SEMANTIC_AUTHORITY: NONE
CURRENT_STATE_AUTHORITY: NONE

## Purpose

This guide explains the preferred way to grow BThwani from a small, proven multi-surface full-stack core into the complete governed target without big-bang feature delivery.

Durable Product meaning remains in governance/**. The active Product breadth and execution order for a concrete campaign are supplied by the current invocation and controlled by the Orchestrator. This guide never activates a slice by itself.

## Core principle

~~~text
TARGET_PRODUCT_VISION != ACTIVE_PRODUCT_SLICE

SMALL_BREADTH
+ CANONICAL_OWNERS
+ REAL_END_TO_END_RUNTIME
+ LEVEL_4_DEPTH
= VALID_DELIVERY
~~~

Do not create simple_*, *_v1, bootstrap_*, fake business routes/tables, shadow DTOs, temporary state machines, empty feature screens or speculative frameworks to make an early slice easier. Build the final canonical owner/model with only the currently admitted behavior.

## Preferred expansion sequence

The default product-learning sequence is:

1. Identity/access foundation.
2. Journey-ready host/runtime/data/contract/design substrate.
3. Private Partner + Store ownership kernel.
4. Private Catalog + Assortment kernel.
5. Minimum serviceability + first governed publication/discovery.
6. One-store Cart.
7. Minimum customer delivery address + geofence/serviceability.
8. Checkout + Order using only the currently admitted fulfillment/payment combination.
9. Partner fulfillment.
10. Minimum captain operational/financial readiness required by the active delivery path.
11. Manual BThwani captain assignment using the same canonical assignment model later automation will consume.
12. Minimum governed custody handoff.
13. Delivery completion and any financial finalization already created by that delivery.
14. Cumulative core fixed point.

This is a recommended learning/dependency order, not a standing authorization to execute the next item.

## Initial breadth discipline

For the first commerce/delivery fixed point, prefer one legal path rather than activating every target variant simultaneously. When consistent with current Governance and invocation, the narrow path is:

~~~text
fulfillment_mode = bthwani_delivery
payment_method   = COD
assignment       = manual operator assignment
handoff          = minimum governed dual custody confirmation
~~~

The canonical models must remain future-compatible, but inactive future values/features are not exposed in contracts/UI as if implemented.

## Core fixed-point proof

Before broad feature expansion, prove at least the materially applicable invariants across the same candidate:

~~~text
Identity isolation
Partner/Store isolation
Catalog ownership
Publication/serviceability authority
Server-authoritative pricing
Address ownership/geofence resolution
Cart idempotency
Checkout/Order idempotency
Order state legality
No DSH financial mirror
WLT conservation for any real financial effect
Assignment uniqueness
Custody semantics
Delivery persistence
Cross-surface canonical readback
Restart persistence
Negative authorization
No fake business truth
No frontend business authority
No duplicate SSOT
Runtime E2E
Cumulative regression
~~~

## Deferred expansion

After the core fixed point, activate additional breadth as independent vertical increments only when explicitly authorized. A practical progression is:

1. client_pickup.
2. partner_delivery.
3. broader WLT/payment/refund/settlement/payout behavior.
4. in-app notifications, then push/deep links/preferences as needed.
5. support/ticketing and later richer messaging.
6. automated dispatch, capacity, proximity/location and reassignment sophistication.
7. partner teams/fleet and richer onboarding/readiness.
8. app-field business journeys.
9. promotions/coupons/ratings/loyalty/search sophistication.
10. advanced operator approvals/control-plane/analytics capabilities.

Each increment must reuse canonical owners and survive cumulative regression; it must not fork an alternate model.

## app-field disposition

app-field is a target deployable surface, but its business features are not a prerequisite for the first customer→partner→captain delivery fixed point unless the active onboarding/readiness policy explicitly requires field evidence.

Before its Product wave, it may remain host-ready only:

~~~text
identity/session
bootstrap
runtime configuration
neutral authenticated shell
production-like build proof
~~~

Do not create placeholder Field workflows simply to populate the app.

## Feature-admission test

Before activating a new feature/mode, ask:

1. Is it required by the current Product slice?
2. Does it create a new owner/state machine/provider/security/financial consequence?
3. Can the current fixed point be proven without it?
4. Will adding it now make failure attribution materially harder?
5. Is its canonical owner/model already clear enough to add without a temporary workaround?

If it is not required and increases independent state/failure breadth, defer it.

## Relationship to OSS and donor material

For each active increment, consult only the donor/OSS evidence cone capable of changing its semantics, owner, edge cases, failure/recovery behavior, UX or tests. Extract applicable truth; do not import donor topology or activate adjacent features merely because a reference product contains them.
