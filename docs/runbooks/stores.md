# Store Discovery and Governance Operations Runbook

DOCUMENT_CLASS: OPERATIONAL_RUNBOOK
PRODUCT_AUTHORITY: NONE
CURRENT_IMPLEMENTATION_AUTHORITY: NONE

Status: OPERATIONAL_RUNBOOK
Owner: DSH Operations

Current DSH discovery/publication contracts, capability governance and runtime source override stale route/error/workflow names.

## Primary health checks

1. Confirm current DSH health/readiness.
2. Verify public store discovery for the affected city/service scope.
3. Verify authorized operator store discovery and pagination/readback.
4. Read the same store's detail, publication diagnostics and audit through current routes.
5. Trace mutations using the current correlation/audit identity.

## Publication incident diagnosis

Use the current server-owned diagnostics/publication contract and resolve blockers in owner order. Typical classes include store lifecycle/visibility/serviceability, partner readiness, catalog publication, marketing visibility, delivery modes, address/coverage, operating hours, delivery readiness and required media.

Never repair publication by changing a surface-local flag. Apply the governed owner action and verify detail, diagnostics, list and audit readback.

## Actor/scope incidents

- `403`-class result → verify role, surface, permission, assignment/scope and object authorization.
- scoped not-found result → verify the resource belongs to the trusted actor/business scope.
- Do not create an all-scope shortcut for partner/field/captain actors.
- Prefer explicit permissions over historical role fallbacks where current contracts support them.

## Mutation failure handling

- Optimistic-concurrency conflict → reload current store/version and start a new mutation attempt.
- Timeout/unknown result → preserve the original idempotency identity until authoritative readback is known.
- Idempotency conflict → inspect original request/correlation; do not reuse the identity for a different request.
- Field/readiness rejection → resolve the owner evidence/gate rather than bypassing it.
- Captain/delivery readiness failure → preserve the reason and do not start an operational transition before prerequisites are satisfied.

## Emergency hide and reactivation

1. Use the current governed owner action to remove client visibility or block readiness.
2. Supply required reason/audit context.
3. Verify public discovery no longer exposes the store.
4. Resolve all blockers at their canonical owners.
5. Reactivate with current optimistic-concurrency state.
6. Verify public, partner/operator and affected operational readbacks plus audit.

## Retention and cleanup

Idempotency/temporary operational rows are cleaned only under current retention policy after their expiry and after confirming no incident/replay investigation requires them. Audit, verification and readiness evidence are not deleted merely to simplify recovery.

## Rollback

- Gate/hide affected stores first when customer impact is possible.
- Revert application code through normal history.
- Preserve audit/verification/readiness history.
- Database structures are removed only by a reviewed migration after consumer/data impact is proven.
- Re-run current registered affected verification on the recovery candidate.

## Decision boundary

This runbook cannot issue a custom closure label. Use only the delivery-policy decision vocabulary (`governance/policies/delivery.md` §18). A runbook or support procedure alone cannot produce `CLOSED_WITH_EVIDENCE`.
