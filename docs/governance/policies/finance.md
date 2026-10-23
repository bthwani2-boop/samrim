# Financial Integrity Policy

ARTIFACT_CLASS: DURABLE_CROSS_CUTTING_POLICY
SEMANTIC_OWNER: docs/governance/policies/finance.md
EXECUTION_AUTHORITY: NONE
IMPLEMENTATION_STATE_AUTHORITY: NONE

WLT is the sole authoritative owner of internal financial truth for every admitted financial effect. DSH/surfaces may express intent or consume bounded WLT-backed readback; providers are external rails, never the internal ledger.

## Money representation

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

## Financial ownership and conservation

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

## External funding and internal balance

An external official wallet/payment provider is a rail, not BThwani balance truth.

```text
FundingIntent
→ provider evidence
→ reconciliation when needed
→ WLT internal balance credit
```

Checkout consumes WLT internal balance/cash allocation. It does not treat an external provider account as an internal checkout balance.

Provider timeout or missing confirmation is not automatic failure or success. Unknown outcomes remain unknown until reconciled, and another rail is not invoked while duplicate movement remains possible.

External provider Cash-In is currently admitted only for Customers and BThwani Captains. Customer funding and Captain funding are separately governed capabilities even when they share a CashInRail implementation. Partner, Field and Store-affiliated Partner Captain funding are not enabled by this admission. The provider rail never chooses the WLT wallet/accounting destination; the server-owned funding purpose does.

## Captain COD coverage and wallet settlement

A BThwani Captain is an independent service provider who retains cash collected from the Customer. BThwani does not accept physical cash from Captains, Partners or Field actors, and does not disburse cash to them. Cash deposited by a Captain at an external exchanger becomes their *external* official-wallet balance, not WLT funding until a separately verified Cash-In completes.

```text
available_cod_coverage
= posted Captain WLT balance
- active COD holds
- active payout holds
- other governed locks

new_cash_reservation <= available_cod_coverage
```

- one initial Captain activation funding threshold may be configured (10,000 YER in the current local policy); it is checked only before the Captain first becomes available, never reset or topped up automatically at midnight;
- previously activated Captains may receive prepaid Orders regardless of their later COD balance, subject to distinct identity/operational and goods-in-custody risk checks;
- a Captain accepting an Order with positive cash collection must atomically reserve 100% of the actual cash portion in WLT; multiple Orders cannot spend the same available cover;
- when that Captain successfully collects and delivers the Order, WLT posts the relevant delivery entitlement and atomically debits the reserved cash amount from the Captain Wallet against the posted cash receivable once, in terminal state DEBITED; the Captain keeps the collected physical cash;
- cancellation before collection releases the hold without a wallet debit; mixed Orders cover only the cash portion, not the Customer's prepaid internal-wallet portion;
- a completed WLT debit must never be followed by a second request to remit the same cash to BThwani; physical Captain cash-remittance routes are obsolete for new Orders;
- historical FINALIZED or REMITTED reservations are not automatically DEBITED; they require evidence-bound reconciliation and must never be charged again if already settled through a previous rail;
- personal Cash-In funding is not delivery earnings and is not eligible for earnings withdrawal; eligible earnings remain capped by real posted unheld balance;
- Store-affiliated Partner Captains and Store-collected cash are owned by the Store relationship, not BThwani Captain custody.

The COD prepayment cover limits exposure to cash retained after successful collection; it does not independently guarantee merchandise already in a Captain's physical custody. Goods-loss risk requires separate bounded controls and evidence.

## Fees, discounts and commissions

Commercial fee bearer is versioned policy rather than an architectural constant. Where an external funding provider charges a fee, the policy may designate platform, customer or campaign funding as bearer.

Field acquisition reward is a one-time earning for a Field-attributed Partner joining case. Its qualifying event remains canonical `STORE_CLIENT_VISIBLE`; DSH proves that event and WLT records the resulting earning exactly once under an explicit versioned policy for the commercial Store Type of the first qualifying Store. A joining case can produce at most one Field acquisition reward regardless of additional Stores, repeated publication or visibility changes. The reward is financially distinct from per-Order Partner commission: Store Type may parameterize this Field reward only, while per-Order Partner commission is governed by the active Store-specific STORE_COMMERCIAL_AGREEMENT and never by a shared Store Type rate. Missing policy never falls back to another type or a default. Later policy changes must not reinterpret or duplicate historical earnings.

## Refunds, payouts and settlement

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

For the current approved target, Partner/Captain/Field surfaces are read-only for official-wallet destination master data. Their admission/onboarding intake may capture a provider preference only; that preference does not activate a destination or grant destination-writing authority. Finance creates or changes a destination through the authorized verification/approval workflow; beneficiaries cannot create, update, deactivate, replace or select a payout destination. A destination change cannot rewrite an already approved payout snapshot.

## Store payout-recipient routing

WLT owns the canonical effective relationship from each Store to its payout-beneficiary Human Actor. The Partner owner is the default beneficiary. The owner may assign one verified, eligible owner or staff actor per Store; multiple Stores may name the same actor. A bulk selection is only a command that creates or changes each Store assignment independently, with its own scope, version, effective time and audit.

Recipient assignment selects the responsible Human Actor relationship. It does not select or edit an official wallet destination. The owner cannot enter a wallet number, beneficiary name or arbitrary external account. WLT resolves the official destination from the selected actor's current verified Identity and Finance-approved provider under this policy. Only the Partner owner may change or explicitly reconfirm a Store recipient; finance_read, payout_request and other Store-management authority do not grant recipient-routing authority.

Partner owners may read financial totals aggregated across their owned Stores. A delegated accountant may read or report only for Stores in the accountant's active authorized scope. WLT preserves each Store's economic attribution in every aggregate. Financial data access, payout-intent creation, recipient routing, Finance approval, transfer execution and reconciliation are separate authorities. A payout request is limited to its authorized Store scope and cannot change the recipient. If selected Stores have different effective recipients or verified destinations, WLT partitions them into separate payout groups and transfers; one external transfer never pays multiple beneficiaries or destinations.

Customer balance withdrawal is not a customer-facing or self-service payout capability. A rare exception begins with an Operations-recorded request and authorization/evidence; WLT resolves the eligible internal balance and reserves the approved amount. Authorized Finance staff approve and perform the manual external transfer, attach transfer-specific receipt evidence, and bind the transfer to the period/batch statement evidence. A different authorized operator independently reconciles the transfer and statement row. WLT reduces the customer liability only after required reconciliation; unknown, mismatched or unsupported outcomes remain held/open as an explicit exception. This process is distinct from Customer funding, Partner/Captain/Field earnings settlement and Captain COD remittance.

## Beneficiary settlement intake before external transfer

A Partner, BThwani Captain, or Field actor with WLT-attributed positive eligible funds may submit an auditable, idempotent **settlement intake** to the Finance queue without an already verified official-wallet destination. An intake only records the server-resolved requested amount and, for Partners, the exact authorized Store allocation. It is **not** a payout, does not create a hold or ledger entry, and does not mean money has been sent. Only one open intake per beneficiary may exist; replay keeps the same business identity.

Finance independently verifies the current beneficiary identity, official destination, authority, eligible amounts, and partner Store recipient routing before using the existing WLT payout creation path. That path alone holds available funds and requires a verified active destination; manual transfer, receipt verification, statement reconciliation, and terminal ledger settlement retain their established independent-operator controls. The intake is linked to the resulting payout only after canonical readback. Missing credentials, destination, funding, eligibility, or reconciliation leave the intake pending with an actionable reason rather than fabricating a transfer.

## Cross-owner reliability

If an operational owner event creates a financial effect:

```text
DSH proves canonical operational transition
→ durable idempotent handoff
→ WLT applies financial effect
→ WLT canonical readback
→ reconciliation of unknown/partial outcomes
```

Synchronous calls are not treated as a distributed transaction. A retry must preserve the same logical operation identity and cannot allocate a new financial identity merely because a commit result was ambiguous.

## Finance access

Every Finance workspace read and mutation requires the current Identity `finance` permission on the Operator session. The `operator` role alone is insufficient. Missing, stale or invalid permission evidence fails closed. The Store Commercial Agreement editor and any retained Store Type suggestion controls follow this boundary; each financial mutation remains attributed to its acting Operator and audited by its canonical owner. Customer withdrawal request intake belongs to the Operations owner and requires its own authorization; intake permission does not grant Finance approval, execution, reconciliation or ledger authority.
