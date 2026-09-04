# Identity Operations Runbook

DOCUMENT_CLASS: OPERATIONAL_RUNBOOK
PRODUCT_AUTHORITY: NONE
CURRENT_IMPLEMENTATION_AUTHORITY: NONE

Status: OPERATIONAL_RUNBOOK
Owner: Identity service operations

Current canonical identity contracts, migrations, runtime configuration and registered CI/guard commands override stale details.

## Service objectives

Availability/latency/error-budget numbers are operational targets only after they are configured and measured in the active environment. They are not fabricated production evidence.

## Required signals

Prefer structured dimensions such as:

- operation ID;
- result/error code;
- HTTP status;
- duration;
- correlation ID;
- surface;
- resolved actor role;
- trusted context identifiers only when permitted and redacted appropriately.

Never record passwords, activation codes, bearer/refresh tokens, token hashes, secrets or full sensitive request bodies.

## Alerts

Investigate the current equivalents of:

1. repeated readiness failure;
2. abnormal login/activation rate limiting;
3. elevated refresh/session failure;
4. identity outbox rows overdue beyond their retry schedule;
5. forbidden-origin/CORS bursts;
6. repeated PostgreSQL constraint violations in identity-owned tables.

## Diagnostic sequence

1. Capture exact commit and correlation ID.
2. Check current identity health/readiness routes.
3. Check PostgreSQL connectivity and current migration state.
4. Classify the failure: login, activation, refresh, session ownership, service authentication, authorization, CORS or outbox delivery.
5. Reproduce only with sanitized actor identifiers and masked personal data.
6. Verify revoked/rotated credentials cannot be replayed after refresh, logout, session revocation, deactivation or deletion where the current contract requires it.

## Support rules

- Expired/revoked session → use the governed sign-in/activation flow; never restore a token manually.
- Locked activation → follow current challenge/rate-limit policy; never reset attempts ad hoc.
- Wrong role/surface → correct the canonical actor/workforce assignment; do not patch client-local state.
- Duplicate identity data → resolve the sovereign existing actor; do not create a parallel actor.
- Outbox backlog → retry by stable event identity after root cause is corrected; do not duplicate downstream effects.

## Rollback

- Roll back application code to a candidate verified under current policy; do not rely on historical workflow names.
- Applied identity migrations are corrected through forward migrations unless an explicitly reviewed rollback contract exists.
- Never roll back to behavior that re-enables wildcard trust, token reuse, cross-actor access, plaintext secrets or unbound support sessions.

## Verification boundary

Use current registered identity/runtime/CI checks from the repository. A historical workflow path or old commit is not current evidence. Final closure requires all applicable same-commit scopes and protected approvals.
