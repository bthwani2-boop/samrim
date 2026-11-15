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
- `POST /v1/actors/me/merchant-role`: accepts only a current Identity Customer session and a separately recorded canonical `verified_at` event. One atomic transaction admits a never-before-provisioned Merchant role and issues a new 256-bit Merchant bearer, stored only as its SHA-256 digest. A previous ACTIVE/SUSPENDED/DISABLED Merchant role returns 409 without self-reactivation. No DSH Store rights arise from this role.
- `POST /v1/actors/me/merchant-session`: re-entry requires the same currently verified Customer actor with an existing ACTIVE Merchant role. One Identity transaction rotates to a new random role-scoped Merchant session and revokes all earlier Merchant sessions for that actor, without affecting Customer or another actor. A missing/suspended/disabled role is not reactivated.
- `database/migrations/001_session_verification.sql`: synthetic Identity actor/role/session baseline, unchanged.
- `database/migrations/002_operator_permission_read.sql`: additive synthetic-only explicit Operator permission table with an Operator-role foreign key. It **does not** issue permissions, create an Original Operator or change an existing protected Identity schema.
- `database/migrations/003_verified_customer_merchant_admission.sql`: additive **synthetic-only** nullable actor verification timestamp. New actors start unverified; only a trusted Identity verification process may ever set this value in a non-test environment, and none is active here.
- `backend/cmd/identity`: isolated owner session verifier, logout writer and verified Customer-to-Merchant role admission that reject non-synthetic startup. Requires explicit `BTHWANI_ISOLATED_TEST_MODE=true`, `IDENTITY_DB_SCHEMA=identity_test_*` and an isolated `IDENTITY_TEST_DATABASE_URL`. It is not a production identity server.
- `contracts/openapi/identity.openapi.yaml`: executable entrypoint for two session operations, one permission read, verified Customer Merchant admission, and existing-active-role Merchant session re-entry. No first-factor verification/login, original Operator bootstrap, public role/permission issuer or admin grant mutation exists.

## Proof and limits

Real isolated PostgreSQL transaction tests exercise two Operators with differing grants, a Customer, a Merchant, permission/session revocation, one-credential authenticated logout with durable independent readback, concurrent logout races, expiry, role and actor suspensions, stale versions, owner failure and forged actor headers; see `internal/session/postgres_integration_test.go`. Synthetic SQL records are test input only; the direct Merchant role conversion is owner-backed but depends on an initial independently authenticated and verified Customer session, which this slice **cannot create**.

**NOT_CLOSED:** initial Customer identity verification and first-factor login, real Operator Passkey binding and original Root Operator continuity, Operator permission administration/audit, first-factor session issuance, refresh-token rotation and broad session-family invalidation, Store-grant integration in DSH, native/Web authenticated journeys and independent critical security review.

**PRODUCTION_ACTIVATION: BLOCKED.** No protected account, finance balance, real session or production migration is authorized by this isolated reader. Governance: `governance/identity.md`.
