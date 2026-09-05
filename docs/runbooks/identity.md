# Identity Operations Runbook

DOCUMENT_CLASS: OPERATIONAL_RUNBOOK
EXECUTION_AUTHORITY: NONE
PRODUCT_SEMANTIC_AUTHORITY: NONE
CURRENT_IMPLEMENTATION_AUTHORITY: NONE

## Owners

Identity owns Human Actor identity/`actor_id`, verified login identifiers, credentials, Identity-wide security eligibility, high-level role admission, authentication/verification/activation/recovery and role-scoped sessions.

DSH owns partner/captain/field operational eligibility, assignment, membership and business authorization scope. WLT owns financial truth. Platform Control owns operator-role provisioning and Identity-wide security actions only where Governance assigns them.

This runbook never creates Product/authorization semantics. Current executable contracts/code/config/runtime remain implementation authority.

## Triage

1. Pin the exact candidate/correlation identity relevant to the incident.
2. Verify Identity health/readiness through the current executable interface.
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

## Recovery

Use only the current canonical owner interfaces and legal transitions. For non-production stale local data that cannot satisfy the current canonical schema, reset/recreate that disposable local data only when the environment is proven non-production. Never apply destructive reset logic to production durable data.

For managed-role access loss, use the owner-authorized re-enrollment/recovery path. For operator access, use the governed privileged credential/MFA recovery path. Never convert activation into a generic bypass login.

For ambiguous challenge-delivery results, preserve operation identity and classify the external delivery outcome according to the current provider/runtime contract; do not blindly resend when duplication or admission side channels are material.

## Verify recovery

Confirm canonical Identity readback, affected domain authorization/eligibility readback, revoked/renewed session behavior, negative cross-role cases, sensitive-data hygiene and the exact runtime behavior exercised. Repository/campaign closure is owned by the Orchestrator, not this runbook.
