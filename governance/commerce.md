# BThwani — Serviceability, Checkout, Orders and Discovery

ARTIFACT_CLASS: DOMAIN_GOVERNANCE_DRAFT
SEMANTIC_OWNER: governance/commerce.md
STATUS: ACTIVE_FOR_PROGRESSIVE_DEVELOPMENT
IMPLEMENTATION_STATE_AUTHORITY: NONE

## Common invariants

DSH owns cart, quote, checkout, Order, authoritative commercial price and adjustment for both sales channels. Identity verifies the actor; WLT alone authorizes funding and posts financial effects. One confirmed Store Order has one Store, immutable channel and chosen fulfillment mode, with frozen Offer/Variant/quantity/modifier, payer/recipient, price/tax where applicable, operational/financial policy and agreement evidence. A public Direct page is not payment authority or a second Order engine. Current protected checkout requires authenticated purchasing Customer; any future guest checkout requires explicit Product, Identity, DSH and WLT admission and proof, never an implied permission.

## SERVICEABILITY_ADDRESSES — Service cities and destination eligibility
CAPABILITY_ID: SERVICEABILITY_ADDRESSES

DSH owns Store origin, owned DeliveryAddress, canonical Service City identity/lifecycle and serviceability. Map/geocoder/router supplies technical inputs, never business eligibility. Each admitted Store and Address has one canonical city. A verified Customer owns the Address; caller actor ID and browsing activeServiceCityId are not authority.

Evaluate current customer-visible Store, its actual city/origin, owned Address city/coordinates, active cities and effective versioned radius. Historical admitted CITY_SCOPE_V2_RADIUS_30KM is a 30,000-metre inclusive straight-line bound, not travel-time or road-distance guarantee. Distinguish:
- SERVICEABLE: valid same active city, eligible Store and within effective radius.
- UNSERVICEABLE: otherwise valid active known cities differ or distance exceeds radius.
- UNAVAILABLE: missing/legacy unassigned, inactive/unknown city, invalid coordinates, unpublished/ineligible Store or missing required canonical dependency/evidence.

Return Store/Address/City and policy-version freshness evidence without leaking coordinates across actors. WLT quote independently rejects the same out-of-scope movement; price tiers cannot extend eligibility. Re-evaluate current owner facts at quote/confirmation; no cached map, local preference, alternative mode or HTTP response alone proves success. DSH owns supported scoped radius policy and WLT consumes compatible effective version. Historical value is not a hardcoded client/SQL constant. Changes apply prospectively and cannot admit inactive cities or unknown coordinates.

## CART_CHECKOUT — Single-Store Cart and canonical confirmation
CAPABILITY_ID: CART_CHECKOUT

One logical cart per verified purchasing Customer and Store across entry surfaces. CartLine binds canonical StoreOffer, sellable Variant, exact quantity and selected modifier-option IDs, not free text or client totals. Explicit DIRECT/MARKETPLACE sales channel must satisfy [Store law](stores.md) at quote and confirmation; missing/unknown/prohibited channels fail closed. Historical Orders without verified channel evidence are not relabeled.

Issue a bounded short-lived owner quote; immediately before confirmation revalidate Store publication/ownership, availability, selected admitted mode, Offer/Variant/quantity/modifiers, price/promotion, stock, serviceability, consent and financial policy/agreement/payment eligibility. Client totals are advisory. No silent fulfillment substitution. Establish stable logical checkout/Order operation identity with immutable payload binding before any WLT effect; changed channel/cart/recipient/mode under that identity conflicts. WLT authorizes actual allocation, holds and subsequent effects; external funding usable only after verified internal posting. Never confuse Customer allocation with beneficiary settlement.

Recipient purpose SELF or OTHER; for OTHER freeze only name, reachable phone and instructions necessary for lawful execution. Purchaser remains Order/payment principal; recipient gains no Identity, wallet, refund or cancellation authority. Destination/recipient PII is revealed only to the permitted participant at the lawful stage, never prospect Captains or unrelated Stores. No unnecessary delivery address for pickup.

Confirm once with canonical snapshot and durable DSH/WLT readback. Unknown cross-owner outcomes reconcile by original identity before reporting success or retrying a financial effect. Failed technical checkout rollback is not commercial cancellation.

## MULTI_STORE_CHECKOUT — Orchestration without merged Store truth
CAPABILITY_ID: MULTI_STORE_CHECKOUT

DSH parent checkout represents composition and status; no second legal Order/settlement writer. Every independent child retains Store, quote, inventory, fulfillment, authority, financial effect identity, custody, exception/cancellation/refund and settlement liability. Combined client total never overrides child quotes. Parent cannot report COMPLETED while any required child/effect is pending or unknown. Explicitly expose partial results, compensate or cancel each child lawfully and reconcile original identities before retry. Grouped pickups/deliveries retain individual custody/liability, not speculative route optimization.

## ORDER_LIFECYCLE — Durable state and lawful exceptions
CAPABILITY_ID: ORDER_LIFECYCLE

DSH owns acceptance, preparation, dispatch/pickup, finalization, cancellation, incident/refund requests and adjustments with current actor/Store authority, applicable readiness, expected Order version and concurrency-safe operation identity. Confirmed snapshot is distinct from later fulfilled snapshot and append-only attributable adjustment history. Actual quantity/substitution/removal requires lawful DSH adjustment, customer consent when required and WLT delta; unresolved required consent blocks the affected readiness/terminal transition. Merchant cannot approve on Customer's behalf.

One explicitly chosen BTHWANI_CAPTAIN, PARTNER_CAPTAIN or CUSTOMER_PICKUP is frozen; no silent mode substitution or historical backfill without proof. DELIVERED, PICKED_UP, REJECTED and CANCELLED remain distinct terminal facts, not generic completed/payment status. Disputes or failed fulfillment create bounded exceptions without rewriting a historical terminal Order into a new sale, cash collection or successful refund. See [fulfillment](fulfillment.md).

### Cancellation and compensation ownership

DSH snapshots versioned Store Type cancellation policy at creation (OPERATIONS_ONLY or CLIENT_BEFORE_ACCEPTANCE). Customer can cancel only while the persisted rule and actual stage permit, before acceptance/dispatch when applicable. Authorized Operations handles bounded exceptions with reason/attribution; each multi-Store child has its own decision. WLT alone determines payment release, collected liability and exact refund/compensation entitlement. Pre-collection hold release is not extra credit. Apply [financial refund law](finance.md#refunds-and-compensation) for the narrow admitted platform-funded compensation and every actual posting; DSH closes only after required readback. Unknown funding/collection or other ambiguous refund remains explicit reconciliation.

### Order-scoped contact and operational exceptions

Early-Customer telephone verification is a DSH Order-scoped Operations process, not a global trust authority, CRM, onboarding role, mandatory preparation prerequisite or payment override. Record factual attempts with current operations permission, short versioned claim, expiry and idempotency. Count distinct Orders only with actual spoken CONFIRMED contact and independently verified completed delivery/pickup; pending/no-answer/denied/invalid/abandoned never count. Do not retrospectively recall Customers with sufficiently proven prior completions or infer a public negative trust label. Historical initial settings: first three Orders, ten-minute claim; DSH owns count, lease, attempt limit, timing and enabled scope. Changes never relabel an old contact. Blocking preparation pending contact needs explicit separate Product admission and actual DSH/WLT payment-state proof.

DSH owns one bounded active exception per Order and reason, current case owner, urgency, next action and append-only attributable event. Existing authorized Order detail/Operations views consume paginated scoped records. Notes cannot overwrite Order or WLT balance. PAYMENT_EXCEPTION and DELIVERY_BLOCKED close only with actual relevant financial acknowledgment, delivery proof or resolved obligations. Deduplicated attention may arise from proven early-stage stagnation, unavailable dispatch, failed delivery or actual no-answer events. Historical noncontractual references: ~30-minute early review, ~5-minute no-offer, two no-answer events, ~30-minute unclaimed escalation. Absent stage event/approved SLA is UNKNOWN. Pin approved stage target at actual stage start; new policy cannot retroactively change its deadline. Only eligible unclaimed automated early-stage attention may auto-close on forward progress; claimed cases and unresolved financial/custody disputes never silently close. Concurrent detectors converge. Journeys FIRST_THREE_ORDER_CONTACT, ORDER_SCOPED_OPERATIONS_EXCEPTION and ORDER_ADJUSTMENT_EXCEPTION_REFUND own cross-surface proof, not a second writer.

## ORDER_CONVERSATION — Order-scoped communication
CAPABILITY_ID: ORDER_CONVERSATION

DSH owns one Store Order message/attachment association, moderation, lawful retention and scoped access. Current purchasing Customer, authorized Store workers, currently assigned Captain and appropriately scoped Operations define membership. Sender-selected recipients bound visibility/read receipts to sender, designated recipients and authorized Operations, not every past participant. Operations composition requires explicit current operations permission. No prospect Captain, unrelated Store, revoked actor or stale notification link grants private contact/media access.

Commit message and private attachment reference atomically under the same idempotency identity. Terminal DELIVERED, PICKED_UP, REJECTED or CANCELLED rejects new sends while retaining authorized reads and committed replay; feedback cannot reopen chat. Historical initial per-message attachment choices: one image JPEG/PNG/WebP up to 3 MiB, one voice MP4/M4A/3GPP/AAC/WebM up to 1.5 MiB, or one operational video MP4/WebM up to 6 MiB. Validate actual bytes and effective owner-approved limits; no public URL, MIME spoof, upload or forwarded link bypass. Native recording/retention follows actual owner/platform gates; text remains usable without new media module. Chat never changes custody, Order or payment.

## COMMERCE_PROMOTIONS — One promotional price/eligibility truth
CAPABILITY_ID: COMMERCE_PROMOTIONS

Admitted forms: Offer/Product discounts, bounded category/group discounts, Store/Order threshold discounts, coupons and authorized platform campaigns. Merchant owner or current delegate may author only granted Stores, including multi-Store UX with explicit per-Store scopes. Platform campaigns may require individual Merchant opt-in; display is not consent. DSH owns eligibility, authoritative price and redemption; WLT owns economic funding. No duplicate price calculator. Draft, scheduled/active and ended/cancelled remain distinct. Server time, usage counters and replay are concurrency-safe. Stacking forbidden absent explicit effective policy.

Funding is PARTNER (merchant), BTHWANI or SHARED with exact split and immutable Order version/snapshot. Unknown/expired/exhausted/refused outcomes fail closed and reconcile with WLT. Customer receives effective discount/coupon evidence, not private subsidy allocation, accounting or WLT internals. No retrospective rewrite of base Offer price, confirmed Order, original funding or earnings.

## DISCOVERY_CONTENT — Governed content-to-Store journeys
CAPABILITY_ID: DISCOVERY_CONTENT

One DSH content owner governs draft, processing, moderation, approval, publication, attribution and takedown. Valid target types STORE, PRODUCT, CATEGORY or PROMOTION depend on author rights; Merchant with current Store promotions grant may draft SHORT_FORM or image BANNER for its own source_store_id and own STORE/PRODUCT/PROMOTION, not CATEGORY. Operator retains publication authority. Homepage platform banners are Marketing Operator-controlled; Store banners are that Store's approved in-window images, never unrelated ordinary products as empty-slot fallback. DIRECT banners on lawful public page do not grant marketplace/home/short-form publication. Merchant hide/restore of approved banner is display choice, not new publication or override of Operator pause.

Short-form uses the bounded media limits in [catalog](catalog.md#owner-backed-limits), validated normalized mobile H.264/AAC and immutable generated JPEG poster. Failed normalization/target visibility never publishes; takedown/cleanup reconciles video/poster and retention. No social platform or alternate publication/checkout authority. Stale/removed links degrade safely; category labels, previews and videos never grant eligibility.

## Operator-managed commercial thresholds — explicit policy, not compiled law

Through one owner-backed Policies UX, DSH owns supported radius/price quote, delivery distance bands and charges, active Order limits, preparation/ETA escalation, cancellation, quantities, promotion/redemption and operational compensation eligibility. WLT owns actual financial rates/distributions, monetary ceilings, obligations, billing/refunds/settlement and postings. DSH quote uses compatible WLT financial terms; it cannot mint ledger credit. Scope, version, effective time, validation, preview and readback follow [architecture](architecture.md#safe-change-protocol). Supported rule changes need no code deployment; new capability requires real implementation/admission. No historical number is immutable merely by being in a donor source, and no slider may bypass security, custody or ledger invariants.

## Commercial measurement and campaign effectiveness

Distinct successful zero search results, query failure, unknown serviceability, unavailable catalog and missing observation. Keep city/channel/filter scope and eligible catalog basis. Interest, views, clicks, favorites and cart changes are not fulfilled demand. Funnel metrics specify cohort/window, distinct units, denominators and missing observations. Confirmation, acceptance, preparation, assignment, delivery/pickup and cancellation derive from respective owner facts; do not double-count parent/children, retries or failures.

Campaign metrics distinguish eligibility, exposure, interaction, redemption, confirmation, fulfillment and reversal. Attribution is not causal uplift. Before increasing exposure verify WLT funding/budget/usage, current Store/Offer eligibility and actual capacity. Recommendations cannot activate discounts or reserve money. Actionable anomalies use existing exceptions/readiness, with reason, source, scope, next action and owner-backed resolution; reopen invalidated evidence. Apply [measurement law](architecture.md#measurement-integrity-and-intelligence-admission) and [financial reporting](finance.md#order-economics-and-financial-measurement).

## Acceptance

For all seven capabilities prove actual owner contracts, two-actor/Store isolation, channel/mode denial, versioned city/radius and quote freshness, changed price/stock, once-only checkout, offline/unknown payment, races, partial child failure, custody and adjustments, private address/media/cursor, contact/exception and promotion funding/expiry, terminal message rejection and applicable rendered Web/Android. Canonical DSH/WLT state and current Identity permission are required; no source-only, UI or HTTP success establishes completed behavior.
