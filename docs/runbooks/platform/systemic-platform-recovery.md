# Systemic Platform Recovery

DOCUMENT_CLASS: OPERATIONAL_RUNBOOK

EXECUTION_AUTHORITY: NONE
PRODUCT_SEMANTIC_AUTHORITY: NONE
CURRENT_IMPLEMENTATION_AUTHORITY: NONE
## Scope

Routes cross-cutting incidents involving database/migrations, contract/version skew, service startup/readiness, credentials/security, or partial cross-service cutover. Domain-specific state rules remain owned by Governance and executable source.

## Triage

1. Pin the exact deployed/working candidate and environment.
2. Determine affected owners, writers, readers, contracts, migrations and runtime processes.
3. Stop unsafe writes only when continuing can widen corruption/security/financial exposure.
4. Preserve evidence without copying secrets/PII unnecessarily.
5. Classify the failure as schema/migration, contract skew, config/runtime, secret/authorization, dependency/provider, or mixed.

## Database and migration failure

Do not edit production truth directly as the normal recovery path. Determine applied migration state, writer compatibility and durable-data risk. Prefer forward-safe correction/roll-forward; rollback is allowed only when the migration and data semantics explicitly support it.

A successful process restart does not prove migration/data correctness. Verify canonical readback and affected invariants.

## Contract/version skew

Identify producer, consumer and exact contract/generated lineage. Unknown or incompatible operations fail closed where mutation safety requires it. Do not keep two mutable protocol authorities merely to bridge skew; use only bounded compatibility with an explicit deletion trigger when unavoidable.

## Credential/security incident

Contain exposed credential use, rotate/revoke through the approved secret authority, inspect audit/provider effects, and invalidate affected sessions/tokens only according to owner semantics. Never paste secret values into tickets or logs.

## Cross-service partial cutover

Identify old/new writers and consumers. Prevent dual writes, finish or safely reverse the cutover, reconcile durable effects, delete/disable obsolete target paths when no longer required, then verify negative space.

## Closure

Verify exact-candidate health/readiness, durable readback, contract compatibility, security/financial invariants and absence of stale writers/config/routes before returning the affected capability to normal operation.
