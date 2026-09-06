# Systemic Platform Recovery

DOCUMENT_CLASS: OPERATIONAL_RUNBOOK

EXECUTION_AUTHORITY: NONE
PRODUCT_SEMANTIC_AUTHORITY: NONE
CURRENT_IMPLEMENTATION_AUTHORITY: NONE

## Scope

Routes cross-cutting incidents involving database/migrations, contract/version skew, service startup/readiness, credentials/security, or partial cross-service cutover. Domain-specific state rules remain owned by Governance and executable source.

## Incident command structure

1. **Incident Commander (IC)**: Holds single operational authority for triage, communications, and declaring containment/recovery phases.
2. **Operations Lead**: Owns infrastructure, database clustering, networking, and deployment pipeline health.
3. **Domain Authority**: The owning service team (Identity, DSH) responsible for state validation, invariants, and rollback decisions.

## Triage

1. Pin the exact deployed/working candidate, commit SHA, and runtime environment.
2. Determine affected owners, writers, readers, contracts, migrations and runtime processes.
3. Stop unsafe writes immediately when continuing can widen corruption, security compromise, or data loss.
4. Preserve forensic logs and database state snapshots without recording plaintext secrets/PII.
5. Classify the failure: schema/migration checksum, contract skew, service token/auth, external provider, or storage corruption.

## Database recovery & environment reset posture

1. **Current posture**: There is currently no repository-owned automated Point-in-Time Recovery (PITR), WAL archiving, or production ingress load-balancer isolation mechanism materialized in this codebase; production launch remains blocked until verified production infrastructure, backup automation, and recovery procedures are implemented.
2. **Current environment recovery procedures**:
   - **Local/integration environments**: Execute `powershell -ExecutionPolicy Bypass -File tools/dev/close-integration-runtime.ps1` to terminate running containers and volumes, followed by `tools/dev/open-integration-runtime.ps1` to cleanly re-provision and auto-migrate.
   - **Schema conformance**: Execute `go run ./cmd/schema-verify` in `services/identity/backend` to verify that all committed migrations, columns, constraints, and index checksums match the canonical schema.
   - **Platform owner lockout recovery**: Execute `go run ./cmd/platform-owner-recover` against `IDENTITY_DATABASE_URL` to atomically reset the platform owner credentials, revoke active sessions and challenges, and log an immutable audit event.

## Database and migration failure

Do not edit production truth directly as the normal recovery path. Determine applied migration state, writer compatibility and durable-data risk. Prefer forward-safe correction/roll-forward; rollback is allowed only when the migration and data semantics explicitly support it.

A successful process restart does not prove migration/data correctness. Verify canonical readback and affected invariants.

## Contract and version skew

Identify producer, consumer and exact contract/generated lineage. Unknown or incompatible operations fail closed where mutation safety requires it. Do not keep two mutable protocol authorities merely to bridge skew; use only bounded compatibility with an explicit deletion trigger when unavoidable.

## Credential and security incident

Contain exposed credential use, rotate/revoke through the approved secret authority, inspect audit/provider effects, and invalidate affected sessions/tokens only according to owner semantics. Never paste secret values into tickets or logs.

## Cross-service partial cutover

Identify old/new writers and consumers. Prevent dual writes, finish or safely reverse the cutover, reconcile durable effects, delete/disable obsolete target paths when no longer required, then verify negative space.

## Closure

Verify exact-candidate health/readiness, durable readback, contract compatibility, security invariants and absence of stale writers/config/routes before returning the affected capability to normal operation.
