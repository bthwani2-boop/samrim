# Identity Operations Runbook

DOCUMENT_CLASS: OPERATIONAL_RUNBOOK
PRODUCT_AUTHORITY: NONE
CURRENT_IMPLEMENTATION_AUTHORITY: NONE

Status: STAGE_B_CANDIDATE_RUNBOOK
Owner: Identity service operations

## Current authority

```text
actor identity + actor_id                 -> Identity
verified phone identifier                 -> Identity
high-level actor-role admission           -> Identity
role-scoped password credentials          -> Identity
purpose-bound verification/challenges     -> Identity
Identity-wide security eligibility        -> Identity
role-scoped device-bound sessions         -> Identity
DSH participant eligibility/scope         -> DSH
financial truth                           -> WLT
```

Identity has no generic Tenant/Operator-Context/AccessGrant/permissions engine.

## Authentication behavior

- Customer registration: phone verification -> client password credential -> client session.
- Customer normal re-authentication: phone + client password. A valid stored session is restored/refreshed instead of prompting on every app open.
- Customer recovery: phone verification -> replace only the client credential -> revoke client sessions -> fresh client session.
- Partner/captain/field: DSH provisions the role first, then one-time managed activation creates the first device-bound role session.
- Repeating managed activation is not a login mechanism. Lost/revoked managed access requires explicit DSH-authorized re-enrollment.
- Operator: Platform Control provisions operator role/password; password proof starts a required second-factor challenge and only successful challenge consumption creates the operator session.
- Passkeys/WebAuthn remain the preferred progressive phishing-resistant target for privileged operator authentication. They are not a mandatory credential for every actor class in the initial baseline.
- Refresh is device-fingerprint checked and rotates atomically. Access tokens remain short-lived bearer tokens.

## Signals and sensitive data

Prefer operation/purpose, result/error code, HTTP status, duration, correlation ID and resolved session role. Never record passwords, challenge codes, bearer/refresh tokens, password hashes, service secrets or full sensitive request bodies.

## Role disable / re-enrollment / global security

Disabling `actor_id + role` revokes only that role's sessions and pending role challenges. Re-enabling never silently creates a session.

For partner/captain/field, DSH may explicitly authorize re-enrollment. That clears the managed role's enrollment marker and revokes that role's sessions/challenges so one fresh activation can occur. Platform Control cannot authorize DSH-role re-enrollment.

Global `security_enabled` disable is separate: only Platform Control may toggle it. Disable revokes all active sessions and pending actor-bound challenges without deleting role bindings. Re-enable never resurrects sessions.

Operator password reset is Platform-Control-authenticated, audited, replaces only the operator credential and revokes operator sessions/pending operator challenges.

## Stale development database

Migration 001 is a refounded non-production baseline. It intentionally fails when losing actor-global username/password/context columns are present. For local/non-production development only: stop the stack, reset/remove the stale PostgreSQL development volume, start the stack and rerun the Identity runtime verifier. Do not add dual-read compatibility for discarded unmerged schema. Do not use destructive reset for production data.

## Diagnostic sequence

1. Pin the exact commit/correlation ID.
2. Check `/identity/health` and `/identity/readiness`.
3. Verify canonical schema and absence of actor-global credential/context columns.
4. Classify: customer registration/login/recovery; managed provisioning/activation/re-enrollment; operator password/MFA; refresh/revocation; service auth; delivery; rate/abuse control.
5. Reproduce with sanitized actor identifiers and masked phone data.
6. Verify canonical actor-role/credential/challenge/session readback.
7. Re-run same-actor multi-role, scoped-revocation and second-factor tests.

## Verification boundary

Final closure requires generated-contract checks, boundary/residue checks, Go/workspace verification, full Foundation runtime and `tools/dev/verify-identity-runtime.mjs`, followed by same-commit GitHub baseline/runtime checks. A password-only operator fixture or repeated-activation managed fixture can never count as green proof.
