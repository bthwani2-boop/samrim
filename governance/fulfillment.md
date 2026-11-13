# BThwani — One Delivery Engine, Policy-Controlled Modes

ARTIFACT_CLASS: DOMAIN_GOVERNANCE_DRAFT
SEMANTIC_OWNER: governance/fulfillment.md
STATUS: DRAFT_PENDING_FULL_GOVERNANCE_CUTOVER
IMPLEMENTATION_STATE_AUTHORITY: NONE

## Mode policy and ownership
DSH owns the **one** Order fulfillment and dispatch engine. Supported modes are `BTHWANI_CAPTAIN` («توصيل بثواني»), `PARTNER_CAPTAIN` («توصيل المتجر») and `CUSTOMER_PICKUP` («استلام من المتجر»). The old internal `PARTNER_CAPTAIN` identifier may be migrated to a cleaner code only as part of a verified contract/SQL cutover, not as a fourth method.

One Operator Policies surface defines the **permitted subsets** for either `MARKETPLACE` or `DIRECT` Store relation through DSH-backed versioned policy. Durable per-Store mode admission may be narrower and requires a compatible WLT accepted financial agreement and any Captain/Store membership, legal collection and actual operational capability. Temporary Store pause is another DSH fact and cannot add modes.

Historic code that hard-blocks platform Captains on DIRECT stores is migration evidence, not a permanent Product rule. **Do not remove its protection until** platform dispatch, payment/cash custody, Order path, permission and settlement are ready for that exact admitted combination.

## STORE_CAPTAIN_MEMBERSHIP — Store-affiliated Captain
CAPABILITY_ID: STORE_CAPTAIN_MEMBERSHIP

A Store owner may register/approve an eligible already-authenticated Captain for one or more specific Store affiliations, subject to verified role/permissions and the accepted operating relationship. Membership does not create a new Identity high-level role, operator authority or platform-dispatch standing. DSH alone writes membership and revocation; unrelated Stores cannot see or alter it. A revoked Captain cannot receive new Store missions, and running commitments must be reconciled explicitly.

## CAPTAIN_DISPATCH — Platform Captain offers and assignment
CAPABILITY_ID: CAPTAIN_DISPATCH

An eligible ready Store Order may receive at most the **effective DSH policy maximum for concurrent platform dispatch offers** (historical initial setting: three) when `BTHWANI_CAPTAIN` is selected, with at most **one active winning assignment**. DSH verifies the Captain's availability, standing, serviceability and version at transactional acceptance; later concurrent accepts lose safely. Failed dispatch and reconnection do not duplicate assignments or create false delivery success.

WLT owns the Captain's verified COD exposure/hold, not DSH. Assignment may not reveal the customer's private address to a non-winning Captain. Location opportunities remain bounded, current and privacy-safe, not open tracking data. Operator visibility/reassignment invokes DSH controls rather than updating another assignment table.

## STORE_CAPTAIN_HANDOFF — Valid Store-to-Captain transfer
CAPABILITY_ID: STORE_CAPTAIN_HANDOFF

DSH records the bounded Store handoff for the **actual assigned authorized Captain** and matching Order; evidence of pickup, item count or OTP, where admitted, belongs to that transaction and cannot be fabricated by client local state. A Store-affiliated Captain is not a platform Captain, and no cash obligation transfers implicitly across handoff. Retried or delayed scans/handoffs reconcile to one state with evidence and appropriate failure recovery.

## FINAL_MILE_DELIVERY — Tracked completion
CAPABILITY_ID: FINAL_MILE_DELIVERY

DSH owns the valid Order/assignment lifecycle, actual delivery-contact snapshot, authorized location updates when needed, bounded ETA, and verified completion. Location/recipient information is scoped to the authorized delivery participant and duration; stale sessions do not reveal it. Completion requires the admitted proof/acknowledgment and routes any lawful post-confirmation financial adjustment through WLT. A delayed or repeated completion never posts a second COD debit, fee or earnings entry.

## CUSTOMER_PICKUP — Merchant-verified handoff to Customer
CAPABILITY_ID: CUSTOMER_PICKUP

Pickup is another mode of the **same** DSH Store Order, not a second order engine. The Store/Customer confirmation, readiness and pickup proof must be bound to the same Store/Order/authorized customer context. No Captain dispatch or Captain wallet custody is invented for pickup. WLT still applies agreed fees, eligible payment collection, refund/reconciliation and any outstanding commercial obligations.

## Admission, operational policy and failure cases
- At registration and any durable mode update, DSH evaluates the permitted relation policy, Store rights, actual mode readiness and WLT terms; fail closed on unavailable owner readback.
- At Order confirmation and assignment, DSH revalidates selected method, publication, geographic/service city reachability, Store availability, inventory and actor/scope. Client may never force another mode via a parameter or silently substitute a mode.
- A policy revision affects future *eligible* offers/Orders at its effective time. Existing confirmed Orders retain their method, pricing and liability snapshots and use explicit adjustments for lawful exceptions.
- An Operator toggle is not authority to grant a new Captain role, provision payments or change ownership of customer cash. Use an owner API for current eligibility, not a hardcoded client or unrelated configuration store.
- Prove `MARKETPLACE` and `DIRECT` permutations separately with valid and invalid mode, paused Store, unavailable Captain, competing accept, customer privacy, offline retry, cancellation, COD/Mixed funding and Store pickup, with a real DSH/WLT readback.

## Captain invitation, location privacy and actual mission proof

An authorized Store owner may invite a person to a Store-Captain membership by name/phone only through the Identity/DSH owner boundaries. When an actor exists, **reuse the actor**; when new, require the Captain's own identity/phone proof and invitation acceptance in the Captain app. The invited person cannot be silently admitted to the public platform dispatch pool, and an unsafe or suspended global Captain cannot bypass standing safety checks merely by accepting Store affiliation.

For platform dispatch, keep **at most one latest permitted availability fix** per Captain rather than a movement trail. A fix older than the **effective owner-backed freshness policy** (historical initial setting: 15 minutes) is not eligible for dispatch or aggregation; opportunity-map aggregation rejects stale samples and must never present customer destination coordinates before a winning assignment. Demand and supply density are privacy-safe aggregated coarse circles, not an individual Captain live-location directory. The original reviewed display intent includes a bounded demand window (historical initial setting: **30 minutes**) and freshness checks; exact retention and display thresholds must be validated against privacy rules at implementation, not treated as permission to store route history.

Only the **currently assigned, authenticated** platform Captain's active mission may expose its **single latest** accurate mission fix to Operations staff explicitly authorized for that active Order; the Customer, Merchant, other Captains and public opportunity maps cannot read that fix or a movement trail. Customer/Merchant Order progress is a DSH lifecycle projection, **not** a live Captain GPS feed. Mission location never becomes a generic journey-party entitlement. Out-of-order, inaccurate, stale, future or third-party updates must fail; a mission completion/revocation/timeout ends location access and retention under the owner policy. Android foreground GPS, user-authorized background mission location where approved, permissions and OS toggles are separate; the app must not silently toggle device OS location services.

The Captain's live app shell must retain efficient access to map opportunities, Deliveries, Wallet and Account without a second assignment page or misleading offer overlay. An offer has its own expiry, is suppressed while an already assigned mission is active, and cannot be accepted after the backend state is unknown. These UX constraints remain part of the affected Captain journey's real device tests, not mere mock layouts.

## Operator-managed dispatch and location thresholds

The previous **three concurrent dispatch offers**, **15-minute** latest-location freshness threshold, **30-minute** aggregate opportunity window, eligible dispatch radius, acceptance timeout, mission escalation threshold, Store preparation estimate, assignment capacity and other **operationally adjustable quantities** are *initial donor reference settings*, not immutable branching or mobile-client constants. DSH owns their permitted ranges, scope, effective versions, location-privacy bounds and current readback; authorized changes occur in the single Operator Policies UI.

The safety invariants remain fixed: at most **one winner per Store Order**, current assignment and valid actor/Store permission, no customer location/address exposure before lawful assignment, no unbounded historical Captain movement trail, no bypass of verified WLT COD coverage and no silent duplicate dispatch on retries. No policy slider may weaken these constraints or create an unimplemented dispatch algorithm.

A proposed wider location age/radius or offer capacity must satisfy bounded privacy, performance and operational acceptance; the Operator receives an explicit unavailable reason when the capability or current resources do not support the proposed value. A changed policy affects only future eligible dispatch attempts and does not silently rewrite a mission already accepted.
