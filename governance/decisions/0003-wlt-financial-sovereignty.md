# ADR 0003 — WLT financial sovereignty

ARTIFACT_CLASS: DURABLE_DECISION_RATIONALE
STATUS: ACTIVE
EXECUTION_AUTHORITY: NONE

## Context
Wallet/payment/refund/commission/payout/settlement truth is high-risk and can diverge when operational services or clients maintain mutable financial mirrors.

## Decision
WLT is the sole authoritative owner/writer of internal financial truth. DSH supplies/consumes bounded operational evidence/projections but never becomes a ledger/payment writer.

## Alternatives
Keep finance inside DSH; allow multiple service-local wallet/payment writers.

## Consequences
Financial invariants, reconciliation, idempotency and provider provenance have one owner; projections must be explicitly non-authoritative.

## Supersession
A later ADR may supersede this decision only by explicitly accounting for migration, ownership and affected Product/System truth.
