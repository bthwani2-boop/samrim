# WLT Payment Projection Reconciliation Runbook

DOCUMENT_CLASS: OPERATIONAL_RUNBOOK
PRODUCT_AUTHORITY: NONE
CURRENT_IMPLEMENTATION_AUTHORITY: NONE

Status: OPERATIONAL_RUNBOOK
Owner: DSH order projection recovery + WLT financial truth
Durable semantic owners: `governance/product/CAPABILITIES.md` for order/capability behavior and `governance/product/FINANCIAL-MODEL.md` for WLT financial truth.

Current DSH/WLT contracts, worker implementation, schema and service-auth configuration override stale identifiers in this runbook.

## Scope

DSH may read an opaque WLT payment-session/reference and store only the bounded read-only projection allowed by the current order contract. Reconciliation code must never debit, credit, refund, settle, capture, cancel or otherwise mutate WLT financial truth unless the current WLT-owned contract explicitly routes such an operation to WLT.

## Runtime principles

- The reconciliation worker/queue identity is implementation truth; verify current source before operating it.
- Retry/lease/batch limits come from current configuration/schema.
- Unsupported WLT status fails closed; do not coerce it to a known DSH projection.
- Exhausted retries become an observable operator condition according to the current queue policy.
- WLT service authentication remains server-side.

## Projection behavior

Use the current contract mapping from WLT payment state to DSH projection. Never infer payment success from a UI, HTTP transport success alone, or DSH-local computation.

A newer verified WLT fact may advance/change the DSH projection according to current version/timestamp rules. Older/stale facts must not overwrite newer verified state. An unchanged fact may refresh reconciliation metadata without creating duplicate event noise.

When the projection changes, preserve the current DSH requirements for order versioning, event stream/outbox and audit/readback.

## Stale/paused projection recovery

1. Pin exact DSH/WLT candidate/runtime state and order/payment/correlation identifiers.
2. Verify DSH↔WLT endpoint/service-auth configuration and WLT readiness.
3. Inspect the current reconciliation row, retry state, lease ownership and last error.
4. Verify lease expiry/worker ownership before any operator recovery.
5. Correct the root cause first: authentication, connectivity, schema, contract or unsupported status.
6. Requeue/retry only through the current governed queue mechanism, preserving the same canonical reconciliation identity.
7. Verify one order projection update and at most the event/outbox effects required by the current version transition.

Do not edit the projected payment status directly.

## Rollback

- Stop/contain the reconciliation worker before incompatible queue/schema changes.
- Preserve reconciliation rows, source timestamps, correlation IDs and audit/outbox evidence until every in-flight item is accounted for.
- The last verified DSH projection may be shown as stale/partial when the contract permits it; WLT remains authoritative.
- Never recover by executing a financial mutation from DSH.

## Evidence boundary

A reconciled DSH projection is operational evidence only. Financial correctness still requires the applicable WLT/finance evidence, and final closure requires every current same-commit evidence scope and protected approval defined by governance.
