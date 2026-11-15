# Identity — current progressive development slice

STATUS: IMPLEMENTATION_IN_PROGRESS
EXECUTION: IN_PROGRESS
PRODUCTION_ACTIVATION: BLOCKED
OWNER: Identity

Identity alone owns actor identity, authentication, active sessions and platform permissions. DSH owns Stores, Store-granted actions and availability; WLT owns money. An Identity Operator permission is not a Store grant or WLT ledger-execution right.

## Isolated implementation

- `backend/internal/session`: SHA-256-only opaque 256-bit bearer session verification against canonical actor, role, issue time, expiry, revocation and actor/role versions.
- `GET /v1/sessions/current`: returns the authoritative actor, role and expiry only.
- `DELETE /v1/sessions/current`: authenticated logout, one conditional and durable Identity PostgreSQL digest-only revocation; requires a current valid session and does not affect other actors or other bearer credentials. Returns 204 once, then 401 for a revoked retry; no token body or cross-origin browser access.
- `GET /v1/operators/me/permissions/{permission}`: reads one of the seven finite Operator scopes from a **current explicit Identity grant** in the same read-only transaction as the active Operator session. It cannot grant from `role=operator` alone. A revoked grant, suspended actor/role or stale session fails closed.
- `database/migrations/001_session_verification.sql`: synthetic Identity actor/role/session baseline, unchanged.
- `database/migrations/002_operator_permission_read.sql`: additive synthetic-only explicit Operator permission table with an Operator-role foreign key. It **does not** issue permissions, create an Original Operator or change an existing protected Identity schema.
- `backend/cmd/identity`: isolated owner session verifier and logout writer that rejects non-synthetic startup. Requires explicit `BTHWANI_ISOLATED_TEST_MODE=true`, `IDENTITY_DB_SCHEMA=identity_test_*` and an isolated `IDENTITY_TEST_DATABASE_URL`. It is not a production identity server.
- `contracts/openapi/identity.openapi.yaml`: executable description of session read/revoke and the bounded Operator permission read. No public issuer/admin mutation is exposed.

## Proof and limits

Real isolated PostgreSQL transaction tests exercise two Operators with differing grants, a Customer, a Merchant, permission/session revocation, one-credential authenticated logout with durable independent readback, concurrent logout races, expiry, role and actor suspensions, stale versions, owner failure and forged actor headers; see `internal/session/postgres_integration_test.go`. Synthetic SQL records are test input only, not a working Identity admission flow.

**NOT_CLOSED:** real login and Passkey factor binding, original Root Operator continuity, Operator permission administration and audit trail, token issuance/refresh/rotation and session-family invalidation, Store-grant integration in DSH, native/Web authenticated consumer journeys and independent critical security review.

**PRODUCTION_ACTIVATION: BLOCKED.** No protected account, finance balance, real session or production migration is authorized by this isolated reader. Governance: `governance/identity.md`.
