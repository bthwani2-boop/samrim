# External References — Finance, Payments and Ledger

DOCUMENT_CLASS: NON_AUTHORITATIVE_EXTERNAL_REFERENCE
EXECUTION_AUTHORITY: NONE
PRODUCT_AUTHORITY: NONE
CURRENT_REPOSITORY_STATE_AUTHORITY: NONE
ADOPTION_AUTHORITY: NONE
REFERENCE_FRESHNESS: REVALIDATE_MATERIAL_FACTS_AT_USE
REFERENCE_REVIEWED_ON: 2026-09-05
REFERENCE_MAX_REVIEW_AGE_DAYS: 180
LICENSE_RECHECK_ON_ADOPTION: REQUIRED
SECURITY_SUPPLY_CHAIN_RECHECK_ON_ADOPTION: REQUIRED


### 1B.5 Payments / external financial rails / payment orchestration

**P1 — Stripe**
- Docs: https://docs.stripe.com/
- Use for: payment lifecycle, idempotency, webhooks, retries, refunds, disputes, asynchronous outcomes, provenance and API design.

**P2 — Adyen**
- Docs: https://docs.adyen.com/
- Use for: enterprise authorization/capture/refund, idempotency, webhooks, unknown/transient outcomes and reconciliation-oriented provider operations.

**P3 — Hyperswitch**
- Repository: https://github.com/juspay/hyperswitch
- Docs: https://docs.hyperswitch.io/
- Use for: inspectable payment orchestration, connectors, retries, routing and provider abstraction.

**P4 — PayPal / Braintree**
- PayPal: https://developer.paypal.com/docs/
- Braintree: https://developer.paypal.com/braintree/docs/
- Use as another mainstream provider lifecycle and webhook/refund counterexample.

**P5 — Airwallex**
- Docs: https://www.airwallex.com/docs
- Use only if payout/cross-border/provider-operation semantics remain unresolved.

High-risk rule: material payment mutations require P1 + P2 cross-check even if P1 appears sufficient.

### 1B.6 Wallet / ledger / accounting / reconciliation

**P1 — Modern Treasury Ledgers**
- Docs: https://docs.moderntreasury.com/ledgers/docs/overview
- Use for: immutable/double-entry ledger concepts, atomicity, transaction statuses, balances, linking money movement to ledger and reconciliation.

**P2 — TigerBeetle**
- Repository: https://github.com/tigerbeetle/tigerbeetle
- Docs: https://docs.tigerbeetle.com/
- Use for: transfer invariants, idempotency, pending/post/void semantics, timeouts, concurrency and balance correctness.

**P3 — Formance Ledger**
- Repository: https://github.com/formancehq/ledger
- Docs: https://docs.formance.com/
- Use for: inspectable ledger/posting/account modeling.

**P4 — Blnk**
- Repository: https://github.com/blnkfinance/blnk
- Docs: https://docs.blnkfinance.com/
- Use for: transaction lineage, inflight transactions, refund/reconciliation and recovery concepts.

**P5 — Apache Fineract**
- Repository: https://github.com/apache/fineract
- Docs: https://fineract.apache.org/
- Use for broad mature financial-account lifecycle comparisons.

**P6 — Cala**
- Repository: https://github.com/GaloyMoney/cala
- Use as a deep specialist ledger counterexample after fresh maintenance verification.

High-risk rule: ledger closure normally uses P1 + P2; use P3 only when implementation detail or another invariant remains missing.

### 1B.18 Fraud / payment risk

**P1 — Stripe Radar**
- Docs: https://docs.stripe.com/radar
- Use for payment fraud/risk signals, rules and review outcomes.

**P2 — Adyen risk management**
- Docs: https://docs.adyen.com/risk-management/
- Use for enterprise payment-risk rules and result handling.

**P3 — Sift**
- Docs: https://developers.sift.com/
- Use for abuse/fraud event modeling and decision workflows.

**P4 — Fingerprint**
- Docs: https://dev.fingerprint.com/
- Use for device-intelligence concepts only when required.

Fraud providers produce signals/decisions; BThwani owns canonical business action/audit semantics.

## 8. WLT / financial corpus

Financial references are primarily **invariant oracles**, not automatic runtime replacements.

### Formance Ledger
Repository: https://github.com/formancehq/ledger
Primary mode: `SELECTIVE_LOGIC_REFERENCE`

Use to challenge:

```text
ledger account modeling
multi-posting transactions
atomic posting
financial transaction semantics
query/readback
idempotency
```

### Blnk
Repository: https://github.com/blnkfinance/blnk
Primary mode: `SELECTIVE_LOGIC_REFERENCE`

Use to challenge:

```text
transaction lineage
inflight transactions
refunds
bulk operations
queue/recovery behavior
reconciliation
```

### TigerBeetle
Repository: https://github.com/tigerbeetle/tigerbeetle
Primary mode: `REFERENCE_ONLY / INVARIANT_ORACLE`

Use to challenge:

```text
idempotent transfer identity
pending/post/void semantics
timeouts
replay behavior
balance correctness
concurrency
financial history
```

Do not replace PostgreSQL/WLT merely because TigerBeetle has stronger financial primitives.

### Cala
Repository: https://github.com/GaloyMoney/cala
Primary mode: `REFERENCE_ONLY`

Use for double-entry/ledger modeling comparisons if the repository remains applicable after fresh verification.

### Apache Fineract
Repository: https://github.com/apache/fineract
Primary mode: `REFERENCE_ONLY`

Use for mature financial/loan/account lifecycle concepts only. It is too broad to become the BThwani core by default.

### ERPNext
Repository: https://github.com/frappe/erpnext
Primary mode: `REFERENCE_ONLY`

Use for accounting/operations edge-case research only where relevant. It must not become a general replacement platform.

---

## 15. Required financial comparison checklist

Whenever WLT/payment/checkout-finance is touched, compare against mature financial references for:

```text
CANONICAL_FINANCIAL_OWNER
CANONICAL_LEDGER_WRITER
BALANCED_POSTING_WHERE_APPLICABLE
EXACT_IDEMPOTENCY
REPLAY_BEHAVIOR
TRANSACTION_ATOMICITY
CONCURRENCY/LOCKING
PENDING_STATE
UNKNOWN_PROVIDER_RESULT
REFUND
REVERSAL
SETTLEMENT
PAYOUT
RECONCILIATION
PROVIDER_PROVENANCE
AUDIT
CANONICAL_READBACK
ZERO_PARALLEL_WRITERS
```

External references may reveal missing rules, but BThwani’s WLT remains the owner.

---
