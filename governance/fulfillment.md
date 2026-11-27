# BThwani — One delivery engine and policy-controlled modes

ARTIFACT_CLASS: DOMAIN_GOVERNANCE_DRAFT
SEMANTIC_OWNER: governance/fulfillment.md
STATUS: ACTIVE_FOR_PROGRESSIVE_DEVELOPMENT
IMPLEMENTATION_STATE_AUTHORITY: NONE

## Mode policy and ownership

DSH owns one Order fulfillment/dispatch engine. Supported identifiers: BTHWANI_CAPTAIN («توصيل بثواني»), PARTNER_CAPTAIN («توصيل المتجر») and CUSTOMER_PICKUP («استلام من المتجر»). Cleaner legacy code requires verified contract/SQL cutover, never an extra method. Identity owns actor/role/session; WLT owns monetary exposure, collection, fees and earnings.

Single owner-backed Operator Policies exposes versioned eligible method subsets per MARKETPLACE/DIRECT. Per-Store eligibility may be narrower: actual Store permission, admitted capability, accepted WLT agreement, applicable Captain standing/membership, legal collection, custody/risk and operational readiness. Temporary pause cannot add a method. Historical DIRECT platform-Captain hard block is migration evidence, not a permanent target prohibition; retain protection until the exact combination is proven. At registration, durable mode change, Order confirmation and assignment validate effective relation, readiness, authority, availability and applicable serviceability, inventory and finance. No caller-forced substitution or hardcoded fallback. Prospective policy preserves confirmed mode/price/liability except lawful explicit adjustment. See [architecture](architecture.md#safe-change-protocol), [stores](stores.md) and [finance](finance.md).

## STORE_CAPTAIN_MEMBERSHIP — Store-affiliated Captain
CAPABILITY_ID: STORE_CAPTAIN_MEMBERSHIP

DSH binds each invitation to one Store and canonical eligible Captain actor. Authorized Store owner or specifically admitted delegated membership scope initiates by name/phone; reuse the actor or initiate admitted Identity-managed enrollment. Owner's name label is not verified legal name. Invited person proves own phone, obtains required authorized Captain role/session through Identity and accepts in the Captain app; invitation alone gives no membership, role, standing, assignment or public-pool access. Only the exact actor can see/accept/decline the invitation. No owner-issued role, password transfer or impersonation.

One actor may hold multiple separately accepted Store memberships without joining general platform dispatch. Store-affiliated Captain eligibility is independent of public-pool availability; suspended/unsafe standing cannot be bypassed through affiliation. One canonical DSH lifecycle (invite, accept/decline, expiry, suspension, restore, removal or Captain leave where policy permits) with version, attribution and replay. Suspension/removal/leave stops future Store missions while preserving existing custody/commitments/rights. No automatic transfer into public dispatch. Old code invitation is only bounded proven compatibility, not a second current writer. Unknown identity, unauthorized Store, duplicate membership, stale accept/restore and conflicting eligibility recover from actual Identity/DSH facts; retry never auto-accepts. Store Captain remuneration and Store-cash handoff are not BThwani Captain wallet/earnings/COD, as [finance](finance.md) governs.

## CAPTAIN_DISPATCH — Platform Captain standing, offers and assignment
CAPABILITY_ID: CAPTAIN_DISPATCH

DSH owns current approved/suspended/revoked platform standing with authorized Operations decision and durable audit. Candidate PENDING is not permission. Identity alone issues role/session after DSH-approved standing for the same verified actor. Standing, availability, assignment, Store membership and custody are separate. A one-way guest interest form, where admitted, submits short unverified contact and receipt, not a role application or status workflow. Only authorized Operations may read it or mark contacted for selective telephone outreach; no automatic account, standing, acceptance/rejection feedback or mission. Verify privacy/retention before public activation.

Only a ready BTHWANI_CAPTAIN Store Order is platform-dispatchable. DSH issues a bounded batch of offers to distinct eligible available Captains, each with expiry and reserved capacity where required. Offer is not assignment. Only authenticated offered Captain accepts/rejects a live offer. Expiry and rejection are durable. Revalidate actual eligibility, fresh presence, capacity, serviceability, version and WLT exposure at atomic acceptance; first valid committed acceptance is sole active winner. Supersede losing offers and restore affected capacity/financial holds through owners. An outstanding offer must not erase fresh presence needed after rejection/expiry; assignment clears winner's dispatch presence. Unknown hold or assignment reconciles original identity before another operation.

Pre-acceptance expose only coarse service-city delivery area, not full Customer address or coordinates. Actual assigned Captain reads bounded pickup/destination/contact task. Operations reassignment uses same engine and exact authority; before pickup supersede old handoff and reconcile financial holds, after custody ordinary reassignment is forbidden until lawful custody recovery. No client calculates final ranking/assignment or WLT balance. No available Captain, stale/declined/expired offer, concurrency, insufficient coverage, offline or hold failure remains explicit and owner-recoverable.

## STORE_CAPTAIN_HANDOFF — One Store-to-Captain custody transfer
CAPABILITY_ID: STORE_CAPTAIN_HANDOFF

DSH binds one current handoff to Store, Order, frozen method, assignment and actual canonical Captain. Authorized owning-Store scope confirms its side before the legally assigned/eligible platform or Store Captain completes pickup; current Store membership is required for affiliated method. No pickup before required Store confirmation. Item/quantity mismatch, shortage, wrong actor/Store, stale assignment, expired membership, financial-hold mismatch and offline state block until authorized owner resolution. Bounded admitted item count, OTP/PIN/QR, photo or other evidence is tied to actual transaction and actor; UI/local state is not proof. Replacement before custody supersedes old attempts, preserving history/financial reconciliation. Exact replay, conflicting payload rejection and durable readback ensure one transfer. Goods custody, payment collection and WLT hold remain distinct.

## FINAL_MILE_DELIVERY — Verified completion and custody recovery
CAPABILITY_ID: FINAL_MILE_DELIVERY

DSH owns operational lifecycle, bounded ETA, delivery-contact snapshot, active mission and evidence, and actual physical cash possession/handoff facts. WLT owns canonical collection, exposure/receivable, adjustment and earnings. Delivery starts only after committed custody; only current authorized Captain advances it and records one terminal result after actual admitted Order/assignment-bound proof (PIN/QR/signature/media where permitted). Proof and financial collection are distinct even when one UI action triggers both. Recipient OTHER is bounded contact, not purchasing, cancellation, payment or account principal.

Failed/no-answer attempt, invalid proof, stale version, duplicate request, offline/restart, recipient unavailable, payment uncertainty and return-to-Store remain explicit recoverable states. Preserve attributable physical custody until lawful recovery/return/transfer resolves it. Do not infer DSH or WLT success from the other service or duplicate delivered state, goods release, COD debit, fee or earnings. Canonical readback and same operation identity govern recovery. Customer/Merchant progress is lifecycle projection, not live Captain GPS.

## CUSTOMER_PICKUP — Merchant-verified pickup
CAPABILITY_ID: CUSTOMER_PICKUP

Same DSH Store Order, explicit CUSTOMER_PICKUP mode. Store confirms readiness before one authorized release to the actual eligible Customer with Store/Order-bound bounded proof; no reuse on another Order. No Captain assignment/handoff, platform Captain cash custody/COD hold, unnecessary delivery address or alternate Order engine. Payment method is independent; WLT owns applicable collection/refund/commission. Wrong actor, no-show, stale readiness, cancellation, duplicate proof and unknown financial outcome require actual owner reconciliation.

## Location, opportunity maps and device behavior

Apply [safety's location law](safety.md#location-consent-and-current-mission-least-privilege). Two distinct latest-only purposes, neither movement history nor public tracking.

### Dispatch presence and aggregate opportunity

For available Captains, DSH holds at most one recent authorized foreground GPS presence sample for dispatch ranking; precise fix is only for authenticated own submission and internal ranking. Offline, suspension or winning assignment clears presence immediately. Outstanding offer preserves usable fix for redistribution after rejection/expiry. Expired fixes are ineligible and physically purged via the owner retention lifecycle; never keep route trails. No Customer, Merchant, other Captain or public individual location read. Authorized Captain and Operations opportunity maps combine privacy-thresholded coarse circles for demand and available supply, not individual pins, exact coordinates, raw identifying counts, live offers or promised assignments. Threshold independently adequate Stores/Orders or Captains; suppress sparse cells. Stale/future samples are rejected, circles cleared on refresh failure; absent/empty privacy-safe result is not zero demand.

### Active platform mission

Only current bearer-authenticated assigned BTHWANI_CAPTAIN submits latest active-mission fix for specifically authorized Operations supervising exact Order. Captain sees that location is shared for active mission. No Customer/Merchant feed, opportunity-map source, notifications or movement log. Reject stale/future/inaccurate/out-of-order fixes and wrong actor/assignment; hide stale/lost and end visibility immediately on completion, revocation or inactive assignment. Purge old and terminal fixes through DSH retention owner; do not confuse logical denial with physical deletion. Local navigation to admitted Store and destination need not disclose location elsewhere.

### Actual Android behavior

Captain shell retains four destinations (Home map, Deliveries, Wallet, Account); one current assignment on Deliveries, one tap from primary navigation, no duplicate dispatch screen. Home map shows idle aggregate opportunities and authorized current mission pickup/destination while assigned. Use short nonmodal offer cards, suppress during active or unverified mission, expired offers never actionable. DSH availability and device GPS are different controls. Device GPS uses real OS permission/service request and settings; do not simulate silent OS toggle. Stop availability before disabling required GPS.

Foreground mission location requires actual admitted permission and visible purpose. Background mission location is explicit opt-in by current eligible assigned Captain; native background permission and visible foreground-service notification where required. Recheck authenticated actor, mission ownership and platform mode before each latest-only fix; stop on completion/sign-out/invalid mission. Device lock, termination, disconnect and permission change may stop updates; display truthful STALE/LOST, not fictitious movement. Verify actual native build/device, permission flows, task lifecycle and recovery; Expo Go/Web or JavaScript test alone cannot prove background reliability.

## Operator-managed dispatch/location policy

Historical initial donor reference settings: three concurrent offers; latest dispatch presence freshness 15 minutes; retention purge at startup and each minute (normal lag up to one minute); 30-minute demand window; aggregate sample maximum age three minutes and future tolerance one minute. These describe prior admitted meanings, not automatically live values or immutable client constants. DSH owns bounded versioned radius, offer/capacity/expiry, freshness, accuracy, retention, privacy threshold, preparation and escalation parameters. Preserve privacy and physically enforced retention when values change; actual current owner/API policy governs eligible future attempts. No policy may weaken one winner, current authority, cash coverage, no public precise locations, no unlimited trails or once-only effects. No unimplemented algorithm, role, payment or custody authority from a toggle.

## Acceptance

Verify MARKETPLACE/DIRECT allowed and denied modes, separate public-pool and Store membership, eligible/ineligible invitation, revocation and role boundaries, stale location and purged terminal data, privacy threshold and map failure, competing acceptance, exact WLT COD/Mixed coverage, release, reassignment and handoff mismatch, actual delivery/pickup proof, offline/replay, return/unknown collection and durable DSH/WLT readback. Exercise actual affected Captain/Merchant/Customer/Operations Web/Android and device-lock/background behavior where applicable. Apply [engineering](engineering.md) and [safety](safety.md); no proof of deployed financial or location capability from historical target, source-only, mock or unperformed review.
