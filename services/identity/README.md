# Identity — owner implementation and development boundary

Identity alone owns actors, verification, roles, sessions, Operator permissions and credentials. DSH owns Store grants and Captain operational standing; WLT owns financial authority. See [Identity policy](../../governance/identity.md), [engineering policy](../../governance/engineering.md) and [journey acceptance](../../governance/journeys.md). This guide describes source, not live state or production admission.

## Implementation

The [Go entrypoint](backend/cmd/identity/main.go) composes the [session domain](backend/internal/session/); the [OpenAPI entrypoint](contracts/openapi/identity.openapi.yaml) defines its HTTP operations. The [public client](clients/README.md) describes the consumer transport.

- Current session: GET and DELETE /v1/sessions/current resolve or revoke a current opaque access credential against authoritative actor/role standing, versions, expiry and revocation.
- Persistent sessions: POST /v1/sessions/persistent establishes a session family; POST and DELETE /v1/sessions/refresh rotate credentials or revoke the family. Independent 256-bit access/refresh secrets are persisted only as digests. A recent racing duplicate is rejected; later confirmed replay revokes the family. The owner enforces idle and absolute expiry.
- Synthetic phone: POST /v1/customer-auth/phone-challenges and /v1/customer-auth/phone-verification implement bounded single-use proof and Customer session issuance.
- Merchant: POST /v1/actors/me/merchant-role and /v1/actors/me/merchant-session admit a never-provisioned Merchant role or rotate an active role session for the verified Customer actor. No Store grant or automatic reactivation follows.
- Captain: POST /v1/actors/me/captain-role and /v1/actors/me/captain-session additionally require actual approved DSH standing. Identity revalidates the source credential after the DSH request.
- Operator: GET /v1/operators/me/permissions/{permission} reads a current explicit grant. GET /v1/operators/{actorId}/permissions and PATCH /v1/operators/{actorId}/permissions/{permission} implement separately admitted original-Operator administration. Changes require the finite scope, revision, reason and command identity, with audit and affected-session invalidation.
- Operator Passkey authentication, initial bootstrap and existing-actor recovery use separate guarded ceremonies. Bootstrap and recovery register credentials; a separate authentication ceremony issues the session.

## Database and serving boundary

The only active fresh-install source is [database/schema](database/schema/), in order: 00_identity.sql, 10_verification.sql, 20_sessions.sql, 30_operator_permissions.sql and 40_operator_passkeys.sql. Use the existing [environment launcher](../../tools/dev/README-Lenovo-Development.md) and [infra owner](../../infra/README.md) for explicitly isolated disposable provisioning. Serving principals must not have bootstrap/DDL authority. Never replay the baseline into retained data.

The retired ten experimental migrations remain in [historical Git source](https://github.com/bthwani2-boop/samrim/tree/e6eaa44691fe98e6aa4e876d3d8a4e2be5a6aedb/services/identity/database/migrations). They are evidence, not installation commands. The [previous owner guide](https://github.com/bthwani2-boop/samrim/blob/9ffef425c7bfbd374f515ca2ffc68fb6ce176b64/services/identity/README.md) preserves dated compatibility, ACL and backup evidence; do not infer present data counts, grants or image state from it. Retained-data upgrades and protected recovery require separate owner authorization and evidence.

The Go process requires BTHWANI_ISOLATED_TEST_MODE=true, an admitted identity_test_* schema and IDENTITY_TEST_DATABASE_URL. It binds loopback by default; exposed development listening requires explicit isolated container mode. Container startup verifies the development database; verify-development-db performs owner verification without serving. Optional private TLS exposes only current-session and effective-permission reads for DSH. Use the canonical Compose and launcher, not manual changes to serving grants.

## Authentication admission

| Capability | Source gate |
| --- | --- |
| Synthetic phone | IDENTITY_SYNTHETIC_PHONE_AUTH; separate HMAC key, approved synthetic Yemen phone allowlist and isolated Mailpit SMTP |
| Captain | IDENTITY_ENABLE_ISOLATED_CAPTAIN_ADMISSION; verified DSH standing endpoint and container TLS trust |
| Operator permissions | IDENTITY_ENABLE_ISOLATED_OPERATOR_PERMISSION_ADMIN; current original-Operator authority |
| Operator Passkey | IDENTITY_ENABLE_ISOLATED_OPERATOR_PASSKEY_AUTH; matching RP ID and permitted origins |
| Initial Operator | IDENTITY_ENABLE_ISOLATED_OPERATOR_BOOTSTRAP; exact disposable database or separately authorized local-first-Owner mode |
| Existing Operator recovery | IDENTITY_ENABLE_ISOLATED_OPERATOR_PASSKEY_RECOVERY; exact disposable WebAuthn database and approved origin |

These are source gates, not instructions to enable them or proof of activation. Synthetic phone proof is not real provider or legal identity proof. Never expose credentials in URLs, logs, Git, screenshots or chat.

### Original Operator and recovery

The offline issue-synthetic-root-ticket command is restricted to the dedicated disposable WebAuthn database. The separate issue-local-dev-root-ticket command additionally requires isolated container mode, IDENTITY_ENABLE_LOCAL_DEV_FIRST_OPERATOR and the exact existing development database/schema with verified owner ACLs. Both require directly supervised human authorization, approved localhost RP/origin and absence of an original Owner. The local variant admits only its known synthetic fixture boundary. Neither command runs as part of startup, CI or ordinary app launch.

Existing-actor recovery consumes independently authorized short-lived actor-bound proof. The HTTP API cannot issue it, select an arbitrary actor or create a second Owner. Recovery registers a replacement credential, revokes old credentials/sessions and preserves the actor, grants, original-Owner marker and audit. The source does not establish a production proof-issuance procedure. A human must complete genuine user-verified WebAuthn and authenticate separately.

## Verification

Use the pinned Go toolchain for go test -count=1 ./... and go vet ./... from backend/. Use the existing isolated PostgreSQL CI verifier and session integration tests for fresh baseline, revocation, replay, concurrency, signed WebAuthn, ACL and restore proof. Never point fixtures at retained development or production data.

From the repository root, use pnpm check:contracts and the owner client tests. Verify source/runtime provenance, current owner readback and actual Chrome/Android journeys as applicable. A green unit test, enabled route or health response is not proof of an authenticated actor, real provider, original-Owner continuity or complete cross-owner journey. Production activation remains a separate gate.
