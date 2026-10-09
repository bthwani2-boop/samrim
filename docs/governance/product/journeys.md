# BThwani Current Journeys

ARTIFACT_CLASS: DURABLE_PRODUCT_GOVERNANCE
SEMANTIC_OWNER: docs/governance/product/journeys.md
EXECUTION_AUTHORITY: NONE
IMPLEMENTATION_STATE_AUTHORITY: NONE

## End-to-end scenario boundary

This document preserves durable cross-capability business scenarios, material handoffs, surface participation and canonical readback expectations. These scenarios are **integration and end-to-end proof lenses**, not implementation slices, slice status, delivery sequence or an authorization to declare code complete. Implementation planning and closure use bounded cross-surface vertical slices derived from current source and admitted Product semantics. A slice may touch many surfaces; not every surface must be changed when unaffected. No separate Journey execution backlog or closure score is maintained here.

A top-level Journey is one end-to-end user/business outcome that crosses at least two material actor-facing surfaces, crosses every canonical business owner/handoff needed by that outcome, and ends with canonical readback usable by every authorized participant.

```text
JOURNEY
≠ SCREEN
≠ ROUTE
≠ SINGLE-SURFACE APP FLOW
≠ CAPABILITY
≠ OWNER-INTERNAL STATE MACHINE
≠ OPERATOR WORKSPACE SECTION
```

The actor-facing surfaces are exactly `CLIENT`, `PARTNER`, `CAPTAIN`, `FIELD` and `OPERATOR`. Identity, DSH, WLT, adapters and external providers are owners/systems/rails, never actor-facing surfaces.

Authentication/session is a prerequisite lane except where role admission is itself the Journey outcome. A surface is listed in `SURFACES` only when it materially participates in the Journey outcome; a merely possible exception or contextual target does not count. Single-surface or owner-internal work remains a supporting subflow, policy/control lane, projection or explicit non-goal.

## MANAGED_PARTICIPANT_ADMISSION — admitted managed actor becomes usable

JOURNEY_ID: MANAGED_PARTICIPANT_ADMISSION
OUTCOME: An eligible managed participant becomes a canonically resolved actor with the admitted high-level role and a usable role-scoped surface session.
SURFACES: OPERATOR, PARTNER, CAPTAIN, FIELD
OWNERS: IDENTITY, DSH
CAPABILITIES: IDENTITY_ACTIVATION_SESSIONS
ENTRY: Authorized DSH domain admission or eligibility exists for Partner, Captain or Field.
EXIT: The target role is admitted and its target surface can authenticate and read owner-backed standing state.
READBACK: Identity role/session readback plus DSH domain-standing readback.

### Frontstage and handoffs

```text
OPERATOR
→ DSH candidate / eligibility
→ authorized Identity role-admission request
→ Identity actor resolution + role admission
→ target PARTNER / CAPTAIN / FIELD activation and authentication
→ DSH standing readback
```

Partner, Captain and Field each use their own role-scoped session. Eligibility, role admission, activation, authentication and resource authorization remain distinct. Client self-registration and Operator bootstrap/recovery remain access subflows.

### Failure / recovery

Duplicate actor risk, ineligible candidate, stale admission, replay, cross-role credential use and interrupted activation fail closed and resume from canonical Identity/DSH state.

### Negative space

No surface grants its own role. Current task assignment never substitutes for standing role admission. No sixth Store-staff role is created.

## PARTNER_TO_VISIBLE_STORE — acquisition to customer-visible Store

JOURNEY_ID: PARTNER_TO_VISIBLE_STORE
OUTCOME: A legitimate prospect progresses through Field, Operator and Partner work to one published Store only after its bound Partner owner accepts the exact Store Commercial Agreement and Finance approves it; the Client then receives the separate customer-safe visibility readback.
SURFACES: FIELD, OPERATOR, PARTNER, CLIENT
OWNERS: IDENTITY, DSH, WLT
CAPABILITIES: PARTNER_ONBOARDING_STORE_PUBLICATION, IDENTITY_ACTIVATION_SESSIONS, CENTRAL_CATALOG, STORE_COMMERCIAL_AGREEMENT
ENTRY: Eligible Field standing or authorized Operator-originated joining work starts a prospective Partner case.
EXIT: The exact Store agreement is Partner-accepted and Finance-approved, initial catalog and final Operator readiness pass, and Store publication plus customer-safe readback are available.
READBACK: Field, Operator and Partner read joining/publication state; Partner and Finance read the canonical agreement state; Client receives the resulting Store projection when catalog/serviceability visibility gates allow it.

### Frontstage and handoffs

```text
OPERATOR → Field candidate/standing
DSH → Identity field-role request
FIELD → JoiningCase work
OPERATOR → review / correction / rejection / admission
DSH → Identity partner-role request
PARTNER → confirm/correct canonical onboarding data
DSH → Store ownership + Service City + Commerce Vertical + Store Type + durable fulfillment-mode policy
WLT → Store-specific agreement proposal
PARTNER → accept exact agreement version and rates
FINANCE → approve; WLT activates only after both gates
FIELD → authorized initial catalog work for the bound joining Store
OPERATOR → final readiness and publication approval
DSH → Store publication
DSH → idempotent Partner Go-Live/catalog handoff and Field mission-complete notification from publication readback
CLIENT → customer-safe Store projection
```

Store publication is not current orderability. Durable enabled fulfillment modes are not temporary mode availability. The JoiningCase remains onboarding history; ongoing Partner Store scope after admission comes from DSH Store ownership and accepted Store-scoped delegation.

### Failure / recovery

Missing/incompatible first-Store facts, correction loops, duplicate logical case, stale version, suspended Field, duplicate-actor risk, missing Partner acceptance, missing Finance approval and interrupted Identity/WLT handoff recover through canonical readback without rebinding the case, actor or agreement version. Missing or inactive agreement blocks publication.

### Negative space

Field does not approve its own case, accept for the Partner or approve financial terms. Operator does not become Partner/Store owner. Store is not a tenant. The first JoiningCase is not a permanent one-Store workspace root.

## STORE_ORDERABILITY — published Store to current ability to accept orders

JOURNEY_ID: STORE_ORDERABILITY
OUTCOME: Partner-maintained operating state is evaluated by DSH and exposed consistently so a Client can know whether the Store and a durably enabled fulfillment mode can accept a new order now, with bounded Operator intervention when authorized.
SURFACES: PARTNER, CLIENT, OPERATOR
OWNERS: DSH
CAPABILITIES: STORE_OPERATIONAL_AVAILABILITY
ENTRY: A published Store has an admitted schedule or bounded operating-state mutation.
EXIT: DSH exposes one current Store/mode orderability result.
READBACK: Partner and Operator receive mutation readback; Client receives customer-safe current orderability.

### Frontstage and handoffs

```text
PARTNER → weekly schedule / temporary pause / resume / allowed temporary mode availability
OPERATOR → bounded authorized operational intervention when required
DSH → validate + version + derive Store/mode orderability
CLIENT → open / closed / paused / unavailable readback
CHECKOUT → revalidate the same DSH result before Order creation
```

### Failure / recovery

Stale schedule, conflicting pause/resume, invalid interval, unauthorized Store scope, attempt to operationally enable an unadmitted fulfillment mode, offline mutation and ambiguous commit reread canonical DSH state. Failed orderability mutation never changes publication, catalog, commercial agreement or serviceability truth.

### Negative space

No numeric capacity engine, mandatory daily check-in, queue forecaster or AI preparation predictor is admitted. Temporary availability does not mutate durable enabled-mode policy or add a fulfillment mode absent from the active Store Commercial Agreement.

## CATALOG_TO_CUSTOMER_OFFER — canonical catalog to customer-safe assortment

JOURNEY_ID: CATALOG_TO_CUSTOMER_OFFER
OUTCOME: Field's authorized initial onboarding and later Operator/Partner catalog work produce one DSH-governed customer-safe Store assortment without exposing internal ownership topology to the Client.
SURFACES: FIELD, OPERATOR, PARTNER, CLIENT
OWNERS: DSH
CAPABILITIES: CENTRAL_CATALOG
ENTRY: An authorized Field initial-catalog, Operator shared-catalog or Partner Store-assortment action begins.
EXIT: Eligible Product/Variant/StoreOffer content is published or intentionally remains ineligible.
READBACK: Field receives authorized pre-Go-Live mutation readback, Operator/Partner receive their authorized mutation readback, and the Client storefront readback comes from DSH.

### Frontstage and handoffs

```text
OPERATOR → vertical / taxonomy / shared Product / Variant / proposal review / import
FIELD (before Go-Live, assigned Store only) → shared search/scan, initial StoreOffers, Store-local items, import and Shared proposals/corrections
PARTNER (after Go-Live) → ongoing Store offers / local items / price / availability / section / modifier
DSH → canonical validation + CUSTOMER_VISIBLE_OFFER evaluation
CLIENT → coherent storefront assortment
```

Shared Product, Variant, identifiers, taxonomy, typed attributes, Store-local Product, StoreOffer, StorefrontSection, modifiers, proposals, import preview/commit and media relationships remain distinct bounded meanings. `VARIABLE_MEASURE` preserves requested quantity/range and can receive actual fulfilled quantity through the Order-adjustment boundary. Current inventory remains availability-only unless finite reservation is separately admitted.

### Failure / recovery

Invalid taxonomy, identifier conflict, stale price/offer, invalid modifier/quantity, duplicate import, unavailable offer and direct-ID bypass fail closed and converge on DSH readback.

### Negative space

Catalog visibility does not prove Store orderability, serviceability or checkout eligibility. Catalog is not PIM/ERP/POS authority.
Field initial write authority ends at Go-Live and is enforced by DSH; Field cannot approve or merge a Shared identity. A Store's customer-facing assortment may combine Shared and Store-scoped Products without exposing that ownership split.

## DISCOVERY_TO_COMMERCE_ENTRY — governed discovery and promotion to valid target

JOURNEY_ID: DISCOVERY_TO_COMMERCE_ENTRY
OUTCOME: Authorized discovery content or an Operator/Partner commercial promotion reaches a Client through an eligible canonical target while any funded promotion preserves the WLT funding boundary.
SURFACES: OPERATOR, PARTNER, CLIENT
OWNERS: DSH, WLT
CAPABILITIES: DISCOVERY_CONTENT, COMMERCE_PROMOTIONS, CENTRAL_CATALOG, STORE_SCOPED_ACCESS_DELEGATION
ENTRY: Authorized content, platform campaign or Store promotion enters its governed review/eligibility lifecycle.
EXIT: Client reaches a valid Store/Product/Category/commerce target or the content/promotion is ineligible, exhausted, not opted-in, cancelled or expired.
READBACK: Publication/eligibility is DSH-backed and funded promotion effect is WLT-backed through the promotion capability.

### Parallel lanes

```text
EDITORIAL: OPERATOR → Discovery Content → DSH publication → CLIENT target
PLATFORM COMMERCIAL: OPERATOR → Platform Campaign → eligible PARTNER opt-in where required → DSH eligibility → WLT funding effect → CLIENT application
STORE COMMERCIAL: PARTNER owner/authorized Store delegate → Store Promotion → DSH Store/catalog eligibility → WLT funding effect when applicable → CLIENT application
```

Partner promotion authority remains bounded to Stores authorized by DSH. Multi-Store authoring never widens Store access and never rewrites base StoreOffer prices.

### Failure / recovery

Expired target, invalid Store/catalog scope, stale publication/version, missing campaign opt-in, concurrent redemption, exhausted coupon, unauthorized Partner delegate, funding refusal and retry conflict fail closed. A banner, UI price decoration or client request never becomes discount/funding authority.

### Negative space

No loyalty, paid membership, social-content network, generic marketing automation, AI targeting, dynamic pricing or app-local publication authority is implied.

## SINGLE_STORE_ORDER_CREATION — Client intent to canonical Store Order

JOURNEY_ID: SINGLE_STORE_ORDER_CREATION
OUTCOME: A Client confirms one Store-scoped commerce intent and the Partner receives at most one canonical Store Order from current catalog, serviceability, Store orderability and financial evidence.
SURFACES: CLIENT, PARTNER
OWNERS: DSH, WLT
CAPABILITIES: SERVICEABILITY_ADDRESSES, CART_CHECKOUT, ORDER_LIFECYCLE, ORDER_PAYMENT_COLLECTION, CUSTOMER_BALANCE_FUNDING, STORE_OPERATIONAL_AVAILABILITY, CENTRAL_CATALOG, COMMERCE_PROMOTIONS
ENTRY: Client has an eligible Store/Offer/cart and chooses an admitted fulfillment intent.
EXIT: One Store Order and its payment/collection intent exist or confirmation fails without duplicate effect.
READBACK: Client and Partner read the canonical Store Order; Client sees WLT-backed payment state where applicable.

### Frontstage and handoffs

```text
CLIENT → address / Store / Offer / Variant / quantity / modifiers / fulfillment intent / payment intent / promotion or coupon intent where applicable
DSH → revalidate serviceability + offer + Store/mode orderability + promotion eligibility + cart evidence
WLT → establish payment/collection and funded-promotion effects
DSH → create at most one canonical Store Order with immutable applicable promotion snapshot
PARTNER → new Order readback
```

A delivery recipient may be `SELF` or `OTHER`. An `OTHER` recipient is bounded delivery-contact data, not a Human Actor or Order/payment principal.

### Supporting financial subflow

`CUSTOMER_BALANCE_FUNDING` may fund WLT internal balance before checkout. The external provider remains a rail, not checkout or ledger authority.

### Failure / recovery

Stale cart, closed/paused Store, unavailable selected mode, unavailable Offer, invalid/expired/exhausted promotion, unserviceable address, invalid recipient data, financial refusal, duplicate confirmation, conflict and unknown cross-owner outcome recover through owner readback/reconciliation without silently creating another Order or changing modes.

### Negative space

No scheduled customer-order lifecycle or generic point-to-point courier request is admitted.

## BTHWANI_CAPTAIN_DELIVERY — Store readiness to delivered by platform Captain

JOURNEY_ID: BTHWANI_CAPTAIN_DELIVERY
OUTCOME: A Partner-ready BThwani-Captain Order is accepted by an eligible Captain, transferred into canonical custody and completed to the Client with explicit tracking/proof and financial effects.
SURFACES: PARTNER, CAPTAIN, CLIENT
OWNERS: DSH, WLT
CAPABILITIES: ORDER_LIFECYCLE, CAPTAIN_DISPATCH, STORE_CAPTAIN_HANDOFF, FINAL_MILE_DELIVERY, ORDER_PAYMENT_COLLECTION, CAPTAIN_BALANCE_FUNDING, PARTNER_CAPTAIN_FIELD_EARNINGS_SETTLEMENT
ENTRY: Partner has accepted/prepared an Order with fulfillment mode `BTHWANI_CAPTAIN` and marks it ready for dispatch.
EXIT: Delivery reaches a legal terminal result and applicable WLT effects are committed or explicitly reconciling.
READBACK: Partner, Captain and Client read one DSH delivery result; WLT financial readback remains separate.

### Frontstage and handoffs

```text
PARTNER → accept / prepare / ready
DSH + WLT → Captain dispatch eligibility + COD exposure if applicable
CAPTAIN → offer accept
DSH → assignment
PARTNER ↔ CAPTAIN → two-sided handoff
DSH → custody
CAPTAIN → final mile + bounded delivery proof
DSH → terminal delivery result
CLIENT / PARTNER / CAPTAIN → tracking/completion readback
WLT → collection / receivable / earning effects
```

Tracking is a DSH projection. Proof is bounded evidence validated by DSH; upload/UI success alone is never delivery truth. `CAPTAIN_BALANCE_FUNDING` remains a supporting balance/collateral subflow, not earnings or COD remittance.

### Failure / recovery

Offer race, assignment conflict, handoff disagreement, connectivity loss, invalid proof, failed delivery, recipient/customer unavailable, payment uncertainty and duplicate terminal action preserve one assignment/custody/delivery truth. Operational exceptions requiring Operator action transfer to `ORDER_ADJUSTMENT_EXCEPTION_REFUND` rather than making Operator part of the normal fulfillment Journey.

### Negative space

Not Partner-Captain delivery, not Customer Pickup, not advanced route optimization and not Captain-authored earnings.

## PARTNER_CAPTAIN_DELIVERY — Store-affiliated Captain fulfillment

JOURNEY_ID: PARTNER_CAPTAIN_DELIVERY
OUTCOME: A Store-affiliated canonical Captain uses an accepted Store relationship to complete an eligible Partner-Captain Order to the Client without reusing BThwani-Captain financial semantics.
SURFACES: PARTNER, CAPTAIN, CLIENT
OWNERS: DSH, WLT
CAPABILITIES: STORE_CAPTAIN_MEMBERSHIP, STORE_CAPTAIN_HANDOFF, FINAL_MILE_DELIVERY, ORDER_LIFECYCLE, ORDER_PAYMENT_COLLECTION
ENTRY: Order mode is `PARTNER_CAPTAIN` and an active accepted Store-Captain membership exists.
EXIT: Delivery reaches a legal terminal DSH result with Store-owned internal Captain remuneration remaining outside WLT.
READBACK: Partner, Captain and Client read canonical fulfillment result.

### Supporting membership subflow

```text
PARTNER → invite canonical eligible Captain
CAPTAIN → accept / decline
DSH → ACTIVE membership only after acceptance
PARTNER → suspend/remove when authorized
CAPTAIN → leave when current policy permits
```

### Failure / recovery

Unaccepted/expired membership, stale membership, wrong Store, handoff disagreement and delivery failure fail closed. Membership history is not rewritten by later suspension/removal. Operator-required exceptions transfer to the exception Journey.

### Negative space

Partner Captain is not a sixth role. Store-Captain remuneration does not create BThwani-Captain wallet, earning or COD-receivable semantics.

## CUSTOMER_PICKUP — Partner readiness to customer pickup

JOURNEY_ID: CUSTOMER_PICKUP
OUTCOME: A Client completes a Store Order directly with the Partner through bounded pickup readiness/proof without introducing Captain semantics.
SURFACES: CLIENT, PARTNER
OWNERS: DSH, WLT
CAPABILITIES: CUSTOMER_PICKUP, ORDER_LIFECYCLE, ORDER_PAYMENT_COLLECTION
ENTRY: Store Order fulfillment mode is `CUSTOMER_PICKUP`.
EXIT: DSH records canonical pickup completion and WLT applies relevant collection/commission effects.
READBACK: Client and Partner receive one canonical pickup result.

### Frontstage and handoffs

```text
PARTNER → accept / prepare / ready for pickup
CLIENT → arrives
CLIENT ↔ PARTNER → bounded pickup proof
DSH → CUSTOMER_PICKED_UP
WLT → applicable collection / Partner commission effect
```

### Failure / recovery

Wrong proof, stale readiness, cancellation and payment uncertainty remain explicit and recover through canonical readback.

### Negative space

No Captain dispatch, Captain custody, Captain COD exposure or delivery-address requirement is introduced merely because other modes use them.

## MULTI_STORE_ORCHESTRATION — parent checkout to independent Store Orders

JOURNEY_ID: MULTI_STORE_ORCHESTRATION
OUTCOME: One Client parent checkout coordinates independent Store Orders without erasing each Store's fulfillment, payment, exception or completion truth.
SURFACES: CLIENT, PARTNER, CAPTAIN
OWNERS: DSH, WLT
CAPABILITIES: MULTI_STORE_CHECKOUT, CART_CHECKOUT, ORDER_LIFECYCLE, ORDER_PAYMENT_COLLECTION, CAPTAIN_DISPATCH, STORE_CAPTAIN_MEMBERSHIP, CUSTOMER_PICKUP
ENTRY: Client confirms a parent intent containing eligible carts for multiple Stores.
EXIT: Each child Store Order has an independent result and parent orchestration exposes canonical aggregate readback.
READBACK: Client sees parent + child results; each Partner/Captain sees only authorized child work.

### Orchestration

```text
PARENT INTENT
→ child Store Order A
→ child Store Order B
→ ...
→ per-child payment + fulfillment + adjustment/exception/cancellation/refund
→ optional bounded grouped execution plan
→ parent reconciliation/readback
```

### Failure / recovery

Partial child failure, duplicate parent retry, one-child cancellation/refund and grouped-plan failure do not rewrite successful siblings.

### Negative space

There is no single multi-Store Order and no advanced route optimizer implied by grouped coordination.

## ORDER_COMMUNICATION — order-scoped participant collaboration

JOURNEY_ID: ORDER_COMMUNICATION
OUTCOME: Authorized participants of one Store Order communicate during the legal conversation window without conversation state becoming Order, custody, payment or support-ticket authority.
SURFACES: CLIENT, PARTNER, CAPTAIN, OPERATOR
OWNERS: DSH
CAPABILITIES: ORDER_CONVERSATION
ENTRY: A canonical Store Order exists and the actor is a current authorized participant or an authorized escalation participant.
EXIT: Conversation enters governed read-only closure after operational completion and grace policy.
READBACK: Messages, membership, unread/read and closure state are canonical DSH conversation readback.

### Parallel lane

Conversation runs beside normal fulfillment. Captain participates only while assignment/member rules authorize it; Operator participates only through authorized escalation. Notifications are derived from owner events and may deep-link to the conversation; provider delivery failure does not change message or Order truth.

### Failure / recovery

Duplicate message retry, media upload failure, membership change, stale read receipt, offline send and post-closure write fail/recover against DSH state.

### Negative space

No generic customer-support ticket platform. Messages do not prove delivery, payment or refund approval.

## ORDER_ADJUSTMENT_EXCEPTION_REFUND — legal order change or exception to reconciled result

JOURNEY_ID: ORDER_ADJUSTMENT_EXCEPTION_REFUND
OUTCOME: A material Order problem or legal post-confirmation change is resolved across affected participants without rewriting the original Order snapshot or hiding operational/financial consequences.
SURFACES: CLIENT, PARTNER, CAPTAIN, OPERATOR
OWNERS: DSH, WLT
CAPABILITIES: ORDER_LIFECYCLE, ORDER_PAYMENT_COLLECTION, PARTNER_CAPTAIN_FIELD_EARNINGS_SETTLEMENT
ENTRY: A canonical Order encounters an allowed adjustment, cancellation, fulfillment failure, dispute or Order-bound financial exception.
EXIT: Operational and financial outcomes are committed or explicitly remain reconciliation-required.
READBACK: Affected surfaces read canonical DSH operational result and WLT financial result.

### Order adjustment branch

```text
PARTNER → item unavailable / actual quantity differs
DSH → validate canonical OrderLine + allowed action
→ remove item OR propose eligible substitute OR record actual measured quantity
CLIENT → approve / reject / alternate when required
DSH → append attributable adjustment + final fulfilled snapshot
WLT → delta / refund / additional legal financial treatment
PARTNER → continue only when mandatory adjustment is resolved
```

Original confirmation snapshot remains immutable; adjustments are attributable facts with stable retry identity.

### Exception branches

Pre-accept cancellation, post-accept cancellation, preparation failure, customer rejection of adjustment, custody mismatch, delivery failure, unavailable customer/recipient, governed return-to-Store when required, payment uncertainty, refund, external RefundCase and post-completion wrong/damaged/missing dispute remain explicit branches. Post-completion dispute does not silently reopen the completed Order. Operator/Finance participation occurs only where the exception requires authorized intervention.

### Failure / recovery

Concurrent cancellation/fulfillment, stale adjustment, duplicate refund, unknown external movement, custody ambiguity and offline participant response fail closed or remain reconciliation-required until owner readback resolves them.

### Negative space

Customer balance withdrawal is not an Order exception and remains a separate supporting financial subflow. No generic returns/exchange/warranty platform is admitted.

## CAPTAIN_COD_REMITTANCE — Captain cash receivable to reconciled closure

JOURNEY_ID: CAPTAIN_COD_REMITTANCE
OUTCOME: BThwani Captain-held COD cash is remitted through authorized Finance treatment until the WLT receivable/exposure is canonically closed.
SURFACES: CAPTAIN, OPERATOR
OWNERS: DSH, WLT
CAPABILITIES: ORDER_PAYMENT_COLLECTION, PARTNER_CAPTAIN_FIELD_EARNINGS_SETTLEMENT
ENTRY: WLT has an open BThwani-Captain COD receivable backed by qualifying delivered-order evidence.
EXIT: Authorized remittance evidence is independently reconciled and WLT closes the corresponding receivable/exposure.
READBACK: Captain sees resulting liability/balance state; Finance reads canonical WLT reconciliation state.

### Failure / recovery

Partial/duplicate remittance, wrong reference, unknown provider/statement outcome and reconciliation mismatch remain explicit. Delivery completion alone never closes the receivable.

### Negative space

COD remittance is not Captain balance Cash-In and not Captain earnings payout.

## PARTNER_COMMISSION_REMITTANCE — Partner receivable to reconciled closure

JOURNEY_ID: PARTNER_COMMISSION_REMITTANCE
OUTCOME: A Partner commission receivable arising from Store-retained customer proceeds is settled or legally offset until WLT records canonical closure.
SURFACES: PARTNER, OPERATOR
OWNERS: DSH, WLT
CAPABILITIES: ORDER_PAYMENT_COLLECTION, PARTNER_CAPTAIN_FIELD_EARNINGS_SETTLEMENT
ENTRY: WLT has an open Partner commission receivable from an eligible Store Order.
EXIT: Authorized payment/offset is reconciled and WLT closes or updates the receivable.
READBACK: Partner and Finance read the same WLT receivable result.

### Failure / recovery

Duplicate remittance, unauthorized offset, mismatched amount/reference and unknown external outcome remain explicit and reconcile before another movement.

### Negative space

Store-retained sale proceeds are not re-credited as a duplicate Partner wallet earning.

## BENEFICIARY_SETTLEMENT — earned entitlement to reconciled payout

JOURNEY_ID: BENEFICIARY_SETTLEMENT
OUTCOME: Eligible Partner, BThwani Captain or Field entitlement reaches an authorized reconciled payout/settlement result without surfaces becoming ledger writers; the first qualifying Field-attributed Store that becomes `STORE_CLIENT_VISIBLE` produces one acquisition earning per joining case.
SURFACES: PARTNER, CAPTAIN, FIELD, OPERATOR
OWNERS: DSH, WLT
CAPABILITIES: PARTNER_CAPTAIN_FIELD_EARNINGS_SETTLEMENT
ENTRY: DSH qualifying evidence has produced a WLT entitlement eligible for settlement.
EXIT: Payout is executed with immutable approved destination evidence and independently reconciled, or remains explicitly held/reconciling.
READBACK: Beneficiary surface and Finance read canonical WLT settlement state.

### Frontstage and handoffs

```text
DSH qualifying event
→ WLT entitlement / eligibility / hold
→ for the first qualifying `STORE_CLIENT_VISIBLE` Store only, WLT records exactly one Field acquisition earning per joining case
→ PARTNER owner optionally assigns one eligible beneficiary to each Store; WLT records separate Store-scoped recipient assignments and resolves the beneficiary's verified destination
→ OPERATOR Finance preparation + approval + execution evidence
→ WLT preserves Store attribution and partitions payout groups by effective recipient and verified destination
→ independent reconciliation
→ WLT completion
→ PARTNER / CAPTAIN / FIELD readback
→ Field reward notification only after WLT entitlement readback
```

### Failure / recovery

Destination change, stale approval, duplicate execution, provider uncertainty and statement mismatch never infer success from UI evidence; WLT finalizes only from governed reconciliation.

### Negative space

Store-affiliated Captain remuneration remains outside BThwani WLT earnings semantics. Field acquisition entitlement and payout are downstream of Store publication and never gate publication; repeated visibility or publication does not create another entitlement.

## Supporting subflows and cross-cutting lanes

These are materially governed but are not promoted to top-level Journeys merely to satisfy coverage:

| ID | Disposition | Capability / owner | Participation |
|---|---|---|---|
| CLIENT_REGISTRATION_SESSION | SUPPORTING_SUBFLOW | `IDENTITY_ACTIVATION_SESSIONS` / Identity | Client access prerequisite |
| OPERATOR_BOOTSTRAP_SESSION | SUPPORTING_SUBFLOW | `IDENTITY_ACTIVATION_SESSIONS` / Identity | Operator access prerequisite |
| ROLE_SESSION_RECOVERY | SUPPORTING_SUBFLOW | `IDENTITY_ACTIVATION_SESSIONS` / Identity | managed-role recovery |
| OPERATOR_PERMISSION_ADMINISTRATION | POLICY_FLOW | `IDENTITY_ACTIVATION_SESSIONS` / Identity | finite Operator scopes + session invalidation |
| PLATFORM_POLICY_ADMINISTRATION | POLICY_FLOW | Identity / DSH / WLT by typed policy owner | Operator mutation + prospective affected-surface readback |
| STORE_SCOPED_DELEGATION | SUPPORTING_SUBFLOW | `STORE_SCOPED_ACCESS_DELEGATION` / DSH + Identity admission | phone-resolved Partner-workspace authority for one or more Store scopes; canonical grants remain Store-scoped |
| STORE_CAPTAIN_MEMBERSHIP | SUPPORTING_SUBFLOW | `STORE_CAPTAIN_MEMBERSHIP` / DSH | accepted Partner-Captain relationship |
| ADDRESS_MANAGEMENT | SUPPORTING_SUBFLOW | `SERVICEABILITY_ADDRESSES` / DSH | ordering prerequisite |
| CART_MANAGEMENT | SUPPORTING_SUBFLOW | `CART_CHECKOUT` / DSH | ordering prerequisite |
| CUSTOMER_BALANCE_FUNDING | SUPPORTING_SUBFLOW | `CUSTOMER_BALANCE_FUNDING` / WLT | internal-balance funding |
| CAPTAIN_BALANCE_FUNDING | SUPPORTING_SUBFLOW | `CAPTAIN_BALANCE_FUNDING` / WLT | BThwani-Captain balance funding |
| PAYMENT_ALLOCATION | SUPPORTING_SUBFLOW | `ORDER_PAYMENT_COLLECTION` / WLT | checkout/payment boundary |
| COD_EXPOSURE_HOLD | SUPPORTING_SUBFLOW | `ORDER_PAYMENT_COLLECTION` / WLT | BThwani-Captain dispatch boundary |
| CUSTOMER_MANUAL_WITHDRAWAL | SUPPORTING_SUBFLOW | `CUSTOMER_BALANCE_MANUAL_WITHDRAWAL` / WLT | Client request → Operations/Finance → independent reconciliation |
| ORDER_FEEDBACK | SUPPORTING_SUBFLOW | `ORDER_LIFECYCLE` / DSH | bounded completed-Order feedback |
| NOTIFICATIONS | PROJECTION | DSH owner events + delivery adapter | many Journeys |
| TRACKING | PROJECTION | DSH | Captain fulfillment Journeys |
| MEDIA | CROSS_CUTTING_LANE | DSH relationship + media adapter | catalog/conversation/content |
| DELIVERY_PROOF | CROSS_CUTTING_LANE | DSH | delivery/pickup evidence |
| AUDIT | CROSS_CUTTING_LANE | each canonical owner | attributable mutation evidence |
| AUTHORIZATION | CROSS_CUTTING_LANE | each canonical owner | every material action/handoff |
| IDEMPOTENCY | CROSS_CUTTING_LANE | each mutation owner | duplicate-safe effects |
| CONCURRENCY | CROSS_CUTTING_LANE | each mutation owner | stale/conflicting mutation |
| OFFLINE_RECOVERY | CROSS_CUTTING_LANE | surface + canonical owner readback | applicable Journeys |
| UNKNOWN_OUTCOME | CROSS_CUTTING_LANE | receiving owner + reconciliation | cross-owner/provider effects |
| RESTART_RESUME | CROSS_CUTTING_LANE | canonical owner readback | applicable Journeys |
| PRIVACY_SECURITY_RETENTION | POLICY_FLOW | DATA/SECURITY policy + canonical owner | minimization, access, retention, evidence |
| ANALYTICS_SEARCH_CACHE | PROJECTION | derived | no mutation authority |
| OBSERVABILITY | CROSS_CUTTING_LANE | runtime operations | evidence, not business authority |

Notification projections are bounded, idempotent derivations of committed canonical owner state under this lane; they never become a second writer of owner facts. Material event classes currently requiring a projection include: Store-scoped delegation invitation, acceptance, activation, suspension and revocation; Store payout-recipient assignment change or required owner review; Finance destination reverification staleness; promotion scheduling/activation/ending and platform-campaign availability/opt-in where Partner- or customer-visible; Store Commercial Agreement awaiting acceptance or version activation; payout lifecycle transitions and payout readiness. Avoiding notification spam is part of the bounded projection law.

## Matrix — Journey × Surface

| Journey | CLIENT | PARTNER | CAPTAIN | FIELD | OPERATOR |
|---|---|---|---|---|---|
| MANAGED_PARTICIPANT_ADMISSION | — | DIRECT | DIRECT | DIRECT | DIRECT |
| PARTNER_TO_VISIBLE_STORE | READBACK | DIRECT | — | DIRECT | DIRECT |
| STORE_ORDERABILITY | DIRECT | DIRECT | — | — | CONDITIONAL |
| CATALOG_TO_CUSTOMER_OFFER | DIRECT | DIRECT | — | DIRECT | DIRECT |
| DISCOVERY_TO_COMMERCE_ENTRY | DIRECT | DIRECT | — | — | DIRECT |
| SINGLE_STORE_ORDER_CREATION | DIRECT | READBACK | — | — | — |
| BTHWANI_CAPTAIN_DELIVERY | DIRECT | DIRECT | DIRECT | — | — |
| PARTNER_CAPTAIN_DELIVERY | DIRECT | DIRECT | DIRECT | — | — |
| CUSTOMER_PICKUP | DIRECT | DIRECT | — | — | — |
| MULTI_STORE_ORCHESTRATION | DIRECT | DIRECT | CONDITIONAL | — | — |
| ORDER_COMMUNICATION | DIRECT | DIRECT | CONDITIONAL | — | CONDITIONAL |
| ORDER_ADJUSTMENT_EXCEPTION_REFUND | DIRECT | DIRECT | CONDITIONAL | — | CONDITIONAL |
| CAPTAIN_COD_REMITTANCE | — | — | DIRECT | — | DIRECT |
| PARTNER_COMMISSION_REMITTANCE | — | DIRECT | — | — | DIRECT |
| BENEFICIARY_SETTLEMENT | — | DIRECT | DIRECT | DIRECT | DIRECT |

## Matrix — Capability participation

| Capability | Primary Journey / disposition | Relation |
|---|---|---|
| `IDENTITY_ACTIVATION_SESSIONS` | MANAGED_PARTICIPANT_ADMISSION | PRIMARY + SUPPORTING ACCESS |
| `PARTNER_ONBOARDING_STORE_PUBLICATION` | PARTNER_TO_VISIBLE_STORE | PRIMARY |
| `STORE_OPERATIONAL_AVAILABILITY` | STORE_ORDERABILITY | PRIMARY |
| `CENTRAL_CATALOG` | CATALOG_TO_CUSTOMER_OFFER | PRIMARY |
| `SERVICEABILITY_ADDRESSES` | SINGLE_STORE_ORDER_CREATION | SUPPORTING |
| `CART_CHECKOUT` | SINGLE_STORE_ORDER_CREATION | PRIMARY |
| `ORDER_LIFECYCLE` | SINGLE_STORE_ORDER_CREATION / fulfillment / exception | PRIMARY |
| `CAPTAIN_DISPATCH` | BTHWANI_CAPTAIN_DELIVERY | PRIMARY |
| `STORE_CAPTAIN_HANDOFF` | BTHWANI_CAPTAIN_DELIVERY / PARTNER_CAPTAIN_DELIVERY | PRIMARY |
| `FINAL_MILE_DELIVERY` | BTHWANI_CAPTAIN_DELIVERY / PARTNER_CAPTAIN_DELIVERY | PRIMARY |
| `ORDER_PAYMENT_COLLECTION` | PAYMENT_ALLOCATION / COD_EXPOSURE_HOLD / CAPTAIN_COD_REMITTANCE / PARTNER_COMMISSION_REMITTANCE / ORDER_ADJUSTMENT_EXCEPTION_REFUND (order / fulfillment / remittance / exception) | SUPPORTING FINANCIAL OWNER |
| `STORE_COMMERCIAL_AGREEMENT` | PARTNER_TO_VISIBLE_STORE + durable fulfillment-mode changes | PRIMARY FINANCIAL PREREQUISITE |
| `CUSTOMER_BALANCE_FUNDING` | CUSTOMER_BALANCE_FUNDING subflow | SUPPORTING_SUBFLOW |
| `CAPTAIN_BALANCE_FUNDING` | CAPTAIN_BALANCE_FUNDING subflow | SUPPORTING_SUBFLOW |
| `PARTNER_CAPTAIN_FIELD_EARNINGS_SETTLEMENT` | BENEFICIARY_SETTLEMENT + remittance Journeys | PRIMARY |
| `CUSTOMER_BALANCE_MANUAL_WITHDRAWAL` | CUSTOMER_MANUAL_WITHDRAWAL subflow | SUPPORTING_SUBFLOW |
| `STORE_CAPTAIN_MEMBERSHIP` | PARTNER_CAPTAIN_DELIVERY | SUPPORTING |
| `STORE_SCOPED_ACCESS_DELEGATION` | STORE_SCOPED_DELEGATION + Partner promotion authorization | SUPPORTING_SUBFLOW |
| `CUSTOMER_PICKUP` | CUSTOMER_PICKUP | PRIMARY |
| `ORDER_CONVERSATION` | ORDER_COMMUNICATION | PRIMARY |
| `COMMERCE_PROMOTIONS` | DISCOVERY_TO_COMMERCE_ENTRY + SINGLE_STORE_ORDER_CREATION | PRIMARY |
| `DISCOVERY_CONTENT` | DISCOVERY_TO_COMMERCE_ENTRY | PRIMARY |
| `MULTI_STORE_CHECKOUT` | MULTI_STORE_ORCHESTRATION | PRIMARY |

## Matrix — Journey × Canonical Owner

| Journey | IDENTITY | DSH | WLT |
|---|---|---|---|
| MANAGED_PARTICIPANT_ADMISSION | PRIMARY | ELIGIBILITY | — |
| PARTNER_TO_VISIBLE_STORE | ROLE ADMISSION | PRIMARY | AGREEMENT ACCEPTANCE / FINANCE APPROVAL |
| STORE_ORDERABILITY | — | PRIMARY | — |
| CATALOG_TO_CUSTOMER_OFFER | — | PRIMARY | — |
| DISCOVERY_TO_COMMERCE_ENTRY | — | PRIMARY | FUNDED PROMOTION EFFECT |
| SINGLE_STORE_ORDER_CREATION | — | PRIMARY | PAYMENT/COLLECTION/PROMOTION FUNDING |
| BTHWANI_CAPTAIN_DELIVERY | — | FULFILLMENT | COD/COLLECTION/EARNING |
| PARTNER_CAPTAIN_DELIVERY | — | FULFILLMENT | ORDER COLLECTION WHERE APPLICABLE |
| CUSTOMER_PICKUP | — | PICKUP | COLLECTION/COMMISSION |
| MULTI_STORE_ORCHESTRATION | — | PRIMARY | PER-CHILD FINANCE |
| ORDER_COMMUNICATION | — | PRIMARY | — |
| ORDER_ADJUSTMENT_EXCEPTION_REFUND | — | OPERATIONAL EXCEPTION | DELTA/REFUND/RECONCILIATION |
| CAPTAIN_COD_REMITTANCE | — | QUALIFYING EVIDENCE | PRIMARY |
| PARTNER_COMMISSION_REMITTANCE | — | QUALIFYING EVIDENCE | PRIMARY |
| BENEFICIARY_SETTLEMENT | — | QUALIFYING EVIDENCE | PRIMARY |

## Platform material census

Every currently material concept must have one explicit disposition. Absence from a top-level Journey is not omission when deliberately classified here or in the supporting-lanes table.

| Material concept | Canonical owner | Disposition | Placement | Status |
|---|---|---|---|---|
| Human Actor / managed role admission | Identity + domain eligibility | TOP_LEVEL_MULTI_SURFACE_JOURNEY | MANAGED_PARTICIPANT_ADMISSION | MAPPED |
| Canonical official identity name | Identity | CROSS_CUTTING_LANE | MANAGED_PARTICIPANT_ADMISSION + BENEFICIARY_SETTLEMENT | MAPPED |
| Client registration/session/recovery | Identity | SUPPORTING_SUBFLOW | CLIENT_REGISTRATION_SESSION | MAPPED |
| Operator bootstrap/session/recovery | Identity | SUPPORTING_SUBFLOW | OPERATOR_BOOTSTRAP_SESSION | MAPPED |
| Operator finite permissions | Identity | POLICY_FLOW | OPERATOR_PERMISSION_ADMINISTRATION | MAPPED |
| Typed/versioned platform policies | policy-specific Identity/DSH/WLT owner | POLICY_FLOW | PLATFORM_POLICY_ADMINISTRATION | MAPPED |
| Partner joining / Store ownership / publication | DSH + Identity role handoff + WLT agreement | TOP_LEVEL_MULTI_SURFACE_JOURNEY | PARTNER_TO_VISIBLE_STORE | MAPPED |
| Ongoing Partner Store scope after onboarding | DSH Store ownership + accepted Store grants | SUPPORTING_SUBFLOW | STORE_SCOPED_DELEGATION + Store-scoped Journeys | MAPPED |
| Store-specific Partner commercial terms | WLT; DSH Store context; bound Partner acceptance; Finance approval | FINANCIAL_PUBLICATION_PREREQUISITE | PARTNER_TO_VISIBLE_STORE | MAPPED |
| Store schedule / pause / temporary mode orderability | DSH | TOP_LEVEL_MULTI_SURFACE_JOURNEY | STORE_ORDERABILITY | MAPPED |
| Durable Store fulfillment-mode policy | DSH + WLT agreement prerequisite where financially material | POLICY_FLOW | PARTNER_TO_VISIBLE_STORE + STORE_ORDERABILITY | MAPPED |
| Catalog / variants / identifiers / taxonomy / typed attributes / offers / sections / modifiers | DSH | TOP_LEVEL_MULTI_SURFACE_JOURNEY | CATALOG_TO_CUSTOMER_OFFER | MAPPED |
| Field initial catalog authority | DSH server-side joining-Store scope until Go-Live | SUPPORTING_SUBFLOW | CATALOG_TO_CUSTOMER_OFFER | MAPPED |
| Product proposals / import preview / import commit / catalog media relation | DSH | SUPPORTING_SUBFLOW | CATALOG_TO_CUSTOMER_OFFER | MAPPED |
| Current availability-only inventory semantics | DSH | SUPPORTING_SUBFLOW | CATALOG_TO_CUSTOMER_OFFER + checkout | MAPPED |
| Store/platform promotion identity, scope and redemption | DSH | TOP_LEVEL_MULTI_SURFACE_JOURNEY | DISCOVERY_TO_COMMERCE_ENTRY | MAPPED |
| Promotion funding/subsidy and settlement effect | WLT | TOP_LEVEL_MULTI_SURFACE_JOURNEY | DISCOVERY_TO_COMMERCE_ENTRY + SINGLE_STORE_ORDER_CREATION | MAPPED |
| Serviceability / address | DSH | SUPPORTING_SUBFLOW | SINGLE_STORE_ORDER_CREATION | MAPPED |
| Single-Store cart / checkout / Store Order | DSH + WLT effect | TOP_LEVEL_MULTI_SURFACE_JOURNEY | SINGLE_STORE_ORDER_CREATION | MAPPED |
| Different delivery recipient for gifts/family delivery | DSH Order snapshot | SUPPORTING_SUBFLOW | SINGLE_STORE_ORDER_CREATION + final mile | MAPPED |
| Restaurants/menu modifiers/sections | DSH Catalog | SUPPORTING_SUBFLOW | CATALOG_TO_CUSTOMER_OFFER | MAPPED |
| Grocery/fresh variable measure and actual fulfilled quantity | DSH + WLT delta | SUPPORTING_SUBFLOW | catalog + ORDER_ADJUSTMENT_EXCEPTION_REFUND | MAPPED |
| Standard non-regulated pharmacy commerce | DSH/WLT standard commerce | SUPPORTING_SUBFLOW | CATALOG_TO_CUSTOMER_OFFER / SINGLE_STORE_ORDER_CREATION / fulfillment Journeys | MAPPED |
| Electronics wrong/damaged/missing delivered item | DSH + WLT | SUPPORTING_SUBFLOW | ORDER_ADJUSTMENT_EXCEPTION_REFUND | MAPPED |
| BThwani Captain dispatch / handoff / custody / delivery | DSH + WLT effects | TOP_LEVEL_MULTI_SURFACE_JOURNEY | BTHWANI_CAPTAIN_DELIVERY | MAPPED |
| Partner Captain invitation/membership/delivery | DSH | TOP_LEVEL_MULTI_SURFACE_JOURNEY | PARTNER_CAPTAIN_DELIVERY | MAPPED |
| Customer Pickup | DSH + WLT effects | TOP_LEVEL_MULTI_SURFACE_JOURNEY | CUSTOMER_PICKUP | MAPPED |
| Multi-Store parent / independent Store Orders | DSH + WLT per child | TOP_LEVEL_MULTI_SURFACE_JOURNEY | MULTI_STORE_ORCHESTRATION | MAPPED |
| Order communication / read state / grace closure | DSH | TOP_LEVEL_MULTI_SURFACE_JOURNEY | ORDER_COMMUNICATION | MAPPED |
| Out-of-stock / substitute / actual variable measure | DSH + WLT delta | TOP_LEVEL_MULTI_SURFACE_JOURNEY | ORDER_ADJUSTMENT_EXCEPTION_REFUND | MAPPED |
| Cancellation / rejection / preparation failure / custody mismatch / delivery failure | DSH + WLT | TOP_LEVEL_MULTI_SURFACE_JOURNEY | ORDER_ADJUSTMENT_EXCEPTION_REFUND | MAPPED |
| Refund / reversal / external RefundCase / payment uncertainty | WLT + DSH evidence | TOP_LEVEL_MULTI_SURFACE_JOURNEY | ORDER_ADJUSTMENT_EXCEPTION_REFUND | MAPPED |
| Post-completion wrong/damaged/missing dispute | DSH + WLT | TOP_LEVEL_MULTI_SURFACE_JOURNEY | ORDER_ADJUSTMENT_EXCEPTION_REFUND | MAPPED |
| Customer balance funding | WLT | SUPPORTING_SUBFLOW | CUSTOMER_BALANCE_FUNDING | MAPPED |
| Captain balance funding | WLT | SUPPORTING_SUBFLOW | CAPTAIN_BALANCE_FUNDING | MAPPED |
| Payment allocation | WLT | SUPPORTING_SUBFLOW | PAYMENT_ALLOCATION | MAPPED |
| Captain COD exposure/hold | WLT | SUPPORTING_SUBFLOW | COD_EXPOSURE_HOLD | MAPPED |
| Captain COD receivable/remittance | WLT | TOP_LEVEL_MULTI_SURFACE_JOURNEY | CAPTAIN_COD_REMITTANCE | MAPPED |
| Partner commission receivable/remittance | WLT | TOP_LEVEL_MULTI_SURFACE_JOURNEY | PARTNER_COMMISSION_REMITTANCE | MAPPED |
| Partner/Captain/Field earning settlement | WLT | TOP_LEVEL_MULTI_SURFACE_JOURNEY | BENEFICIARY_SETTLEMENT | MAPPED |
| Field acquisition entitlement | DSH qualifying visibility event + WLT exactly-once earning | SUPPORTING_SUBFLOW | PARTNER_TO_VISIBLE_STORE → BENEFICIARY_SETTLEMENT | MAPPED |
| Customer manual withdrawal | WLT | SUPPORTING_SUBFLOW | CUSTOMER_MANUAL_WITHDRAWAL | MAPPED |
| Official-wallet payout destination administration | WLT/Finance using Identity phone/name | POLICY_FLOW | BENEFICIARY_SETTLEMENT support | MAPPED |
| Store delegated access invitation/grant/revocation | DSH + Identity admission | SUPPORTING_SUBFLOW | STORE_SCOPED_DELEGATION | MAPPED |
| Notifications / deep links / unread | DSH intent/read state + adapter delivery | PROJECTION | many Journeys | MAPPED |
| Tracking / Captain telemetry | DSH | PROJECTION | Captain fulfillment | MAPPED |
| Delivery/pickup proof | DSH | CROSS_CUTTING_LANE | fulfillment | MAPPED |
| Media / attachment lifecycle | DSH relationship + media adapter | CROSS_CUTTING_LANE | catalog/conversation/content | MAPPED |
| Authorization / audit / correlation / idempotency / concurrency | each canonical owner | CROSS_CUTTING_LANE | all applicable Journeys | MAPPED |
| Offline / degraded / retry / unknown outcome / restart/resume | each owner + surface recovery | CROSS_CUTTING_LANE | all applicable Journeys | MAPPED |
| Privacy / security / minimization / retention | DATA/SECURITY policy + owner | POLICY_FLOW | PRIVACY_SECURITY_RETENTION | MAPPED |
| RTL / accessibility / loading-empty-ready-pending-success-forbidden-offline-conflict-reconciliation-error states | Experience policy | POLICY_FLOW | every participating surface | MAPPED |
| Search / cache / analytics | derived | PROJECTION | read models | MAPPED |
| Runtime logging/observability | runtime operations | CROSS_CUTTING_LANE | operational evidence, not business authority | MAPPED |
| Prescription-required or specially regulated pharmacy fulfillment | none admitted | EXPLICIT_NON_GOAL | current Product target | MAPPED |
| Generic returns/exchanges | none admitted | EXPLICIT_NON_GOAL | current Product target | MAPPED |
| Electronics warranty-claim management | none admitted | EXPLICIT_NON_GOAL | current Product target | MAPPED |
| Scheduled customer orders | none admitted | EXPLICIT_NON_GOAL | current Product target | MAPPED |
| Generic point-to-point courier requests | none admitted | EXPLICIT_NON_GOAL | current Product target | MAPPED |
| Advanced route optimization | future bounded adapter only if separately admitted | EXPLICIT_NON_GOAL | current Product target | MAPPED |
| Numeric/predictive Store capacity / mandatory daily check-in | none admitted | EXPLICIT_NON_GOAL | current Product target | MAPPED |
| Loyalty / rewards standalone Product | none admitted | EXPLICIT_NON_GOAL | current Product target | MAPPED |
| Paid membership / subscription Product | none admitted | EXPLICIT_NON_GOAL | current Product target | MAPPED |
| Generic support/ticketing platform | none admitted | EXPLICIT_NON_GOAL | current Product target | MAPPED |
| Social review/community network | none admitted | EXPLICIT_NON_GOAL | current Product target | MAPPED |
| Generic analytics Product / standalone notification Product | none admitted | EXPLICIT_NON_GOAL | current Product target | MAPPED |
| Broad customer-profile/privacy orchestration Product | none admitted | EXPLICIT_NON_GOAL | current Product target | MAPPED |
| Generic Partner organization/team/tenant system | none admitted | EXPLICIT_NON_GOAL | current Product target | MAPPED |
| Separate Partner Staff application or sixth Store-staff Identity role | none admitted | EXPLICIT_NON_GOAL | current Product target | MAPPED |
| ERP/POS replacement | none admitted | EXPLICIT_NON_GOAL | current Product target | MAPPED |
| Speculative multi-currency breadth | none admitted | EXPLICIT_NON_GOAL | current Product target | MAPPED |

## End-to-end integration proof boundary

For every participating surface, applicable user-visible states are not polish: `loading`, `empty`, `ready`, `pending`, `success`, `forbidden`, `offline`, `conflict`, `reconciliation_required` and `error` must be deliberately handled or marked not applicable with reason by implementation proof.

A cross-surface scenario is not proven merely because endpoints exist or constituent slices pass independently. When the connected outcome is claimed, current-material integration proof follows:

```text
INTENT
→ AUTHORIZATION
→ CANONICAL MUTATION
→ CROSS-OWNER HANDOFF WHEN APPLICABLE
→ CONSUMER SURFACE
→ USER-VISIBLE STATE
→ FAILURE / RETRY / UNKNOWN-OUTCOME TREATMENT
→ RESTART / RESUME
→ CANONICAL READBACK
```

The structural verifier proves only mechanically detectable relationships. It never proves semantic correctness from prose. An admitted capability outside the active delivery gate is not falsely claimed implemented merely because it is mapped here.
