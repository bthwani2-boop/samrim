# BThwani — Cross-Owner Journeys and Proof Boundaries

ARTIFACT_CLASS: DOMAIN_GOVERNANCE_DRAFT
SEMANTIC_OWNER: governance/journeys.md
STATUS: DRAFT_PENDING_FULL_GOVERNANCE_CUTOVER
IMPLEMENTATION_STATE_AUTHORITY: NONE

## Purpose and authority

These **16** named business journeys are the canonical *cross-surface proof lenses*, not another capability admission census, Order/finance writer, screen registry, implementation plan or claim that a workflow is live. `governance/product.md` owns the **26 capability** admission IDs; Identity, DSH, WLT and relevant HR logical ownership retain their own domain facts and policy decisions. The `JOURNEY_ID` identifiers below preserve historic acceptance traceability on branch `41`. Historic `PARTNER` in identifiers means the **Merchant** actor, not an additional actor or engine. In current content: Customer, Merchant, Captain and Operator are the four actor-facing surfaces. No extra enrollment app or independent Direct Commerce engine follows from an older identifier.

A Journey crosses materially participating surfaces and ends with actual owner-backed readback on each. Every mutable operational quantity below (contact count, claim expiry, stage attention, dispatch timeout, commercial price, promotion limit) is an initial donor policy candidate/default, **editable through the single Operator Policies workspace via its canonical owner** once implemented and authorized. A configurable value never disables permissions, safety, immutable transaction history or ledger conservation. Historic durations are not contractual SLA promises.

The `CAPABILITIES:` references below reproduce the **14 explicit Journey-to-capability mappings in branch `41`** for traceability only; the 26-item admission census remains exclusively in `governance/product.md`. The donor does not declare a `CAPABILITIES:` field for `FIRST_THREE_ORDER_CONTACT` or `ORDER_SCOPED_OPERATIONS_EXCEPTION`, so no mapping is invented for those two pending Product-owner reconciliation. These links are not implementation evidence or independent policy approvals.

## MANAGED_PARTICIPANT_ADMISSION — Actor role and standing

JOURNEY_ID: MANAGED_PARTICIPANT_ADMISSION
CAPABILITIES: IDENTITY_ACTIVATION_SESSIONS
SURFACES: OPERATOR, MERCHANT, CAPTAIN
OWNERS: Identity, DSH
ENTRY: Verified eligible human account or authorized managed-role admission.
EXIT: The admitted person signs into the correct role-scoped app and the current standing is readable from Identity/DSH.
READBACK: Identity actor, verified authentication, role, session and relevant DSH standing.

A Merchant self-registers directly through Identity after required verification; **no preapproval, onboarding intermediary or parallel enrollment record** is required for ordinary Merchant admission. Captain admission retains current role/standing gates. Operator role admission is protected by its separate high-security Identity rules. Existing verified actors are reused, not duplicated because a Store invitation or HR access request exists. A Store-affiliated Captain membership remains a DSH resource relationship, not a platform-role shortcut.

**Fail/recover:** duplicate phone/actor, unauthorized operator, suspended role, wrong-role session, stale invitation, cross-account cache or interrupted admit → read original Owner facts; never fabricate activated roles, duplicate users or auto-revive disabled access.

## PARTNER_TO_VISIBLE_STORE — Merchant registration through publication

JOURNEY_ID: PARTNER_TO_VISIBLE_STORE
CAPABILITIES: PARTNER_ONBOARDING_STORE_PUBLICATION, IDENTITY_ACTIVATION_SESSIONS, CENTRAL_CATALOG, STORE_COMMERCIAL_AGREEMENT
SURFACES: MERCHANT, OPERATOR, CUSTOMER
OWNERS: Identity, DSH, WLT
ENTRY: Identity-verified Merchant creates a DSH Store, choosing eligible `MARKETPLACE` or `DIRECT`.
EXIT: Store is genuinely eligible, approved and published for its authorized channel; Customer sees the correct public projection.
READBACK: one Identity Merchant actor, one DSH Store initially **unpublished and closed**, one accepted and approved WLT Store agreement, subsequent DSH publication/readiness.

One Store writer serves both relations. DSH validates service city, vertical, type, Store ownership, location, media, catalog and declared opening schedule. WLT proposes contract terms under effective **Operator policy**, the Merchant accepts that exact version, and Finance approves applicable activation; fees or subscriber status do not appear active from a mere Store-type default. Only after required Store/legal, content, serviceability and finance gates may DSH publish the appropriate public full Store Web page and, when separately eligible, marketplace discovery.

**Fail/recover:** incorrect phone/actor, create retry, inactive WLT agreement, missing consent or catalog, duplicate Store or disallowed relation → recover original draft Store; no fake publication, bypassed payment or another Direct engine.

## STORE_ORDERABILITY — Publication does not imply accepting Orders

JOURNEY_ID: STORE_ORDERABILITY
CAPABILITIES: STORE_OPERATIONAL_AVAILABILITY
SURFACES: MERCHANT, CUSTOMER, OPERATOR
OWNERS: DSH
ENTRY: Published Store has eligible active service city and an approved operating-hours/mode policy.
EXIT: DSH yields one versioned current orderability result per Store and fulfillment method.
READBACK: Merchant/Operator mutation readback plus customer-safe open, closed, temporarily paused or unavailable state.

Store status, approved publication, weekly hours, temporary closure, actual Offer availability, location eligibility, specific fulfillment method admission and current operational pause are distinct. An Operator may intervene only within Identity permission and the DSH policy. DSH checks effective eligibility **again at confirmation**; temporary resume cannot admit a mode that is contractually or technically unavailable.

**Fail/recover:** stale schedule, overlapping closures, offline save, cross-Store access, unknown eligibility → no permissive fallback, no second publication/Order writer, canonical readback after uncertain mutation.

## CATALOG_TO_CUSTOMER_OFFER — One sellable catalog, two channels

JOURNEY_ID: CATALOG_TO_CUSTOMER_OFFER
CAPABILITIES: CENTRAL_CATALOG
SURFACES: OPERATOR, MERCHANT, CUSTOMER
OWNERS: DSH
ENTRY: Authorized shared registry/ProductVariant or Merchant Store-scoped item/Offer and eligible publication.
EXIT: Customer reads only eligible current Stores, Variants and StoreOffers.
READBACK: DSH taxonomy, Variant/StoreOffer, Store scope, price, availability and public catalog projection.

One Registry and one StoreOffer writer support shared and Store-scoped Products. Global taxonomy/typed attributes, local quick entry, price editing, import preview/commit, modifier group, actual measurable quantity, stock and media are admitted through their legal DSH commands. A content link or Offer card is not proof the Store is open or the quote current. Full Customer Expo Web Store and compact marketplace Store views consume the same DSH facts under distinct channel eligibility.

**Fail/recover:** unauthorized Store SKU/media, stale cursor, invalid variant/modifier/weight/quantity, duplicate import, changed price, hidden draft or lost network → no guessed product identity, no alternate local catalog or false checkout permission.

## DISCOVERY_TO_COMMERCE_ENTRY — Content, promotion and funded eligibility

JOURNEY_ID: DISCOVERY_TO_COMMERCE_ENTRY
CAPABILITIES: DISCOVERY_CONTENT, COMMERCE_PROMOTIONS, CENTRAL_CATALOG, STORE_SCOPED_ACCESS_DELEGATION
SURFACES: OPERATOR, MERCHANT, CUSTOMER
OWNERS: DSH, WLT
ENTRY: Eligible author prepares a Store-scoped discovery item, approved banner or promotion.
EXIT: Customer reaches only a lawful visible Store/Product/Category/Promotion target or receives unavailable/expired outcome.
READBACK: DSH approved content/target, Store scope and redemption; WLT source of funded discount where material.

Operator editorial and platform-funded campaigns, eligible Merchant opt-in and Merchant Store-specific promotions share the same DSH approval/publication and canonical pricing/Offer path. Funding split is WLT-owned, and redemption is time/use-limited and idempotent; UI discounts never become a financial writer. Direct Store content visibility does not create marketplace listing.

**Fail/recover:** revoked author, missing opt-in, removed media, expired target, exhausted coupon, race, funding refusal → reject safely and re-read actual DSH/WLT state. No speculative loyalty/social/AI marketing product.

## SINGLE_STORE_ORDER_CREATION — Current quote to one Store Order

JOURNEY_ID: SINGLE_STORE_ORDER_CREATION
CAPABILITIES: SERVICEABILITY_ADDRESSES, CART_CHECKOUT, ORDER_LIFECYCLE, ORDER_PAYMENT_COLLECTION, CUSTOMER_BALANCE_FUNDING, STORE_OPERATIONAL_AVAILABILITY, CENTRAL_CATALOG, COMMERCE_PROMOTIONS
SURFACES: CUSTOMER, MERCHANT
OWNERS: Identity, DSH, WLT
ENTRY: Customer selects one eligible StoreOffer cart, recipient/address, fulfillment and admitted COD/Wallet/Mixed payment.
EXIT: At most **one** DSH Store Order plus one consistent WLT allocation, or an explicitly failed/unknown outcome.
READBACK: DSH Store Order and immutable price/policy/collection snapshot; WLT funding/hold/settlement state.

DSH quotes current server prices, legal promotion, quantity, Stock, Store publication, city/serviceability, cancellation policy and chosen mode, then rechecks at confirmation. Recipient `OTHER` is private delivery contact, **not** a new human actor or owner of payment. Client totals, expired quotes and URL parameters cannot authorize price or financial collection. A Direct Store's approved link uses the **same** DSH checkout writer as marketplace, not a direct-orders table.

**Fail/recover:** stale cart, changed unit/price, closed Store, unavailable mode, invalid location, expired promotion, insufficient funds, ambiguous provider timeout or replay → owner-based resolution without duplicate Order, extra wallet debit or silent mode change.

## BTHWANI_CAPTAIN_DELIVERY — One winning assignment and lawful custody

JOURNEY_ID: BTHWANI_CAPTAIN_DELIVERY
CAPABILITIES: ORDER_LIFECYCLE, CAPTAIN_DISPATCH, STORE_CAPTAIN_HANDOFF, FINAL_MILE_DELIVERY, ORDER_PAYMENT_COLLECTION, CAPTAIN_BALANCE_FUNDING, PARTNER_CAPTAIN_EARNINGS_SETTLEMENT
SURFACES: MERCHANT, CAPTAIN, CUSTOMER
OWNERS: DSH, WLT
ENTRY: Merchant-accepted and prepared `BTHWANI_CAPTAIN` Store Order becomes ready for an eligible platform Captain.
EXIT: DSH confirms one assigned Captain, two-sided Store-to-Captain handoff and valid delivery proof; WLT effects are posted once or explicitly reconciling.
READBACK: DSH dispatch/assignment/handoff/proof/terminal delivery to authorized surfaces and WLT Captain exposure, debit, entitlement and receivable.

The **maximum concurrent offer count** and acceptance/dispatch durations are DSH Operator policies (historic initial offer count three), but the **single winning assignment** is an unchangeable safety invariant. WLT checks approved gross COD exposure and holds **only actual cash portion**, not prepaid wallet portion, with idempotent release on valid cancellation and once-only debit upon valid collection. Customer address is unavailable to losing candidates and only disclosed after lawful assignment. The Captain retains physical collected cash under the admitted current settlement model; historical obligations use their original auditable reconciliation path.

**Fail/recover:** two simultaneous accepts, stale location, wrong actor, handoff dispute, offline proof, COD shortage or duplicate delivery → one canonical assigned/delivered state and explicit WLT reconciliation, not a second dispatch or refund writer.

## PARTNER_CAPTAIN_DELIVERY — Store-affiliated Captain, same Order

JOURNEY_ID: PARTNER_CAPTAIN_DELIVERY
CAPABILITIES: STORE_CAPTAIN_MEMBERSHIP, STORE_CAPTAIN_HANDOFF, FINAL_MILE_DELIVERY, ORDER_LIFECYCLE, ORDER_PAYMENT_COLLECTION
SURFACES: MERCHANT, CAPTAIN, CUSTOMER
OWNERS: Identity, DSH, WLT
ENTRY: An eligible `PARTNER_CAPTAIN` method is selected and that Captain has accepted current Store-specific membership.
EXIT: DSH completes Store-owned handoff and customer delivery with correct financial/collection obligations.
READBACK: DSH Store membership, assigned mission, custody and completion; WLT actual Store collection/fee responsibilities when applicable.

Merchant invites a verified person; Captain accepts the Store-specific relationship. Membership is neither global platform dispatch eligibility nor an automatic platform wallet, payment-custody or WLT earning. Internal Store-Captain remuneration is not BThwani platform-Captain compensation. Suspension/revocation affects future missions; existing obligations require explicit reconciliation.

**Fail/recover:** unaccepted invitation, wrong Store, invalid session, suspended Captain, stale membership, delivery dispute → fail closed, no cross-Store access or fictitious platform COD hold.

## CUSTOMER_PICKUP — Verified Store/customer handoff

JOURNEY_ID: CUSTOMER_PICKUP
CAPABILITIES: CUSTOMER_PICKUP, ORDER_LIFECYCLE, ORDER_PAYMENT_COLLECTION
SURFACES: CUSTOMER, MERCHANT
OWNERS: DSH, WLT
ENTRY: Eligible `CUSTOMER_PICKUP` Store Order is accepted/prepared/ready.
EXIT: Authorized Store/customer handoff proof results in one DSH pickup terminal state and the WLT financial effects required by the agreement.
READBACK: DSH pickup readiness/proof/Order terminal result and WLT collection/commission.

The Order is the *same* canonical DSH Store Order. Customer arrival, pickup evidence and Store acceptance remain scoped; no Captain offer, platform-Captain balance hold or duplicate pickup order arises. Failed/repeated proof does not complete twice.

## MULTI_STORE_ORCHESTRATION — Parent intent, independent children

JOURNEY_ID: MULTI_STORE_ORCHESTRATION
CAPABILITIES: MULTI_STORE_CHECKOUT, CART_CHECKOUT, ORDER_LIFECYCLE, ORDER_PAYMENT_COLLECTION, CAPTAIN_DISPATCH, STORE_CAPTAIN_MEMBERSHIP, CUSTOMER_PICKUP
SURFACES: CUSTOMER, MERCHANT, CAPTAIN
OWNERS: DSH, WLT
ENTRY: Customer submits one permitted multi-Store intent with independently valid Store carts.
EXIT: Each child Store Order has its own persisted confirmed/failed/compensating result; parent displays an accurate aggregate.
READBACK: DSH per-Store Orders and parent orchestration status, WLT per-child funding and liabilities, scoped Merchant/Captain tasks.

Parent is orchestration, **not** a second legal Order writer or blanket Store settlement. Partial success, cancellation and refund must be visible; failing child Store cannot overwrite another Store's inventory or money. A client's combined total cannot replace separate authoritative quotes.

## ORDER_COMMUNICATION — Private Order-scoped interaction

JOURNEY_ID: ORDER_COMMUNICATION
CAPABILITIES: ORDER_CONVERSATION
SURFACES: CUSTOMER, MERCHANT, CAPTAIN, OPERATOR
OWNERS: DSH
ENTRY: Canonical Store Order and current role-scoped participant permission.
EXIT: Authorized communication reaches bounded read-only closure after completion and applicable policy.
READBACK: DSH Order-scoped message, attachment/recorded media, read/unread/closure and role visibility.

A prospective Captain, revoked Merchant employee or unrelated Store cannot read recipient contacts or private media. DSH filters each message and receipt to its **author, explicitly selected recipients and currently authorized Operations**, not every current or former Order participant; Operations composition itself needs explicit current `operations` authority. Message-plus-attachment is one idempotent, private write. Terminal `DELIVERED`, `PICKED_UP`, `REJECTED` and `CANCELLED` close new sends while retaining authorized readback of previously committed messages. Notification/deep-link access always rechecks the owner's Order and per-message recipient participation; a successful media upload is not a payment, custody or Order mutation. No generic social inbox or alternate Order support engine.

## FIRST_THREE_ORDER_CONTACT — Bounded new-Customer confirmation

JOURNEY_ID: FIRST_THREE_ORDER_CONTACT
SURFACES: OPERATOR, CUSTOMER
OWNERS: DSH (Identity authorization)
ENTRY: Authorized Operations employee opens a current Order needing actual customer-contact verification.
EXIT: Order has factual `CONFIRMED` customer conversation and **separate** canonical delivered/customer-pickup proof, or unresolved/no-answer/denied result.
READBACK: DSH attributed call attempt/result, one claim owner/expiry, one derived distinct-Order count and Order proof.

The historic initial routine-contact count is **three distinct confirmed and completed Store Orders**, and existing Customers with at least three independently proven historical completions are exempt from retrospective calls. The number, claim time (historically ten minutes), attempt-related attention threshold and enabled period are **DSH Operator Policies**, not client constants. Only an actual spoken contact may be `CONFIRMED`; a reserved task starts `PENDING` with zero attempts. `NO_ANSWER`, denial or invalid number are recorded as actual observations, **never automatic fraud verdicts**, delivery proof, a second user profile or a wallet rule.

The initial contact mode **does not block Merchant preparation or require Customer trust status to proceed**. Making preparation contingent on a contact call is a distinct Product change requiring DSH/WLT cash/Wallet/Mixed proof and explicit adoption; it is not an Operator toggle for an unimplemented gate. Expired claim can be renewed or reclaimed by eligible Operations without altering Order status. No recording of call audio is implied; don't show a defamatory trust label to Customer.

**Fail/recover:** two Operators claiming concurrently, expired claim, zero-attempt old placeholder, duplicate `CONFIRMED`, unproven completion, wrong account → one attributable DSH contact outcome and no false derived count.

## ORDER_SCOPED_OPERATIONS_EXCEPTION — Evidence-based exception resolution

JOURNEY_ID: ORDER_SCOPED_OPERATIONS_EXCEPTION
SURFACES: OPERATOR (material participants read only their lawful Order facts)
OWNERS: DSH; WLT for financial evidence
ENTRY: Actual Order-bound signal or authorized human Operations attention.
EXIT: One appropriate attributable case resolution or explicit pending/reconciliation-required state.
READBACK: DSH case reason, urgency, owner, versioned events, referenced canonical evidence and current owner status.

DSH allows **one active case per (Order, reason)** with a distinct subsequent occurrence only after the earlier case is resolved. Each active case has exact affected Order, actionable next step and ownership before a normal resolution. Payment and delivery-blocked cases require an actual **POSTED financial handoff** or verified delivery/custody event with no unresolved money; **writing a resolution note cannot release WLT funds, alter Order state, or invent a completed transfer**. Unverifiable old closed cases remain subject to audit instead of retroactive proof fabrication. Search/filter/pagination/urgency queue reads are DSH-owned and permission-scoped, not another generic helpdesk.

DSH may detect qualified stage stagnation or failure signals through one **owner-backed operational-policy** detector. Historic illustrative attention defaults: created/accepted/preparing ~30 minutes depending on Store preparation policy, no-assignment-after-ready ~5 minutes for platform-Captain mode, unanswered contact attention after two *recorded* unsuccessful calls, unclaimed NORMAL case escalation ~30 minutes. All numerical thresholds, enabled detectors, case urgency and allowed stage targets are **named Operator Policies**, subject to source event availability and safety bounds; no thresholds are silently frozen in source/SQL/UI.

**Contractual SLA and operational attention are distinct.** An approved stage SLA requires DSH policy version, effective time and an actual authoritative stage-start event, and is pinned to that stage's start, not recalculated retroactively. No approved SLA → `UNKNOWN`, not a contractual breach. Non-contractual attention fallback is explicitly labeled and cannot assign blame from a missing event. Forward stage transition may auto-close **only unclaimed, automatic early-stage attention** with audit; claimed, financial/custody disputes or incomplete handoffs require explicit evidence and human/owner reconciliation.

**Fail/recover:** duplicate detector runs, race to claim, stale version, wrong Store, repeated missed-call event, unavailable WLT, out-of-order stage or unresolved external funds → deduplicated case, reliable pending state; no parallel Order/ledger writer.

## ORDER_ADJUSTMENT_EXCEPTION_REFUND — Lawful post-confirmation changes

JOURNEY_ID: ORDER_ADJUSTMENT_EXCEPTION_REFUND
CAPABILITIES: ORDER_LIFECYCLE, ORDER_PAYMENT_COLLECTION, PARTNER_CAPTAIN_EARNINGS_SETTLEMENT
SURFACES: CUSTOMER, MERCHANT, CAPTAIN, OPERATOR (only when needed)
OWNERS: DSH, WLT
ENTRY: Owner-confirmed missing item, measured-weight difference, eligible substitution, cancellation, failure, dispute or Order-bound financial exception.
EXIT: DSH attributable adjustment and WLT lawful financial delta/credit/hold release or explicit reconciliation-required state.
READBACK: Immutable original DSH Order snapshot + adjustment history and final fulfilled facts; WLT balanced refund/receivable/settlement states.

Merchant proposes only valid substitute/removal/actual quantity; Customer accepts/rejects when required. A cancellation or dispute follows Order-frozen **DSH versioned policies** (windows, permitted actor, compensation eligibility/ceiling, funding source) administered from Operator Policies; later policy changes do not alter old Order terms. WLT alone posts once-only final refund or permissible compensation, distinguishing **released hold** from cash balance credit. A customer complaint never reopens a terminal Order by rewriting original confirmation. Return-to-Store or post-completion dispute uses bounded authorized paths, not a speculative returns/warranty platform.

**Fail/recover:** cancellation-versus-handoff race, incorrect cash source, duplicate refund, already transferred Store liability, offline Customer decision → unknown/reconciliation rather than double credit or silent financial forgiveness.

## PARTNER_COMMISSION_REMITTANCE — Store-collected proceeds, platform receivable

JOURNEY_ID: PARTNER_COMMISSION_REMITTANCE
CAPABILITIES: ORDER_PAYMENT_COLLECTION, PARTNER_CAPTAIN_EARNINGS_SETTLEMENT
SURFACES: MERCHANT, OPERATOR
OWNERS: WLT (DSH provides original Store Order evidence)
ENTRY: Under an eligible accepted commission agreement, a Store has retained actual Customer proceeds and WLT has an outstanding platform commission receivable.
EXIT: Authorized paid/offset receivable reconciles and closes or remains explicitly outstanding.
READBACK: WLT Store-specific original receivable, payment/offset evidence, outstanding amount, agreement version and final reconciliation.

Commission on Store-collected Direct/Marketplace is not automatically covered by BThwani-Captain physical COD debit or Store subscription. Only WLT can recognize incoming official settlement or a **lawful authorized offset**; the Merchant and Finance see consistent outstanding amounts. The collected Store proceeds **cannot be credited a second time as fresh WLT Merchant earnings**. A generic policy may govern fee and remittance cadence, but it cannot create a payment rail or write accounting effects.

**Fail/recover:** duplicate remittance, wrong Store/recipient, unauthorized offset, mismatched transfer reference, stale statement or unknown provider outcome → retain receivable until WLT verifies, never infer settled from receipt screenshot.

## BENEFICIARY_SETTLEMENT — Evidence-backed payout to verified beneficiary

JOURNEY_ID: BENEFICIARY_SETTLEMENT
CAPABILITIES: PARTNER_CAPTAIN_EARNINGS_SETTLEMENT
SURFACES: MERCHANT, CAPTAIN, OPERATOR
OWNERS: WLT (Identity verified actor; DSH source entitlement evidence)
ENTRY: WLT holds eligible Store/Captain earned entitlement, plus any binding historic obligation.
EXIT: Unique payout is executed and independently matched to external evidence, or remains held/reconciling.
READBACK: WLT beneficiary assignment per Store, approved Identity-derived destination, authorization/hold, external execution receipt, actual statement row and final ledger/posting status.

A Store owner may assign an eligible verified recipient to a specific Store under WLT's controlled policy; this is **not** the same as editing official phone/payment destination. Finance verifies entitlement, legal beneficiary and exact destination before authorizing transfer. A settlement intake without verified destination remains **intake only**, not reserved or paid money. Split separate Store beneficiaries/destinations safely; archived lawful earnings are never erased or paid again simply because their source registration workflow is no longer available. Merchant payout and platform-Captain earnings are not Store-affiliated Captain personal wages.

**Fail/recover:** changed verified phone or recipient, stale approval, second transfer, statement mismatch, provider timeout or cross-Store claim → hold/reconcile; independent result before successful completion. New Store publication never creates obsolete rewards.

## Supporting subflows and bounded projections (not additional Journeys)

Identity login/session/Operator grant; Store-scoped delegation; Store-Captain invitation; address/cart; Customer and Captain balance funding; COD exposure hold; verified customer exceptional withdrawal; Order feedback; current delivery tracking/proof; Customer notifications; private media; owner-authorized analytics; observability and incident reporting support the 16 Journeys through their established domain owners. None is a generic new service, alternative Store, second finance flow or permission bypass.

Notifications are **derived, role-scoped and idempotent projections** of committed canonical owner transitions: Store delegation invitation/accept/revoke, payout-recipient change/reverification, Store agreement acceptance/activation, platform-promotion/opt-in, payout lifecycle and relevant current Order/Captain actions. Notification unread totals and paginated inbox must be consistent with the canonical event/projection semantics; delivery to device is not mutation success.

Every participating interface must represent applicable `loading`, `empty`, `pending`, `success`, `forbidden`, `offline`, `conflict`, `reconciliation_required` and `error` states or explicitly justify an inapplicable state. Required integration proof on the *actual candidate* is: intent → current Identity/Store authority → canonical mutation → cross-owner handoff → correct next actor surface → failure/retry/unknown-result handling → restart/resume → persisted owner readback, with true actor/Store isolation and affected Web/Android/iOS tests as applicable.

## Provenance and cutover restriction

Semantics reconstructed from the old `D:\samrim\docs\governance\journeys.md` at branch `41`, SHA `426d67b47beb8c66b09acd8c7394086b53ac5aae`, reconciled to currently approved **one-Store/one-Order, policy-driven** target. This file is not a complete legal signoff, applied migration record or implementation proof. Historical raw `CLIENT/PARTNER` surface identifiers remain compatibility context, not an instruction to create another app or reanimate obsolete processes.
