# Identity — Service Owner and Current Development State

STATUS: IMPLEMENTATION_IN_PROGRESS
EXECUTION: IN_PROGRESS
PRODUCTION_ACTIVATION: BLOCKED
OWNER: Identity

Identity remains the only owner/writer of actors, high-level roles, sessions, authentication and platform-wide permissions. DSH owns Store grants and standing; WLT owns money. No client headers or Store records create Identity actors or permissions.

## Implemented development slice

- `backend/internal/session`: owner-backed verification of an opaque 256-bit bearer credential using its SHA-256 digest, canonical actor/role standing, session expiration/revocation and actor/role authorization versions. It returns only the attributable actor, role and expiration, never tokens or private profile data.
- `backend/cmd/identity`: explicit loopback-only **synthetic test mode** reader. It refuses startup unless `BTHWANI_ISOLATED_TEST_MODE=true`, `IDENTITY_DB_SCHEMA` is an `identity_test_*` namespace, and an isolated `IDENTITY_TEST_DATABASE_URL` is supplied. No production/operator login or session issuance route exists.
- `database/migrations/001_session_verification.sql`: additive isolated bootstrap intended only for a previously absent `identity_test_*` schema; not a protected-database migration. Its `__SCHEMA__` placeholder must be validated and replaced by a guarded synthetic test runner.
- `contracts/openapi/identity.openapi.yaml`: one internal read operation; reserved path-group files remain unreferenced placeholders.

This verifier cannot issue a session or grant a role. Real user login and passkey verification, refresh/revocation endpoints, protected Identity/DSH grant integration and Web/Android native journeys are **NOT_RUN**. It is an incomplete prerequisite, not a completed Identity capability or full admission journey.

Canonical governance: [Identity](../../governance/identity.md). Placement: [Repository structure](../../REPOSITORY-STRUCTURE.md). Runtime proof and current SHA must be established separately; no synthetic test success authorizes production or customer secrets.
