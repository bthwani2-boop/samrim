# Plan — Identity current-session and effective Operator grant read

STATUS: DEVELOPMENT_IN_PROGRESS
CAPABILITY_ID: IDENTITY_ACTIVATION_SESSIONS
JOURNEY: MANAGED_PARTICIPANT_ADMISSION — prerequisite only, not full journey

## Constitution and authority

Use `AGENTS.md`, `REPOSITORY-STRUCTURE.md`, `governance/README.md`, `governance/identity.md` and the existing Codex/Spec Kit derived adapter. Never use the spec as a second permission law. Use the currently authorized active development branch only; historical archive branches remain read-only. The single Git-turn lock belongs to its current owner; no parallel Git writes.

## Current owner implementation

Identity `services/identity/backend/internal/session` has one SHA-256 bearer parser, Postgres `READ ONLY REPEATABLE READ` canonical actor/session/role lookup, and a second strictly scoped read of explicit Operator permission in **the same transaction**. A `403` signals a verified session without effective grant; `401` signals an invalid session; `503` means owner verification failed and no permission is granted. The finite set is operations, merchant, catalog, marketing, finance, hr and platform_policies. Historical partners is never admitted as a new grant; a grant is never created by a role or HTTP header. Existing SQL migrations 002 and 005 retain historical bytes; additive migration 007 performs an audited, transaction-safe name cutover and role-session invalidation. Source publication does not authorize migration against an existing protected namespace.

`DELETE /v1/sessions/current` now conditionally revokes only the presented active session digest via an owner-atomic PostgreSQL write. Replays, suspension and stale auth versions fail closed; it does not issue credentials or revoke a session family. New additive `services/identity/database/migrations/002_operator_permission_read.sql` is limited to isolated `identity_test_*` schemas. Original migration 001 remains unchanged. Real grant/revoke and audited original-Operator administration require a separately approved implementation. Dev runtime is loopback only and requires explicit isolated env; no protected services or data are reused.

## Contracts and consumers

`services/identity/contracts/openapi/identity.openapi.yaml`: `GET /v1/sessions/current`, `DELETE /v1/sessions/current`, and `GET /v1/operators/me/permissions/{permission}`. No public credential issuance, admin bootstrap or production server. Notify session02 that `RequireOperatorPermission(ctx,bearer,operations)` can use the effective permission **read** after it has authenticated the caller; DSH owns the actual Store grant, mutation and its authorization tests. Session03 must not edit session02 DSH files while they are claimed.

## Evidence

1. Go unit/negative/owner failures, no actor-header impersonation, no token leaks or cross-origin CORS.
2. Native Linux Go integration inside isolated Docker network against PostgreSQL, synthetic distinct Operators and active/revoked grants; separate readback connection proves durable session and permission revocation, plus 12 simultaneous session logouts and stale principal denial. No protected account/data changes.
3. Strict OpenAPI parser and structural security guard, Go vet, formatting, exact toolchain and security checks, affected regression only.
4. Independent critical security risk review, full real identity-issued session, DSH Merchant/Operator permission path and real Web/Android acceptance are required **before** full journey CLOSED. CI/Sonar gates classified independently.

Spec Kit 1.3.0 official CLI + existing project workflow/codex integration are inspected; full remote Codex SDD remains reserved to the shared-worktree Spec Kit coordinator while it holds Git turn. Never start a duplicate workflow, falsely claim Fast delivery, or bypass human review gates.

## Session-03 verified Customer → Merchant role (progressive isolated slice)
The existing Customer bearer and canonical verified_at actor proof are necessary preconditions, never caller-supplied actor headers or the presence of a Merchant Store. A new additive 003 migration makes synthetic actors unverified by default; no public verification mutation is introduced. One Identity transaction locks actor/role/session, refuses existing roles even if disabled, creates Merchant standing, issues a single random 256-bit bearer digest-only with a short lifetime, and returns token only on success. Actual verified first-factor login and real Operator Passkey remain out of scope and cannot be certified by synthetic test data.

### Open technical gates
1. Real Identity verification factor/phone/passkey initial issuer, guest-to-verified admission, secure refresh/role re-entry after unknown response and recovery; avoid treating seeded synthetic verified_at as a real identity proof.
2. Independent DSH protected Store grant and Merchant/Operator/Customer app integration with exact final code, persistent readbacks, IDOR, revocation and account isolation.
3. Exact final CI/Sonar and independent critical security/architecture review before full journey CLOSED.

## Session-03 logout handoff (delivered)
Identity canonical owner now writes the current session revoked_at atomically and proves 204→401 from a separate PostgreSQL connection in a local isolated native Linux container. The 12-way race commits once, and stale/suspended/forged requests do not revoke another actor. This is not a credential issuer, WebAuthn flow, session-family replay/recovery engine, or complete participation journey. Delivered Commit c9a8b4fb1406cabb28eafd40edb9a5f9801c5898. Sonar Vortex request was 403 and CodeRabbit local review authentication failed; full independent critical review remains blocked. Runtime apps are not updated by the Git push.
