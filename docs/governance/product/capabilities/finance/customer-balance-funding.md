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
- provider fee bearer is versioned policy, not an eternal architectural constant;
- secrets/provider credentials never enter client authority.

## Failure and recovery

Duplicate callback, timeout, unknown result, provider reversal, mismatched amount/reference and delayed confirmation reconcile before another credit is possible.
