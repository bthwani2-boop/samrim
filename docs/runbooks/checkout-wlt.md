# Checkout and WLT Operations Runbook

DOCUMENT_CLASS: OPERATIONAL_RUNBOOK
PRODUCT_AUTHORITY: NONE
CURRENT_IMPLEMENTATION_AUTHORITY: NONE

Status: OPERATIONAL_RUNBOOK
Owner services: DSH + WLT boundary
Financial authority: WLT only

This runbook is operational guidance. Current canonical governance, contracts, migrations and runtime source override stale details.

## Purpose

Operate and recover the checkout-to-WLT payment-session handoff without creating duplicate payment sessions, duplicating discounts, editing financial truth in DSH, or losing trusted scope isolation.

## Normal path

1. The authenticated client creates a checkout intent with the current required idempotency identity.
2. DSH validates cart ownership, item snapshots, store, fulfillment mode, address ownership, serviceability, delivery pricing and applicable commercial eligibility.
3. DSH persists the checkout intent and permitted commercial snapshot.
4. DSH requests/reuses a WLT payment-session reference using the stable checkout-owned idempotency contract.
5. DSH stores only the WLT reference and permitted read-only financial projection.
6. WLT-owned authenticated events update the DSH projection idempotently through the current contract and transaction/outbox discipline.
7. Client/operator surfaces read the canonical DSH checkout projection rather than financial truth directly.

## Unknown WLT outcome

- Do not create a second manual WLT session.
- Reconcile using the same stable checkout-owned identity.
- Keep an ambiguous result recoverable; do not fabricate success or failure.
- On definitive failure, release only DSH-owned operational reservations allowed by the current state machine.
- On confirmed WLT read/create success, bind the existing WLT reference and verify persisted readback.

Use current owner/service diagnostics to list unresolved checkout intents by canonical state, age and correlation identity. Do not encode table/column names in the runbook; inspect the current executable schema or repository-owned diagnostic command.

## WLT event receipt incidents

For a receipt that appears unapplied, inspect the current receipt/projection transaction and event identity before redelivery. A duplicate event with identical identity/payload must be idempotent. Reuse of the same event identity for contradictory scope/session/status data is an integration incident, not a retry-success path.

Never delete receipt/audit evidence or insert a second event to make a queue look healthy.

## Operational signals

Monitor the current equivalents of:

- count/oldest age of unknown WLT outcomes;
- unapplied or retrying WLT event receipts;
- event replay conflicts;
- payment-session/trusted-scope mismatches;
- WLT handoff/reconciliation failures;
- checkout and WLT-handoff latency;
- divergence between active DSH projections and WLT references.

Thresholds are operational configuration, not domain truth; verify the current production profile before treating a number in a runbook as an alert contract.

## Security and privacy

- Enforce actor, surface, permission, business-scope and object authorization from trusted server-side context.
- WLT event delivery requires the current service-authentication contract.
- Never expose coupon secrets, wallet/provider credentials, payment instruments, tokens or ledger payloads in DSH logs or UI.
- Address snapshots follow current privacy/retention policy.
- Never synthesize a fallback trusted context.

## Runtime verification

Use the current registered runtime/guard commands from `package.json` and current runtime scripts. For DSH/WLT claims, require same-commit startup/health/readiness, targeted checkout/WLT smoke, persistence/readback and relevant database invariants. Do not treat a command shown here as current until its path/arguments are verified.

## Rollback and recovery

1. Stop or gate the defective mutation path where possible while preserving reads/evidence.
2. Preserve checkout, event-receipt, outbox, audit and WLT reference evidence.
3. Revert application code through normal history; never force-push.
4. Do not drop compatibility/evidence structures during incident response unless a reviewed forward migration owns that change.
5. Keep WLT as financial authority and reconcile affected checkout/payment references there.
6. Verify commercial reservation state against current checkout/order truth before restoring mutations.
7. Re-run applicable same-commit checks on the recovery candidate.

## Closure boundary

This runbook cannot close a journey. Final closure requires all applicable evidence scopes and protected approvals defined by current governance (`governance/policies/delivery.md` §18) on the same immutable candidate.
