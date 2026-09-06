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

## Executable database restore drill

When a catastrophic database corruption or unrecoverable schema state occurs, execute the following validated drill:

1. **Isolation**: Stop inbound ingress traffic at the load balancer / reverse proxy layer (`503 Service Unavailable`).
2. **Cluster Stop**: Terminate all application backend service instances (Identity, DSH) to prevent concurrent mutating connections.
3. **Point-in-Time Recovery (PITR)**:
   - Identify the exact recovery target timestamp $T_{recover}$ immediately preceding the incident.
   - Restore PostgreSQL base backup into a pristine volume.
   - Replay WAL archives up to $T_{recover}$ (`recovery_target_time = '...'`).
4. **Schema & Data Conformance Drill**:
   - Start PostgreSQL in read-only maintenance mode.
   - Run migration schema verifier to assert checksum integrity against the release candidate binary.
   - Run canonical readback queries across human actors, active role bindings, and verified identifiers.
5. **Token Fence Invalidation**:
   - Invalidate all bearer and refresh tokens issued after $T_{recover}$ by bumping the service security epoch.
6. **Traffic Resumption**:
   - Start Identity and DSH services.
   - Verify health and readiness endpoints report `status: "ok"`.
   - Restore reverse proxy ingress and monitor error logs for 15 minutes.

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
