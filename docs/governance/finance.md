# Financial Rules and Agreements

ARTIFACT_CLASS: DURABLE_GOVERNANCE
SEMANTIC_OWNER: docs/governance/finance.md
EXECUTION_AUTHORITY: NONE
IMPLEMENTATION_STATE_AUTHORITY: NONE

WLT owns every internal financial effect. DSH supplies operational evidence; no policy, app or provider becomes a parallel financial writer.

## Financial Integrity Policy

WLT is the sole authoritative owner of internal financial truth for every admitted financial effect. DSH/surfaces may express intent or consume bounded WLT-backed readback; providers are external rails, never the internal ledger.

### Money representation

For the current YER Product:

```text
AuthoritativeMoney:
  amount_minor: exact integer
  currency: YER

1 amount_minor = 1 YER
```

Authoritative monetary arithmetic never uses binary floating point. Rounding is server-owned and follows the applicable versioned policy.

Basis points are applied as:

```text
raw = amount × rate_bps / 10_000
result = apply_rounding_policy(raw)
```

### Financial ownership and conservation

- authoritative amounts are server-derived from trusted owner facts and applicable versioned policy;
- client totals/screenshots/provider labels are never financial truth;
- every value-changing operation is authenticated, authorized, idempotent, concurrency-safe, correlated and auditable;
- DSH references/projections never become a second ledger or mutable balance authority;
- one financial effect has one WLT owner path and one canonical readback.

Customer payment allocation and beneficiary/settlement allocation answer different questions and must not be collapsed.

```text
CustomerPaymentAllocation
→ how the customer's payable amount is funded
→ internal balance and/or cash for currently admitted checkout sources

SettlementAllocation
→ how economic entitlement/funding is distributed
→ merchant proceeds / commissions / delivery earnings / discounts / subsidies / refunds / adjustments
```

A platform-funded discount is a funding source for the merchant entitlement; it is not an extra copy of product value.

### External funding and internal balance

An external official wallet/payment provider is a rail, not BThwani balance truth.

```text
FundingIntent
→ provider evidence
→ reconciliation when needed
→ WLT internal balance credit
```

Checkout consumes WLT internal balance/cash allocation. It does not treat an external provider account as an internal checkout balance.

Provider timeout or missing confirmation is not automatic failure or success. Unknown outcomes remain unknown until reconciled, and another rail is not invoked while duplicate movement remains possible.

External provider Cash-In is currently admitted only for Customers and BThwani Captains. Customer funding and Captain funding are separately governed capabilities even when they share a CashInRail implementation. Merchant-owner and Store-affiliated Captain funding are not enabled by this admission. The provider rail never chooses the WLT wallet/accounting destination; the server-owned funding purpose does.

### Captain COD coverage and wallet settlement

A BThwani Captain is an independent service provider who retains cash collected from the Customer. BThwani does not accept physical cash from Captains or Merchants, and does not disburse cash to them. Cash deposited by a Captain at an external exchanger becomes their *external* official-wallet balance, not WLT funding until a separately verified Cash-In completes.

```text
available_cod_coverage
= posted Captain WLT balance
- active COD holds
- active payout holds
- other governed locks

confirmed_order_total < available_cod_coverage
cash_portion_to_reserve <= available_cod_coverage
```

- one initial Captain activation funding threshold may be configured (10,000 YER in the current local policy); it is checked only before the Captain first becomes available, never reset or topped up automatically at midnight;
- previously activated Captains may receive prepaid Orders regardless of their later COD balance, subject to distinct identity/operational and goods-in-custody risk checks;
- a Captain accepting a COD or mixed-payment Order with a positive cash portion must have **WLT available unheld coverage strictly greater than the complete confirmed Order payable amount** (products and applicable delivery), not merely the cash portion; WLT atomically holds only the cash amount the Captain will actually collect. This separates the owner's admission threshold for gross Order exposure from the actual cash liability. Reservations for concurrent Orders reduce available cover and cannot be reused. A prepaid Customer Wallet portion is never debited from Captain coverage;
- when that Captain successfully collects and delivers the Order, WLT posts the relevant delivery entitlement and atomically debits the reserved cash amount from the Captain Wallet against the posted cash receivable once, in terminal state DEBITED; the Captain keeps the collected physical cash;
- cancellation before collection releases the hold without a wallet debit; mixed Orders cover only the cash portion, not the Customer's prepaid internal-wallet portion;
- a completed WLT debit must never be followed by a second request to remit the same cash to BThwani; physical Captain cash-remittance routes are obsolete for new Orders;
- historical FINALIZED or REMITTED reservations are not automatically DEBITED; they require evidence-bound reconciliation and must never be charged again if already settled through a previous rail;
- personal Cash-In funding is not delivery earnings and is not eligible for earnings withdrawal; eligible earnings remain capped by real posted unheld balance;
- Store-affiliated Partner Captains and Store-collected cash are owned by the Store relationship, not BThwani Captain custody.

The strict gross-Order eligibility threshold and cash-portion hold must be evaluated at the exact atomic assignment/acceptance boundary against authoritative WLT facts. The monetary hold covers collected cash only; it does not itself compensate for lost goods in custody. Merchandise-loss liability requires separate bounded, contractual controls and evidence. If a policy later changes this threshold, old accepted Orders retain their frozen financial meaning.

### Fees, discounts and commissions

Cash-In provider charges are borne by BThwani under the current provider agreements, not silently withheld from the beneficiary's gross funded balance. Their exact amount must come from trusted provider settlement evidence under the provider's approved external contract, not a hard-coded 2% deduction. On successful funding, WLT credits the Customer or Captain gross amount, debits `EXTERNAL_SETTLEMENT_CASH` for the provider's net proceeds, and separately debits `PLATFORM_CASH_IN_PROVIDER_FEE_EXPENSE` for the provider fee (zero fees retain the two-entry posting). All three facts are frozen together and verified for conservation; replay cannot modify the fee. Without a real provider rail or fee evidence, the development simulator proves accounting behavior only, not real payment-provider integration.

An approved Store-specific commercial agreement with **zero product commission** for `BTHWANI_CAPTAIN` may instead specify a fixed customer delivery markup in YER. WLT quotes the general distance tariff plus that explicit Store markup, and snapshots both the agreement and markup at checkout. On delivery, WLT credits the **entire base distance tariff** to the Captain and books the extra amount only to `PLATFORM_DELIVERY_MARGIN_INCOME`; it may never reduce Captain earnings or be disguised as product commission. The Customer sees the full fee before confirmation. A Store with a nonzero product commission cannot add this markup under the initial admitted rule; Partner Captain/Customer Pickup never create this BThwani delivery margin. A frozen old Order is not repriced when Store agreements change.

No retired enrollment-attribution or referral reward is issued for new Stores. Historical immutable ledger records remain protected. Any binding unpaid obligation requires Finance inventory, lawful settlement or documented disposition and independent review. Obsolete reward writers, payout routes and beneficiary enrollment are not recreated in the new Product.

### Refunds, payouts and settlement

Order cancellation and customer-wallet compensation are separate controlled decisions. Each Store Type has one versioned cancellation mode: OPERATIONS_ONLY or CLIENT_BEFORE_ACCEPTANCE. At Order creation DSH snapshots the Store-Type policy; policy updates affect new Orders only. An owner may cancel a CREATED, uncollected Order only when its stored policy allows, before Store acceptance or dispatch. Otherwise an active Operations operator reviews the Store's preparation status, records a reason and executes only an admissible transition. No customer or partner may bypass DSH authorization with a forged actor header. Multi-store Orders are reviewed independently per child; technical rollback of a failed checkout is not a commercial cancellation.

Before collection, cancellation releases the original WLT payment reservation or cancels the cash obligation through the idempotent DSH/WLT handoff. This is not a new wallet credit or goodwill compensation. After collection, operations and finance determine the correct customer entitlement with evidence, applicable customer rights and balanced settlement; an unresolved collection is not permission to mint credit. There is no automatic customer compensation upon cancellation, adjustment or review. A specifically authorized Finance operator may approve and manually post a BThwani wallet credit through the existing reviewed compensation operation with a bounded amount, one audited balanced ledger effect, idempotent replay and canonical readback. A manual external/cash return is an exceptional separately authorized process; double reimbursement is forbidden. The customer must see only posted funds, never a pending promise.

The narrow admitted compensation operation is Finance-reviewed and platform-funded for a confirmed-collected, customer-approved, full item removal on an already completed Order with no discount or promotion. DSH derives the exact amount from the original immutable Order line; WLT checks the original collected payment, caps total credits and posts an auditable platform expense versus Customer Wallet liability exactly once per adjustment. DSH closes that adjustment only after WLT ledger and wallet readback. This exceptional platform expense must not be described as a reversal of settled Partner proceeds. Other cases (pre-collection repricing, Store-funded reversal, discounts/promotions, changing quantities, unresolved collection) remain explicitly pending their proper owner reconciliation rather than minting guessed credit. An APPLIED removal cannot generate a second compensation for the same original Order line.

Beneficiary settlement uses:

```text
eligible amount
→ payout intent / hold
→ approved immutable beneficiary/destination snapshot
→ execution evidence
→ verification
→ reconciliation
→ completion or explicit exception
```

The current external payout execution method is manual transfer through the appropriate official wallet, not a provider payout API. WLT still derives the eligible amount, places/releases/finalizes holds, resolves and pins the verified destination, and controls every legal transition. Each transfer requires its own receipt/evidence attached to that transfer. An authoritative official-wallet statement is retained once per period or batch and its matched statement rows are linked to the relevant transfers; one statement may support multiple transfers. A generated XLSX may serve as a frozen execution artifact, but it never updates WLT accounting truth.

For every beneficiary paid through an official-wallet rail, the wallet number is the current verified canonical Identity phone and the beneficiary name is the current canonical official Identity name. Neither value is an independent onboarding or payout input. WLT resolves both from the bound actor identity and selected provider; client-supplied phone or name cannot create or change a destination. Before payout approval and execution, WLT checks the destination against current Identity facts. An approved or frozen immutable beneficiary snapshot preserves what was authorized historically; it does not by itself authorize an unexecuted manual transfer after current beneficiary eligibility changes. A phone or identity-version mismatch makes the destination stale and requires Finance reverification; payment to the old or new number is blocked until the destination is verified again. No silent redirect is allowed.

For a Store-attributed payout that has not been executed, Finance must revalidate the effective Store payout-recipient assignment in WLT and the beneficiary's current Identity eligibility **at the transfer-instruction release boundary**. An unavailable, stale or `RECIPIENT_REVIEW_REQUIRED` result blocks releasing instructions, with an explicit held/review exception until reauthorized. The historical approved snapshot remains immutable, and no beneficiary substitution or silent redirect is permitted. A transfer already performed follows evidence, reconciliation and exception handling, not a fabricated reversal.

For the current approved target, Merchant/Captain surfaces are read-only for official-wallet destination master data. Their admission/onboarding intake may capture a provider preference only; that preference does not activate a destination or grant destination-writing authority. Finance creates or changes a destination through the authorized verification/approval workflow; beneficiaries cannot create, update, deactivate, replace or select a payout destination. A destination change cannot rewrite an already approved payout snapshot.

### Store payout-recipient routing

WLT owns the canonical effective relationship from each Store to its payout-beneficiary Human Actor. The Partner owner is the default beneficiary. The owner may assign one verified, eligible owner or staff actor per Store; multiple Stores may name the same actor. A bulk selection is only a command that creates or changes each Store assignment independently, with its own scope, version, effective time and audit.

Recipient assignment selects the responsible Human Actor relationship. It does not select or edit an official wallet destination. The owner cannot enter a wallet number, beneficiary name or arbitrary external account. WLT resolves the official destination from the selected actor's current verified Identity and Finance-approved provider under this policy. Only the Partner owner may change or explicitly reconfirm a Store recipient; finance_read, payout_request and other Store-management authority do not grant recipient-routing authority.

Partner owners may read financial totals aggregated across their owned Stores. A delegated accountant may read or report only for Stores in the accountant's active authorized scope. WLT preserves each Store's economic attribution in every aggregate. Financial data access, payout-intent creation, recipient routing, Finance approval, transfer execution and reconciliation are separate authorities. A payout request is limited to its authorized Store scope and cannot change the recipient. If selected Stores have different effective recipients or verified destinations, WLT partitions them into separate payout groups and transfers; one external transfer never pays multiple beneficiaries or destinations.

Customer balance withdrawal is not a customer-facing or self-service payout capability. A rare exception begins with an Operations-recorded request and authorization/evidence; WLT resolves the eligible internal balance and reserves the approved amount. Authorized Finance staff approve and perform the manual external transfer, attach transfer-specific receipt evidence, and bind the transfer to the period/batch statement evidence. A different authorized operator independently reconciles the transfer and statement row. WLT reduces the customer liability only after required reconciliation; unknown, mismatched or unsupported outcomes remain held/open as an explicit exception. This process is distinct from Customer funding, Merchant/Captain earnings settlement and Captain COD remittance.

### Beneficiary settlement intake before external transfer

A Partner or BThwani Captain with WLT-attributed positive eligible funds may submit an auditable, idempotent **settlement intake** to the Finance queue without an already verified official-wallet destination. An intake only records the server-resolved requested amount and, for Partners, the exact authorized Store allocation. It is **not** a payout, does not create a hold or ledger entry, and does not mean money has been sent. Only one open intake per beneficiary may exist; replay keeps the same business identity.

Finance independently verifies the current beneficiary identity, official destination, authority, eligible amounts, and partner Store recipient routing before using the existing WLT payout creation path. That path alone holds available funds and requires a verified active destination; manual transfer, receipt verification, statement reconciliation, and terminal ledger settlement retain their established independent-operator controls. The intake is linked to the resulting payout only after canonical readback. Missing credentials, destination, funding, eligibility, or reconciliation leave the intake pending with an actionable reason rather than fabricating a transfer.

### Cross-owner reliability

If an operational owner event creates a financial effect:

```text
DSH proves canonical operational transition
→ durable idempotent handoff
→ WLT applies financial effect
→ WLT canonical readback
→ reconciliation of unknown/partial outcomes
```

Synchronous calls are not treated as a distributed transaction. A retry must preserve the same logical operation identity and cannot allocate a new financial identity merely because a commit result was ambiguous.

### Finance access

Every Finance workspace read and mutation requires the current Identity `finance` permission on the Operator session. The `operator` role alone is insufficient. Missing, stale or invalid permission evidence fails closed. The Store Commercial Agreement editor and any retained Store Type suggestion controls follow this boundary; each financial mutation remains attributed to its acting Operator and audited by its canonical owner. Customer withdrawal request intake belongs to the Operations owner and requires its own authorization; intake permission does not grant Finance approval, execution, reconciliation or ledger authority.

## STORE_COMMERCIAL_AGREEMENT — Store Commercial Agreement

CAPABILITY_ID: STORE_COMMERCIAL_AGREEMENT

### Outcome

Each Store has one explicit active commercial model and exact terms, accepted by its bound Partner owner and approved by Finance before activation. WLT alone owns commercial charge facts, immutable Order snapshots, recurring invoices and settlement accounting.

### Ownership

WLT owns agreement identity and versions, proposed rates, Partner acceptance, Finance approval, activation, effective and superseded facts and audit. DSH supplies canonical Store context and enabled fulfillment modes and performs the bounded operational handoff; DSH does not write financial rates. The commercial model is chosen independently of DSH's canonical Store `relationModel`: both BTHWANI_PARTNER and INDEPENDENT_STORE may use COMMISSION or SUBSCRIPTION when admitted and activated under a WLT-owned effective policy and accepted Store agreement. Relation still governs commerce channels, fulfillment and publication independently of fees. Authorized Operators may propose the eligible Store-specific terms through the existing DSH-to-WLT agreement route; selecting a model in the UI cannot override the canonical Store relation or create a different financial writer. Partner-management screens may read agreement history but are not a separate model-selection writer. No retired enrollment source may propose new agreement terms. The bound Partner owner accepts exact terms. An authorized Finance actor approves them. ORDER_PAYMENT_COLLECTION alone resolves the active agreement for an applicable Order and owns that Order's immutable agreement snapshot.

### Approved Store commercial models

Three decisions remain separate and server-enforced: (1) DSH Store relation `MARKETPLACE`/`DIRECT`, (2) WLT financial model `COMMISSION`/`SUBSCRIPTION`, and (3) WLT-approved Order collection responsibility `PLATFORM_COLLECTION`/`MERCHANT_COLLECTION`. The Operator's versioned relation-specific **default** is proposed automatically at registration, not charged or accepted automatically. Each Store receives its own disclosed, accepted and Finance-approved agreement with an effective date and owner-backed terms. Both fee models and either approved collection responsibility can be assigned to either relation, but none grants marketplace visibility, Captain dispatch or an unimplemented payment rail by itself. Changing the default is prospective; an existing agreement requires renewed consent and a safe cutover.

This rule distinguishes the approved target from deployable readiness. Both Store relations can use **COMMISSION** or **SUBSCRIPTION**, with one WLT agreement/ledger boundary and one effective model per Store agreement version. No separate independent billing engine, shadow agreement table, second settlement writer or automatic subscription collection is admitted. Existing 0% Partner commissions and historical agreement snapshots remain lawful historical/contractual facts, not evidence of an independent plan.

An independent Store's direct Order remains merchant-direct and cannot inherit marketplace wallet, BThwani Captain or platform collection solely because it uses DSH Orders. Collection responsibility (merchant collects versus BThwani collects) is a separately approved agreement/policy fact for either relation, not a consequence of COMMISSION versus SUBSCRIPTION; BThwani collection is blocked until the corresponding payment, reconciliation and settlement path is proven. Where BThwani is financially obligated, WLT exclusively owns applicable platform effects. Direct Orders and recurring invoices remain separately gated until proven.

Exactly one of these two models governs a Store agreement at any effective instant, regardless of relation; no caller may silently switch an accepted Store agreement:

- **COMMISSION**: explicitly agreed Store-specific basis points or fixed YER amount on defined eligible Orders for the Store's admitted channel. It must have an applicable WLT quote, immutable Order snapshot, collection/receivable accounting and settlement; percentage-only fields cannot authorize a fixed fee.
- **SUBSCRIPTION**: expressly accepted recurring YER Store charge for one approved plan, billing period and service scope. Its plan may bound actually implemented hosting/capacity/optional service entitlements for either relation but never Identity permissions, Store ownership, marketplace entitlement, or unsafe bypasses. No conversion from zero commission or automatic billing is inferred.

A WLT-owned operator-editable default may choose COMMISSION or SUBSCRIPTION for new Stores of either relation, and suggest Store-specific commission terms or versioned subscription plans with YER prices, billing periods and justified limits. A Store's accepted, Finance-approved agreement remains the only charge authority. Policy changes affect future agreement versions, never rewrite active terms or past Orders. DSH enforces only the applicable WLT-derived operational entitlements, without shadow plan facts. Store Type alone cannot select a fee model; an interface never levies a charge or grants authorization by choosing a badge.

For either Store relation, a subscription **plan** is a WLT-owned versioned definition of an approved YER price, billing period, service scope and only operationally implemented capacity/feature limits. Plans and commission defaults may be Operator-configurable through owner APIs, but plan selection during registration is a proposal, not an accepted agreement or automatic debit. Store-specific commission terms remain independently negotiable/accepted within policy. DSH enforces only applicable technical limits from the effective WLT entitlement and must preserve Store isolation, durable drafts and previously entitled records across renewal, expiry or downgrade. Any experimental example prices or tiers in a working plan remain non-binding until separately admitted and bootstrapped by WLT.

A recurring agreement must identify YER amount, billing period and time zone, effective date, renewal/termination terms, due and grace rules, Partner consent, and adjustment or refund policy. WLT alone may produce an invoice and post a uniquely identified charge for one agreement version and period; retries and concurrent runs must not duplicate an invoice, collection, balance debit or accounting effect. Unknown payment outcomes require reconciliation. Non-payment must not silently revoke Identity access or Store ownership; any operational restriction requires a separately approved policy. Old Orders retain their original contractual snapshots.

**Delivery boundary:** WLT stores explicit versioned commercial-model proposals for COMMISSION and SUBSCRIPTION and DSH carries them to Partner and Operator surfaces for review and consent. Historic agreements remain COMMISSION, including a 0% product commission. **Only currently implemented and validated commission agreements for the existing eligible marketplace Partner route may be Finance-activated today.** Commission on direct independent Orders, subscription for either relation, and any BThwani-operated direct-order collection remain NOT_RELEASED until their respective owner-backed quote/invoice, idempotent posting, evidence/reconciliation, settlement and independent finance/security review pass. WLT's API and DB must reject unsupported activation; no screen or accepted proposal can override these gates.

Only COMMISSION or SUBSCRIPTION is admitted for a new effective Store agreement; no combined fee model is admitted. Historical financial records requiring retention remain immutable and auditable with owner-backed resolution, never automatic conversion or extra charges.

### Invariants

- final terms are Store-specific; a Store's terms do not derive from another Store with the same commercial Store Type;
- each version explicitly identifies Store, the selected commercial model (COMMISSION or SUBSCRIPTION), agreement version, status, proposer/provenance, enabled fulfillment modes and rates, applicable recurring terms, Partner acceptance, Finance approval, effective/superseded facts, reason/audit and idempotency/correlation; a zero product commission never implies subscription;
- every durably enabled fulfillment mode has exactly one explicit pricing/commission rule in the active agreement; SUBSCRIPTION contracts carry explicit zero product commission for each enabled mode rather than silently omitting pricing facts;
- the lifecycle is `PROPOSED` → `PARTNER_ACCEPTED` → Finance-approved `ACTIVE` → `SUPERSEDED`;
- silence, Store creation, role admission, catalog readiness or publication is not Partner acceptance;
- only authorized Finance approval can activate an accepted version; the canonical initial Operator (Root Owner) may Finance-approve a Store agreement they proposed themselves after Partner acceptance, when Identity confirms their administrator standing and Finance permission; other proposing Operators cannot self-approve;
- each material term change creates a new version and historical evidence is immutable;
- adding a fulfillment mode that changes commercial obligations requires a new agreement version containing that mode before DSH may treat it as durably enabled;
- materially changing or removing an enabled mode's commercial terms also requires a new agreement version;
- temporarily pausing/resuming a mode already durably admitted is operational state owned by `STORE_OPERATIONAL_AVAILABILITY` and does not create a new agreement version;
- an operational toggle cannot activate a fulfillment mode absent from the Store's durable admitted mode policy and active agreement;
- Store Type policy can suggest amounts or mode-specific terms only within the WLT-approved effective commercial model; it never overrides the relation or becomes fallback billing authority;
- an initial Store agreement may have zero product commission for each admitted fulfillment mode; zero rates are explicit Store-specific financial facts, not an implied waiver of Partner acceptance or Finance approval;
- a zero-commission proposal does not by itself create a timed promotion or authorize automatic paid conversion; a governed duration, effective date, consent evidence and applicable policy must exist before any later paid terms become active;
- no more than one agreement version is active for a Store at a time;
- a Partners Operator may propose but cannot accept for the Partner owner; Finance approval is separate except for the Root Owner exception above. No unrelated actor may propose or approve on behalf of the Store owner;
- retries, stale versions and concurrent transitions preserve one auditable result.

### Failure and recovery

Missing Store context, unsupported mode, invalid rate, Store-scope mismatch, non-acceptance, missing Finance authority, stale version and conflicting mutation fail closed and recover through WLT and DSH canonical readback. Missing or inactive terms block Store publication and any Order that requires them; operational availability cannot bypass this capability.

## ORDER_PAYMENT_COLLECTION — Order Payment and Collection

CAPABILITY_ID: ORDER_PAYMENT_COLLECTION

### Outcome

Every admitted Store Order has one WLT-owned payment/collection truth that conserves the customer's payable amount across admitted sources and reconciles legal Order adjustments, delivery COD, Store-collected cash, Partner commission receivables and refund effects without duplicate movement.

### Ownership

WLT owns payment intent, customer payment allocation, collection state, Order-adjustment financial deltas, COD receivable/exposure, Partner commission receivable, refund/reversal treatment and financial readback. DSH owns operational Order/fulfillment/adjustment facts that qualify financial effects.

### Collection responsibility and custody gates

Every admitted Store Order snapshots the **approved responsible collector** for product and delivery value, along with the actual physical custodian where different. With `MERCHANT_COLLECTION`, the Merchant or its explicitly affiliated Captain receives its sale proceeds outside BThwani custody; DSH records handoff and collection evidence, and WLT accounts only for BThwani's actual fees/commission receivables, not a fictitious external merchant wallet balance. With `PLATFORM_COLLECTION`, BThwani controls supported payment rails, WLT liabilities, refunds and Store settlement; a BThwani Captain may retain physical COD cash only after adequate WLT reservation, and WLT debits the actual cash collected exactly once upon confirmed delivery. A prepaid Customer Wallet portion is never charged twice.

Collection responsibility is independent of Store relation and fee model, but **a combination cannot be activated until its actual DSH checkout, Identity permission, WLT reconciliation, Captain custody and independent finance/security gates are operationally proven**. The customer sees the actual responsible collector, payment methods and recourse before checkout confirmation. A changed default cannot rewrite accepted agreements or prior Orders.

### Invariants

- payment method/source is independent from fulfillment mode;
- customer funding allocation currently composes admitted WLT internal balance and/or cash semantics; external provider account balance is never directly authoritative at checkout;
- original financial confirmation remains attributable to the original Order snapshot; an approved DSH OrderAdjustment causes a new WLT delta/reversal/additional-treatment fact rather than rewriting prior ledger movement;
- before collection, an accepted OrderAdjustment may create one unresolved WLT reconciliation case linked to the still-uncollected payment; this is a durable handoff, not authority to alter the original payable amount, collect more money, refund, or credit a wallet. The order remains blocked from an incompatible fulfillment transition until an authorized pre-collection repricing/cancellation treatment is implemented and confirmed from WLT;
- after collection, a proven customer credit is returned to the existing BThwani Customer Wallet by default, spendable across eligible Stores; no standalone refund system or routine Customer action is required; the current implemented Finance-reviewed platform-expense credit applies only to a completed customer-approved full item removal without promotions, with original line amount and WLT collected payment independently verified; other economic responsibility/adjustments remain unresolved until their proper settlement is available;
- an accepted OrderAdjustment first records one existing WLT reconciliation case; no wallet credit may post until collected facts, the actual approved delta and all affected funding/Store/commission entitlements are reconciled; WLT owns one idempotent balanced posting and authoritative wallet history;
- cancellation or correction before collection is a payment-obligation change, not a customer refund; uncertain collection remains unresolved;
- exceptional external official-wallet refund or balance withdrawal requires the existing Operations/Finance manual authorization, transfer receipt and independent reconciliation, without a physical cash handover or duplicate credit;
- cancelled payment intents are not eligible for new OrderAdjustment reconciliation cases;
- duplicate/retried OrderAdjustment identity cannot create a duplicate financial effect;
- where a substitute/actual measure would require more value than the already authorized amount, WLT determines the legal additional financial treatment; DSH/Partner cannot assume extra collection authority;
- for `CUSTOMER_PICKUP` paid with cash at the Store, the Store receives and retains the customer's sale proceeds; WLT records the Order-bound collection and the versioned commission receivable owed by the responsible Partner;
- For a zero-product-commission Store in `BTHWANI_CAPTAIN` fulfillment only, an explicitly accepted and Finance-approved Store agreement may freeze one fixed additional delivery markup. The Customer sees the full general delivery charge plus markup; the Captain earns the unchanged general distance tariff while the extra amount is a separate platform delivery-margin income entry. WLT locks the exact agreement amount and rejects any checkout allocation with a different markup or one applied to a non-BThwani Captain mode;
- Partner commission uses product value as its calculation basis and is governed by the active Store-specific `STORE_COMMERCIAL_AGREEMENT` for that Store and fulfillment mode. Each applicable Order snapshots the agreement identity and version, fulfillment mode, commission rate, calculation basis and required rounding facts; later agreement changes never reinterpret an existing Order;
- for `PARTNER_CAPTAIN`, the Store chooses an approved free, fixed or distance-based customer delivery fee under its versioned Store agreement; Store-Captain remuneration remains a Store responsibility outside BThwani Captain Wallet, and the fee's economic owner is snapshot per Order;
- when a Store Captain collects cash for a `PARTNER_CAPTAIN` Order, sale proceeds belong to Store/Partner and the Captain hands them to the Store; DSH records collection/handoff/Store acknowledgment outside WLT, and WLT creates no BThwani-Captain COD receivable, Captain earning or wallet movement for those proceeds;
- Store-collected pickup cash never creates BThwani Captain cash custody, COD exposure, Captain COD remittance or a duplicate Partner wallet credit for sale proceeds already retained by the Store;
- customer payment allocation does not include merchant/platform settlement funding;
- external provider funding first becomes WLT internal balance through `CUSTOMER_BALANCE_FUNDING`;
- accepting BThwani Captain COD reserves 100% of the Order's actual cash source, atomically against posted unheld coverage; prepaid-only Orders have no COD coverage requirement;
- on confirmed collection and successful delivery by that same Captain, WLT atomically debits the reserved cash amount from the Captain Wallet and offsets the posted COD receivable once; the Captain retains the physical cash, with no second remittance to BThwani;
- cancellations before collection release the COD hold; legacy FINALIZED/REMITTED records must be reconciled with their actual historical evidence instead of being debited automatically;
- Partner commission receivable settlement/remittance is distinct from Partner sale proceeds and from beneficiary earnings payout;
- collection, adjustment, cancellation/refund, remittance and reconciliation are idempotent and preserve stable logical identities;
- ambiguous distributed/provider outcomes remain explicit until reconciled;
- no surface or DSH projection becomes payment truth.

### Failure and recovery

Insufficient balance/exposure, adjustment delta refusal, unknown provider outcome, duplicate collection/delta/remittance, wrong collected amount, cancellation race, unresolved Partner commission receivable, remittance uncertainty and refund exception fail closed or remain reconciliation-required from canonical WLT state.

## CUSTOMER_BALANCE_FUNDING — Customer Balance Funding

CAPABILITY_ID: CUSTOMER_BALANCE_FUNDING

### Outcome

A customer may fund one WLT-owned internal BThwani balance through a proven external rail without treating provider state as internal ledger truth.

### Ownership

WLT owns FundingIntent, internal balance credit, fee effect and reconciliation. Provider adapters own external transport/query mechanics only.

### Invariants

- external wallet/provider rail is not internal balance;
- a funding intent has one stable logical identity and amount/currency;
- provider success is accepted only with evidence sufficient for the active provider contract;
- timeout/unknown remains unresolved until provider query/reconciliation;
- internal balance credit occurs exactly once;
- under the current approved provider agreements BThwani bears Cash-In charges: the Customer is credited 100% of confirmed gross funding; the trusted provider settlement result freezes the actual non-negative fee (not a universal hard-coded 2%); the ledger separately debits the provider's net cash and `PLATFORM_CASH_IN_PROVIDER_FEE_EXPENSE` to conserve the Customer liability without collecting an extra fee from the Customer. A changed provider fee for the same idempotent result is rejected, and no non-success outcome may post a fee;
- secrets/provider credentials never enter client authority.

### Failure and recovery

Duplicate callback, timeout, unknown result, provider reversal, mismatched amount/reference and delayed confirmation reconcile before another credit is possible.

## CAPTAIN_BALANCE_FUNDING — BThwani Captain Balance Funding

CAPABILITY_ID: CAPTAIN_BALANCE_FUNDING

### Outcome

A BThwani Captain may fund their single WLT-owned internal balance through an approved external Cash-In rail. The same balance supports governed COD collateral/exposure and other admitted Captain financial effects; top-up is not itself an earning or payout.

### Ownership

WLT owns the Captain FundingIntent, purpose-to-wallet resolution, provider event application, fee effect, internal balance credit and reconciliation. The external provider adapter owns transport and provider inquiry mechanics only.

### Invariants

- this capability applies only to a Captain whose BThwani-owned financial relationship is active;
- Store-affiliated Captains and Merchant owners are not included by this admission;
- the Captain uses one WLT balance, not a separate top-up or COD wallet;
- provider identity never selects the internal wallet or ledger account; server-owned purpose maps the confirmed intent to the correct Captain wallet;
- provider success is accepted only with evidence sufficient for the approved provider contract;
- timeout/unknown outcomes remain unresolved until inquiry/reconciliation and cannot trigger an unsafe duplicate movement;
- each intent and provider event is idempotent and the balance credit posts exactly once;
- BThwani bears provider Cash-In fees; confirmed gross funding is credited in full to the Captain's internal balance, while provider fees are separate platform expenses under the versioned provider contract;
- Cash-In replenishes confirmed internal COD coverage, but is not itself a posted delivery earning or a remittance of cash to BThwani; Captains retain customer cash and settlement occurs through the one WLT wallet debit after confirmed collection;
- secrets and provider credentials never enter client authority.

### Failure and recovery

Duplicate/replayed event, timeout, unknown result, provider reversal, mismatched amount/reference and delayed confirmation reconcile before another credit is possible. WLT canonical readback resolves whether the Captain balance was credited.

## PARTNER_CAPTAIN_EARNINGS_SETTLEMENT — Partner and Captain Earnings Settlement

CAPABILITY_ID: PARTNER_CAPTAIN_EARNINGS_SETTLEMENT

### Outcome

Current Partner and BThwani Captain entitlements are derived from admitted canonical qualifying events and use the governed WLT payout/settlement lifecycle. Previously accrued binding obligations remain available as historical readback for authorized Finance review, lawful settlement or documented disposition. Obsolete beneficiary/reward enrollments cannot create new payment requests or entitlements. The Operator Finance workspace presents separate beneficiary sections while sharing the payout, execution and reconciliation controls that have the same financial semantics.

### Ownership

WLT owns earnings ledger, beneficiary eligibility/holds, payout intent, official destination state, immutable approved settlement snapshot, settlement batch, transfer evidence and reconciliation. DSH and Control Panel provide operational facts or bounded intent and consume WLT readback; they are never a second financial writer.

### Invariants

- earnings are created from one explicit qualifying owner event and are idempotent;
- economic entitlement is distinct from the Customer's payment-source allocation;
- outstanding Partner commission receivables from Store-collected pickup cash reduce that Partner's later eligible earnings before payout; they never offset another Partner's entitlement;
- a remaining Partner commission receivable may be cleared by a direct Partner remittance only after WLT records and reconciles the verified receipt;
- Store-collected sale proceeds already retained by the Partner do not become a second WLT Partner wallet credit;
- Partner/Captain payout execution is currently a governed manual official-wallet transfer; historical obligations require separately reviewed disposition; a provider payout API is not implied;
- each external transfer has transfer-specific receipt/evidence, while a period/batch statement is retained once and matched statement rows may be linked to multiple transfers;
- generated spreadsheets are immutable execution artifacts and never a source of WLT financial truth;
- Merchant and BThwani Captain surfaces do not create, update, deactivate, replace or select official-wallet destination master data; Finance owns the governed provisioning/change workflow;
- official-wallet admission for active Partner and BThwani Captain actors collects a provider preference only; historical legally bound destinations are retained without new provisioning. WLT derives the number and beneficiary name from current canonical Identity facts under `docs/governance/finance.md`; stale Identity facts require reverification before payout approval or execution;
- a derived wallet number may be shown read-only; it is never an editable destination input;
- payout approval freezes an immutable beneficiary/destination/amount snapshot;
- external execution evidence is independently verified/reconciled before completion;
- an approved payout cannot silently follow a later destination change;
- WLT owns each Store's effective payout-recipient actor assignment and its version, effective time, audit and readiness; the default is the Partner owner, and the owner may explicitly assign one verified eligible owner or staff actor per Store;
- multiple Stores may share a beneficiary, but each Store assignment remains independently scoped and read back; a multi-Store selection creates individual canonical assignments rather than one global routing fact;
- recipient eligibility requires a canonical actor with current verified Identity facts, an active eligible relationship to that Store and a current Finance-approved WLT destination/provider;
- recipient assignment is owner-only and names a beneficiary relationship, never a wallet number, name or destination; delegated finance-read, report, payout-request or Store-management permissions cannot change it;
- payout-request authority permits only a bounded intent for authorized Store scope; WLT independently enforces eligibility, holds and all approval, execution and reconciliation boundaries;
- if the assigned staff member's Store relationship is suspended/revoked or ceases to be eligible, the Store's future payout readiness requires owner action; WLT must not silently keep paying that actor or silently fall back to the owner;
- a verified-phone or Identity change makes the affected destination require Finance reverification before a future payout; it never silently redirects a payout;
- recipient changes affect only future payout intents that have not been committed to an immutable snapshot; approved, executing, transferred and reconciled payouts retain their original beneficiary, destination and per-Store allocations;
- aggregated owner readback preserves per-Store attribution; a payout spanning different recipients or destinations is partitioned into separate canonical groups/transfers, never one transfer to multiple recipients;
- historical reward-policy records remain audit evidence and never authorize a new reward;
- binding historical attribution evidence stays at its original owner and cannot authorize a new reward or duplicate economic entitlement. WLT retains prior valid payouts and evidence; re-attribution after Store admission or publication is prohibited;
- Store-affiliated Partner Captain compensation and cash custody remain outside this capability and WLT unless a separately governed integration is explicitly admitted;
- no surface edits ledger balances directly.

### Minimal recipient-assignment state semantics

The exact executable representation belongs to implementation, but current durable meaning must distinguish at least:

```text
DEFAULT_OWNER
SELECTED_VERIFIED_STAFF
RECIPIENT_REVIEW_REQUIRED
```

`DEFAULT_OWNER` routes future unpinned payout intents to the Partner owner without requiring an explicit assignment record. `SELECTED_VERIFIED_STAFF` records an owner-assigned eligible staff beneficiary. `RECIPIENT_REVIEW_REQUIRED` marks a Store whose recipient eligibility is broken (for example a suspended, revoked or otherwise ineligible staff relationship); future payout readiness for that Store stays blocked until the owner selects or explicitly reconfirms a legal recipient. Assignments enter `RECIPIENT_REVIEW_REQUIRED` fail-closed from canonical eligibility facts; every other transition is owner-initiated, versioned and audited. No transition rewrites a committed payout snapshot.

### Failure and recovery

Insufficient eligible amount, destination verification failure, duplicate payout, execution timeout/unknown, missing receipt, statement mismatch, duplicate statement import and reconciliation exception remain explicit and recover through WLT canonical readback. A Store entering `RECIPIENT_REVIEW_REQUIRED` does not mutate in-flight payouts; it blocks only future payout readiness until explicit owner action.

## CUSTOMER_BALANCE_MANUAL_WITHDRAWAL — Customer Balance Manual Withdrawal Exception

CAPABILITY_ID: CUSTOMER_BALANCE_MANUAL_WITHDRAWAL

### Outcome

Operations can record a rare Customer request to return eligible value from the Customer's WLT internal balance through a governed manual external transfer. This is an exception workflow, not a Customer self-service withdrawal feature.

### Ownership

WLT owns eligibility calculation, amount validation/resolution, hold, payout/transfer identity, destination snapshot, ledger finalization and canonical readback. Operations owns request intake and evidence of the request. Authorized Finance staff approve and execute the external transfer. An independently authorized operator reconciles the transfer against authoritative official-wallet statement evidence.

### Invariants

- Customers cannot submit a withdrawal mutation through a self-service client journey;
- Operations records the request, Customer identity, reason and supporting authorization/evidence through its authorized workflow;
- WLT derives eligible balance and reserves the approved amount before execution; client or Operator arithmetic never establishes the amount;
- Finance approval, manual execution and independent reconciliation are attributable, authorized and audited;
- every transfer has its own receipt/evidence, and a retained statement for the relevant period/batch is linked through matched statement rows;
- execution evidence alone does not finalize the WLT liability reduction;
- WLT finalizes only after required independent reconciliation confirms amount, currency, beneficiary/destination and external reference;
- unknown, duplicate, mismatched or unreconciled results remain held and enter an explicit exception state;
- this workflow is distinct from Customer Cash-In, Merchant/Captain earnings settlement, refunds and Captain COD remittance.

### Failure and recovery

Insufficient eligible balance, invalid authorization, missing evidence, duplicate request/reference, execution timeout/unknown result, statement mismatch and reconciler conflict remain explicit. WLT readback determines the current hold, liability and exception state; a retry preserves the same logical identity until the outcome is resolved.
