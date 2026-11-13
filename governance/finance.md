# BThwani — Financial Ownership, Collection and Store Agreements

ARTIFACT_CLASS: DOMAIN_GOVERNANCE_DRAFT
SEMANTIC_OWNER: governance/finance.md
STATUS: DRAFT_PENDING_FULL_GOVERNANCE_CUTOVER
POLICY_DECISION: HUMAN_APPROVED_2026-11-13
IMPLEMENTATION_RISK_ASSURANCE: NOT_RUN
IMPLEMENTATION_STATE_AUTHORITY: NONE

This is a **newly authored target** for the approved business distinctions and the human-approved initial target collection defaults (explicit user approval on 2026-11-13). It is not a copy of historical finance.md, a migration, proof of available payments, or an activation switch. The chosen target policy is human-approved; operational activation requires remaining owner reconciliation, accepted effective agreements and a verified runnable implementation with documented internal risk assurance. The root governance README still says NOT_READY.

## 1. One money writer, one order writer

- Identity owns the human actor and access rights; DSH owns Store, channel relation, Store Orders, amounts and operational fulfillment; WLT exclusively owns internal wallet balances, payment/collection intents, ledgers, versioned Store commercial agreements, platform receivables and settlements.
- An app, Operator policy screen, Store portal, Docker service, direct SQL writer or provider webhook does not create a second wallet ledger or override WLT. DSH calls WLT through the accepted financial contract.
- Merchant is the **person/actor** authorized to administer potentially multiple Stores. Store is the DSH commercial resource. Never collapse their IDs or create merchant-specific order/ledger engines.

## 2. Four independent dimensions — no parallel engines

1. **Store channel relation**: `MARKETPLACE` or `DIRECT` — selected for the Store on registration, subject to DSH publication and checkout eligibility.
2. **Commercial fee model**: `COMMISSION` or `SUBSCRIPTION` — an Operator-configurable permitted default per relation, materialized as one versioned, accepted, Store-specific WLT agreement. Either model may be configured for either relation. Do not hard-code Partner=Commission or Direct=Subscription.
3. **Financial collection/settlement responsibility**: `PLATFORM_MANAGED` or `STORE_MANAGED` — a separately approved Store-specific financial responsibility, with documented custodians, settlement terms and refund liability. This is **not** a second WLT or DSH engine.
4. **Fulfillment method**: the approved DSH pickup/dispatch/Store-Captain method, separately checked against financial and operational readiness.

An Operator may change effective defaults in the **single owner-backed policy configuration** for future agreements only. It cannot silently rewrite historical agreements or orders, change an active Store's signed terms without an effective agreement transition, or make an unimplemented capability ready.

## 3. Human-approved initial target collection policy

| Store relation | Default collection responsibility | What it means |
| --- | --- | --- |
| `MARKETPLACE` | `PLATFORM_MANAGED` | The platform coordinates eligible customer wallet/cash/mixed allocations, WLT holds/receivables and beneficiary settlements; physical COD cash custody follows the admitted Captain/Store contract, not a fictional platform cash drawer. |
| `DIRECT` | `STORE_MANAGED` | The Store is responsible for its **externally collected** customer funds, refunds and customer-facing receipts under its accepted terms; WLT records only verified platform fees/claims/settlements and other admitted platform-owned financial effects. A Store external cash balance is never represented as a WLT customer wallet. |

These are **human-approved initial target defaults**, not immutable restrictions, accepted Store agreements, or a claim that they work today. A different combination is valid only after the owner-backed policy permits it, the Store accepts a versioned agreement, DSH/WLT contracts support it and the exact flow passes financial/legal/security acceptance. Never expose a disabled combination as a usable UI choice.

## 4. Fee-model semantics

- `COMMISSION`: calculate the applicable commission from the qualified authoritative order basis and signed effective fee terms, with a frozen Order/Agreement version. The money may be collected through either approved responsibility model; WLT posts the platform receivable or deduction once. Never calculate authoritative commission in the Merchant UI.
- `SUBSCRIPTION`: one versioned Store subscription agreement, coverage period, invoice/due amount, renewal/cancellation and WLT posting/reconciliation. Do not debit or activate subscription automatically from policy selection until billing, invoicing, idempotency, rights and acceptance are verified.
- Fee model, collector and delivery are **orthogonal**. Subscription does not imply Store owns all collected customer money; commission does not imply the platform physically takes cash.
- A changed policy affects **new Store agreements/periods** at their legal effective date. In-flight and completed Orders retain immutable versions, economics, customer allocation and entitlement snapshots.

## 5. Payment and custody at checkout

- For `PLATFORM_MANAGED`, enable only WLT-verified and channel-eligible payment sources: prepaid internal Customer Wallet, COD, or Mixed where the particular DSH/WLT fulfillment and customer flow is ready. A Cash-In provider is an external funding rail, **not** a second internal wallet.
- For `STORE_MANAGED`, initially expose only a specifically admitted Merchant-collected payment flow (e.g. cash on eligible direct pickup or Store delivery) with explicit receipt/refund responsibility. Do not automatically reuse the platform Customer Wallet, platform Captain COD coverage, Mixed, or marketplace checkout merely because the Store has a direct website.
- Cash **custody** and accounting ownership differ. Under an admitted BThwani Captain COD flow the Captain may retain collected physical cash while WLT applies a balanced receivable/hold/debit against the Captain's authoritative balance. Under the human-approved initial target, admission verifies unheld coverage strictly greater than the total confirmed Order payable, while the atomic hold/debit applies only to the cash portion. Quantitative coverage adequacy and legitimate eligibility thresholds must be tested and documented before actual enablement; prepaid Customer wallet funding is not debited a second time from the Captain. Store-collected cash cannot be treated as Captain/platform custody.
- DSH sets and revalidates the authoritative quotation, Store/Offer price, quantity, availability, relation, fulfillment eligibility and final Order snapshot at confirmation; WLT authorizes the selected payment and later financial effects. UI totals never write the canonical amount.
- The payable customer's **funding allocation** is distinct from beneficiary earnings and settlement allocation. Each owner-backed effect must be idempotent under timeout, retries and simultaneous acceptance, with an explicit unknown/reconciliation state rather than a speculative success.

## 6. Registration, consent and later changes

1. Merchant registers as one Identity actor and creates a DSH Store, selecting `MARKETPLACE` or `DIRECT`. No additional Merchant identity or Store engine is created.
2. DSH obtains the effective policy version for that relation; the permitted fee model and suggested collection/fulfillment options are displayed as terms, not silently charged.
3. WLT creates/accepts the versioned Store agreement, including fee model and financial responsibilities only when the supporting capabilities and required approvals are ready.
4. DSH publication and checkout remain unavailable until their own legal, catalog, payment, dispatch and security gates succeed; Store registration alone is not publication or payment activation.
5. Changes are prospective and versioned. Preserve Store ID, published permitted links, past Order snapshots, financial obligations, open disputes and cash settlement/reconciliation; verify no overlapping fee period or duplicate charge.

## 7. Mandatory financial acceptance before activating a combination

- Matrix tests for **both Store relations × both fee models × each separately admitted collector/fulfillment/payment choice**; unsupported combinations must fail closed and be invisible to normal purchasers.
- Prove fresh and existing Order behavior: price change/unavailable item, COD/WALLET/MIXED split, unknown payment, replay, concurrent accepts/holds, cancellation before/after collection, refund/dispute, failed settlement and retry.
- Prove every WLT ledger posting balances, no double debit, commission and subscription invoice exactly once per liability/period, preserved beneficiary assignment, segregation of customer funding versus Store earnings, and immutable old terms.
- Verify real authorized Identity/DSH/WLT responses and durable WLT readback; a UI render, mock, HTTP 200 or syntactic pass is not financial proof.
- The human-approved 2026-11-13 decision requires no external reviewer for selecting these financial *policy targets*. Actual financial, protected database and permission effects require documented internal adversarial risk analysis, accepted agreements and owner-backed negative/ledger/concurrency/restore checks before activation. If not executed, those implementation checks remain `NOT_RUN`/`REVIEW_BLOCKED` rather than `PASS`; no unperformed independent signoff is claimed.

## 8. Exclusions and unresolved implementation evidence

- No second shopping cart, Store ledger, direct-Order writer, Merchant Wallet product or independent billing engine for relation variants.
- Do not invent commission percentages, subscription prices, tax amounts, external provider fees, default payment guarantees or legal custody arrangements. Their **values** belong to current versioned owner-backed policy and accepted terms.
- The exact API/SQL field names, migrations, availability of Store-managed payment rails and production financial capability readiness must be determined by the implementation-stage audit. They are NOT_RUN for this clean worktree.
- These rules cannot silently override existing binding obligations. The historical source and archived contracts remain provenance outside this clean branch; preserve lawfully protected transaction records when rebuilding SQL.


## 9. Financial integrity inherited from approved current policy

**Money:** For current YER Product, every authoritative amount is an **exact integer** with `currency=YER`; one `amount_minor` corresponds to one YER. No binary floating-point arithmetic at authorization, billing, balances, commission or settlement. Basis-point rounding belongs to WLT's **versioned** applicable fee policy, and every journal/transfer conserves its posting balance.

**Captain physical COD:** Under an admitted BThwani Captain cash-on-delivery Order, the Captain may keep physical cash received from the Customer. Do not claim BThwani has a physical cash cashier/remittance requirement for new Orders simply because older contracts or reports mention remittance. Cash deposited with an outside agent/provider is an external balance, **not** a WLT wallet credit until separate verified Cash-In. Historical COD remittance liabilities need evidence-based reconciliation at WLT and cannot be forgiven or charged a second time.

**Gross exposure and cash portion are distinct:** at atomic Captain acceptance with positive COD, WLT's human-approved initial target verifies available unheld coverage **strictly greater than the total confirmed payable Order**; this is subject to real quantitative risk adequacy testing before activation. Only the actual positive **cash portion** is reserved, later debited once upon the admitted collection/delivery event. Customer-prepaid wallet funding is not deducted from the Captain balance again. Previously activated Captains can receive wholly prepaid Orders subject to goods-in-custody and role risk. Initial activation funding threshold is a separately configurable WLT policy, not a midnight reset or per-order debit. Holds and terminal cash state must be replay/concurrency safe.

**Refunds and payouts:** WLT preserves customer funding liability, Store platform receivables, commission, Captain earned entitlements, merchant beneficiaries and settlement state as different records with appropriate immutable origins. An accepted Order's monetary snapshot cannot be reinterpreted by later Operator policy changes. A direct Store-collected cash sale must not be silently posted as BThwani Captain physical custody.

## STORE_COMMERCIAL_AGREEMENT — Accepted effective fees per Store
CAPABILITY_ID: STORE_COMMERCIAL_AGREEMENT

WLT owns the canonical Store agreement and all transitions: proposed terms and current version, Merchant informed acceptance, Finance authorization, effective model/period, supersession, cancellation and legally relevant historical evidence. Every Store relation may use `COMMISSION` or `SUBSCRIPTION` if the exact model's billing/invoice, financial and permission flow is implemented and approved.

A mutable policy default **suggests** terms for new or renegotiated Stores; it does not by itself accept an agreement, activate subscription billing, overwrite an effective Store contract, change settled Orders or grant new checkout rights. Signed rates are captured in exact basis points and/or exact recurring YER amounts with term/version, allowed fulfillment methods and effective date. WLT rejects subscription activation until recurring invoices, issuance/renewal, due handling, retries, cancellation and ledger consequences are actually proven. No `HYBRID` model is automatically admitted from historical rows.

## ORDER_PAYMENT_COLLECTION — Customer funding, cash custody and collector obligation
CAPABILITY_ID: ORDER_PAYMENT_COLLECTION

Payment method (`WALLET`, `COD`, `MIXED` where admitted), collector responsibility (`PLATFORM_MANAGED` / `STORE_MANAGED` as future owner-backed policy), funding source, physical cash custody and beneficiaries are **different facts**. WLT owns admissible payment intents, allocation, holds, refund and settlement. DSH provides the authoritative Order amount, Store relation and selected fulfillment, not a second ledger.

An Operator-approved collector selection is effective only for a Store-specific legal agreement and real checkout/fulfillment combinations that have been independently proven. The same mode under Direct and Marketplace can have different cash responsibility without acquiring a second Order engine. Unknown provider response, network timeout, race, cancellation and refund must converge on one state and once-only journal effects. Customer payments cannot be confirmed merely from local UI state.

## CUSTOMER_BALANCE_FUNDING — Verified external-to-internal credit
CAPABILITY_ID: CUSTOMER_BALANCE_FUNDING

Customer Wallet is WLT-owned. An external payment provider is a verifiable cash-in rail and never a substitute internal account. WLT credits customer balance only after valid uniquely correlated provider evidence and once-only funding posting; duplicate callbacks, replays, wrong actor/currency/amount or unresolved provider status must not create balance. The customer can read only their own funds and transactions. Never interpret Store externally collected money as customer Wallet funding.

**Funding-purpose admission retained from donor 41:** The external official-wallet `CashInRail` is currently admitted as a funding **transport** for only the verified **Customer** and **BThwani platform Captain** WLT funding purposes. Even if those capabilities share one provider adapter, the server-selected, owner-authorized funding purpose determines the sole canonical WLT destination; the external provider or client-supplied account does not select a wallet. This admission creates **no** Merchant-owner, Store wallet or Store-affiliated Captain Cash-In/withdrawal product. A timeout, repeated callback or uncertain provider settlement is reconciled against one funding identity before crediting an internal balance; it cannot be resolved by reinitiating a second rail movement.

## CAPTAIN_BALANCE_FUNDING — Initial funding and subsequent internal credit
CAPABILITY_ID: CAPTAIN_BALANCE_FUNDING

BThwani Captain WLT balance uses separately verified external funding and posted ledger facts. An initial activation threshold may be set from Operator Policies but applies only at its proper initial eligibility boundary; no daily automatic top-up, hidden negative balance, or fabricated funding after a failed provider read. Distinguish actual earned delivery entitlements, personal funded balance, COD cash liability, gross Order exposure and goods-custody protections. Store-affiliated Captains do not automatically hold platform Captain wallet/cash powers.

## PARTNER_CAPTAIN_EARNINGS_SETTLEMENT — Beneficiary and external payout
CAPABILITY_ID: PARTNER_CAPTAIN_EARNINGS_SETTLEMENT

WLT owns per-Store earnings/fee attribution and Captain earnings, the Merchant/Store beneficiary assignment, official verified payout destination, payout holds, external transfer and independent reconciliation. The default Store beneficiary is the authorized owner; an eligible Store-scoped delegate may be named only through the approved owner change protocol, independently from the wallet-number/provider selection.

A beneficiary may submit a **settlement intake** request without a verified destination; this is only a Finance work item, not a payout, ledger mutation, reservation or claim of transfer. When Finance verifies all rights/amounts/destination it creates the canonical payout intention and reservation. Separate transfer evidence and statement reconciliation complete the liability once. A bulk multi-Store payout cannot collapse distinct beneficiary/destination scopes into one unsafe transfer.

**One-open-intake and verified payout creation:** A Partner or BThwani platform Captain may request only WLT-verified positive **eligible** funds, and WLT records at most **one open settlement intake per beneficiary**. The intake freezes the server-resolved amount and, for Partners, exact authorized per-Store allocation, with an auditable, stable idempotency/correlation identity; concurrent or replayed requests read the same open intake rather than creating duplicate payout intentions. An intake without a verified official-wallet destination is permitted as a **request for Finance review only**, with **no WLT hold, ledger posting, transfer or implied entitlement disbursement**. Finance must independently re-evaluate current canonical Identity eligibility, WLT amount and Store recipient assignment, active verified provider/destination and specific Finance authorization before a *separate* canonical payout path may reserve funds. Only after payout owner readback may the intake be linked to that payout. Missing destination, uncertain amount, stale identity or unresolved transfer leaves an actionable pending/held outcome and never triggers a silent new payout, recipient fallback or substitute accounting entry. These retained branch-41 target rules are human-approved as policy on 2026-11-13; actual activation still requires reviewed accepted agreements, verifiable owner-backed financial/security evidence, and proven segregation of duties, not an invented external FIN/SEC signoff.

## CUSTOMER_BALANCE_MANUAL_WITHDRAWAL — Exception-only withdrawal
CAPABILITY_ID: CUSTOMER_BALANCE_MANUAL_WITHDRAWAL

This is **not** a customer self-service payout product. A documented exceptional case begins through authorized Operations intake with reason/evidence, then WLT verifies available balance and holds the approved amount. Authorized Finance executes and documents an external transfer to a verified destination; independent reconciliation links the receipt and statement item before WLT releases the internal liability. Unknown or mismatched results remain held/open for investigation, not silently completed or reattempted as a fresh transfer. Operator policy cannot turn this bounded exception into a general payout button.

## Source conflicts to reconcile before policy adoption

Legacy operational documents may refer to daily physical COD remittance or a relationship-specific commission/subscription split. These are **not silently adopted** here: the effective current WLT implementation/protected legal obligations and latest approved Product decisions must be reconciled for each historical vs new operation. Historical external repayment, reconciliation evidence and any binding contract remain protected. Exact fee percentages, subscription prices and Store-managed collection law are unresolved owner-backed values, not hardcoded defaults.

## Protected refund, destination and transfer-specific evidence

At the present admitted external settlement model, payout execution is a **verified manual transfer through the approved official wallet rail**, not an assumed automated provider payout API. WLT creates a unique authorized payout/hold and pins the approved destination, then separate execution evidence, transfer-specific receipt, official batch/period statement and matched statement row are linked and independently reconciled before completion. An exported spreadsheet is an execution artifact, never an accounting writer.

The beneficiary's official payment destination must be derived from **current Identity-verified canonical phone and official name** and the Finance-approved provider. A Merchant or Captain may state a provider *preference*, but may not enter/change the official receiving account number or beneficiary name. A changed phone, actor identity version, recipient assignment or disabled destination makes a not-yet-executed transfer **stale and blocked for Finance reverification**, not silently redirected. Previously frozen approved evidence remains immutable; a performed transfer takes the reconciliation/exception route rather than a fabricated reversal.

Store recipient assignment and payout destination approval are **independent**: only the eligible Store owner can change the Store's legal payout-beneficiary actor, subject to WLT validation; possession of finance-read, payout-intake or other delegated Store privileges does not convey that power. Finance can read/approve/execute/reconcile only under its specific current Identity `finance` permission and separation of duties. The Operator role alone is not sufficient. Customer withdrawal exception intake, Finance approval, external execution and reconciliation remain deliberately separate authorizations.

A general Order cancellation never automatically mints Customer Wallet compensation. Where refund liability exists, WLT verifies the original collected allocation and eligible remedy and posts no more than the documented outstanding entitlement once. A transferred/settled liability does not become platform-funded merely because a UI changed its wording. Cases involving uncertain collection, Store-funded returns, campaign discounts or partial quantity adjustments remain explicit exceptions until correct funding and ownership are established.

## Operator-managed financial values versus immutable accounting rules

WLT owns changeable, bounded and legally admitted **commission percentages, subscription amounts and billing periods, settlement intervals, minimum/maximum eligible transfer amounts, allowable delivery fee distributions, Captain initial activation funding, COD coverage thresholds, refund/compensation monetary ceilings, and Store collection responsibility**, independently from `MARKETPLACE`/`DIRECT` when the relevant contract supports the setting.

The initial gross-coverage eligibility described above is a **current approved financial-policy rule**, not permission to scatter an unchangeable number or comparison operator through clients and unrelated services. Any different coverage formula or threshold requires WLT's explicit eligible policy contract, accounting/safety review and real concurrent COD tests before the Operator can activate it. The *accounting invariants* (balanced ledger, exact currency, no duplicate posting, lawful consent and verified beneficiary) are never adjustable switches.

Every financial value has scope, effective version, signed Store agreement compatibility and an attributable readback. A new default may apply to **future eligible agreements** but never silently rewrite prior accepted orders, subscriptions, reserves or settlements. Changing a supported value should not require code deployment; introducing a genuinely new payment/billing capability does.

## WLT Store-collected proceeds and commission receivable boundary

When the accepted WLT `COMMISSION` agreement and lawful Order collection policy permit the **Store** to retain the Customer's proceeds, WLT records the resulting **platform commission receivable against the correct Store** from confirmed DSH Order/collection evidence. A Store-owned cash collection is **not** the same as BThwani-Captain physical COD liability, customer wallet funding, Merchant wallet top-up or a WLT platform-managed payout. Recognizing the Store's collected sale as a second wallet earning would double count the transaction.

Only WLT applies an authorized actual receipt, lawful offset, reversal/adjustment or period settlement against that receivable. The official settlement period, payment/offset eligibility, due-date attention thresholds, fees and collection responsibility are governed by the **accepted Store agreement and versioned WLT Operator Policies** when implemented; never hardcode them by `MARKETPLACE` or `DIRECT` relation. No policy edit rewrites earlier accepted Order/agreement snapshots or independently recorded cash.

WLT cannot mark the receivable cleared merely because Merchant reports transfer, Operator closes an incident, a receipt image was uploaded or a provider responded ambiguously. Verify exact payer, destination, source evidence, amount, balance and external statement/counterparty; duplicate references, cross-Store offsets, overpayment, timeout, stale account and refund-after-payment remain explicit canonical reconciliation cases. See `PARTNER_COMMISSION_REMITTANCE` in `journeys.md` for the cross-surface handoff; no new commission service or second ledger is admitted.

## Financial-accounting distinctions recovered from branch 41 — review-gated

### Provider-funded gross credit versus provider expense

If and only if an **officially approved Cash-In provider** has supplied authenticated successful funding and trustworthy fee/settlement evidence, WLT must credit the beneficiary's **verified gross** funding amount. A provider fee payable by BThwani is a **separate platform expense** rather than an undisclosed deduction from Customer/Captain funds. The corresponding external settlement proceeds are the **actual provider net**, and the three effects must balance in one atomic, idempotent, evidence-correlated financial event. A zero provider fee has zero expense but does not change the gross-funding invariant. Historic account labels `EXTERNAL_SETTLEMENT_CASH` and `PLATFORM_CASH_IN_PROVIDER_FEE_EXPENSE` identify separate *economic facts*, not SQL table names to copy blindly.

No generic "2%" provider fee or unconditional cash-in credit is admitted. Actual fee schedules and applicability are governed by the official external provider agreement and safe WLT owner policy, **not guessed from a screen**. A local simulator proves only isolated internal ledger behavior, not external settlement rights. Any legal fee changes apply to qualifying **future transactions** with frozen provider evidence, not retroactive edits.

### Store-approved delivery markup versus Captain earnings

The donor-approved initial combination permits a **separate fixed Customer delivery markup** on the standard BThwani Captain distance tariff **only** for an eligible Store with a **zero product commission** under its accepted WLT Store agreement. The Customer sees the full fee at quote/confirmation; the Captain's **entire base distance tariff** remains the Captain's entitlement, while the distinct additional markup is platform delivery-margin income (historical economic label `PLATFORM_DELIVERY_MARGIN_INCOME`). Neither hidden reduction of Captain entitlement nor relabeling the markup as Store product commission is allowed. Store-affiliated Captain delivery or Customer Pickup does not inherit that BThwani-Captain markup.

The **fee amount and mode eligibility** are versioned, auditable WLT Operator policies and Store-specific accepted terms, not hardcoded business numbers. Introducing a markup together with nonzero product commission or another unverified fee stacking combination requires human-approved economic/conservation rules, internally reviewed WLT owner implementation and concurrent money/quote tests **before enabling the option**. This historic default does not establish that the production code currently supports it.

### Recipient readiness without silent beneficiary fallback

WLT's per-Store payout-recipient decision has three business meanings:

- `DEFAULT_OWNER`: the Store's verified owner is the beneficiary for eligible **future unpinned payout intents**, with no artificial staff assignment needed.
- `SELECTED_VERIFIED_STAFF`: the owner has explicitly assigned one eligible, verified Store staff actor under an independently versioned/audited WLT Store-recipient relationship.
- `RECIPIENT_REVIEW_REQUIRED`: the selected recipient lost current eligibility, verified Identity authority, Store membership or destination readiness; **future payout instruction release is blocked** until the owner explicitly selects/reconfirms a legal recipient and Finance verifies the correct official destination.

These are **recipient readiness semantics**, not a new Person role, three payout engines or permission for Finance to choose the Store beneficiary. Staff suspension/revocation must never trigger a silent fallback or redirect; an already approved/partly executed transfer preserves its immutable beneficiary and enters the correct reconciliation path. Multi-Store payout batching retains Store-level allocations and partitions different beneficiaries/destinations into separate transfers. Recipient rules have one WLT owner, independent Finance approval/reconciliation and future-effective Operator policy as appropriate.

**Adoption boundary:** these recovered monetary semantics are a **candidate reviewed draft from the branch-41 donor**, not final external-provider/legal or ledger migration acceptance. The prior external reviewer gate was not performed; the 2026-11-13 human decision adopts policy targets without that external signoff, while financial/security/schema implementation evidence remains `NOT_RUN`/`REVIEW_BLOCKED` until demonstrated. No actual ledger, payout, production setting or customer balance has been changed.

## Payout-instruction release and uncertain-transfer boundary

Before **every not-yet-executed** manual official-wallet transfer, WLT must recheck the current verified Identity name/phone, authorized Finance scope, effective per-Store beneficiary assignment, verified destination, eligible hold, approved transfer version and absence of conflicting release/settlement. A destination approved yesterday does not license release after a verified phone or staff-assignment change. `RECIPIENT_REVIEW_REQUIRED`, failed current Identity/DSH/WLT readback or changed recipient blocks the instruction with a retained accountable exception; WLT never silently falls back from selected staff to the Store owner or redirects to a supplied wallet number.

A receipt/image or generated XLSX is **not** financial completion. Each unique payout preserves its own transfer-specific receipt and external statement-row match even when one official statement covers several transfers; independent authorized reconciliation alone closes the liability. Duplicate transfer attempts, partial execution, wrong beneficiary, failed provider read and ambiguous external response remain held/reconciling on the original operation identity, rather than being retried with a new payout identity. An intake cannot reserve funds, and no actor may execute and independently reconcile their own transfer merely because they have `finance` read access. These are financial-policy acceptance conditions, not proof of a real rail or SQL implementation.

## Old physical-COD obligations remain audit evidence, not new postings

Historical WLT COD/physical remittance records previously labeled `FINALIZED` or `REMITTED` cannot be relabeled as uncollected, re-debited or re-credited merely to fit the new Captain cash-coverage model. A protected upgrade retains their identity, original counterparty, actual provider/cash custody, legal settlement evidence, already-posted ledger movements and applicable period. Only a separately admitted and Finance-reviewed reconciliation can resolve an **actually outstanding** old liability; a current `CAPTAIN_BALANCE_FUNDING` top-up is a **different** funding operation, not proof that physical cash was remitted or an excuse to mint a new earning.

Unknown or missing historical evidence is explicitly `RECONCILIATION_REQUIRED`, not a permissive replacement with a new policy default. This requirement is binding as a preservation boundary but its specific SQL mapping and protected migration are `REVIEW_BLOCKED` until donor rows and current financial truth are verified.
