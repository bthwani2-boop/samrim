# Identity Operations Runbook

DOCUMENT_CLASS: OPERATIONAL_RUNBOOK
PRODUCT_AUTHORITY: NONE
CURRENT_IMPLEMENTATION_AUTHORITY: NONE

Status: STAGE_B_CANDIDATE_RUNBOOK
Owner: Identity service operations

## Current authority

```text
actor identity + actor_id            → Identity
high-level actor-role admission      → Identity
OTP/password authentication          → Identity
role-scoped sessions                 → Identity
DSH participant eligibility/scope    → DSH
financial truth                      → WLT
```

Identity currently has no generic Tenant/Operator-Context/AccessGrant/permissions engine.

## Required signals

Prefer operation ID, result/error code, HTTP status, duration, correlation ID and resolved session role. Never record passwords, activation codes, bearer/refresh tokens, token hashes, password hashes, service secrets or full sensitive request bodies.

## Authentication behavior

- Client OTP may establish client role.
- Partner/captain/field OTP succeeds only after DSH has provisioned and enabled that role.
- Operator is password-only.
- OTP is short-lived, single-use and attempt-limited, with phone/source throttling.
- Operator login failures are tracked by account and source; abusive sources are throttled without a simple username-only permanent lockout.
- Refresh is checked against device fingerprint and rotates atomically. Access tokens remain short-lived bearer tokens.

## Role disable / recovery

Disabling `actor_id + role` revokes only that role's sessions and pending activations. A provisioning retry never silently re-enables the role; the owner must explicitly enable it.

Operator password reset is Platform-Control-authenticated, audited, replaces the Argon2id credential and revokes existing operator sessions.

## Stale Stage-B database

The discarded pre-refoundation Stage-B schema was never integrated as production truth. Migration 001 intentionally fails if legacy actor columns such as `roles`, `operator_context_id`, `permissions` or actor-global lifecycle fields are present.

For local/non-production development only: stop the stack, reset/remove the stale PostgreSQL development volume, start the stack, then rerun the Identity runtime verifier. Do not add compatibility migration/dual-read logic for the discarded unmerged schema. Do not apply destructive reset instructions to production data.

## Diagnostic sequence

1. Capture exact commit/correlation ID.
2. Check `/identity/health` and `/identity/readiness`.
3. Check database schema and absence of legacy actor columns.
4. Classify provisioning/OTP/activation/password/reset/refresh/role/session/service-auth/CORS/rate-limit failure.
5. Reproduce with sanitized actor identifiers and masked phone data.
6. Verify canonical actor-role/session readback.
7. Re-run same-actor multi-role and scoped-revocation tests.

## Support rules

- Expired/revoked session → use canonical login/OTP; never restore token manually.
- Locked activation → request a new challenge after throttling; never reset attempts ad hoc.
- Wrong DSH eligibility/store/assignment scope → correct DSH owner truth; do not add Identity permissions/context.
- Wrong Identity role admission → owning service manages the explicit role; do not create another actor.
- Credential compromise → use governed operator password reset where applicable and verify revocation.

## Verification boundary

Final closure requires generated-contract checks, boundary/residue checks, Go/workspace verification, full Foundation runtime and `tools/dev/verify-identity-runtime.mjs`, followed by same-commit GitHub baseline/runtime checks. Isolated-role green fixtures alone are not closure proof.
