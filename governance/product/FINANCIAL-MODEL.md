# BThwani Financial Model

ARTIFACT_CLASS: DURABLE_FINANCIAL_PRODUCT_GOVERNANCE
SEMANTIC_OWNER: governance/product/FINANCIAL-MODEL.md
EXECUTION_AUTHORITY: NONE
CLOSURE_AUTHORITY: NONE
IMPLEMENTATION_STATE_AUTHORITY: NONE

## Scope and owner

WLT is the sole authoritative owner of internal financial truth. DSH and deployable surfaces may express intent or consume bounded WLT-backed readback, but they never become writers of wallet, ledger, payment, refund, commission, payout, settlement or reconciliation truth.

```text
WLT = FINANCIAL SOURCE OF TRUTH
DSH = OPERATIONAL OWNER / APPLICATION FACADE WHERE REQUIRED
FRONTEND = INTENT + READBACK
PROVIDER = EXTERNAL RAIL, NOT INTERNAL LEDGER
```

## One wallet / one ledger

Each actor has one canonical internal WLT wallet. Available, held, pending, earned, settled, reserved and withdrawal-eligible amounts are states/projections over that truth, not parallel wallets. Every value-changing internal movement is represented through the canonical balanced ledger. Direct balance edits, spreadsheet totals, screenshots, client arithmetic and operator-entered authoritative amounts are forbidden.

## Server-derived values

Authoritative amounts derive from trusted operational events, canonical state and versioned WLT policy. Commission, fee, earning, hold, payable, refund, settlement and withdrawal eligibility are calculated server-side. The applicable policy version is retained where reproduction/audit requires it.

## Order payment allocation

When an order combines internal wallet, external official-wallet payment, COD, subsidy, discount or delivery charge, WLT owns one conserved server-derived allocation. No payment-method label is sufficient accounting truth and the same fee, earning, subsidy or order value must never be counted twice.

## Captain COD exposure

Captain COD authorization is order-specific, atomic and idempotent:

```text
ELIGIBLE_ORDER
→ RESERVE_REQUIRED_COD_EXPOSURE
→ ALLOW_ASSIGNMENT
→ RELEASE_EXACTLY_ONCE_WHEN_REQUIRED
  OR FINALIZE/DEBIT_EXACTLY_ONCE_WHEN_REQUIRED
```

Future earnings do not fabricate pre-existing COD capacity. A second custody/remittance model may not account for the same order value unless an explicitly approved Product model replaces the current one.

## Cash-In and external financial rails

External official-wallet/provider rails may move external money but do not own internal BThwani balances. Internal credit requires authoritative provider evidence normalized by WLT and a legal WLT posting. Client success screens, screenshots, callbacks or unverified payloads never create credit.

```text
TIMEOUT != FAILURE
MISSING_CONFIRMATION != SUCCESS
UNKNOWN MUST REMAIN UNKNOWN UNTIL RECONCILED
```

Do not invoke another provider/route for the same ambiguous money movement until duplicate movement is proven impossible.

## Payout destinations and stakeholder Cash-Out

Partner, captain and field use one WLT-owned payout engine with stakeholder-specific eligibility expressed as policy. Destination master data is WLT-owned, versioned, encrypted/masked where appropriate and read-only on beneficiary surfaces.

The current governed manual external settlement lifecycle is:

```text
ELIGIBILITY
→ HOLD
→ REQUEST/PREPARE
→ INDEPENDENT APPROVAL WHEN REQUIRED
→ IMMUTABLE PAYOUT/BATCH SNAPSHOT
→ EXTERNAL EXECUTION
→ EVIDENCE
→ INDEPENDENT VERIFICATION WHEN REQUIRED
→ RECONCILIATION
→ COMPLETION
```

A bare `mark paid` transition is forbidden. Approved payout/frozen settlement facts are immutable. Automated external payout is a separate approved capability, not an implication of a provider adapter.

## Settlements, commissions and adjustments

DSH supplies trusted operational identities/evidence; WLT verifies that evidence and its own refund/payment truth before calculating settlement/commission effects. Cancelled/unverified sources are not payable; deterministic idempotency prevents duplicate effects; adjustments are typed, reasoned, attributable and balanced.

## Representative financial reads

Client, partner, captain and field read only authorized WLT-backed wallet/ledger state. Operator financial lookup is permission-scoped and trusted-context isolated.

```text
READ_PERMISSION != MONEY_MOVEMENT_PERMISSION
SETTLEMENT_SUMMARY != WALLET_BALANCE
DSH_REFERENCE/PROJECTION != SECOND_LEDGER
```

## Reconciliation and close

External evidence, WLT ledger truth, approved payout/batch facts and operational sources must agree at the required boundary. Mismatch creates an explicit reconciliation exception. Blocking exceptions, missing evidence, control-total mismatch or unresolved material exposure block affected completion/close.

## Security, audit and simulation

Every financial mutation is authenticated, server-authorized, correlated, idempotent, auditable and concurrency-safe. Separation of duties is enforced server-side where required. Mocks/sandboxes may emulate external outcomes but cannot bypass WLT state machines, accounting, authorization, idempotency or reconciliation.
