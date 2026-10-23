# Customer Balance Funding

ARTIFACT_CLASS: DURABLE_PRODUCT_CAPABILITY_GOVERNANCE
SEMANTIC_OWNER: docs/governance/product/capabilities/finance/customer-balance-funding.md
EXECUTION_AUTHORITY: NONE
IMPLEMENTATION_STATE_AUTHORITY: NONE
CAPABILITY_ID: CUSTOMER_BALANCE_FUNDING

## Outcome

A customer may fund one WLT-owned internal BThwani balance through a proven external rail without treating provider state as internal ledger truth.

## Ownership

WLT owns FundingIntent, internal balance credit, fee effect and reconciliation. Provider adapters own external transport/query mechanics only.

## Invariants

- external wallet/provider rail is not internal balance;
- a funding intent has one stable logical identity and amount/currency;
- provider success is accepted only with evidence sufficient for the active provider contract;
- timeout/unknown remains unresolved until provider query/reconciliation;
- internal balance credit occurs exactly once;
- under the current approved provider agreements BThwani bears Cash-In charges: the Customer is credited 100% of confirmed gross funding; the trusted provider settlement result freezes the actual non-negative fee (not a universal hard-coded 2%); the ledger separately debits the provider's net cash and `PLATFORM_CASH_IN_PROVIDER_FEE_EXPENSE` to conserve the Customer liability without collecting an extra fee from the Customer. A changed provider fee for the same idempotent result is rejected, and no non-success outcome may post a fee;
- secrets/provider credentials never enter client authority.

## Failure and recovery

Duplicate callback, timeout, unknown result, provider reversal, mismatched amount/reference and delayed confirmation reconcile before another credit is possible.
