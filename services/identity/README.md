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
- `database/migrations/004_customer_phone_verification.sql`: additive binding of one reserved fictional phone to one verified Identity actor, with durable per-phone challenge limits.
- `POST /v1/customer-auth/phone-challenges` and `POST /v1/customer-auth/phone-verification`: optional isolated phone proof. A challenge expires in five minutes and permits five attempts. Successful proof is consumed in the same transaction as Customer session issuance. Re-entry reuses the actor and respects current standing.
- `backend/cmd/identity`: isolated owner session verifier, logout writer and verified Customer-to-Merchant role admission that reject non-synthetic startup. Requires explicit `BTHWANI_ISOLATED_TEST_MODE=true`, `IDENTITY_DB_SCHEMA=identity_test_*` and an isolated `IDENTITY_TEST_DATABASE_URL`. It is not a production identity server.
- `contracts/openapi/identity.openapi.yaml`: executable entrypoint for health, synthetic phone proof, session reads/logout, the permission read and direct Merchant admission/re-entry.

To exercise the phone flow, apply the four Identity migrations to a fresh `identity_test_*` schema in a disposable database. Set `IDENTITY_SYNTHETIC_PHONE_AUTH=true` with a freshly generated 32-byte hex value in `IDENTITY_SYNTHETIC_PHONE_HMAC_KEY` and an isolated Mailpit SMTP address in `IDENTITY_SYNTHETIC_PHONE_SMTP`. The service accepts a loopback SMTP address or `mailpit:1025` in explicit isolated container mode. Only `+12025550100`–`+12025550199` are accepted. The code is delivered to the isolated Mailpit inbox.

Merchant Web uses the loopback server's `MERCHANT_SYNTHETIC_IDENTITY_ORIGIN` setting and an HttpOnly session cookie. Native uses `EXPO_PUBLIC_MERCHANT_SYNTHETIC_IDENTITY_ORIGIN` and app-scoped SecureStore. Admission grants the Merchant workspace role. DSH must still verify Store access before exposing any private Store operation.

## Proof and limits

Real isolated PostgreSQL transaction tests exercise phone proof contention, stable actor reuse, distinct Operator grants, revocation, expiry, suspension, stale versions, owner failure and forged actor headers. See `backend/internal/session/postgres_integration_test.go`. The synthetic phone flow issues a Customer credential from delivered proof, which then authorizes the existing Merchant admission command.

**NOT_CLOSED:** real phone-provider verification, Captain admission and DSH standing, Operator Passkey and original Root Operator continuity, Operator permission administration/audit, session-family recovery and rotation, DSH Store-grant authentication and independent critical security review.

**PRODUCTION_ACTIVATION: BLOCKED.** No protected account, finance balance, real session or production migration is authorized by this isolated reader. Governance: `governance/identity.md`.
