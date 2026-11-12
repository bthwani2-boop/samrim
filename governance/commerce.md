# BThwani — Serviceability, Checkout, Orders and Discovery

ARTIFACT_CLASS: DOMAIN_GOVERNANCE_DRAFT
SEMANTIC_OWNER: governance/commerce.md
STATUS: DRAFT_PENDING_FULL_GOVERNANCE_CUTOVER
IMPLEMENTATION_STATE_AUTHORITY: NONE

## Common invariants
DSH is the **one** owner of cart, quote, checkout, Order, price and adjustment truth for Marketplace and Direct. Each confirmed Store Order has one Store ID, frozen authoritative price/units/tax-if-applicable/policy/agreement/fulfillment/payment allocation snapshot. WLT handles payment authorization, holds, ledger and settlement; Identity handles actor/authorization. Direct Web checkout (guest or authenticated as explicitly approved) reuses DSH Order engine and may not spawn a second direct-orders table or cart state machine.

## SERVICEABILITY_ADDRESSES — Service cities and destination eligibility
CAPABILITY_ID: SERVICEABILITY_ADDRESSES

DSH owns canonical service-city approval, location coordinates/address accuracy, address scope, distance/effective serviceability and route eligibility. Address/recipient PII is minimized, scoped and never exposed to candidate Captains before lawful assignment. The donor CITY_SCOPE_V2_RADIUS_30KM semantics require compatibility review against actual owner policy before encoding numbers in new SQL; no hardcoded UI city bypass. A geolocation fix or client map position is not proof of serviceable Order delivery. Re-evaluate location/selected fulfillment at confirmation with versioned owner decisions.

## CART_CHECKOUT — Single-Store Cart and canonical confirmation
CAPABILITY_ID: CART_CHECKOUT

A user can compose a Store cart, receive one short-lived server quote, and confirm only if current Store publication, owner, price, stock, quantity, consent, serviceability, selected fulfillment and payment all remain eligible. UI totals are advisory; DSH authoritatively prices from StoreOffer and WLT authorizes funds. Confirmations have bounded idempotency, unknown-result reconciliation and no duplicate Orders or charges. Cancellation/refund eligibility is a versioned policy and original Order fact; legal changes post confirmation use DSH adjustments and WLT effects, never overwrite the initial snapshot.

## MULTI_STORE_CHECKOUT — Orchestration without merged Store truth
CAPABILITY_ID: MULTI_STORE_CHECKOUT

A multi-Store shopping intent may coordinate multiple independent Store Orders under one orchestrated customer experience. Each Store retains its own Store Order, pricing, inventory, fulfillment, merchant permission and settlement liability. Failure in one child has explicit cancellation/compensation/partial-result semantics; a parent does not become a separate legal Order writer or conceal mixed financial results. No client-provided combined total overrides Store-level quotes.

## ORDER_LIFECYCLE — Durable state and lawful exceptions
CAPABILITY_ID: ORDER_LIFECYCLE

DSH owns Order states, Store acceptance, preparation, dispatch/pickup, finalization, cancellation, adjustments and bounded incident/refund requests. State transition validates actor and Store relationship, exact Order version, publication/fulfillment eligibility and concurrency; a retry does not repeat side effects. Actual fulfilled quantity, substitution or removal after confirmation is an attributable adjustment + WLT delta, not a silent mutation of the legal Order. Operations intervention must be bounded and auditable, not a separate Order workflow.

## ORDER_CONVERSATION — Order-scoped communication
CAPABILITY_ID: ORDER_CONVERSATION

Participants may communicate via admitted messages and private video/audio evidence only within the Order-scoped, role-appropriate access window. DSH owns message/attachment association, moderation/legal retention and read rights; media transport/storage is technical. A Captain not yet assigned, unrelated Store or revoked actor must not receive customer phone/address or private media. Stale notification links cannot create unauthorized access.

## COMMERCE_PROMOTIONS — One promotional price/eligibility truth
CAPABILITY_ID: COMMERCE_PROMOTIONS

Approved campaigns, discounts and sponsored discovery may affect presentation and customer price only through their canonical DSH eligibility and WLT funding/settlement contracts. A price promotion has scope, dates, funding source, usage limits and an auditable snapshot; stacking conflicts and races fail safely. Do not invent a second Offer/Order price calculator in promotions, Operator UI, video feed or Direct Store Web. Unknown funding does not silently become platform liability.

## DISCOVERY_CONTENT — Governed content-to-Store journeys
CAPABILITY_ID: DISCOVERY_CONTENT

Merchant/operator banners, short-form media, categories and applicable discovery surfaces route customers to valid Store/Offer targets only after approval, relevance and visibility checks. Media creation, upload, processing, safe publication, moderation, takedown and attribution are bounded DSH/content facts. Videos are not a generic social platform. A stale or removed promotional link must degrade safely without bypassing Store ownership or stock/checkout gating.

## Contract, permission and failure proof
All seven capabilities require real Store-scoped owner checks, two-actor isolation, versioned policies and confirmation at DSH + WLT handoff as affected. Test stale quote, price/stock change, offline retries, payment unknown, Order state races, duplicate idempotency, private address leak, cross-Store media/cursor, multi-Store partial failure and actual canonical state. Successful page rendering/HTTP 200 alone is insufficient.
