# Commerce Promotions

ARTIFACT_CLASS: DURABLE_PRODUCT_CAPABILITY_GOVERNANCE
SEMANTIC_OWNER: docs/governance/product/capabilities/commerce/commerce-promotions.md
EXECUTION_AUTHORITY: NONE
IMPLEMENTATION_STATE_AUTHORITY: NONE
CAPABILITY_ID: COMMERCE_PROMOTIONS

## Outcome

Authorized platform or Partner Store promotions change customer commercial eligibility through one DSH rule truth while funded financial effects remain explicit WLT truth.

## Ownership

DSH owns promotion identity, author, eligibility, Store/catalog scope, lifecycle, limits, redemption and application to commerce. WLT owns discount funding, subsidy, merchant economic effects and reconciliation. Operator may author platform campaigns. An authorized Partner owner or Store-scoped delegate may author Store promotions only for Stores DSH authorizes.

## Current admitted forms

- Product or StoreOffer discount;
- bounded product-group/category discount;
- Store/order-threshold discount;
- coupon/code;
- platform campaign with Partner opt-in where required.

The initial Product does not imply loyalty, points, membership, generic marketing automation, AI targeting, dynamic pricing or a broad segmentation system.

## Scope and lifecycle

A promotion may target one Store, selected authorized Stores or all Stores authorized to the acting Partner. Multi-Store authoring is a convenience command; canonical promotion scope remains explicit per Store and never widens authorization.

Durable meaning distinguishes draft/not-yet-effective, scheduled or active, and ended/cancelled states. Exact executable names belong to implementation. Time windows and usage limits are server-evaluated.

## Funding

Every funded discount records an explicit funding source/allocation: `PARTNER`, `BTHWANI` or `SHARED`. `SHARED` records the exact allocation. DSH evaluates commerce eligibility; WLT owns the monetary funding/subsidy and settlement consequence. Client input never chooses funding source.

## Invariants

- a promotion never rewrites base Catalog/Product/Variant/StoreOffer identity or base price merely to represent a temporary discount;
- eligibility and redemption are server-owned, versioned, concurrency-safe and idempotent;
- Partner promotion authority is Store-scoped and follows `STORE_SCOPED_ACCESS_DELEGATION`;
- platform campaigns may define eligibility and may require explicit Partner opt-in;
- stacking is denied by default unless an explicit versioned rule allows it;
- customer discount and funding source are distinct facts;
- checkout revalidates promotion eligibility server-side;
- each applicable Order freezes the exact promotion/version, Store scope, discount amount and funding allocation required for reconciliation;
- later StoreOffer price changes or promotion edits never reinterpret a committed Order;
- cancellation/refund uses frozen transaction evidence rather than current promotion state.

## Customer readback

Customer surfaces may show effective price, discount label, campaign and coupon result needed for the buying decision. They do not expose Partner accounting, WLT internals or subsidy topology.

## Failure and recovery

Expired/ineligible code, exhausted usage, invalid Store/catalog scope, unauthorized Partner staff, stale version, concurrent redemption, funding refusal, missing campaign opt-in, cancellation/refund and unknown financial effect fail closed or remain explicit and reconcile without duplicate discount.

## Proof boundary

Proof covers every admitted form, Store and multi-Store scope, owner/delegate authorization, platform campaign opt-in, each funding source, invalid/expired/exhausted states, duplicate/concurrent redemption, base-price preservation, immutable Order funding snapshot and WLT-backed settlement effects.
