# BThwani — Cross-owner journeys and proof boundaries

ARTIFACT_CLASS: DOMAIN_GOVERNANCE_DRAFT
SEMANTIC_OWNER: governance/journeys.md
STATUS: ACTIVE_FOR_PROGRESSIVE_DEVELOPMENT
IMPLEMENTATION_STATE_AUTHORITY: NONE

## Purpose and authority

A journey is an end-to-end integration proof of an admitted user/business outcome through at least two material actor-facing surfaces and every necessary canonical owner/handoff, ending in lawful owner readback usable by each authorized participant. It is not a Product census, implementation backlog, screen, route, owner-internal state machine, business writer or runtime status register. Customer, Merchant, Captain and Operator are the only actor-facing surfaces; Identity, DSH, WLT and technical providers are systems/owners/rails, not surfaces. Session/authentication is a supporting prerequisite unless role admission is itself the outcome. Only surfaces materially participating in the specific scenario are included; optional escalation and context-only destinations are separate supporting or exception lanes. A scoped policy/control operation or single-surface proof must not be promoted to a cross-surface closure.

Implement independently ready capabilities under [engineering](engineering.md#capability-scoped-implementation-acceptance-before-global-cutover); close each connected outcome only when its applicable owner-backed criteria pass. [Product](product.md) owns capability admission. Domain owners own substantive rules and configurable values; this document owns the handoffs, observable outcomes and failure proof, not duplicate numerical defaults.

The sixteen existing proof IDs and historical capability mappings retain traceability to the read-only donor at SHA 426d67b47beb8c66b09acd8c7394086b53ac5aae. PARTNER in an ID means Merchant, not another actor. FIRST_THREE_ORDER_CONTACT and ORDER_SCOPED_OPERATIONS_EXCEPTION were mapped to their current capabilities under the 2026-11-14 Product authorization; the latter is a bounded supporting Operations proof with its historic ID preserved, not a second cross-surface journey. Catalogue and Store relation links include capabilities actually exercised. Neither mappings nor original count establish a ceiling or prove implementation.

## MANAGED_PARTICIPANT_ADMISSION — Actor role and standing

JOURNEY_ID: MANAGED_PARTICIPANT_ADMISSION
CAPABILITIES: IDENTITY_ACTIVATION_SESSIONS
SURFACES: OPERATOR, MERCHANT, CAPTAIN
OWNERS: Identity, DSH
ENTRY: Verified eligible human account or authorized managed-role admission.
EXIT: Eligible actor signs into the correct role-scoped surface with current standing.
READBACK: Canonical actor, authentication, session, role and relevant DSH standing.

Verify [Identity](identity.md), [HR](hr.md) and [fulfillment](fulfillment.md) boundaries: Customer verification is a prerequisite, ordinary Merchant self-registration needs no preapproval, Captain admission requires standing, and protected Operator access retains its authority. Reuse the same verified actor; Store membership is not a global role. Duplicate identity, stale invitation, suspended or wrong role, unauthorized assistance, cross-account cache and interrupted admission must fail or recover from owner facts; never create another Root Operator or revive disabled access.

## PARTNER_TO_VISIBLE_STORE — Merchant registration through publication

JOURNEY_ID: PARTNER_TO_VISIBLE_STORE
CAPABILITIES: PARTNER_ONBOARDING_STORE_PUBLICATION, IDENTITY_ACTIVATION_SESSIONS, CENTRAL_CATALOG, STORE_COMMERCIAL_AGREEMENT, STORE_RELATION_MODEL
SURFACES: MERCHANT, OPERATOR, CUSTOMER
OWNERS: Identity, DSH, WLT
ENTRY: Verified Merchant requests a Store in an eligible relation.
EXIT: Approved Store is visible only through its authorized channels.
READBACK: Identity Merchant, one initially unpublished/closed DSH Store, exact accepted and approved WLT agreement, DSH publication and customer-safe projection.

Exercise [Store](stores.md), [catalogue](catalog.md) and [finance](finance.md) owners: approved classification, service city, location, media, catalogue, hours, exact agreement acceptance and Finance approval precede applicable publication. Direct page and marketplace listing have distinct eligibility with one Store identity. Failed consent, retry, invalid ownership/relation, missing catalogue or inactive agreement must retain the correct draft and deny premature publication or payment.

## STORE_ORDERABILITY — Publication does not imply accepting Orders

JOURNEY_ID: STORE_ORDERABILITY
CAPABILITIES: STORE_OPERATIONAL_AVAILABILITY
SURFACES: MERCHANT, CUSTOMER, OPERATOR
OWNERS: DSH
ENTRY: Published Store with eligible service city and admitted fulfillment method.
EXIT: One current, versioned orderability result per Store and method.
READBACK: Authorized schedule/closure/pause mutation and corresponding customer-safe state.

Apply [Store availability](stores.md). Verify publication, schedule, pause, Offer availability, serviceability and method readiness separately, including revalidation at confirmation. Stale or overlapping schedule, offline save, forbidden Store and uncertain result require owner readback; resume must not admit an otherwise unavailable method.

## CATALOG_TO_CUSTOMER_OFFER — One sellable catalogue, two channels

JOURNEY_ID: CATALOG_TO_CUSTOMER_OFFER
CAPABILITIES: CENTRAL_CATALOG, CUSTOMER_STORE_CATALOG
SURFACES: OPERATOR, MERCHANT, CUSTOMER
OWNERS: DSH
ENTRY: Authorized shared or Store-scoped Product, Variant and Offer.
EXIT: Customer reads only eligible current Store/Variant/Offer facts.
READBACK: Taxonomy, Variant, StoreOffer, price, stock and public channel-specific catalogue projection.

Exercise [catalogue](catalog.md): typed attributes, quick entry, price edit, import preview/commit, modifiers, measured quantity, media and stock. Compare full Store Web and compact marketplace projections without treating either as checkout authority. Reject wrong Store/SKU/media, invalid variant/quantity/weight, stale cursor, hidden draft, changed price and duplicate import; recover unknown results from the same writer.

## DISCOVERY_TO_COMMERCE_ENTRY — Content, promotion and funded eligibility

JOURNEY_ID: DISCOVERY_TO_COMMERCE_ENTRY
CAPABILITIES: DISCOVERY_CONTENT, COMMERCE_PROMOTIONS, CENTRAL_CATALOG, STORE_SCOPED_ACCESS_DELEGATION
SURFACES: OPERATOR, MERCHANT, CUSTOMER
OWNERS: DSH, WLT
ENTRY: Authorized author prepares eligible content, banner or promotion.
EXIT: Customer reaches only a currently lawful target or receives an unavailable/expired result.
READBACK: Approved DSH content/target, Store scope, redemption and material WLT funding.

Exercise [commerce](commerce.md), [Store delegation](stores.md) and [finance](finance.md): editorial approval, opt-in, Store scope, target visibility, funded redemption, limits and idempotency. Direct visibility does not grant marketplace discovery. Revoked author, missing opt-in, expired/removed target, exhausted coupon, concurrent redemption or funding refusal must reject safely; re-read actual owner outcomes.

## SINGLE_STORE_ORDER_CREATION — Current quote to one Store Order

JOURNEY_ID: SINGLE_STORE_ORDER_CREATION
CAPABILITIES: SERVICEABILITY_ADDRESSES, CART_CHECKOUT, ORDER_LIFECYCLE, ORDER_PAYMENT_COLLECTION, CUSTOMER_BALANCE_FUNDING, STORE_OPERATIONAL_AVAILABILITY, CENTRAL_CATALOG, COMMERCE_PROMOTIONS
SURFACES: CUSTOMER, MERCHANT
OWNERS: Identity, DSH, WLT
ENTRY: Eligible StoreOffer cart, recipient/address, fulfillment and admitted payment choice.
EXIT: At most one Store Order with consistent payment allocation, or explicit failed/unknown result.
READBACK: DSH Order and immutable quote/channel/policy snapshot; WLT funding, hold and collection state.

Use [commerce](commerce.md), [catalogue](catalog.md), [Store eligibility](stores.md) and [finance](finance.md). Prove current server prices, units, stock, consent, serviceability, cancellation and chosen mode at confirmation, including Direct checkout through the same writer. Recipient OTHER is private contact, not a new actor; client totals and URL parameters confer no authority. Changed price/unit, stale cart, closed Store, invalid channel/location, unavailable mode, expired promotion, insufficient funds, timeout and replay cannot duplicate Order or debit or silently substitute a mode.

## BTHWANI_CAPTAIN_DELIVERY — One assignment and lawful custody

JOURNEY_ID: BTHWANI_CAPTAIN_DELIVERY
CAPABILITIES: ORDER_LIFECYCLE, CAPTAIN_DISPATCH, STORE_CAPTAIN_HANDOFF, FINAL_MILE_DELIVERY, ORDER_PAYMENT_COLLECTION, CAPTAIN_BALANCE_FUNDING, PARTNER_CAPTAIN_EARNINGS_SETTLEMENT
SURFACES: MERCHANT, CAPTAIN, CUSTOMER
OWNERS: DSH, WLT
ENTRY: Accepted and prepared BTHWANI_CAPTAIN Store Order ready for an eligible Captain.
EXIT: One assignment, verified two-sided handoff, valid delivery proof and once-only financial effect or explicit reconciliation.
READBACK: DSH offer/assignment/custody/proof/terminal state; WLT exposure, cash hold, debit, entitlement and receivable.

Verify [fulfillment](fulfillment.md) and [finance](finance.md): enforce current dispatch policy, one winner, no precise address before lawful assignment, approved gross exposure and actual cash-portion hold excluding prepaid funds, release on lawful cancellation, once-only collection debit and retained cash under admitted settlement. Concurrent accepts, stale location, wrong actor, disputed handoff, offline proof, coverage shortage and duplicate delivery must preserve one canonical assignment and reconcilable financial state.

## PARTNER_CAPTAIN_DELIVERY — Store-affiliated Captain, same Order

JOURNEY_ID: PARTNER_CAPTAIN_DELIVERY
CAPABILITIES: STORE_CAPTAIN_MEMBERSHIP, STORE_CAPTAIN_HANDOFF, FINAL_MILE_DELIVERY, ORDER_LIFECYCLE, ORDER_PAYMENT_COLLECTION
SURFACES: MERCHANT, CAPTAIN, CUSTOMER
OWNERS: Identity, DSH, WLT
ENTRY: Eligible PARTNER_CAPTAIN method and accepted current Store membership.
EXIT: Store-owned handoff and delivery complete with lawful collection obligations.
READBACK: Membership, assignment, custody and completion; material WLT Store collection/fee responsibility.

Apply [fulfillment](fulfillment.md) and [finance](finance.md). Prove invitation acceptance by the actual actor, permitted Store assignment, handoff and proof. Store membership confers no platform dispatch privilege or platform earnings. Revocation blocks future work and reconciles existing obligations; wrong Store, stale membership/session, suspension and disputed delivery must fail closed without artificial platform COD hold.

## CUSTOMER_PICKUP — Verified Store/customer handoff

JOURNEY_ID: CUSTOMER_PICKUP
CAPABILITIES: CUSTOMER_PICKUP, ORDER_LIFECYCLE, ORDER_PAYMENT_COLLECTION
SURFACES: CUSTOMER, MERCHANT
OWNERS: DSH, WLT
ENTRY: Accepted/prepared CUSTOMER_PICKUP Store Order is ready.
EXIT: One authorized pickup terminal result with the required financial effect.
READBACK: DSH readiness, handoff proof, terminal state and WLT collection/commission.

Apply [fulfillment](fulfillment.md) and [finance](finance.md). Wrong recipient, unavailable readiness, failed or repeated proof cannot complete twice. No Captain offer, platform COD hold or duplicate pickup Order.

## MULTI_STORE_ORCHESTRATION — Parent intent, independent children

JOURNEY_ID: MULTI_STORE_ORCHESTRATION
CAPABILITIES: MULTI_STORE_CHECKOUT, CART_CHECKOUT, ORDER_LIFECYCLE, ORDER_PAYMENT_COLLECTION, CAPTAIN_DISPATCH, STORE_CAPTAIN_MEMBERSHIP, CUSTOMER_PICKUP
SURFACES: CUSTOMER, MERCHANT, CAPTAIN
OWNERS: DSH, WLT
ENTRY: One permitted multi-Store intent with independently valid carts.
EXIT: Each child has its own confirmed, failed or compensating result; parent is accurate aggregation.
READBACK: DSH child Orders/parent status, WLT per-child funding/liabilities and scoped tasks.

Apply [commerce](commerce.md) and [finance](finance.md). Prove separate quotes, eligibility, Store permissions, custody, cancellation/refund, idempotent child recovery and partial failure. One failed child cannot overwrite another's stock or funds. Parent is not a legal Order, payment or settlement writer.

## ORDER_COMMUNICATION — Private Order-scoped interaction

JOURNEY_ID: ORDER_COMMUNICATION
CAPABILITIES: ORDER_CONVERSATION
SURFACES: CUSTOMER, MERCHANT, CAPTAIN, OPERATOR
OWNERS: DSH
ENTRY: Canonical Order and current participant authority.
EXIT: Authorized interaction reaches bounded read-only closure.
READBACK: Message, attachment, per-recipient visibility/read state and terminal send denial.

Apply [commerce](commerce.md). Test private contact/media access, sender/designated-recipient and authorized Operations scope, explicit Operations composition permission, atomic idempotent message-plus-attachment, terminal rejection of new sends and replay of committed sends. Revocation, prospective Captain, unrelated Store and stale notification/deep link must not disclose content. Upload is not an Order or payment mutation.

## FIRST_THREE_ORDER_CONTACT — Bounded new-Customer confirmation

JOURNEY_ID: FIRST_THREE_ORDER_CONTACT
CAPABILITIES: ORDER_LIFECYCLE
SURFACES: OPERATOR, CUSTOMER
OWNERS: DSH (Identity authorization)
ENTRY: Authorized Operations employee opens an eligible Order contact task.
EXIT: Factual spoken confirmation plus separate completed delivery/pickup proof, or explicit unresolved/no-answer/denied outcome.
READBACK: Claim owner/expiry, actual attempts/result, distinct qualifying Order count and separate fulfillment proof.

Apply [commerce](commerce.md#order-scoped-contact-and-operational-exceptions). Prove one exclusive claim, renewal/release/reclaim and denial of simultaneous actor recording; PENDING at first claim has zero attempts and no call timestamp. Verify actual contact, truthful migration of old placeholders, duplicate/replayed result, wrong account, wrong role and unproven completion cannot advance count. Previously qualified Customers are exempt only from routine calls. The initial non-gating mode preserves Merchant's ordinary orderability/visibility and payment/custody invariants; prove neither call nor claim changes those owner facts. No call-audio recording, duplicated sensitive profile, public trust label or automatic cancellation. Any later preparation gate needs its own admitted cross-owner proof, not a UI-only restriction.

## ORDER_SCOPED_OPERATIONS_EXCEPTION — Evidence-based case resolution

JOURNEY_ID: ORDER_SCOPED_OPERATIONS_EXCEPTION
CAPABILITIES: ORDER_LIFECYCLE, ORDER_PAYMENT_COLLECTION
SURFACES: OPERATOR (supporting proof; other participants read only lawful Order facts)
OWNERS: DSH; WLT for financial evidence
ENTRY: Actual Order-bound signal or authorized Operations attention.
EXIT: Attributable case resolution or explicit pending/reconciliation-required state.
READBACK: Reason, urgency, owner, versioned events, canonical evidence and current state.

Apply [commerce](commerce.md#order-scoped-contact-and-operational-exceptions) and [finance](finance.md). Verify one active case per Order/reason, genuine new occurrence after prior resolution, no reopening from unchanged signal, exclusive claim, owner before manual resolution, scope and version. Exercise urgency-first bounded inbox, unassigned/current-actor filters, private Order-case timeline and read-only eligible evidence list; selected evidence must be rechecked at actual resolution and retained. PAYMENT_EXCEPTION/DELIVERY_BLOCKED require exact applicable posted financial handoff or verified delivery-completion audit with no unresolved obligations. Reject a note alone, cross-Order or stale evidence, unavailable WLT, and denial after authority revocation. Show retained legacy unsupported closures for audit without inventing proof.

Prove actual current stage event and approved stage-effective deadline (UNKNOWN if absent), separately identified noncontractual attention, actual no-answer and no-offer events, one escalation of an eligible unclaimed case and one eligible automatic early-stage resolution on subsequent genuine forward progress. Deny reopening from repeated signals, escalation of claimed/resolved cases, automatic closure of claimed/money/custody cases and inference of Merchant fault, trust, cancellation or SLA breach from missing evidence. Test races, stale version, out-of-order events, interrupted recovery and next eligible state. Actual multi-surface exception/financial outcome remains subject to the connected Order adjustment/refund journey; this supporting proof cannot close it.

## ORDER_ADJUSTMENT_EXCEPTION_REFUND — Lawful post-confirmation changes

JOURNEY_ID: ORDER_ADJUSTMENT_EXCEPTION_REFUND
CAPABILITIES: ORDER_LIFECYCLE, ORDER_PAYMENT_COLLECTION, PARTNER_CAPTAIN_EARNINGS_SETTLEMENT
SURFACES: CUSTOMER, MERCHANT, CAPTAIN, OPERATOR (when needed)
OWNERS: DSH, WLT
ENTRY: Owner-confirmed missing item, measured difference, eligible substitution, cancellation, dispute or financial exception.
EXIT: Attributable adjustment and lawful balanced financial delta/hold release or reconciliation-required state.
READBACK: Original immutable Order, adjustment history and final fulfilled facts; WLT refund/receivable/settlement.

Apply [commerce](commerce.md) and [finance](finance.md). Verify lawful consent for substitution/removal/quantity, frozen terms and permitted actor, once-only authorized refund or compensation, distinct release of unused hold and wallet credit. No rewrite of original terminal Order or generic returns platform. Handoff/cancel race, wrong cash source, duplicate refund, settled liability and offline consent must reconcile without double credit or forgiveness.

## PARTNER_COMMISSION_REMITTANCE — Store-collected proceeds and platform receivable

JOURNEY_ID: PARTNER_COMMISSION_REMITTANCE
CAPABILITIES: ORDER_PAYMENT_COLLECTION, PARTNER_CAPTAIN_EARNINGS_SETTLEMENT
SURFACES: MERCHANT, OPERATOR
OWNERS: WLT (DSH supplies Order evidence)
ENTRY: Eligible commission agreement, actual Store-retained proceeds and outstanding WLT receivable.
EXIT: Authorized payment/offset reconciles and closes receivable or it remains outstanding.
READBACK: Original Store-specific receivable, agreement, evidence, outstanding amount and reconciliation.

Apply [finance](finance.md). Verify matching owner, recipient, statement, authorized offset and actual retained proceeds; no second Merchant wallet earning, automatic Captain COD settlement or subscription inference. Duplicate remittance, mismatched reference, wrong Store, stale statement and provider unknown must leave truthful outstanding state until verified.

## BENEFICIARY_SETTLEMENT — Evidence-backed payout

JOURNEY_ID: BENEFICIARY_SETTLEMENT
CAPABILITIES: PARTNER_CAPTAIN_EARNINGS_SETTLEMENT
SURFACES: MERCHANT, CAPTAIN, OPERATOR
OWNERS: WLT (Identity actor, DSH entitlement evidence)
ENTRY: Eligible earned entitlement including binding historical obligation.
EXIT: Unique executed payout independently matched to evidence, or held/reconciling.
READBACK: Store beneficiary assignment, Identity-derived destination, approval/hold, transfer-specific receipt, statement row and final ledger status.

Apply [finance](finance.md). Verify assignment versus destination change, intake without verified destination as intake only, separate approval/hold/execution/reconciliation, correct Store beneficiary grouping and distinct payouts where needed. Preserve old lawful earnings; new publication does not create retired reward, and Store Captain personal wage is not platform earnings. Stale approval, changed phone/beneficiary, duplicate transfer, statement mismatch, unknown provider result or cross-Store claim must hold/reconcile, not fabricate success.

## Supporting subflows and bounded projections (not additional Journeys)

- [Identity](identity.md): login, verification, protected bootstrap, recovery, finite Operator grants and session invalidation. [HR](hr.md): EMPLOYEE_HR, scoped staff records and protected Operator admission/exit handoffs; test denied cross-employer access and recovery, never infer account authority from employment.
- [Store](stores.md) and [fulfillment](fulfillment.md): delegation, Store Captain invitation and acceptance, lawful tracking and delivery proof. [Commerce](commerce.md): address/cart, bounded completed-Order feedback, contact and exceptions. [Finance](finance.md): Customer and Captain funding, allocation, COD coverage and CUSTOMER_BALANCE_MANUAL_WITHDRAWAL; verify exceptional withdrawal and independent reconciliation rather than self-service payout.
- Notifications follow [architecture](architecture.md) and are scoped idempotent projections of committed events, including invitation/acceptance/activation/suspension/revocation, beneficiary change/review and destination reverification, campaign schedule/activation/end/opt-in, agreement awaiting acceptance/activation, payout and relevant Order/Captain actions. Verify unread totals, scoped pagination, deduplication, bounded delivery without spam, stale/revoked deep-link denial and delivery recovery; receipt on a device is not mutation success. Transport failures must not undo committed owner truth.
- Policy administration uses the actual owner and prospective affected readback. Media, audit, authorization, idempotency, concurrency, offline and unknown-result recovery, restart/resume, privacy/retention, analytics/search/cache and observability are cross-cutting proof, not competing services or writers.

The actual scenario fields are the canonical proof mappings; do not maintain parallel actor/capability/owner/status matrices. Supporting and exception lanes are not new admitted capabilities.

## End-to-end acceptance and provenance

For every affected interface prove applicable loading, empty, ready, pending, success, forbidden, offline, conflict, reconciliation_required and error states or justify inapplicability. Exercise actual intent, current authorization, canonical mutation, cross-owner handoff, correct next surface, failure/retry/unknown outcome, restart/resume and persisted readback. Verify separate actor/Store isolation and actual affected Web/Android/iOS surfaces as applicable; apply [engineering](engineering.md) and [safety](safety.md). A structural check, mock, screenshot, historical source or independent constituent test does not close a journey. Keep evidence at the owning sources, tests, native CI and authorized work items.

The read-only donor journey file at the pinned SHA is historical provenance, not authority to resurrect retired paths or claim legal/runtime acceptance. Material unresolved historical obligations remain open under the [governance index](README.md).
