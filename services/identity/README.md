# Identity — current progressive development slice

STATUS: IMPLEMENTATION_IN_PROGRESS
EXECUTION: IN_PROGRESS
OWNER: Identity

Identity alone owns actor identity, authentication, active sessions and platform permissions. DSH owns Stores, Store-granted actions and availability; WLT owns money. An Identity Operator permission is not a Store grant or WLT ledger-execution right.

## Isolated implementation

- `backend/internal/session`: SHA-256-only opaque 256-bit bearer session verification against canonical actor, role, issue time, expiry, revocation and actor/role versions.
- `GET /v1/sessions/current`: returns the authoritative actor, role and expiry only.
- `DELETE /v1/sessions/current`: authenticated logout, one conditional and durable Identity PostgreSQL digest-only revocation; requires a current valid session and does not affect other actors or other bearer credentials. Returns 204 once, then 401 for a revoked retry; no token body or cross-origin browser access.
- `GET /v1/operators/me/permissions/{permission}`: reads one of the seven finite Operator scopes from a **current explicit Identity grant** in the same read-only transaction as the active Operator session. It cannot grant from `role=operator` alone. A revoked grant, suspended actor/role or stale session fails closed.
- `GET /v1/operators/{actorId}/permissions`: reads the permission states and revisions of one active Operator. Identity requires the current original Operator session before resolving the target. The isolated Control Panel access view uses this read when `IDENTITY_ENABLE_ISOLATED_OPERATOR_PERMISSION_ADMIN=true`.
- `PATCH /v1/operators/{actorId}/permissions/{permission}`: the same isolated setting allows the original Operator to grant or revoke a scope for another active Operator. One Identity transaction records the expected revision, reason, audit and target-session invalidation. The Control Panel reloads current Identity state after confirmation and retains the original command for explicit recovery after an interrupted response.
- `POST /v1/actors/me/merchant-role`: accepts only a current Identity Customer session and a separately recorded canonical `verified_at` event. One atomic transaction admits a never-before-provisioned Merchant role and issues a new 256-bit Merchant bearer, stored only as its SHA-256 digest. A previous ACTIVE/SUSPENDED/DISABLED Merchant role returns 409 without self-reactivation. No DSH Store rights arise from this role.
- `POST /v1/actors/me/merchant-session`: re-entry requires the same currently verified Customer actor with an existing ACTIVE Merchant role. One Identity transaction rotates to a new random role-scoped Merchant session and revokes all earlier Merchant sessions for that actor, without affecting Customer or another actor. A missing/suspended/disabled role is not reactivated.
- `database/schema/` — the sole current disposable Identity baseline, five ordered domain files covering actors and roles, verification, session families and refresh, Operator permissions and Passkeys. New isolated namespaces use this baseline; existing namespaces never do. The ten experimental migrations (including the historical `partners` to `merchant` audit and cutover) are preserved in Git at `e6eaa44691fe98e6aa4e876d3d8a4e2be5a6aedb`. The cutover audit and its insert guard are not new-install objects: the fresh `operator_permission_commands` CHECK excludes `partners` entirely, while the historical schema preserves existing legacy audit rows and rejects new ones via a trigger. Isolated catalog comparison confirmed all other current columns, indexes, functions, triggers, constraints and grants (excluding physical column ordering and the historical cutover objects). Protected historical records, applied checksums, and separately authorized upgrade/recovery obligations are unchanged.
- `POST /v1/customer-auth/phone-challenges` and `POST /v1/customer-auth/phone-verification`: optional isolated phone proof. A challenge expires in five minutes and permits five attempts. Successful proof is consumed in the same transaction as Customer session issuance. Re-entry reuses the actor and respects current standing.
- `backend/cmd/identity`: isolated owner session verifier, logout writer and verified Customer-to-Merchant role admission that reject non-synthetic startup. Requires explicit `BTHWANI_ISOLATED_TEST_MODE=true`, `IDENTITY_DB_SCHEMA=identity_test_*` and an isolated `IDENTITY_TEST_DATABASE_URL`. It is not a production identity server.
- `contracts/openapi/identity.openapi.yaml`: executable entrypoint for health, synthetic phone proof, session reads/logout, the permission read and direct Merchant admission/re-entry.

To exercise the phone flow, install the ordered Identity baseline in a fresh, absent `identity_test_*` namespace in a disposable database. Set `IDENTITY_SYNTHETIC_PHONE_AUTH=true` with a freshly generated 32-byte hex value in `IDENTITY_SYNTHETIC_PHONE_HMAC_KEY` and an isolated Mailpit SMTP address in `IDENTITY_SYNTHETIC_PHONE_SMTP`. The service accepts a loopback SMTP address or `mailpit:1025` in explicit isolated container mode. Set `IDENTITY_SYNTHETIC_YEMEN_PHONES` to the comma-separated international format of the approved test mobile numbers. Delivery is to Mailpit. The verification baseline enforces the canonical synthetic phone format; new challenge issuance remains restricted by the Yemen development allowlist. Retained fixture rows must not be overwritten.

Merchant Web uses the loopback server's `MERCHANT_SYNTHETIC_IDENTITY_ORIGIN` setting and an HttpOnly session cookie. Native uses `EXPO_PUBLIC_MERCHANT_SYNTHETIC_IDENTITY_ORIGIN` and app-scoped SecureStore. Admission grants the Merchant workspace role. DSH must still verify Store access before exposing any private Store operation.

## Proof and limits

Real isolated PostgreSQL transaction tests exercise phone proof contention, stable actor reuse, distinct Operator grants, revocation, expiry, suspension, stale versions, owner failure and forged actor headers. See `backend/internal/session/postgres_integration_test.go`. The synthetic phone flow issues a Customer credential from delivered proof, which then authorizes the existing Merchant admission command.

**NOT_CLOSED:** real phone-provider verification, Captain admission and DSH standing, Operator Passkey and original Root Operator continuity, Operator permission administration/audit, session-family recovery and rotation, DSH Store-grant authentication and independent critical security review.

**Isolated synthetic scope only:** this document grants no authority to alter protected accounts, balances, real sessions or applied migrations. Governance: `governance/identity.md`.
## First Operator — isolated synthetic bootstrap only

The narrowly scoped first-Owner development path is deliberately disabled by default:
`IDENTITY_ENABLE_ISOLATED_OPERATOR_PASSKEY_AUTH=true` and the *separate*
`IDENTITY_ENABLE_ISOLATED_OPERATOR_BOOTSTRAP=true` are required on the
isolated Identity owner. The Operator BFF additionally requires
`OPERATOR_ENABLE_ISOLATED_ROOT_BOOTSTRAP_BFF=true` and one exact browser
origin shared with Identity: `http://localhost:23100` on Surface or
`http://localhost:13000` through the development tunnel. Neither the
server nor the offline issuer enables Root bootstrap outside the
dedicated disposable WebAuthn database.

Apply owner migration `008_operator_initial_bootstrap.sql` **only** to a
verified, fresh, disposable `identity_test_*` schema, following 001–007.
The CLI `go run ./cmd/identity issue-synthetic-root-ticket` is an
**offline authorized administration action** restricted to the dedicated
disposable `refoundation_webauthn_s02` database. The server and CI never
invoke the CLI. It refuses any existing Operator role or
Root marker; only a directly supervised owner can deliver the one-time
10-minute claim secret to the intended test user's Windows Hello browser.

`POST /v1/operators/passkey/bootstrap/options` and
`POST /v1/operators/passkey/bootstrap` accept only the claim secret and a
valid user-verified resident WebAuthn registration. One atomic Identity
transaction persists the actor, role, seven canonical Operator grants,
immutable original Root marker, credential and append-only audit.
Enrollment does not issue a bearer. The separately registered Passkey must
then complete the normal authentication flow before any workspace is shown.
A pending/used claim, a second Root, or a preexisting Operator prevents the
initial route from granting authority.

The live synthetic cryptographic test is
`TestInitialOperatorBootstrapRealPostgresAndWebAuthn`; it requires a
separately authorized disposable PostgreSQL container and an exact opt-in.
**No** real user contact details should be seeded in these fixtures.
Historical original-Operator continuity, real verified contact binding,
credential recovery, human Windows Hello exercise, current production
migration and independent critical risk review remain **NOT_CLOSED**.

## Existing Operator Passkey recovery — implementation staged, not activated

The canonical Identity owner now contains a separate, **disabled-by-default**
existing-actor WebAuthn recovery handler. It reuses migration 006 tables
(`operator_passkey_recovery_proofs`, `operator_passkey_ceremonies`,
`operator_passkey_users`, `operator_passkey_credentials`, immutable audit).
It does not need a new service, a new Operator actor, new permissions, or an
additional database schema.

Both the Identity option `IDENTITY_ENABLE_ISOLATED_OPERATOR_PASSKEY_RECOVERY=true`
and the Control Panel option `OPERATOR_ENABLE_ISOLATED_PASSKEY_RECOVERY_BFF=true`
require the existing isolated Passkey configuration and the exact approved
`localhost` WebAuthn origin. The Identity startup additionally refuses any
database other than the dedicated disposable `refoundation_webauthn_s02`;
an `identity_test_*` schema inside the shared `bthwani_refoundation` database
is not authority to recover an existing Operator. Neither option is enabled in
the current `bthwani-refoundation` runtime.

**Critical precondition:** the recovery proof must already be a digest-bound,
unexpired, ten-minute-or-less proof for a confirmed existing ACTIVE Operator,
issued **outside HTTP** after independently authorized human identity
continuity. This repository does not yet have a verified issuance/approval
procedure for original historical Operators. The recovery API and browser
cannot select an actor or mint that proof; do not insert an arbitrary actor ID,
reuse a first-Owner bootstrap ticket, or create a second Root. No protected
database is to be changed to test this path.

After a valid proof, `POST /v1/operators/passkey/recovery/options` begins a
four-minute user-verified WebAuthn registration, and
`POST /v1/operators/passkey/recovery` atomically registers the replacement
credential, invalidates other recovery proofs and ceremonies, revokes prior
Operator credentials and sessions, and writes immutable audit. It preserves
the actor, all role grants and the original-Owner marker. **No session is
returned**; the user must separately sign in with the registered key.

The current deliverable is implementation plus unit/contract checks;
a genuinely preauthorized proof, disposable PostgreSQL signed-WebAuthn
integration, Windows Hello registration, session/revocation readback, and
independent security review are still required before activation. **NOT_CLOSED**.


## Local development: first Operator in the existing refoundation Identity

This is **local development**, not a production identity admission flow. An
administrative Gmail address is not an authentication or ownership proof for
this isolated workflow; do not build production email verification just to
exercise the local Control Panel.

The existing development PostgreSQL database (`bthwani_refoundation`) and
Identity schema (`identity_test_docker_2e1e6ae0ba6b`) originally contained
five synthetic `operator-docker-*` actors. They were removed by explicit
human authorization after verified backup and cross-owner reference checks.
The authoritative readback now shows zero Operators and zero original Owners.
The ordinary disposable `refoundation_webauthn_s02` first-Owner path still
refuses *every* preexisting Operator.

The **separate, disabled-by-default** local development path can create exactly
one original Owner despite those known synthetic actors, only when:

- The Identity service and offline ticket issuer both target that exact
  database and schema; the existing container remains `bthwani-refoundation`.
- `BTHWANI_ISOLATED_TEST_MODE=true`,
  `BTHWANI_ISOLATED_CONTAINER_MODE=true`, and the exact WebAuthn RP
  `localhost` with origin `http://localhost:13000` are verified.
- Both `IDENTITY_ENABLE_ISOLATED_OPERATOR_PASSKEY_AUTH=true` and
  `IDENTITY_ENABLE_ISOLATED_OPERATOR_BOOTSTRAP=true` are explicitly enabled,
  with the **additional** `IDENTITY_ENABLE_LOCAL_DEV_FIRST_OPERATOR=true`.
- The retained schema is verified to contain the required original Operator bootstrap objects. Historical compatibility upgrade 008 is preserved in Git; never apply the fresh baseline over this schema or auto-upgrade shared data.
- The owner readback confirms no original Owner, no registered Operator
  Passkeys, and no unknown Operator actor IDs. An existing `operator-root-*`
  or any non-fixture Operator **blocks** this path.
- A human on the authorized device explicitly runs the *offline*
  `identity issue-local-dev-root-ticket` command and keeps its single-use
  ten-minute token out of logs, Git, URLs and chat.
- The human completes real Windows Hello registration using the matching
  browser origin, then signs in **separately**. Identity alone creates the
  original actor, seven finite grants, singleton marker, credential and
  immutable audit within one transaction. No synthetic role is deleted or
  reassigned, and enrollment alone never returns a session.

Do not reuse the earlier disposable sandbox ticket or paste an exposed token.
Do not treat the user-provided email address as proof of ownership; local
Windows Hello is the directly supervised step here. This code is NOT a
production first-admin workflow.

**Current state (local development, verified 2026-11-23):** the existing
`bthwani_refoundation` Identity test schema now has the empty
`operator_initial_bootstrap` table, created by an explicitly guarded,
additive local compatibility upgrade after a rolled-back eight-migration
probe. The pre-upgrade schema backup remains on Lenovo. Independent owner
readback showed zero Operators/Owners/credentials, three Customer roles, one
Merchant role and no newly issued session or permission. This is **not**
production activation or a live authenticated Owner.

The running Identity container still uses the older verifier image with
Passkey and bootstrap switches disabled. On 2026-11-23 the authorized
local-only Identity PostgreSQL role
`identity_runtime_docker_2e1e6ae0ba6b` received scoped table/column grants
in the existing `bthwani_refoundation` database: first-Owner enrollment,
Passkey authentication, session issuance/revocation and Operator permission
management, without DSH/WLT grants, schema creation, protected-history DELETE
or Passkey-audit UPDATE. The exact guarded grant script was tested under
transactional rollback, applied once with checksum verification and confirmed
by independent PostgreSQL ACL readback and actual restricted-role INSERT in
a separate rolled-back test transaction. No Operator, credential, session or
permission row was issued by those tests.

The isolated real signed-WebAuthn/concurrency integration, controlled runtime
cutover, human Windows Hello ceremony, durable permission/session readback
and independent security review remain required before first-Owner admission.
The saved pre-upgrade database archive is retained on Lenovo.
`JOURNEY_CLOSED=NO`; `PRODUCTION_ACTIVATION=BLOCKED`.