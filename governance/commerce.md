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

## Effective serviceability policy inherited for continuity

Branch-41 approved donor semantics include `CITY_SCOPE_V2_RADIUS_30KM`: Store and **owned** Customer DeliveryAddress must resolve to the **same active canonical Service City**, and their authoritative coordinates must be within the **current versioned DSH service-radius policy** (historical initial setting: a **30,000-metre inclusive straight-line radius**). Bad/unknown coordinates, inactive/unassigned city or absent owner readback fail closed. WLT's admitted delivery quote must reject the same out-of-scope movement; a longer-distance fee tier is not an authorization to bypass the delivery boundary.

Treat 30 km as the reviewed **initial effective business policy**, not an immutable number scattered throughout client or SQL. Changing a supported radius later occurs via a versioned, owner-controlled scoped policy in Operator Policies with DSH and WLT compatible readback and explicit operational/legal admissibility. Client city filters are presentation preferences only; they cannot influence the server's canonical Store/Address city determination. Straight-line reachability is not a road travel-time guarantee. Confirm the effective policy and price **again** at Order acceptance so an old map preview or alternate app route cannot bypass it.

## Cancellation and compensation ownership

One DSH-owned versioned cancellation policy applies to the relevant Store Type and is snapped onto the Order at creation. The permitted options include `OPERATIONS_ONLY` and `CLIENT_BEFORE_ACCEPTANCE`. Customer-initiated cancellation is permitted only while the persisted Order policy and actual Store/dispatch stage allow it; an authorized Operator can handle bounded exceptions with reason and attribution. Each child Store Order in a multi-Store checkout receives its own cancellation decision.

Pre-collection release of a WLT hold is **not** an extra credit. For already collected payments, compensation/refund requires evidence of entitlement, a balanced WLT posting, correct funding source and idempotent replay. The narrow donor-approved platform-funded compensation for a confirmed collected, customer-approved full-item removal from a completed Order, with **no promotion or discount**, must be separately checked and capped to the original line amount. All other ambiguous refund situations remain open for authorized WLT/DSH reconciliation rather than guessing a customer credit or silently reducing Store earnings.

## Promotion funding and discovery-media safety

The presently admitted promotion forms are StoreOffer/Product discounts, bounded category/product-group discounts, Store/Order threshold discounts, coupon codes, and authorized platform campaigns that may require individual Merchant opt-in. Funding is explicitly `PARTNER` (merchant), `BTHWANI` (platform) or `SHARED` with exact split; DSH owns eligibility/redemption and WLT owns **who economically funds** the discount. Stacking is forbidden unless an explicit effective policy allows it. Redemption has time/use limits, conflict/replay safety and an immutable Order-side funding/version snapshot; an edited campaign never retroactively rewrites base StoreOffer prices or earnings.

Discovery content targets valid DSH Store, Product, Category or Promotion references only as authorized for its author. A Merchant-authored short video or image banner is limited to its **own Store / Product / Promotion**, not an arbitrary global Category; the Operator retains publication approval. Homepage platform banners and Merchant Store banners have distinct authorization/placement policies but a **single DSH content publication owner**. A DIRECT Store banner may appear on its legal public Store page without entering marketplace discovery or copying the homepage writer. Merchant hide/restore of an already approved Store banner does not grant the right to publish an unapproved draft.

The currently bounded short-form source requires at most **10 MiB and 30 seconds**, valid normalized mobile-oriented H.264/AAC media and a generated immutable JPEG poster. Failed processing must not publish the content, and approved takedown/cleanup reconciles video and poster references safely under retention. These values are owner-controlled media policy, not extra client upload authority. Category labels or media previews never become replacement Store/Offer/Order eligibility engines.

## Operator-managed commercial thresholds — explicit policy, not compiled law

The historical **30 km** service radius is the initial effective DSH value for an eligible active Service City; it is not a constant in SQL/client/code. An authorized Operator can set a supported radius per admitted city or relation where actually needed. DSH owns eligibility at checkout/Order confirmation; WLT pricing/quote must use the same effective validated policy version. A changed radius cannot activate an unapproved city, allow unknown coordinates or retroactively modify accepted Orders.

DSH owns configurable **delivery distance bands, fees, additional distance charges, active Order limits, preparation/ETA escalation thresholds, cancellation windows, quantities, promotion validity/redemption and compensation eligibility/ceilings** according to the individual proper owner and verified capabilities. Amounts actually owed, refunded, settled or billed remain WLT-owned; a DSH pricing policy may produce a quoted charge but cannot post a WLT ledger credit itself.

Do not interpret the historic 30 km, a cancellation option, delivery fee, short-form media limit or promotion threshold as a **hardcoded immutable Product law**. The Operator Policies UX may change approved values with validation, bounded scope, version, effective date, preview and durable readback. An implementation must not silently accept a change to the underlying data without actual service/application support. Changing a supported rule requires no code deployment; adding a *new kind of operation* still requires implementation and security/financial admission. Unapproved old Orders retain their frozen commercial terms.
