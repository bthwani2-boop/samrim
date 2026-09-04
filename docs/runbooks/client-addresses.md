# Client Address Operations Runbook

DOCUMENT_CLASS: OPERATIONAL_RUNBOOK
PRODUCT_AUTHORITY: NONE
CURRENT_IMPLEMENTATION_AUTHORITY: NONE

Status: OPERATIONAL_RUNBOOK
Owner: DSH Operations

Current contracts, migrations and runtime source override stale names in this runbook.

## Scope

Covers authenticated client address-book operations, duplicate protection, default-address invariants, governed service-area binding, soft deletion, privacy retention and checkout address resolution.

## Triage inputs

Record the exact commit, environment, operation ID, HTTP status, error code and correlation ID. Do not copy recipient names, phones, address lines, coordinates or delivery instructions into tickets, logs or chat.

## 5xx investigation

1. Confirm DSH health/readiness and database availability.
2. Group failures by operation/error class without PII labels.
3. Verify the relevant current migrations and constraints are applied.
4. Reproduce with synthetic client/address data only.
5. If a deployment introduced incompatible writers, roll back the application first; do not remove protective constraints while incompatible writers remain.

## Conflict handling

- A stale optimistic-concurrency conflict requires reload and retry from committed state.
- An active logical duplicate requires reuse/edit of the canonical existing row, not bypassing the unique constraint.
- Idempotent create retry must preserve the original request identity.

## Default-address invariant

Use read-only diagnostics to detect multiple active defaults or active address sets without a default. Repair only through an explicitly scoped transaction/owner action with audit evidence; never mass-update unrelated clients.

## Privacy retention

Verify the current privacy policy/job configuration, batching/locking behavior and purge eligibility. Expired soft-deleted PII must be scrubbed according to current policy while retaining only the audit/reference fields the canonical contract permits. Escalate if expired PII remains past its governed retention deadline.

## Service-area rejection

For service-area verification failures, validate current coordinates and canonical service-area membership using the governed geometry/source. Do not accept free-form area labels or bypass geofence validation.

## Checkout mismatch

Checkout should resolve the client-owned persisted address/reference defined by the current contract. Do not accept a client-supplied address snapshot as server truth when the contract requires an owned address record.

## Rollback

1. Pause incompatible writers.
2. Restore the last verified application candidate through normal history.
3. Preserve address rows, soft-delete metadata, events and privacy audit.
4. Keep ownership/default/idempotency constraints unless a reviewed forward migration replaces them safely.
5. Re-run targeted backend, static and PostgreSQL verification before restoring writes.

## Closure boundary

A runbook is operational guidance only. Journey closure requires applicable same-commit product, static, runtime, security/privacy, QA/accessibility, CI/release and other evidence defined by current governance.
