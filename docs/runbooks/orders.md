# Order Truth Operations Runbook

DOCUMENT_CLASS: OPERATIONAL_RUNBOOK
PRODUCT_AUTHORITY: NONE
CURRENT_IMPLEMENTATION_AUTHORITY: NONE

Status: OPERATIONAL_RUNBOOK
Owner: DSH order operations

Current authority sources: `governance/product/PRD.md`, `governance/policies/engineering.md`, applicable capability governance in `governance/product/CAPABILITIES.md`, and current DSH contracts/state-machine/migrations. This runbook is operational guidance only.

## Operational objectives

Availability, latency, duplicate-order, outbox-age and projection-staleness thresholds are environment/SLO configuration, not domain truth. Verify current observability configuration before treating a number as an alert contract.

## Diagnostic scope

Use the current authorized order-truth/operations diagnostics and preserve trusted-scope isolation. Diagnostics must exclude secrets, personal data not needed for triage, raw idempotency keys and provider payloads.

## High-severity conditions

Investigate current equivalents of:

- stuck order-creation/idempotency attempts;
- duplicate orders for one canonical checkout/idempotency scope;
- order event/outbox retry or dead-letter conditions;
- attempted mutation of immutable order snapshots;
- stale/missing WLT payment projection;
- order version/event sequence divergence.

## Triage sequence

1. Pin exact DSH candidate/runtime commit, trusted context, order ID/number and correlation ID.
2. Read current diagnostics and classify creation/idempotency, outbox, snapshot and payment-projection state.
3. Inspect current order/idempotency/event/outbox/audit records by scope/correlation using read-only access.
4. Verify the one-order-per-canonical-checkout/idempotency invariant.
5. Verify event version/order version continuity required by the current state model.
6. For payment projection issues, verify WLT independently; never mutate wallet/refund/settlement truth from DSH.
7. Recover downstream/outbox delivery by fixing the dependency and replaying the same canonical event identity, not inserting a second event.
8. Preserve dead-letter/audit evidence and requeue only after root cause is corrected.

## Safe recovery

- A legitimate client retry reuses the original idempotency identity and should read back the already-created order when the contract supports replay.
- A stuck attempt is repaired only after proving no canonical order already exists for the same scope.
- Immutable commercial/address/item/correlation snapshots must not be edited to simplify support.
- Operational order state changes use allowed server-owned transitions; do not update status directly to satisfy a UI.

## Rollback

1. Gate affected mutation bindings while preserving safe reads.
2. Stop/contain event publishers only when required by the incident and preserve their queue state.
3. Do not drop idempotency, audit or outbox evidence before every in-flight item is reconciled.
4. Roll back application code before removing compatible schema, and use forward migrations for schema correction.
5. Verify one-order-per-checkout/idempotency, event continuity and WLT projection integrity on the recovery candidate.

## Incident evidence

Record exact candidate/migration state, redacted trusted-scope/order/correlation identifiers, diagnostics/audit/outbox references, root cause, impact, corrective action and proof that the recovery did not duplicate operational or financial effects.
