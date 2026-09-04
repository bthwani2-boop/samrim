# Settlements and Payouts Runbook

DOCUMENT_CLASS: OPERATIONAL_RUNBOOK
PRODUCT_AUTHORITY: NONE
CURRENT_IMPLEMENTATION_AUTHORITY: NONE

## Owners

WLT owns settlement, commission, payout, wallet/ledger and reconciliation truth. DSH supplies trusted operational evidence only.

## Diagnose

For a blocked/mismatched payout or settlement:

1. identify actor/business scope;
2. inspect WLT eligibility/hold/request/snapshot/batch state;
3. inspect source operational evidence through its owner;
4. inspect external execution evidence/provider reference;
5. inspect reconciliation exception;
6. confirm no parallel manual balance adjustment exists.

## Safety

A spreadsheet/export is evidence only. Never mark paid from a screenshot/export alone. Never directly edit balance or frozen payout snapshot.

## Recovery

Use governed approval, retry/reconciliation, reversal or superseding operation permitted by WLT. Unknown external results remain unknown until reconciled.

## Verify

Prove balanced ledger effects, immutable approved snapshot, external evidence, reconciliation and stakeholder/operator readback.
