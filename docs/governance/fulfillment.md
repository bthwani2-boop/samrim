# Fulfillment and Delivery

ARTIFACT_CLASS: DURABLE_GOVERNANCE
SEMANTIC_OWNER: docs/governance/fulfillment.md
EXECUTION_AUTHORITY: NONE
IMPLEMENTATION_STATE_AUTHORITY: NONE

## STORE_CAPTAIN_MEMBERSHIP — Store Captain Membership

CAPABILITY_ID: STORE_CAPTAIN_MEMBERSHIP

### Outcome

A Store may establish an accepted Store-scoped affiliation with a canonical Captain actor so eligible Partner-Captain fulfillment can occur without inventing another Identity role.

### Ownership

DSH owns invitation/membership/affiliation, Store scope, acceptance, eligibility, suspension/removal and operational readback. Identity owns the canonical Human Actor and standing `captain` role. WLT retains only the Order payment/Partner commission financial authority that applies to `PARTNER_CAPTAIN`; Store-Captain internal remuneration is a Store responsibility outside WLT.

### Minimal lifecycle

```text
PARTNER STORE OWNER
→ invite canonical eligible Captain
→ CAPTAIN reads invitation
→ accept OR decline
→ DSH activates membership only after acceptance
→ Partner may suspend/remove when authorized
→ Captain may leave when current policy permits
```

### Invariants

- Partner Captain is not a separate Identity role;
- Partner cannot create or grant the `captain` role;
- invitation/membership references one canonical Captain actor and one Store;
- delegated membership authority is inactive until the Captain accepts;
- one Captain actor may hold multiple accepted Store relationships;
- Store owner authorization cannot grant or mutate Identity role by request input;
- membership eligibility is distinct from platform Captain availability/pool state;
- suspension/removal/leave stops future eligibility without rewriting historical fulfillment records;
- `ORDER_PAYMENT_COLLECTION`/WLT continues to govern applicable customer collection and Partner commission consequences of Partner-Captain Orders;
- Store-Captain remuneration and Store-side cash handoff do not reuse BThwani-Captain earning, wallet, COD exposure or remittance semantics.

### Failure and recovery

Unknown Captain identity, Captain without standing eligibility, declined/expired invitation, unauthorized Store scope, duplicate invitation/membership, stale accept/suspend/restore/remove and conflicting fulfillment eligibility converge on one DSH relationship truth. Retry cannot auto-accept on behalf of the Captain or create a duplicate membership.


### Store owner-created Captains — approved 2026-10-21

An authorized Store owner creates or reuses the Captain's canonical Identity account by name and phone and creates an inactive invitation addressed to that exact actor. The invited Captain proves phone possession, activates their account and accepts their Store membership in the Captain app. A different Captain must not see or accept the invitation. The owner's display label is not an independently verified legal name.

A Store-targeted, accepted Captain need not also join the platform's general dispatch pool, and membership must never make the Captain eligible for public-pool orders. Suspension blocks new Store offers without rewriting existing custody. Existing unsafe/suspended general admission must not be bypassed. Legacy code invitations remain temporarily supported solely for compatibility.

## CAPTAIN_DISPATCH — Captain Dispatch

CAPABILITY_ID: CAPTAIN_DISPATCH

### Outcome

A ready `BTHWANI_CAPTAIN` Store Order may receive up to three concurrent DSH dispatch offers to eligible Captains, but at most one active assignment. The first valid, transactionally committed acceptance wins; all other open offers are superseded with capacity and financial exposure reconciled. Partner Captain dispatch remains separately governed.

### Ownership

DSH owns Captain standing operational eligibility/availability, dispatch offer, assignment and reassignment truth. WLT owns COD exposure/hold and other financial effects.

### Admission boundary

Both Store relationships may offer any supported subset of `BTHWANI_CAPTAIN`, `PARTNER_CAPTAIN` and `CUSTOMER_PICKUP` through one versioned DSH policy, not separate delivery engines. Mode activation must check real Store permission/publication/orderability, Identity Captain standing or Store affiliation, WLT agreement, cash collection, risk/exposure and fulfillment readiness. An ordinary Store employee is not automatically a Captain. Show «توصيل بثواني»، «توصيل المتجر» and «استلام من المتجر» in Arabic; an unimplemented or unready method cannot be enabled through an Operator toggle.


DSH establishes standing Captain operational eligibility before authorized Identity role admission. A transient delivery assignment is not standing role admission.

Store-affiliated Partner Captain eligibility belongs to `STORE_CAPTAIN_MEMBERSHIP` and does not silently place that relationship into the platform Captain dispatch pool.

### Invariants

- only a ready `BTHWANI_CAPTAIN` order is platform-dispatchable;
- the Captain app has four primary tabs: Home, Deliveries, Wallet and Account. Deliveries reuses the canonical current-assignment screen at `/deliveries`, accessible in one tap without a duplicate Order/dispatch engine. Home is a full-height map that displays privacy-safe opportunity circles while idle and the canonical Store/Customer destination during an assigned mission; delivery actions remain on that Deliveries tab. Incoming offers are short non-modal floating cards on Home, never a full-screen interruption of active navigation; offers expire when not accepted and are suppressed while a mission is active or its state cannot be verified. An availability Switch writes through to DSH, and a separate device GPS status Switch reflects Android permissions/services. GPS activation requests OS permission/service enablement; deactivation opens OS location settings (no simulated silent OS toggle). Disabling GPS while available requires stopping dispatch availability first;
- ranking nearby available Captains may use an authorized, recent foreground GPS fix kept only as their latest dispatch presence; it never authorizes Client live tracking, delivery movement logs, or publication of Captains' positions in opportunity maps;
- an **active BTHWANI_CAPTAIN mission** may publish only the most recent authenticated Captain location for authorized Operations staff supervising that exact active order. This mission fix is separate from dispatch presence; it is not Customer/Merchant tracking and it must not flow to opportunity heatmaps, notifications or movement-history logs. The Captain sees that mission location is shared with Operations while active;
- DSH accepts mission fixes only from the bearer-authenticated assigned Captain, with fresh event times, monotonic sequences and bounded accuracy. It stores no route trail, hides stale or lost fixes and hides location immediately when assignment is no longer active; the periodic retention worker physically purges old and terminal mission fixes;
- Android mission location uses foreground fixes without extra consent. An active platform Captain may explicitly opt in to background location from the mission header; native Expo TaskManager then requires Android background-location permission and a visible location foreground-service notification. The app validates current Identity, assignment ownership and platform fulfillment before each latest-only fix and stops the task on mission completion or sign-out. No location trail or Client tracking is retained. Native build, device-lock and network-disconnect evidence is required before operationally declaring background delivery tracking reliable; Expo Go and JavaScript-only tests are insufficient. Android may stop location after the app is terminated, so Operations displays STALE/LOST instead of fictitious movement;

- DSH retains at most one foreground dispatch fix per available Captain. A fix older than 15 minutes is ineligible for dispatch and map aggregation and is physically purged by DSH's retention worker, run at startup and every minute (normal deletion lag up to one minute). Going offline, suspension or winning an assignment clears it immediately. Exact fixes are accessible only to the authorized Captain's own submission path and internal DSH dispatch ranking; the Captain map and authorized Operator map receive only thresholded coarse cells. No Customer, Merchant or other Captain can read another Captain's exact dispatch fix;
- both Captain and Operator opportunity maps reject aggregate samples more than 3 minutes old or over 1 minute in the future and remove circles on any refresh failure; an empty privacy-safe result never implies zero demand;
- an outstanding offer reserves availability but does not erase fresh dispatch presence needed for immediate redistribution after rejection or expiry; the assigned winner's dispatch presence is cleared, and explicit offline/suspension also clears it;
- pre-acceptance offer details disclose only the coarse service-city delivery area, never the Customer's full address or destination coordinates; only the assigned Captain may read the precise delivery task;
- the Captain home and Operator Operations map overlay geographic circles for recent 30-minute platform delivery demand (orange) and available Captains' coarse density (teal) together by default without layer-selection tabs; the Captain presence input is only the latest authorized dispatch fix, not routes. Require a minimum safe number of independent Stores/orders or Captains before publishing any cell; never expose individual Captain coordinates, Customer delivery destinations, raw counts, live offers or guaranteed assignments;
- one platform-dispatch batch creates no more than three concurrent offers to distinct eligible available Captains;
- only an eligible available Captain with required financial exposure capacity may accept an applicable COD offer;
- one order has at most one active assignment, regardless of competing acceptances;
- successful assignment supersedes all losing open offers and restores their available capacity and financial holds through their owning services;
- capacity, eligibility and financial authorization are owner-backed and enforced under concurrency;
- only the authenticated offered Captain may accept/reject the live offer;
- expiry and rejection are durable decisions;
- reassignment before pickup is canonical and must reconcile any prior financial hold; after custody begins, ordinary reassignment is forbidden;
- no surface computes final dispatch authority.

### Failure and recovery

No eligible Captain, insufficient governed exposure, timeout, decline, stale offer, concurrent assignment, financial-hold failure, reassignment conflict and offline state preserve one assignment truth. Unknown cross-owner effects reconcile before another assignment/hold creates duplicate liability.

## STORE_CAPTAIN_HANDOFF — Store to Captain Handoff

CAPABILITY_ID: STORE_CAPTAIN_HANDOFF

### Outcome

For a Captain-delivered Store Order, custody transfers from the owning Store to the legally assigned/eligible canonical Captain exactly once through one DSH-owned handoff truth.

### Ownership

DSH owns custody/handoff and operational exception truth. Platform assignment eligibility comes from `CAPTAIN_DISPATCH`; Store-affiliated Captain eligibility comes from `STORE_CAPTAIN_MEMBERSHIP`. Financial consequences belong to WLT.

### Invariants

- handoff is bound to current Order, Store, fulfillment mode and canonical Captain actor;
- only authorized owning-Store Partner scope confirms the Store side;
- only the legally assigned/eligible Captain completes Captain-side pickup;
- pickup cannot complete before required confirmation;
- one executable custody transfer exists per current fulfillment assignment;
- replacement before custody supersedes obsolete handoff attempts and reconciles affected financial holds;
- a blocking mismatch/shortage prevents pickup until canonically resolved;
- retries are idempotent and materially different payload cannot reuse one operation identity;
- no surface keeps independent custody truth.

### Failure and recovery

Stale assignment/membership, wrong Store/Captain, duplicate attempt, retry conflict, mismatch/shortage, financial-hold mismatch and offline state recover from canonical DSH/WLT readback.

## FINAL_MILE_DELIVERY — Final Mile Delivery

CAPABILITY_ID: FINAL_MILE_DELIVERY

### Outcome

After governed Store-to-Captain custody transfer, the canonical Captain completes one Captain-delivered Store Order to one terminal DSH result with consistent participant readback and bounded delivery evidence.

### Ownership

DSH owns operational delivery lifecycle/result, bounded tracking projection, Order recipient-contact use, delivery-evidence relationship/validation and physical cash possession/collection/handoff facts where applicable. WLT owns canonical payment collection truth, COD receivable/exposure, earnings, remittance and other financial effects. Customer Pickup is a separate fulfillment capability.

### Invariants

- delivery begins only after canonical Captain pickup/custody;
- only the canonical current Captain may advance active delivery;
- terminal completion is recorded once and cannot be duplicated by retry;
- delivery proof and payment collection are distinct owner-backed facts even when one user action triggers both;
- proof may use a bounded policy-approved mechanism such as PIN, QR, signature or media evidence; no uploaded file or UI success indicator is by itself delivery truth;
- DSH validates proof/evidence against canonical Order/assignment/custody context before terminal transition;
- the purchasing Client remains Order/payment principal even when the delivery recipient is `OTHER`;
- Captain receives only the bounded recipient contact/instructions needed for current delivery and that data grants no account/financial authority;
- failed/blocked attempt remains explicit canonical state until legal recovery;
- a recoverable failure preserves physical-custody responsibility until governed recovery/return/custody transition resolves it;
- Client/Partner/Operator order progress is a DSH lifecycle-state projection, not a live GPS feed;
- Captain foreground GPS supports nearest-available dispatch; the Captain may navigate locally to Store pickup and the authorized Customer address;
- DSH does not expose Captain coordinates or movement to the Client, and does not accept per-assignment location updates; current dispatch presence is not a movement-history feed;
- restart/retry use canonical readback rather than local state.

### Failure and recovery

Connectivity loss, stale version, duplicate submission, invalid proof, unavailable recipient/customer, payment-collection uncertainty, failed delivery and governed return-to-Store preserve one canonical operational state and safe reconciliation/resume path. WLT effects must not be treated as atomically committed merely because DSH completion was attempted.

## CUSTOMER_PICKUP — Customer Pickup

CAPABILITY_ID: CUSTOMER_PICKUP

### Outcome

A `CUSTOMER_PICKUP` Store Order reaches governed Store pickup readiness and is released to the authorized customer exactly once with canonical proof/readback and no Captain assignment.

### Ownership

DSH owns pickup eligibility, readiness, proof and operational completion. WLT owns applicable payment/refund effects.

### Invariants

- pickup is explicit Order fulfillment mode;
- no Captain assignment/handoff/cash-custody fact is invented for pickup;
- delivery-address fields that are not meaningful to pickup cannot be required merely because another fulfillment mode uses them;
- Store confirms readiness before customer pickup completion;
- pickup proof is bounded to the Order and cannot be replayed for another Order;
- customer payment method remains a separate decision.

### Failure and recovery

Customer no-show, stale readiness, duplicate proof, wrong customer, cancellation and payment/refund uncertainty remain explicit and reconcile through canonical owners.
