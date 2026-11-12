# BThwani — Financial Ownership, Collection and Store Agreements

ARTIFACT_CLASS: DOMAIN_GOVERNANCE_DRAFT
SEMANTIC_OWNER: governance/finance.md
STATUS: DRAFT_PENDING_FULL_GOVERNANCE_CUTOVER
RISK_REVIEW: REVIEW_BLOCKED_UNTIL_INDEPENDENT_FINANCE_SECURITY_MIGRATION_REVIEW
IMPLEMENTATION_STATE_AUTHORITY: NONE

This is a **newly authored target** for the approved business distinctions and a recommended default collection policy. It is not a copy of historical finance.md, a migration, proof of available payments, or an activation switch. Final adoption requires harmonization with the remaining domain owners and an independently reviewed runnable implementation. The root governance README still says NOT_READY.

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

## 3. Recommended initial default collection policy

| Store relation | Default collection responsibility | What it means |
| --- | --- | --- |
| `MARKETPLACE` | `PLATFORM_MANAGED` | The platform coordinates eligible customer wallet/cash/mixed allocations, WLT holds/receivables and beneficiary settlements; physical COD cash custody follows the admitted Captain/Store contract, not a fictional platform cash drawer. |
| `DIRECT` | `STORE_MANAGED` | The Store is responsible for its **externally collected** customer funds, refunds and customer-facing receipts under its accepted terms; WLT records only verified platform fees/claims/settlements and other admitted platform-owned financial effects. A Store external cash balance is never represented as a WLT customer wallet. |

These are **proposed defaults**, not immutable restrictions or a claim that they work today. A different combination is valid only after the owner-backed policy permits it, the Store accepts a versioned agreement, DSH/WLT contracts support it and the exact flow passes financial/legal/security acceptance. Never expose a disabled combination as a usable UI choice.

## 4. Fee-model semantics

- `COMMISSION`: calculate the applicable commission from the qualified authoritative order basis and signed effective fee terms, with a frozen Order/Agreement version. The money may be collected through either approved responsibility model; WLT posts the platform receivable or deduction once. Never calculate authoritative commission in the Merchant UI.
- `SUBSCRIPTION`: one versioned Store subscription agreement, coverage period, invoice/due amount, renewal/cancellation and WLT posting/reconciliation. Do not debit or activate subscription automatically from policy selection until billing, invoicing, idempotency, rights and acceptance are verified.
- Fee model, collector and delivery are **orthogonal**. Subscription does not imply Store owns all collected customer money; commission does not imply the platform physically takes cash.
- A changed policy affects **new Store agreements/periods** at their legal effective date. In-flight and completed Orders retain immutable versions, economics, customer allocation and entitlement snapshots.

## 5. Payment and custody at checkout

- For `PLATFORM_MANAGED`, enable only WLT-verified and channel-eligible payment sources: prepaid internal Customer Wallet, COD, or Mixed where the particular DSH/WLT fulfillment and customer flow is ready. A Cash-In provider is an external funding rail, **not** a second internal wallet.
- For `STORE_MANAGED`, initially expose only a specifically admitted Merchant-collected payment flow (e.g. cash on eligible direct pickup or Store delivery) with explicit receipt/refund responsibility. Do not automatically reuse the platform Customer Wallet, platform Captain COD coverage, Mixed, or marketplace checkout merely because the Store has a direct website.
- Cash **custody** and accounting ownership differ. Under an admitted BThwani Captain COD flow the Captain may retain collected physical cash while WLT applies a balanced receivable/hold/debit against the Captain's authoritative balance. Admission must verify available unheld coverage strictly greater than the total confirmed Order payable, while the atomic hold/debit applies only to the cash portion. Prepaid wallet funds are not debited a second time from the Captain. Store-collected cash cannot be treated as Captain/platform custody.
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
- Changes affecting finance, protected databases or permissions require a genuinely independent domain review before final acceptance. Without it, `REVIEW_BLOCKED` even if local checks pass.

## 8. Exclusions and unresolved implementation evidence

- No second shopping cart, Store ledger, direct-Order writer, Merchant Wallet product or independent billing engine for relation variants.
- Do not invent commission percentages, subscription prices, tax amounts, external provider fees, default payment guarantees or legal custody arrangements. Their **values** belong to current versioned owner-backed policy and accepted terms.
- The exact API/SQL field names, migrations, availability of Store-managed payment rails and production financial capability readiness must be determined by the implementation-stage audit. They are NOT_RUN for this clean worktree.
- These rules cannot silently override existing binding obligations. The historical source and archived contracts remain provenance outside this clean branch; preserve lawfully protected transaction records when rebuilding SQL.


## 9. Financial integrity inherited from approved current policy

**Money:** For current YER Product, every authoritative amount is an **exact integer** with `currency=YER`; one `amount_minor` corresponds to one YER. No binary floating-point arithmetic at authorization, billing, balances, commission or settlement. Basis-point rounding belongs to WLT's **versioned** applicable fee policy, and every journal/transfer conserves its posting balance.

**Captain physical COD:** Under an admitted BThwani Captain cash-on-delivery Order, the Captain may keep physical cash received from the Customer. Do not claim BThwani has a physical cash cashier/remittance requirement for new Orders simply because older contracts or reports mention remittance. Cash deposited with an outside agent/provider is an external balance, **not** a WLT wallet credit until separate verified Cash-In. Historical COD remittance liabilities need evidence-based reconciliation at WLT and cannot be forgiven or charged a second time.

**Gross exposure and cash portion are distinct:** at atomic Captain acceptance with positive COD, WLT verifies available unheld coverage is **strictly greater than the total confirmed payable Order**; only the actual positive **cash portion** is reserved, later debited once upon the admitted collection/delivery event. Customer-prepaid wallet funding is not deducted from the Captain balance again. Previously activated Captains can receive wholly prepaid Orders subject to goods-in-custody and role risk. Initial activation funding threshold is a separately configurable WLT policy, not a midnight reset or per-order debit. Holds and terminal cash state must be replay/concurrency safe.

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

## CAPTAIN_BALANCE_FUNDING — Initial funding and subsequent internal credit
CAPABILITY_ID: CAPTAIN_BALANCE_FUNDING

BThwani Captain WLT balance uses separately verified external funding and posted ledger facts. An initial activation threshold may be set from Operator Policies but applies only at its proper initial eligibility boundary; no daily automatic top-up, hidden negative balance, or fabricated funding after a failed provider read. Distinguish actual earned delivery entitlements, personal funded balance, COD cash liability, gross Order exposure and goods-custody protections. Store-affiliated Captains do not automatically hold platform Captain wallet/cash powers.

## PARTNER_CAPTAIN_EARNINGS_SETTLEMENT — Beneficiary and external payout
CAPABILITY_ID: PARTNER_CAPTAIN_EARNINGS_SETTLEMENT

WLT owns per-Store earnings/fee attribution and Captain earnings, the Merchant/Store beneficiary assignment, official verified payout destination, payout holds, external transfer and independent reconciliation. The default Store beneficiary is the authorized owner; an eligible Store-scoped delegate may be named only through the approved owner change protocol, independently from the wallet-number/provider selection.

A beneficiary may submit a **settlement intake** request without a verified destination; this is only a Finance work item, not a payout, ledger mutation, reservation or claim of transfer. When Finance verifies all rights/amounts/destination it creates the canonical payout intention and reservation. Separate transfer evidence and statement reconciliation complete the liability once. A bulk multi-Store payout cannot collapse distinct beneficiary/destination scopes into one unsafe transfer.

## CUSTOMER_BALANCE_MANUAL_WITHDRAWAL — Exception-only withdrawal
CAPABILITY_ID: CUSTOMER_BALANCE_MANUAL_WITHDRAWAL

This is **not** a customer self-service payout product. A documented exceptional case begins through authorized Operations intake with reason/evidence, then WLT verifies available balance and holds the approved amount. Authorized Finance executes and documents an external transfer to a verified destination; independent reconciliation links the receipt and statement item before WLT releases the internal liability. Unknown or mismatched results remain held/open for investigation, not silently completed or reattempted as a fresh transfer. Operator policy cannot turn this bounded exception into a general payout button.

## Source conflicts to reconcile before policy adoption

Legacy operational documents may refer to daily physical COD remittance or a relationship-specific commission/subscription split. These are **not silently adopted** here: the effective current WLT implementation/protected legal obligations and latest approved Product decisions must be reconciled for each historical vs new operation. Historical external repayment, reconciliation evidence and any binding contract remain protected. Exact fee percentages, subscription prices and Store-managed collection law are unresolved owner-backed values, not hardcoded defaults.
