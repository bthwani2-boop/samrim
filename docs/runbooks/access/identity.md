# Identity Operations Runbook

DOCUMENT_CLASS: OPERATIONAL_RUNBOOK

EXECUTION_AUTHORITY: NONE
PRODUCT_SEMANTIC_AUTHORITY: NONE
CURRENT_IMPLEMENTATION_AUTHORITY: NONE

## Owners

Identity owns Human Actor identity/`actor_id`, verified login identifiers, credentials, Identity-wide security eligibility, high-level role admission, authentication/verification/activation/recovery and role-scoped sessions.

DSH owns partner/captain/field operational eligibility, assignment, membership and business authorization scope. Platform Control owns operator-role provisioning and Identity-wide security actions only where Governance assigns them.

This runbook never creates Product/authorization semantics. Current executable contracts/code/config/runtime remain implementation authority.

## Triage

1. Pin the exact candidate/correlation identity relevant to the incident.
2. Verify Identity health/readiness through the current executable interface (`/identity/health`, `/identity/readiness`).
3. Classify the incident: customer registration/authentication/recovery; managed-role provisioning/activation/re-enrollment; operator MFA; session refresh/revocation; service authentication; challenge delivery; abuse/rate control.
4. Resolve the authenticated Human Actor and single active session role server-side.
5. Verify the canonical role/credential/challenge/session readback and the owning-domain eligibility/scope where business authorization is involved.
6. Reproduce with sanitized identifiers and masked contact data.

## Safety invariants

- A challenge proves the configured verification purpose; it never self-grants partner/captain/field/operator business admission.
- Managed activation is one-time enrollment, not recurring login.
- Disabling one actor-role revokes only that role's sessions/pending role proofs; unrelated roles remain independent.
- Identity-wide security disablement revokes active authentication state without deleting role bindings; re-enable does not resurrect sessions.
- Operator session creation requires the governed privileged authentication factors; password-only success is not sufficient where MFA is required.
- Caller-provided headers/body/query/UI state never grant actor identity, role, business scope or service identity.
- Do not introduce compatibility reads/writes for retired identity schemas merely to preserve stale development data.

## Sensitive data

Prefer operation/purpose, result/error code, HTTP status, duration, correlation ID and resolved session role. Never record passwords, challenge codes, bearer/refresh tokens, password hashes, service/provider secrets or unnecessary sensitive request bodies.

## Operational procedures

### 1. OTP / Provider delivery outage
1. **Diagnosis**: Inspect Identity health metrics and logs for external SMS/delivery errors (`delivery_status = 'failed'` or `'unknown'`).
2. **Containment**: Delivery acknowledgement remains decoupled from delivery status. If error rate exceeds delivery threshold, mark challenges `suppressed` rather than accumulating pending queues.
3. **Recovery**: Do not perform blind automated retries on unacknowledged challenges. Direct users to retry after the rate-limit window. Verify provider circuit breaker status before lifting throttle.

### 2. Suspected refresh token replay / credential compromise
1. **Diagnosis**: Grep security audit logs for `session.compromised` and `session.refresh_stale`.
2. **Analysis**:
   - `REFRESH_STALE` indicates legitimate concurrent refresh race within grace window; client retries safely without session invalidation.
   - `session.compromised` indicates reuse of an already-rotated token outside grace window (material replay).
3. **Containment**: Identity automatically invalidates the entire token lineage for that session upon confirmed replay.
4. **Mass revocation**: For compromised actors, call Platform Control `/internal/actors/{actorId}/security/disable` to revoke all active sessions across all roles atomically.

### 3. Privileged operator / platform owner lockout recovery
1. **Diagnosis**: Operator locked out due to expired credential or lost second-factor device.
2. **Procedure**:
   - An active `platform_owner` accesses Control Panel to initiate governed operator credential reset (`/internal/actors/{actorId}/roles/operator/reenrollment`).
   - If all `platform_owner` credentials are lost, invoke the break-glass predeploy CLI tool on a secured host with direct database credentials.
   - Never inject arbitrary SQL to bypass MFA or grant roles.

### 4. Bootstrap incident containment & durable completion
1. **Diagnosis**: Attempted re-bootstrap or concurrent bootstrap conflict.
2. **Safety rule**: Bootstrap is strictly one-time and protected by a database advisory lock and `identity_bootstrap_completed` durable state.
3. **Containment**: If bootstrap fails halfway, inspect transaction rollback; verify no orphaned owner row exists. Never clear the completion marker in a production database.

### 5. Migration checksum mismatch resolution
1. **Diagnosis**: Identity fails startup with `MIGRATION_CHECKSUM_MISMATCH`.
2. **Root cause**: Executable migration SQL files were modified after being committed and applied to the target database.
3. **Resolution**:
   - Never edit existing applied migration files in production.
   - Roll forward with a new incremental migration file (`000XX_...sql`).
   - If in local development, perform a controlled schema reset with `tools/dev/close-integration-runtime.ps1`.

### 6. Database restore & PITR verification
1. **Restore procedure**: Restore PostgreSQL cluster from immutable WAL/PITR backup snapshot.
2. **Post-restore canonical verification**:
   - Run `identity-schema-verify` binary against restored database.
   - Verify `identity_bootstrap_completed` state matches pre-incident epoch.
   - Invalidate all inflight session tokens issued between snapshot timestamp and incident time by advancing `token_revocation_epoch`.
   - Readback check: Verify phone-to-actor resolution and role binding counts match audit ledger.

## Verify recovery

Confirm canonical Identity readback, affected domain authorization/eligibility readback, revoked/renewed session behavior, negative cross-role cases, sensitive-data hygiene and the exact runtime behavior exercised. Repository/campaign closure is owned by the Orchestrator, not this runbook.
