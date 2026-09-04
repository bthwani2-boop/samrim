# Governed Dispatch Operations Runbook

DOCUMENT_CLASS: OPERATIONAL_RUNBOOK
PRODUCT_AUTHORITY: NONE
CURRENT_IMPLEMENTATION_AUTHORITY: NONE

Status: OPERATIONAL_RUNBOOK
Owner: DSH dispatch operations

Current authority sources: `governance/product/PRD.md`, `governance/policies/engineering.md`, applicable capability governance in `governance/product/CAPABILITIES.md`, and current DSH contracts/implementation. This runbook is operational guidance only.

## Scope

Covers captain offer creation/response, timeout, cancellation, reassignment, capacity/service-area eligibility, operator monitoring and client tracking readback. DSH remains the operational-truth owner for dispatch under the current product/domain ownership model unless a higher current authority explicitly changes that ownership.

## Primary signals

Monitor current equivalents of:

- overdue offers still active;
- repeated captain eligibility/capacity rejection;
- order/assignment state divergence;
- more than one active assignment for an order;
- accepted assignment with inconsistent delivery state;
- cancellation/reassignment attempted after a forbidden transition;
- missing dispatch decision/audit records;
- captain/operator read failures by trusted scope;
- unusual rejection/override growth.

## Operator recovery

1. Pin the exact candidate/runtime context and read current assignment + decision history.
2. Expire overdue offers through the governed domain action.
3. For a legal pre-pickup recovery, cancel/reassign only through current state-machine transitions and an eligible captain in the permitted scope.
4. Record the required operational reason and preserve the original idempotency identity for a retry of the same intent.
5. Verify read-after-write: prior assignment terminality and the active-assignment invariant.
6. Verify captain/operator/client projections converge where the current journey requires them.

## Safe database diagnostics

Use read-only queries adapted to the current schema to detect overdue offers, multiple active assignments, capacity projection and dispatch decision history. Do not convert a diagnostic query into direct state mutation.

## Forbidden recovery

- no direct assignment-status update outside the domain transition;
- no deletion to hide a conflict;
- no arbitrary capacity/scope/service-area change to force eligibility;
- no WLT ledger, COD liability, commission, settlement or payout mutation from dispatch recovery;
- no new retry identity until the original outcome/readback is understood.

## Rollback

Prefer application/control gating while preserving database/audit evidence. Additive governance/audit columns are not dropped during incident response merely to restore old code. Restore the last verified application candidate, run read-only diagnostics, then reconcile active assignments through governed actions.

## Escalation

- Security: cross-scope/object-authorization evidence.
- Workforce: workforce/accreditation/vehicle/employment projection ownership.
- Platform/operations: service-area/platform context issues.
- WLT: financial truth/projection issues only.

Assignment truth remains DSH-owned unless a newer registered authority explicitly changes the boundary.
