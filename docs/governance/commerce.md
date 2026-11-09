# Commerce, Checkout and Orders

ARTIFACT_CLASS: DURABLE_GOVERNANCE
SEMANTIC_OWNER: docs/governance/commerce.md
EXECUTION_AUTHORITY: NONE
IMPLEMENTATION_STATE_AUTHORITY: NONE

## SERVICEABILITY_ADDRESSES — Serviceability and Addresses

CAPABILITY_ID: SERVICEABILITY_ADDRESSES

### Outcome

A client can maintain an owned delivery address and receive one canonical DSH serviceability decision for a target customer-visible Store on the current BThwani delivery path.

### Ownership

DSH owns delivery-address operational truth, Store delivery-origin operational location truth, canonical Service City operational truth, and serviceability policy/evaluation result. Map/geocoding/routing providers are technical adapters for physical delivery and are not serviceability authorities.

### Admitted policy: CITY_SCOPE_V2_RADIUS_30KM

The admitted serviceability policy is:

- `POLICY_VERSION = CITY_SCOPE_V2_RADIUS_30KM`
- `MEASUREMENT`: matching canonical Service City plus straight-line distance between the Store delivery origin and the owned Client delivery address
- `BOUNDARY`: both locations in the same active Service City and at most 30,000 metres apart
- `COMPARISON`: inclusive maximum of 30 kilometres; invalid or missing coordinates fail closed
- WLT delivery quotes enforce the same maximum independently; a quote beyond this limit must not produce an arbitrary long-distance charge.

Canonical evaluation inputs for `CITY_SCOPE_V2_RADIUS_30KM` are:

- target canonical customer-visible Store and its assigned Service City (`Store.service_city_id`);
- owned client delivery address and its assigned Service City (`DeliveryAddress.service_city_id`);
- canonical active Service City state;
- canonical Store origin and Address coordinates;
- immutable `CITY_SCOPE_V2_RADIUS_30KM` policy identity and version.

Canonical decision semantics:

- `SERVICEABLE`: Store and owned Address reference the same active canonical Service City, and the target Store satisfies customer-visible eligibility and the 30 km radius;
- `UNSERVICEABLE`: Store and owned Address are active but in different Cities or exceed the accepted operating radius;
- `UNAVAILABLE`: required City assignment missing, required City inactive or unknown, legacy unassigned state, target Store not customer-visible, or required canonical dependency unavailable.

Store origin and DeliveryAddress coordinates are evaluated server-side only. Straight-line distance is a conservative operating limit, not a road distance or travel-time promise. Expanding service radius requires a new explicitly governed policy, not merely extending delivery-price bands.

### Invariants

- client input supplies address/location intent and discovery preferences, never authoritative serviceability;
- an address belongs to exactly one authorized client, derived from the verified client session;
- serviceability is Store-scoped, evaluated by DSH server-side from canonical Store and Address records;
- client activeServiceCityId is local client discovery preference only and is never serviceability authority;
- Store publication/customer visibility remains the `PARTNER_TO_VISIBLE_STORE` outcome; serviceability readiness is a prerequisite for `SINGLE_STORE_ORDER_CREATION` and does not redefine publication;
- the canonical result exposes sufficient Store, Address, and Service City version evidence for later Cart freshness validation without exposing raw coordinates;
- no alternate fulfillment lane can be selected through address/serviceability input;
- exact location is purpose-limited operational data and must be minimized.

### Location Core and Service City relationship

LOCATION CORE:

- owned client delivery address with exact coordinates and text;
- Store delivery origin with exact coordinates;
- canonical persistence, ownership, and readback for delivery execution.

SERVICE CITY SCOPE:

- DSH owns canonical Service City identity and lifecycle (active/inactive);
- Store belongs to exactly one canonical Service City;
- DeliveryAddress belongs to exactly one canonical Service City;
- `CITY_SCOPE_V2_RADIUS_30KM` evaluates same-city identity and a bounded origin-to-address radius.

### Failure and recovery

Missing City assignment, inactive City, unserviceable address, stale evidence, or DSH offline state fail truthfully and distinguish `UNSERVICEABLE` from `UNAVAILABLE`. Recovery occurs by rereading or re-evaluating canonical owner state. A successful user-facing result requires canonical committed readback.

## CART_CHECKOUT — Cart and Checkout

CAPABILITY_ID: CART_CHECKOUT

### Outcome

A Client builds one owned Store cart and confirms one Store-scoped checkout intent from canonical Catalog, Store, current orderability and serviceability evidence without client-authoritative eligibility or duplicate operational/financial effects.

### Ownership

DSH owns cart/checkout operational truth and the bounded delivery-recipient snapshot carried into the resulting Store Order. Catalog, Store publication, `STORE_OPERATIONAL_AVAILABILITY` and serviceability owners provide canonical evidence. WLT owns admitted financial intent/allocation. Multi-Store composition belongs to `MULTI_STORE_CHECKOUT`.

### Invariants

- one logical cart is scoped to authenticated Client and Store;
- each CartLine identifies one canonical StoreOffer and ProductVariant plus exact requested quantity and selected modifier option IDs;
- item identity, availability and commercial evidence come from canonical DSH owners;
- mutation is versioned/idempotent and one retry identity cannot represent a different payload;
- checkout carries an explicit fulfillment intent independent from payment method;
- checkout revalidates current Store operational orderability and selected fulfillment-mode availability immediately before confirmation; a published Store or enabled mode policy alone is insufficient;
- an unavailable selected mode is rejected with explicit readback and is never silently replaced by another mode;
- checkout establishes one stable logical operation identity before cross-owner financial effects; an ambiguous commit/retry cannot silently allocate another logical Order identity;
- confirmed checkout snapshots address/serviceability, Store/mode orderability evidence, item/variant/quantity/pricing/modifier evidence and other transaction facts required by `ORDER_LIFECYCLE`;
- a delivery recipient may be `SELF` or `OTHER`; when `OTHER`, only bounded recipient name/phone/delivery instructions needed for execution are snapshotted, while the purchasing Client remains Order/payment principal;
- recipient data never creates an actor, account, role or financial authority;
- stale or invalidated evidence blocks confirmation;
- client-supplied totals, Product/Variant/Offer facts, eligibility, Store scope, quantity validity, inventory, serviceability, operational availability, fulfillment authority or financial result are not authoritative.

### Financial boundary

DSH derives authoritative commercial basis from owner facts and asks WLT to establish applicable payment/collection intent through `ORDER_PAYMENT_COLLECTION`. Customer payment allocation and later settlement allocation remain separate. External-provider funding becomes checkout-usable only after `CUSTOMER_BALANCE_FUNDING` has produced canonical WLT internal balance.

### Failure and recovery

Stale cart, unavailable/unpublished Offer, invalid modifier/quantity, closed/paused Store, unavailable selected mode, unserviceable address, invalid recipient data, financial refusal, conflict, offline state and ambiguous cross-owner outcome recover through canonical reread/reconciliation. No success is reported before committed owner readback.

### Material participants

Client ordering experience, Partner new-Order readback and DSH/WLT owner runtimes are material consumers. Deployable host names and repository paths remain implementation truth.

## MULTI_STORE_CHECKOUT — Multi-Store Checkout

CAPABILITY_ID: MULTI_STORE_CHECKOUT

### Outcome

One customer checkout container may coordinate purchases from multiple Stores while creating independent canonical Store Orders and preserving per-Store fulfillment, financial and exception isolation.

### Ownership

DSH owns parent checkout composition and child Store Order relations. Each child Order remains owned by `ORDER_LIFECYCLE`; WLT owns per-child financial allocation/effects. Grouped pickup/delivery planning, when admitted by actual volume, remains DSH operational truth.

### Invariants

- one child Store Order belongs to one Store;
- parent checkout never becomes a multi-Store Order writer that erases child autonomy;
- child fulfillment modes may differ where Product rules permit;
- financial allocation/effects are traceable per child;
- partial failure/cancellation/refund is explicit and idempotently reconciled;
- parent cannot appear fully complete while an accepted child or associated financial effect remains unresolved;
- grouped delivery/pickup optimization may coordinate children but cannot merge their ownership or settlement truth.
- grouped planning is bounded operational coordination; advanced route-optimization is not admitted by this capability.

### Failure and recovery

Partial child creation, financial refusal, Store rejection, mixed fulfillment failure, grouped-delivery failure and retry ambiguity reconcile per child and at parent readback without duplicate Orders or money movement.

## ORDER_LIFECYCLE — Order Lifecycle

CAPABILITY_ID: ORDER_LIFECYCLE

### Outcome

One eligible confirmed Store-scoped checkout creates at most one canonical DSH Store Order, preserving original purchased evidence, explicit fulfillment meaning, attributable legal post-confirmation adjustments and legal operational transitions through completion/exception.

### Ownership

DSH owns operational Order truth, original confirmation snapshot, OrderAdjustment history, cancellation/failure/dispute operational state and final fulfilled snapshot. WLT owns every financial effect, including adjustment deltas/refunds/reconciliation. Mode-specific execution is owned by the applicable fulfillment capability.

### Invariants

- one canonical Store-scoped checkout operation yields at most one Store Order;
- one Store Order belongs to exactly one Store;
- a parent Multi-Store checkout never collapses multiple Stores into one Store Order;
- the durable Order model distinguishes `BTHWANI_CAPTAIN`, `PARTNER_CAPTAIN` and `CUSTOMER_PICKUP`; fulfillment mode is distinct from payment method;
- the Client selects one fulfillment mode from current canonical eligible modes; checkout rejects disabled/unavailable mode and snapshots the selection without fallback;
- when adding a fulfillment mode, any required backfill must preserve existing Order identities and explicit historical mode meaning; never silently reinterpret past Orders to introduce another mode;
- required StoreOffer/ProductVariant/display-name/variant/modifier/requested-quantity/pricing/amount/serviceability and other purchase evidence remains the original confirmation snapshot;
- a legal post-confirmation change never mutates that original snapshot in place; it creates an attributable OrderAdjustment and contributes to a separate final fulfilled snapshot;
- an OrderAdjustment may cover bounded item removal, eligible substitution or actual fulfilled quantity/measure where current catalog quantity semantics permit it;
- a required customer decision is explicit when the adjustment materially changes what the customer will receive/pay; Partner cannot self-approve a customer-required substitute merely by continuing preparation;
- unresolved mandatory adjustment blocks readiness/completion until it reaches a legal outcome or the Order enters the appropriate exception/cancellation path;
- WLT alone owns resulting financial delta and, where a paid customer is owed money, the default credit to that Customer Wallet exactly once; DSH never infers ledger completion from operational adjustment state;
- before collection, cancel or correct only the unpaid obligation; after collection, keep any unverified amount explicitly pending rather than issuing a speculative credit;
- no independent routine refund ticket/journey is required; rare external exceptions remain authorized Operations/Finance work;
- a delivery recipient snapshot may differ from the purchasing Client, but it has no Order/payment authority;
- Partner acts only on Orders for an authorized owned/granted Store scope;
- Partner acceptance, rejection, preparation and readiness are canonical DSH transitions;
- cancellation/failure/refund eligibility derives from explicit canonical state, custody, adjustment and policy rather than UI inference;
- after delivery/pickup, wrong/damaged/missing-item review may open a bounded post-completion incident/refund branch without reopening or rewriting the completed Order;
- generic returns/exchanges/warranty management is not admitted by this capability;
- basic rating/feedback may attach to a completed Order as bounded feedback and remains independent from conversation closure;
- canonical readback is required after mutation.

### Order adjustment boundary

```text
PARTNER reports item unavailable / quantity difference
→ DSH validates canonical OrderLine + allowed action
→ remove OR propose eligible substitute OR record actual quantity
→ CLIENT decision when required
→ DSH appends immutable attributable adjustment
→ WLT applies/reconciles financial effect
→ DSH exposes final fulfilled snapshot
```

Retry of the same logical adjustment cannot create another adjustment/effect. A replacement remains a canonical referenced item/variant where required; free-text substitution is not transaction authority.

### Lifecycle boundary

The Partner preparation path is common until fulfillment readiness. Downstream state is mode-specific: platform Captain dispatch, Store-affiliated Captain fulfillment or Customer Pickup. Delivery/pickup completion and governed failures remain explicit. Conversation is parallel to this lifecycle and cannot mutate Order/payment/custody truth.

### Failure and recovery

Handle duplicate creation, stale version, unauthorized Store scope, rejection, cancellation, preparation conflict, item unavailable, adjustment timeout/rejection/conflict, concurrent cancellation, fulfillment failure, custody mismatch, post-completion dispute, retry conflict and restart/resume without forking Order truth. Cross-owner financial consequences reconcile through WLT rather than being inferred from DSH state alone.

## ORDER_CONVERSATION — Order Conversation

CAPABILITY_ID: ORDER_CONVERSATION

### Outcome

Authorized participants exchange bounded Order-scoped operational messages without creating a general social/chat system or parallel Order truth.

### Ownership

DSH owns conversation membership, message identity/content relation, read state, lifecycle and moderation/visibility rules. Media/notification providers are technical adapters only.

### Invariants

- conversation is bound to one canonical Store Order;
- participants derive from current authorized Order/Store/Captain/customer relations; the captain joins only during an active assignment, not via public self-registration;
- senders select one or more operational recipients; DSH filters message reads and read receipts to only the sender, selected recipients and authorized operations;
- authorized operations can review every Order message without opening a separate chat, while their composer is explicitly opt-in and requires operations permission;
- an Order message, media item or support escalation cannot perform payment, payout, refund, settlement or custody state changes;
- text is the baseline message type; each message may attach one image (JPEG/PNG/WebP, at most 3 MiB), one voice recording (admitted MP4/M4A/3GPP/AAC/WebM, at most 1.5 MiB), or one operational video (MP4/WebM, at most 6 MiB), with declared type checked against the actual content; video remains Order-scoped private media subject to the same authorization, idempotency and lifecycle restrictions as other attachments;
- message attachments are stored as private DSH data, without public object URLs; every retrieval checks the same order, current participant and per-message recipients; operations require explicit authorization;
- a message and its attachment are inserted atomically, and retries preserve the original idempotency key, media content and recipients;
- recording or playback requiring a new native mobile module is activated only on a compatible Android/iOS development build, without blocking text and photo chat on older builds;
- messages cannot mutate Order/payment/custody truth;
- notification delivery is a projection of message/owner events, not message authority;
- when the Order reaches DELIVERED, PICKED_UP, REJECTED or CANCELLED, DSH immediately prevents any new message; prior committed idempotent messages may be replayed without a fresh write; the recorded conversation remains readable to authorized actors;
- rating submission does not control conversation closure;
- deletion/redaction, where legally admitted, preserves required audit meaning.

### Failure and recovery

Offline send, duplicate retry, attachment failure, participant-role change, unread/read retry and notification-delivery failure preserve one DSH message/read-state truth.

## COMMERCE_PROMOTIONS — Commerce Promotions

CAPABILITY_ID: COMMERCE_PROMOTIONS

### Outcome

Authorized platform or Partner Store promotions change customer commercial eligibility through one DSH rule truth while funded financial effects remain explicit WLT truth.

### Ownership

DSH owns promotion identity, author, eligibility, Store/catalog scope, lifecycle, limits, redemption and application to commerce. WLT owns discount funding, subsidy, merchant economic effects and reconciliation. Operator may author platform campaigns. An authorized Partner owner or Store-scoped delegate may author Store promotions only for Stores DSH authorizes.

### Current admitted forms

- Product or StoreOffer discount;
- bounded product-group/category discount;
- Store/order-threshold discount;
- coupon/code;
- platform campaign with Partner opt-in where required.

The initial Product does not imply loyalty, points, membership, generic marketing automation, AI targeting, dynamic pricing or a broad segmentation system.

### Scope and lifecycle

A promotion may target one Store, selected authorized Stores or all Stores authorized to the acting Partner. Multi-Store authoring is a convenience command; canonical promotion scope remains explicit per Store and never widens authorization.

Durable meaning distinguishes draft/not-yet-effective, scheduled or active, and ended/cancelled states. Exact executable names belong to implementation. Time windows and usage limits are server-evaluated.

### Funding

Every funded discount records an explicit funding source/allocation: `PARTNER`, `BTHWANI` or `SHARED`. `SHARED` records the exact allocation. DSH evaluates commerce eligibility; WLT owns the monetary funding/subsidy and settlement consequence. Client input never chooses funding source.

### Invariants

- a promotion never rewrites base Catalog/Product/Variant/StoreOffer identity or base price merely to represent a temporary discount;
- eligibility and redemption are server-owned, versioned, concurrency-safe and idempotent;
- Partner promotion authority is Store-scoped and follows `STORE_SCOPED_ACCESS_DELEGATION`;
- platform campaigns may define eligibility and may require explicit Partner opt-in;
- stacking is denied by default unless an explicit versioned rule allows it;
- customer discount and funding source are distinct facts;
- checkout revalidates promotion eligibility server-side;
- each applicable Order freezes the exact promotion/version, Store scope, discount amount and funding allocation required for reconciliation;
- later StoreOffer price changes or promotion edits never reinterpret a committed Order;
- cancellation/customer-wallet compensation uses frozen transaction evidence rather than current promotion state; WLT reconciles Store and campaign funding without duplicating discount value.

### Customer readback

Customer surfaces may show effective price, discount label, campaign and coupon result needed for the buying decision. They do not expose Partner accounting, WLT internals or subsidy topology.

### Failure and recovery

Expired/ineligible code, exhausted usage, invalid Store/catalog scope, unauthorized Partner staff, stale version, concurrent redemption, funding refusal, missing campaign opt-in, cancellation/refund and unknown financial effect fail closed or remain explicit and reconcile without duplicate discount.

### Proof boundary

Proof covers every admitted form, Store and multi-Store scope, owner/delegate authorization, platform campaign opt-in, each funding source, invalid/expired/exhausted states, duplicate/concurrent redemption, base-price preservation, immutable Order funding snapshot and WLT-backed settlement effects.

## DISCOVERY_CONTENT — Discovery Content

CAPABILITY_ID: DISCOVERY_CONTENT

### Outcome

Banners, carousels, short-form media and other admitted discovery content are published through one DSH-owned eligibility/publication model that can route customers to canonical commerce destinations without becoming an app-local content truth.

### Ownership

DSH owns content identity, placement/eligibility, target relation, publication lifecycle and canonical readback. Media adapters own binary storage/delivery mechanics only.

### Invariants

- content targets canonical Store/Catalog/promotion destinations or explicit bounded informational targets;
- discovery content may target admitted canonical `STORE`, `PRODUCT`, `CATEGORY` or `PROMOTION` destinations as appropriate to its kind; DSH validates relation and scope;
- Partner-sourced `SHORT_FORM` and in-Store image `BANNER` specifically target a `STORE`, `PRODUCT` or `PROMOTION` belonging to the authorized source Store; `CATEGORY` is not an admitted Partner-owned destination;
- customer visibility requires the applicable review/approval and publication transition;
- an authenticated Partner with the Store-scoped `promotions` grant may submit a `SHORT_FORM` or image `BANNER` draft only with `source_store_id` bound to the authorized Store and an eligible destination belonging to it; the Operator retains publication authority;
- the platform-wide homepage banner is authored/published by Marketing Operators and excludes Partner-sourced Store media; the customer Store banner reads only the authorized Store’s published, approved, within-window images and never fills empty slots with ordinary products;
- the same DSH Discovery Content publication engine may serve Operator-approved independent Store-owned image banners only on the legally published independent Store website. Publication requires its own reviewed Store/legal/policy facts and a self-Store destination, never a marketplace publication flag, homepage inclusion, short-form distribution, or a merchant-controlled approval shortcut; withdrawing that public Store makes its banners unavailable at read time;
- the Partner may hide or restore its own approved Store banner independently of Operator publication, but cannot publish an unapproved draft or override an Operator pause; independent Partner display state and version are owned by DSH;
- SHORT_FORM MP4 media is bounded to 10 MiB input and 30 seconds, normalized to mobile-friendly H.264/AAC and accompanied by an immutable JPEG poster in the existing DSH media owner;
- normalization failures block publication, and cleanup removes both the normalized video and derived poster;
- app-local hard-coded content is not publication authority;
- media provider identity is replaceable without redefining content identity;
- publication/expiry/scope are explicit and server-owned;
- promotional financial effect remains with `COMMERCE_PROMOTIONS`/WLT rather than content itself;
- autoplay/media behavior must preserve accessibility, bandwidth and platform constraints through Experience policy.

### Failure and recovery

Missing media, expired target, invalid scope, provider failure and stale publication recover without exposing unavailable commerce actions as valid.
