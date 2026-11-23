# Identity verified session and effective Operator permission

STATUS: DEVELOPMENT_IN_PROGRESS
CAPABILITY_ID: IDENTITY_ACTIVATION_SESSIONS
JOURNEY: MANAGED_PARTICIPANT_ADMISSION — incomplete dependency

## User story

As a protected BThwani service, I can authenticate a current Identity actor and explicitly check an Operator workspace permission, with no ability to impersonate another actor, trust a caller-supplied role, or infer any grant from Operator status alone.

## Functional requirements

- FR-001: The single canonical Identity owner verifies only opaque high-entropy bearer secrets using a stored digest, current actor and role standing, exact auth/role versions, issue time, expiry and revocation.
- FR-002: Invalid, forged, stale, expired and revoked sessions never identify an actor or grant permission; owner outage always fails closed.
- FR-003: An active Operator's current effective permission is granted only when an explicit matching Identity-owned permission is active in the same transaction snapshot as the verified session.
- FR-004: Only `operations`, `merchant`, `catalog`, `marketing`, `finance`, `hr`, `platform_policies` are in scope. Historical `partners` is rejected as a new scope; unlisted, forged or malformed scope requests fail without an owner read.
- FR-005: A role by itself cannot grant any permission. Different Operators have independent grants; revocation and account/role suspension are observed on every request.
- FR-006: Both reads are no-store, no credential echo, no browser cross-origin bearer access. Caller actor/role headers and query/body cannot change principal or grant decisions.
- FR-007: The isolated Identity owner is restricted to synthetic test actors and an explicitly isolated local environment. It may issue a short-lived Customer credential only after a single-use proof for an approved synthetic test phone number; that exception must not be reachable with real identities or in protected/production environments. Operator bootstrap and Operator grant mutation remain excluded from this isolated entry workflow. The separate FR-010 permits proof-bound Merchant role-scoped issuance from an already verified Customer session.
- FR-008: DSH Store authorization remains a separate mandatory check at the actual mutation boundary. A Finance workspace grant alone does not authorize wallet/ledger execution.
- FR-009: An authenticated DELETE /v1/sessions/current atomically sets revoked_at for only the presented bearer digest when the Identity owner confirms its current actor, role and version. First successful request returns 204 without a body; revoked replay, stale or suspended principal returns 401 without mutation; owner outage returns 503.
- FR-010: POST /v1/actors/me/merchant-role admits a never-provisioned Merchant role only for the same actor as a currently active Customer bearer with separately verified Identity actor proof. One canonical PostgreSQL transaction both creates the role and stores only the digest of a cryptographically random new Merchant session; no Store ownership or Operator permission can follow from Identity alone.
- FR-011: Already-active, disabled or suspended Merchant roles cannot self-register or reactivate. Missing verification and stale/forged credentials fail closed; concurrent registration has exactly one winner. The new bearer is short-lived and never logged, stored raw, embedded in a URL, or returned in an error.

## Acceptance scenarios

- AC-01: Current synthetic Merchant and Customer tokens return their actual Identity roles; two separate active Operator tokens return their own authoritative actors.
- AC-02: Operator A with `operations` receives a successful read; Operator B with only `marketing` fails `operations` but succeeds `marketing`.
- AC-03: Revoking A's grant immediately denies the next read; revoking A's session denies all reads, without denying B.
- AC-04: Future-issued, expired, suspended, stale-version, unknown bearer, malformed scope, body/query injection and owner outage always reject at the correct authorization/error boundary.
- AC-05: A forged client actor header cannot change the effective permission and the bearer is absent from responses.
- AC-06: An isolated real PostgreSQL integration test and HTTP handler readback pass; generic mocks and HTTP 200 alone are not accepted as a complete user journey.
- AC-07: Authenticated logout is durably confirmed from a separate PostgreSQL connection; 12 simultaneous logout attempts yield exactly one 204; replay, suspension, wrong security version and forged actor header cannot revoke another session. Current Operator B permissions remain independent.
- AC-08: A verified synthetic Customer signs in with its current Identity session, submits direct Merchant role admission, receives a new Merchant bearer bound to the same actor; an independent owner DB connection verifies one new role and active session. The original Customer session remains valid, Merchant logout revokes only its own credential, and no DSH Store grant is fabricated.
- AC-09: Unverified, wrong-role, stale, expired or already-provisioned (including SUSPENDED) actors cannot self-admit; 12 simultaneous attempts by one eligible Customer create one Merchant role and only one Merchant session. Retry after an uncertain committed response cannot silently create another role, but a separate role re-entry/recovery mechanism remains a full-journey dependency.

## Outside this bounded implementation

Operator original credential continuity and Passkey enrollment, live phone-provider verification, session refresh and family-wide rotation, Operator grant administration with audit, DSH protected workspace integration, and production activation remain **NOT_CLOSED** and require implementation and critical-risk review.

## Synthetic Merchant entry extension

- In an isolated test environment, reserved synthetic phone numbers receive a single-use, attempt-limited verification proof. Concurrent completion cannot create duplicate Customer identities or credentials. Repeated verified entry resolves to the same actor, and suspended actors or roles cannot regain access.
- A verified Customer may enter and re-enter the Merchant role only through the Identity owner. Merchant sessions stay isolated from other roles and application surfaces; entry alone provides no DSH Store grant.
- Whole-journey acceptance still requires real phone-provider verification, DSH Captain standing and Identity admission, authorized Operator Passkey and recovery, independent security review and supported native-device proof.

Acceptance requires observable replay protection, concurrent proof consumption, actor reuse, suspension, wrong-role denial, durable revocation, reload, sign-out and protected Store navigation. Independent Identity and DSH owner readback must show that an admitted Merchant cannot access an unrelated Store or use a revoked credential and that Store ownership is unchanged. A locally simulated device or test account does not substitute for physical-device or protected-environment evidence.

Source authority: `governance/identity.md` and `governance/journeys.md`. Branch 41 read-only.
## Separate isolated first-Operator bootstrap increment (development only)

The canonical Identity owner now has an **explicitly disabled by default** one-time synthetic Root bootstrap path. It does not register a real historical Operator, prove a human phone/email, or activate protected production authentication.

- The offline-only `cmd/identity` issuer must confirm a strict isolated `identity_test_*` schema, an explicit local opt-in, and *no existing Operator role or original Owner marker*. It generates a random 256-bit ticket and never exposes an actor/scope bootstrap API.
- The ticket is consumed only by a ten-minute, server-stored challenge and a real WebAuthn `navigator.credentials.create()` ceremony with exact localhost RP, resident credential and user verification required. A replay, forged origin, mismatched ceremony, expired claim, missing UV, or malformed credential fails closed.
- Identity writes the first actor, Operator role, seven explicit canonical workspace grants, immutable original Root marker, public-key credential, one-time claim consumption and audit in a **single PostgreSQL transaction**. Competing requests must yield at most one Root, no privilege-grant input is accepted, and successful enrollment **does not issue a session**.
- The first Operator must then authenticate separately through the existing signed WebAuthn login before accessing the UI. Identity remains the only source of truth for the operator/permissions and no DSH Store or WLT finance authority is conferred implicitly.
- The opt-in routes and BFF must remain unavailable on current shared/production services; applying migration 008 to an existing protected database, reenrolling the historical Owner, actual Windows Hello device proof, human-verification/recovery, and independent critical security review remain distinct **NOT_CLOSED** gates.

Acceptance of this **synthetic** increment requires exact Go unit/negative tests, strict OpenAPI/generated operation parity, UI type/build checks, and a real disposable PostgreSQL cryptographic WebAuthn fixture that proves one-winner concurrency, durable Owner marker/grants/credential/audit, independent signed login, revoked/invalid replay refusal and zero session on enrollment. It does **not** close protected original Owner continuity or production readiness.

## Separate existing-Operator Passkey recovery increment — STAGED / NOT_CLOSED

This is a distinct progressive increment beyond FR-001–FR-011. It does not
retroactively close the original Operator continuity requirement.

- FR-R01: An offline, separately authorized identity-continuity proof is
  required and bound by SHA-256 digest to one existing ACTIVE Operator.
  Browser requests cannot choose an actor, mint a proof, create a role,
  set grants or create an original-Owner marker.
- FR-R02: Identity allows a single-use, user-verified, resident WebAuthn
  registration challenge under one exact localhost RP and origin. The
  challenge expires within four minutes and the approved proof cannot
  remain valid beyond ten minutes after issuance.
- FR-R03: Successful recovery replaces credentials, revokes older Operator
  sessions, invalidates other outstanding recovery claims and records
  append-only owner audit in one SQL transaction, retaining the same actor,
  Operator role and permission rows. It issues no session.
- FR-R04: Identity and the Control Panel each require an independent explicit
  recovery opt-in; current shared runtime remains disabled.
- AC-R01: Invalid, replayed, revoked, expired, unverified, cross-actor,
  inactive-role and concurrent proofs never grant session or privilege.
- AC-R02: A disposable real PostgreSQL and WebAuthn integration proves
  replacement, counter-signature verification, replay safety, other-actor
  isolation, rollback and owner readback; the user then registers through
  Windows Hello and performs separate login.
- AC-R03: Critical independent security review covers proof issuance and
  original actor continuity; no protected Identity changes until approved.

Status: Go unit checks, OpenAPI owner-contract checks and control-panel
type/security checks are available. AC-R01/02/03 are not complete: verified
human continuity, approved proof issuance, disposable SQL/WebAuthn integration
and independent review are missing. No credential has been issued to the
current original owner. JOURNEY_CLOSED=NO, PRODUCTION_READY=NO.
