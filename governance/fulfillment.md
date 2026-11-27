# BThwani — One Delivery Engine, Policy-Controlled Modes

ARTIFACT_CLASS: DOMAIN_GOVERNANCE_DRAFT
SEMANTIC_OWNER: governance/fulfillment.md
STATUS: ACTIVE_FOR_PROGRESSIVE_DEVELOPMENT
IMPLEMENTATION_STATE_AUTHORITY: NONE

## Mode policy and ownership

DSH owns one Order fulfillment and dispatch engine. Supported identifiers are BTHWANI_CAPTAIN («توصيل بثواني»), PARTNER_CAPTAIN («توصيل المتجر») and CUSTOMER_PICKUP («استلام من المتجر»). A cleaner legacy PARTNER_CAPTAIN code requires a verified contract/SQL cutover, not an additional method.

The single Operator Policies surface exposes DSH versioned permitted mode subsets per MARKETPLACE/DIRECT relation. Per-Store admission may be narrower: require Store rights, actual capability, compatible accepted WLT agreement, applicable Captain membership, legal collection and current operational eligibility. Temporary pause cannot add modes. Historical hard-blocking of platform Captains for DIRECT is migration evidence, not a permanent Product prohibition; preserve its protection until the exact combination has proven dispatch, checkout, cash custody, permissions and settlement.

At registration and durable mode change, validate relation policy and owner readiness; unavailable owner readback fails closed. At Order confirmation and assignment, revalidate method, publication, service-city reachability, Store availability, inventory, actor and scope. No caller-forced substitution, hardcoded client fallback or independent settings writer. Effective policy changes apply only to future eligible offers/Orders; confirmed method, price and liability snapshots remain intact except explicit lawful adjustments. Follow [architecture](architecture.md#safe-change-protocol).

## STORE_CAPTAIN_MEMBERSHIP — Store-affiliated Captain
CAPABILITY_ID: STORE_CAPTAIN_MEMBERSHIP

DSH binds each Store-scoped invitation to one canonical actor and one Store. An authorized Store owner initiates an invitation by name/phone via admitted Identity/DSH enrollment; reuse an existing eligible actor, or require the invited person's own verified phone/Identity proof. The invitation alone cannot activate membership, impersonate the Captain, issue global captain role or establish platform standing. Only the invited actor's verified acceptance in the Captain app activates the membership. Store display names are not official Identity names; a suspended/unsafe actor cannot bypass standing restrictions by affiliation.

One actor may have several independently consented Store memberships; no extra high-level role or Operator scope. DSH writes invitation, acceptance, decline, expiry and revocation with idempotent reconciliation of duplicates and concurrent retries. Unrelated Stores cannot read/write it. Suspension/leaving/revocation stops new Store missions; running commitments, prior custody and liabilities remain attributable and are explicitly reconciled, never silently moved to public dispatch. Apply the owner admission boundary in [Identity](identity.md).

## CAPTAIN_DISPATCH — Platform Captain offers and assignment
CAPABILITY_ID: CAPTAIN_DISPATCH

DSH alone owns platform standing: current authorized operations decision, approved/suspended/revoked state and durable audit. A candidate application (from an admitted origin) in PENDING is not permission. Identity alone issues the Captain role/session for the same verified actor after current DSH approval. Standing, Store membership, assignment and goods custody remain different facts.

A one-way guest interest form on Captain sign-in is separately owned by DSH: short unverified contact submission and receipt only, not an application-status flow. Only effective operations access reads contact details or marks contacted for selective telephone outreach. No automatic account, role, standing, assignment or acceptance/rejection feedback. Before public activation, establish lawful privacy and retention/deletion policy.

An eligible ready Store Order using BTHWANI_CAPTAIN receives a batch of distinct currently eligible Captains within the effective DSH offer maximum. An offer is not an assignment. It has its own expiry; DSH revalidates standing, availability, serviceability and version at transactional acceptance. Exactly at most one active winner per Store Order; supersede losing offers durably, reconcile candidate capacity and WLT-owned COD exposure/holds at their owners. An outstanding offer may reserve capacity but cannot erase the fresh presence fix needed after rejection/expiry. Retry, reconnection, concurrent accept and unknown backend state never create a duplicate assignment or pretend success.

Offered Captains see only coarse delivery area; only the assigned authorized Captain reads bounded task/recipient details. Operations visibility/reassignment invokes the existing DSH engine. Before pickup, reassignment supersedes obsolete offers/handoffs and reconciles financial holds. After custody, ordinary reassignment cannot silently transfer goods or liability. Verified WLT COD coverage is a mandatory independent constraint, not a DSH-calculated wallet.

## STORE_CAPTAIN_HANDOFF — Valid Store-to-Captain transfer
CAPABILITY_ID: STORE_CAPTAIN_HANDOFF

DSH owns one two-sided custody handoff per current assignment. The authorized Store scope confirms its side first; only the actual assigned or currently authorized Store-affiliated canonical Captain may complete pickup against that confirmation for the same Store/Order. Missing items, quantity mismatch, wrong Store/Captain, expired membership or stale assignment block until an authorized DSH exception resolves them.

Bind item count, OTP, QR/PIN, photo or other admitted pickup evidence to the transaction and actor; client local state or success banner cannot prove custody. One handoff identity, conflict-safe replay, attributable evidence and canonical readback. A Store-affiliated Captain is not thereby a platform Captain; goods custody never implies cash obligation transfer. Order state, physical custody and WLT collection/holds are separate owner facts; timeout or missing acknowledgment cannot fabricate another effect.

## FINAL_MILE_DELIVERY — Tracked completion
CAPABILITY_ID: FINAL_MILE_DELIVERY

DSH owns valid Order/assignment lifecycle, bounded ETA, actual delivery-contact snapshot, narrowly authorized active mission location and verified completion. Completion requires valid custody, the current authorized Captain and the admitted Order-bound proof/acknowledgment (PIN/QR/signature/media where permitted). A recipient different from the purchasing Customer receives no account, payment or cancellation authority.

Failed proof, no-answer, network interruption, return or uncertain cash collection leaves explicit recoverable DSH/WLT state. Delayed/repeated confirmation must not cause duplicate delivered state, goods release, COD debit, fee or earnings. WLT alone records lawful financial adjustment and readback.

## CUSTOMER_PICKUP — Merchant-verified handoff to Customer
CAPABILITY_ID: CUSTOMER_PICKUP

Pickup uses the same DSH Store Order. Store confirms readiness before one-time release to the actual authorized Customer with matching Store/Order and bounded pickup proof. No Captain assignment, Captain COD hold, invented wallet custody or unnecessary delivery-address requirement. No-show, stale readiness, wrong actor and duplicate proof remain owner-resolved exceptions. WLT alone applies eligible collection, agreed fees, refund/reconciliation and outstanding commercial obligations.

## Location, opportunity map and device behavior

Apply [safety's location law](safety.md#location-consent-and-current-mission-least-privilege). For dispatch, DSH retains at most one latest eligible availability fix per Captain, with freshness, accuracy and retention limits. Stale samples are ineligible for dispatch/aggregation. Demand/supply density uses bounded-window privacy-safe aggregate coarse circles, never individual pins, movement trails or precise customer destination before winning assignment. Reject stale observations, suppress stale circles on refresh failure and distinguish unavailable/missing from zero demand.

Separately, only the authenticated currently assigned platform Captain may submit the latest admitted active-mission fix. Read access is exclusive to specifically authorized Operations for that Order, not a Customer/Merchant GPS feed, other Captains, public map or general notification. Customer/Merchant progress is a lifecycle projection. Reject out-of-order, stale, inaccurate, future or third-party updates; completion, revocation, expiry, timeout, logout and retention rules end applicable access. Actual retention does not become an unlimited location history.

Captain shell retains four destinations (Home map, Deliveries, Wallet, Account), efficient nonmodal floating opportunity cards and no second assignment page or misleading offer overlay. Suppress offers during an active assigned mission; expired or unknown-state offers are not acceptable. Availability and device-GPS controls are distinct. Android foreground/background permissions and visible operating notification where required must be user-authorized; never silently toggle OS location services. Test actual Android permission, account switch, task stop, stale/offline/refresh behavior and mission visibility; Expo Web or mock layout cannot certify device behavior.

## Operator-managed dispatch and location thresholds

Historical initial donor reference settings: three concurrent offers, 15-minute latest-location freshness, 30-minute aggregate demand window, and coarse-map samples up to three minutes old or one minute future. These are not automatically active values or hardcoded client constants. DSH owns permitted ranges, scope, version, current readback and privacy limits for these and other legitimate operational quantities (dispatch radius, acceptance timeout, escalation, preparation estimate and assignment capacity). Validate exact retention/display/freshness thresholds at implementation.

An authorized proposed wider radius/age/capacity must satisfy privacy, performance, actual capabilities and operational acceptance; expose concrete unavailable reason rather than invent an algorithm. No policy may weaken one active winner, current actor/Store/assignment authority, private-address bounds, no unlimited trail, verified WLT COD coverage or once-only effects. A toggle cannot grant roles, provision payments or change cash ownership. Policy mutation uses the single owner-backed Operator Policies experience and affects future eligible attempts only.

## Acceptance

Preserve these human-approved target requirements (2026-11-13), not claims that Go/SQL, payout, background tracking or custody flows are complete. Prove each MARKETPLACE and DIRECT permutation with allowed/denied modes, paused Store, unavailable Captain, wrong actor, competing acceptance, authorization/privacy, handoff mismatch, offline retry, cancellation, COD/Mixed, pickup and durable DSH/WLT readback. Prove actual consumer behavior and applicable internal security, finance, migration and legal evidence before activation under [engineering](engineering.md) and [safety](safety.md); no unperformed external signoff or invented runtime proof.
