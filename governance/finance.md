# BThwani — Financial Ownership, Collection and Store Agreements

ARTIFACT_CLASS: DOMAIN_GOVERNANCE_DRAFT
SEMANTIC_OWNER: governance/finance.md
STATUS: ACTIVE_FOR_PROGRESSIVE_DEVELOPMENT
POLICY_DECISION: HUMAN_APPROVED_2026-11-13; COLLECTION_RELATION_DEFAULTS_SUPERSEDED_2026-11-26
IMPLEMENTATION_STATE_AUTHORITY: NONE

This is approved target financial policy, not an activated provider, migration, available payment or proof of deployed implementation. The 2026-11-26 decision supersedes former relation-specific collector defaults for future agreements; preserve binding historical obligations and actual ledger history. Protected activation requires the actual owner contract, legal consent, authorization and [safety](safety.md) risk proof.

## Financial integrity and distinct dimensions

Identity owns actor/access; DSH owns Store, relation/channel, commercial quote, Order and fulfillment; WLT exclusively owns internal money, allocation/holds, ledger, commercial agreements, fee attribution, receivables and settlement. Neither UI, provider, direct SQL, Store ledger nor second wallet/billing engine is authoritative.

YER amounts are exact integers; amount_minor = one YER. Never use binary floating point for authoritative money. WLT applies versioned rounding to amount × rate_bps / 10,000. Every journal/transfer balances; immutable history, attribution, stable operation identity, concurrency, idempotency and owner readback are mandatory. DSH operational effect and WLT posting are separate durable transitions; reconcile unknown/partial results by original identity, not fresh payment.

Four independent dimensions:
- Store relation and Order sales channel are distinct DSH facts under [stores](stores.md) and [commerce](commerce.md).
- WLT fee model COMMISSION or SUBSCRIPTION is separately selected, accepted and Finance-approved for either relation.
- WLT collector PLATFORM_MANAGED or STORE_MANAGED is separately accepted for either relation; no relation-derived fallback.
- DSH fulfillment method is separately eligible subject to actual financial, operational and legal readiness.

Customer funding allocation (wallet/cash) is distinct from settlement allocation (Store proceeds, commission, Captain earnings, discounts, subsidies, refund/adjustment). No UI, campaign or external rail changes accounting ownership; platform-funded discount is a funding source, not duplicate merchandise value.

## STORE_COMMERCIAL_AGREEMENT — Accepted effective fees per Store
CAPABILITY_ID: STORE_COMMERCIAL_AGREEMENT

WLT owns proposed exact Store terms and version, informed acceptance by bound Merchant owner, Finance approval, effective date/model/period, supersession, cancellation and historical audit. DSH provides verified Store and eligible fulfillment context; registration shows permitted fee, explicit collector and methods, not automatic acceptance or charge. Default from one owner-backed Policies UX applies only to future eligible agreements, never overwrites active terms. No second relation-specific Store/merchant identity or WLT writer.

COMMISSION uses qualified authoritative Order basis, exact accepted basis points and frozen agreement/version; post deduction or platform receivable once. SUBSCRIPTION uses exact recurring YER amount, coverage period, invoice/due, renewal/cancellation and reconciliation. Do not activate until billing, idempotency, invoice/period and financial rights are proven. No automatically admitted HYBRID. Both fee models may apply to either relation and eligible collector; subscription does not imply cash ownership, commission does not imply physical platform custody. Optional tier entitlements follow Product law; no implicit role/checkout/payment rail. Trial/free/grace terms require versioned approved policy.

A changed Store agreement or relation preserves Store ID, lawful links, prior terms/Orders, open disputes, cash obligations and periods; renewed consent, effective version and verified cutover prevent overlapping or duplicate charges. DSH publication and checkout have independent owner gates. Missing agreement/collector or unsupported combination fails closed. No invented fee/tax/provider charges or guarantee.

## ORDER_PAYMENT_COLLECTION — Customer funding, cash custody and collector obligation
CAPABILITY_ID: ORDER_PAYMENT_COLLECTION

WLT owns exact payment intent/allocation, holds, collection, refund and settlement from DSH authoritative amount and eligibility snapshot.

| Collector | Admitted meaning |
| --- | --- |
| PLATFORM_MANAGED | Platform coordinates admitted internal prepaid WALLET, COD or MIXED, WLT holds/receivables and beneficiary settlement; physical custody follows accepted Captain/Store terms. |
| STORE_MANAGED | Store retains external customer proceeds with explicit receipt/refund responsibility under accepted terms; WLT records only verified platform-owned financial effects. Initially only specifically admitted Merchant-collected flow (e.g. cash at eligible pickup/Store delivery); no automatic platform Wallet, Mixed, Captain coverage or marketplace checkout. |

Either collector may apply to either relation/admitted channel only when exact accepted agreement, payment/fulfillment and legal/security evidence permit. Store-collected external cash is not Customer Wallet funding or platform/Captain custody. Unsupported combinations are unavailable, not remapped.

### Captain physical COD and exposure

Under the approved initial BThwani Captain model, Captain keeps collected physical cash; no new physical remittance to BThwani after the corresponding WLT debit, and no assumed platform cash disbursement. External exchanger deposit is external balance until verified Cash-In. Store-affiliated Captain and Store cash are not platform Captain custody.

At atomic acceptance of positive COD/mixed cash portion, available unheld coverage = posted Captain WLT balance minus active COD holds, payout holds and other governed locks. Approved initial eligibility requires coverage strictly greater than total confirmed payable (not merely cash portion). Reserve only actual positive cash portion, atomically; concurrent holds cannot reuse coverage. On verified collection/delivery post applicable earned entitlement and debit reserved cash once against receivable (DEBITED). Cancellation before collection releases hold without debit. Prepaid wallet portion is never debited from Captain again. Goods loss liability needs separate contractual controls/evidence; hold alone does not compensate lost goods. Test quantitative adequacy before activation; different formula requires explicit WLT policy, risk review and concurrent tests. Historical activation threshold 10,000 YER is a reference for separate initial eligibility policy, not daily reset or universal current number. Previously activated Captains may take prepaid Orders subject to standing and goods-custody risk. Historical FINALIZED/REMITTED remain their actual old facts, never automatically re-debited or re-credited.

### Store-collected proceeds and commission receivable

For accepted COMMISSION terms where Store retains proceeds, WLT records the platform commission receivable against exact Store from confirmed DSH Order and collection evidence. No duplicate wallet earning, Captain hold or Merchant top-up. WLT alone clears by verified receipt, lawful offset, reversal/adjustment or period settlement under accepted agreement. Exact payer, destination, source, amount, balance, statement/counterparty required; merchant report, closed incident or uploaded receipt is not proof. Duplicate reference, cross-Store offset, overpayment, timeout, stale account and refund-after-payment remain canonical reconciliation cases. Period/due attention, fee, offset and collector policy never rewrite prior terms. Journey PARTNER_COMMISSION_REMITTANCE owns cross-surface proof.

### Delivery tariff, markup and promotions

The donor-approved initial combination permits a fixed Customer delivery markup on standard BThwani Captain distance tariff only for eligible Store with zero product commission under its accepted WLT agreement. Customer sees full fee before confirmation. Captain receives entire base distance tariff; additional markup is distinct platform delivery-margin income (historical PLATFORM_DELIVERY_MARGIN_INCOME), not reduced earnings or disguised product commission. Store-affiliated delivery and pickup do not inherit it. Fee amount/mode are versioned WLT terms; nonzero commission plus markup or another stacking combination requires approved economic/conservation semantics and actual owner tests before activation. WLT funds promotion split exactly under frozen evidence; no duplicate charge or retrospective reinterpretation.

### Refunds and compensation

DSH owns lawful cancellation/adjustment under [commerce](commerce.md). Before collection release original reservation/cancel cash obligation, not extra Wallet credit. After collection WLT verifies original allocation, lawful entitlement, funding source and remaining amount; balanced posting at most outstanding entitlement once. No automatic compensation, double reimbursement, guessed credit or silent reduction of Store earnings. Manual external/cash return is exceptional, separately authorized and reconciled.

Narrow admitted platform-funded compensation: confirmed-collected, customer-approved full-item removal on completed Order with no promotion/discount. DSH derives amount from immutable line; authorized Finance reviews and WLT checks collected funds, caps total credits at original line amount, posts platform expense versus Customer Wallet liability once per adjustment and provides readback. Not reversal of settled Merchant proceeds; applied removal cannot yield a second compensation. Other quantity, discount, Store-funded, uncertain collection or disputed cases remain open until correct owner reconciliation.

## CUSTOMER_BALANCE_FUNDING — Verified external-to-internal credit
CAPABILITY_ID: CUSTOMER_BALANCE_FUNDING

External official-wallet CashInRail is transport, not internal balance. Only verified Customer and BThwani platform Captain purposes admitted; server-selected authorized purpose alone chooses canonical WLT destination. No Merchant/Store/Store-affiliated Captain Cash-In/withdrawal product follows. Authenticate unique provider evidence for correct actor/currency/amount and correlate once to funding intent; callbacks, duplicate/replayed or unresolved settlement never create another credit/rail movement. Customer sees own posted funds/transactions only.

If approved provider supplies authenticated successful funding and trustworthy fees/settlement evidence, credit beneficiary verified gross, debit actual net external settlement and separate BThwani provider fee expense in one balanced atomic idempotent event; zero fee has no expense. Preserve historical economic labels EXTERNAL_SETTLEMENT_CASH and PLATFORM_CASH_IN_PROVIDER_FEE_EXPENSE as distinct facts, not mandated SQL names. No hardcoded 2%, guessed fees, undisclosed gross deduction or fee change after replay. Actual provider agreement determines fee applicability and future frozen transactions. Isolated simulator proves internal accounting only; stage/production activation follows [engineering](engineering.md#external-financial-rails-by-environment).

## CAPTAIN_BALANCE_FUNDING — Initial funding and subsequent internal credit
CAPABILITY_ID: CAPTAIN_BALANCE_FUNDING

Apply verified external funding above to separately authorized BThwani Captain purpose. Distinguish personal funded balance from actual earned delivery entitlements, COD cash liability, gross exposure, payout holds and goods custody. Personal Cash-In is not earnings eligible for earnings withdrawal; real unheld posted balance caps eligible earnings. Initial activation threshold is checked at proper initial boundary only. No fabricated funding, daily top-up, negative hidden balance or Store Captain wallet/cash entitlement from affiliation.

## PARTNER_CAPTAIN_EARNINGS_SETTLEMENT — Beneficiary and external payout
CAPABILITY_ID: PARTNER_CAPTAIN_EARNINGS_SETTLEMENT

WLT owns per-Store/Captain earning attribution, beneficiary routing, verified official destination, payout intent/hold, external execution and independent reconciliation. Financial read, request, recipient change, approval, execution and reconciliation are distinct authority. Operator finance permission is mandatory for every Finance read/mutation, not enough alone for all actions; Store scopes and segregation apply. Merchant aggregates only owned Stores; delegated accountant only active granted Stores. Preserve exact Store-level attribution.

### Recipient and destination

Only actual eligible Store owner may change/reconfirm one Store recipient through versioned/audited WLT relationship, not staff grant/Finance authority. DEFAULT_OWNER applies to future unpinned eligible intents; SELECTED_VERIFIED_STAFF explicitly assigns eligible verified actor; RECIPIENT_REVIEW_REQUIRED blocks future instruction release when eligibility, Identity, Store membership or destination fails. No silent fallback to owner or redirect after staff suspension. Bulk selection persists distinct per-Store assignment; separate beneficiaries/destinations require separate transfers.

Destination is a different WLT fact: derive current verified canonical Identity phone and official name with Finance-approved provider. Beneficiary may state provider preference only; no entry/change of account number/name, destination creation, update, deactivation or substitution. Finance verifies current facts and active destination. Changed phone, Identity version, recipient or destination makes unexecuted instruction stale, blocks until reverification; past pinned evidence stays immutable. Performed transfer follows reconciliation/exception, never fabricated reversal.

### Intake, instruction and reconciliation

One open intake per Merchant or BThwani Captain beneficiary, positive WLT-verified eligible funds only. Freeze server-resolved amount and exact authorized Store allocation with stable identity; duplicate/concurrent/replayed intake returns same. Missing destination allowed as Finance review request only, no hold, posting, transfer or implied disbursement. Only separate canonical payout path after current Identity, eligible amount, Store recipient, active verified destination and specific Finance authority may reserve funds; link intake after owner readback. Uncertain/missing data stays pending/held with actionable reason.

Admitted external execution is manual transfer through approved official wallet rail, not assumed payout API. WLT creates unique payout/hold and pins approved beneficiary/destination/version. Before each not-yet-executed instruction release recheck current name/phone, actual Finance scope, assignment, destination, hold/version and no conflicting release/settlement. Missing/stale/RECIPIENT_REVIEW_REQUIRED blocks; no silent redirect.

Every transfer has own receipt and matched official statement row, with statement retained once per period/batch. XLSX is frozen execution artifact, not ledger writer. Separate authorized execution and independent reconciliation complete liability once; executor cannot reconcile own transfer merely from finance access. Unknown, partial, wrong beneficiary, duplicate, provider outage or mismatched statement stays on original identity with held/reconciling exception, no fresh transfer. Preserve attribution and old terms.

## CUSTOMER_BALANCE_MANUAL_WITHDRAWAL — Exception-only withdrawal
CAPABILITY_ID: CUSTOMER_BALANCE_MANUAL_WITHDRAWAL

Not Customer self-service. Authorized Operations records exceptional reason/evidence and request; WLT verifies available balance and holds approved amount. Separate authorized Finance approval, manual external transfer to verified destination, transfer-specific receipt and different authorized operator reconciliation link statement row before reducing/releasing internal liability. Unknown/mismatch remains held/open, not silently completed or retried. No policy converts this exception to general payout button.

## Financial policy values and protected history

WLT owns supported bounded commissions, subscription amounts/periods, settlement intervals, transfer min/max, delivery distributions, initial activation, COD coverage, refund/compensation ceilings and collector independent of relation. Apply [architecture](architecture.md#safe-change-protocol), exact signed agreement compatibility, effective version and attributable readback; supported changes need no code deployment, new financial capabilities require implementation and approval. Never change conservation, exact currency, once-only posting, consent or verified beneficiary. Preserve accepted prior orders, periods, holds and settlements.

Legacy physical remittance and enrollment/referral reward are not new writers. Retain protected actual old counterparty, cash/provider custody, legal evidence, IDs, immutable ledger, already settled periods and unpaid binding liabilities. Only specifically authorized WLT reconciliation resolves genuinely outstanding records; current Captain Cash-In is a different operation. Unknown old evidence is RECONCILIATION_REQUIRED; protected schema mapping remains unaccepted until actual donor/current records and recovery are proven. Do not invent fee rates, subscription prices or legal terms.

## Order economics and financial measurement

WLT owns authoritative monetary attribution; DSH qualifying Order/line/quantity/fulfillment/snapshot evidence. Distinguish merchandise value, platform-earned revenue, Store/Captain entitlements, custody, Customer funding, fees, promotions and settlement. Cash received, wallet funding, gross merchandise and payable to others are not automatically platform revenue. Use accepted frozen economics, exact integer YER and approved accounting treatment.

Contribution margin = qualifying platform-earned revenue less attributable variable costs borne by platform (applicable Captain expense, provider fee, platform-funded discount and other documented variable costs). Count adjustment/refund once; no cost already netted twice, Merchant-funded discount as platform expense, or invented Merchant COGS. Separate estimate, committed effect, settled outcome and unknown/unallocated cost; period and reconciliation completeness explicit. Margin is not net profit. No proxy or analytics ledger proves balances/earnings. Reuse WLT reconciliation/conservation tests; metric tests prove attribution, units, duplicate/reversal handling.

## Acceptance before financial activation

Apply all permitted relation/channel × fee model × collector/fulfillment/payment combinations and rejection of DIRECT marketplace or unsupported combinations. Prove price change, stock, COD/WALLET/MIXED, actual eligible amounts, atomic holds, concurrent acceptance, unknown/retry, pre/post-collection cancellation, disputes/refund, settlement and destination change, exact ledger conservation, no double debit/fee/period invoice, preserved beneficiaries/old terms, segregation and negative access. Actual WLT/DSH/Identity runtime and durable readback plus protected restore/risk/legal/consent evidence where applicable; mock, HTTP 200, source and syntactic pass do not prove financial activation. Internal risk-assurance requirements belong to [safety](safety.md#proof-internal-technical-risk-assurance-and-incident-readiness); separate external reviewer is not automatically required for policy choice. Unexecuted proof remains NOT_RUN/REVIEW_BLOCKED at its actual owner, never an unearned implementation status in governance.
