# Feature: Identity verified sessions, role admission and Operator access

CAPABILITY_ID: IDENTITY_ACTIVATION_SESSIONS
JOURNEY: MANAGED_PARTICIPANT_ADMISSION
ARTIFACT_CLASS: DERIVED_SPEC_KIT_REQUIREMENTS

This feature describes the bounded Identity-owner implementation and its applicable acceptance. It is not a policy, authority, work tracker or implementation certificate. Resolve decisions at [Identity governance](../../governance/identity.md), cross-owner boundaries at [architecture](../../governance/architecture.md), integration at [journeys](../../governance/journeys.md), and execution at [AGENTS.md](../../AGENTS.md). The [owner guide](../../services/identity/README.md), [OpenAPI entrypoint](../../services/identity/contracts/openapi/identity.openapi.yaml), owner SQL and tests define the observable source contracts. Record actual status and evidence in the current authorized work source.

## User scenarios

A protected service verifies a current actor and role and, where needed, an explicit current Operator grant. The person verifies their own identity, enters only eligible roles, may renew or revoke their own sessions, and recovers a credential through the authorized owner without impersonation or privilege expansion. A verified role is not a Store grant, dispatch authorization or financial command authority. Cross-role, cross-account and cross-Store state must never leak through UI, network, cache or delayed responses.

## Session and role requirements

- FR-001 — Accept only opaque high-entropy Identity-issued credentials. Persist digests, resolve current actor/role standing, security versions, issue time, expiry and revocation.
- FR-002 — Invalid, forged, stale, expired, suspended or revoked sessions never identify a principal or grant a right. Unavailable owner fails closed.
- FR-003 — Resolve an active Operator's explicit effective permission with the current verified session in the same transaction snapshot.
- FR-004 — Admit only the seven scopes registered by Identity governance. Reject legacy partners as a new scope and invalid/unlisted requests before an owner permission read.
- FR-005 — No role-only permission. Independent Operators retain their own grants; suspension and revocation affect the appropriate principal and session, not unrelated actors.
- FR-006 — Session and permission reads are no-store; no bearer echo, credential leakage, unauthorized cross-origin access or caller-supplied principal.
- FR-007 — Synthetic phone admission is explicitly gated in the isolated environment: approved test-phone allowlist, bounded single-use verification, limited attempts, actor reuse, suspended actor/role denial, and no real-provider or production authority. Delivery uses the admitted encrypted owner transport without plaintext fallback. Protected Operator bootstrap is a separate ceremony, not an extension of this phone route.
- FR-008 — Actual DSH resource-grant and WLT financial authorization remain independently enforced at their own read/write boundaries.
- FR-009 — Authenticated current-session logout revokes the presented active credential atomically. A successful first revocation returns 204 without body; invalid/revoked/stale/suspended session fails closed and owner failure returns 503. Unrelated actor and role credentials remain unaffected. Persistent-family revocation uses its separate owner contract.
- FR-010 — Direct first Merchant admission uses the same currently verified Customer actor and independently recorded actor proof. One owner transaction admits a never-provisioned role and issues a new digest-only role session; no Store or Operator right follows.
- FR-011 — Refuse duplicate, disabled or suspended first-role admission, missing verification and stale/wrong-role credentials. Serialize competing admissions to exactly one new role and credential. An unknown response cannot justify a second role or an automatic new operation.
- FR-012 — Active-role re-entry is a distinct owner operation; revalidate the eligible source Customer, rotate the role credential atomically, preserve unrelated roles and refuse self-reactivation. Captain admission/re-entry also requires current approved DSH standing; revalidate Identity after the peer request.
- FR-013 — Persistent access and refresh credentials are distinct digests. Enforce owner idle/absolute expiry, atomic rotation, racing duplicate rejection, confirmed replay compromise/revocation and family logout. Client persistence, cancellation and recovery cannot resurrect revoked sessions or expose another actor.
- FR-014 — Original-Operator permission administration requires the original current authorized Operator, finite registered scope, expected revision, reason, command identity, durable audit and affected-session invalidation. No scope delegates that authority. HR request and DSH Store-grant owners remain separate.

## Protected Operator credential ceremonies

The canonical requirements for original-actor continuity and user-verified Passkey authentication are owned by Identity governance. No production issuer, credential or protected database mutation is authorized here.

- BOOT-01 — Initial synthetic Root bootstrap requires the exact separately admitted disposable or explicitly authorized local development boundary, an offline owner-issued random 256-bit ticket, no existing Operator or original-Owner marker, and the approved localhost RP/origin. The original bounded ten-minute challenge requirement remains subject to actual owner contract verification. No HTTP endpoint grants a caller ticket issuance, principal choice or scope selection.
- BOOT-02 — Use genuine WebAuthn registration with resident credential, exact origin/RP and user verification; refuse replay, forged/mismatched/expired ceremonies, missing verification and malformed credentials. One transaction writes the first actor, role, seven explicit grants, immutable original-Owner marker, credential, claim consumption and audit. Competing requests admit at most one Root. Enrollment alone issues no session; separate signed authentication is required.
- FR-R01 — Recovery consumes independently authorized, digest-bound short-lived proof for one existing active Operator. No arbitrary actor selection, proof minting, role/grant creation or second Root by HTTP.
- FR-R02 — A single-use resident, user-verified registration ceremony uses the exact approved RP/origin. Preserve the bounded four-minute challenge and ten-minute proof lifetime acceptance from the original increment; verify them against the actual owner contract before claiming parity.
- FR-R03 — Recovery atomically replaces credentials, revokes previous sessions/credentials, invalidates competing claims and appends audit, preserving the actor, role, permission rows and original-Owner attribution. It issues no session.
- FR-R04 — Recovery and its presentation require independent explicit admission. Never enable protected credential effects from a source edit or successful synthetic test.

## Acceptance scenarios

- AC-01 — Distinct current Customer, Merchant and Operator credentials resolve their actual actors and roles. No caller-selected principal.
- AC-02 — Operator A with operations can read that scope; B with only marketing is denied operations and can read marketing.
- AC-03 — Revocation of A's grant immediately denies its next protected read; revocation of A's session denies its reads without altering B.
- AC-04 — Future-issued, expired, stale-version, suspended, unknown credentials, invalid scope, malformed body/query and owner outage fail at the correct authorization/error boundary.
- AC-05 — Forged actor/role headers cannot change decisions; responses, URLs, logs and stored state contain no raw credential leakage.
- AC-06 — Real isolated PostgreSQL and HTTP handler evidence includes separate owner readback; unit tests, mock owners and HTTP 200 alone are insufficient.
- AC-07 — Twelve concurrent current-session logout attempts produce one 204 and a durable revocation; replay, suspension, stale version and forgery cannot revoke a different session. Independent Operator access remains intact.
- AC-08 — Verified Customer first Merchant admission returns one session for the same actor, with durable role/session readback; Customer access remains valid, Merchant logout is scoped, and no Store grant is created.
- AC-09 — Unverified, wrong-role, expired/stale or already-provisioned/suspended actors cannot first-admit. Twelve simultaneous eligible first admissions yield one new role and session; unknown-response recovery cannot create another role.
- AC-10 — Synthetic phone: real encrypted delivery, purpose/expiry/attempt bounds, failure compensation, concurrent single-use proof, actor reuse, suspension denial and durable readback. No real-provider identity claim.
- AC-11 — Re-entry: concurrent role rotation leaves only the current role credential valid; Customer and unrelated actors remain unaffected. Captain standing denial, recheck after peer call and role/session races fail closed.
- AC-12 — Persistent family: expiry, rotation, racing retry, replay, revocation, cancellation, late response and reload are tested against actual owner state and affected consumers; separate actors, roles, cookies and device storage.
- AC-13 — Original-Operator grant administration: real owner readback, audit, stale-version/replay/concurrency denial, non-original administrator and wrong-actor denial, immediate affected-session invalidation.
- AC-14 — Bootstrap: real disposable PostgreSQL and cryptographic WebAuthn test; one-winner race, durable owner/grants/credential/audit, no session on enrollment, separate signed login and rejection of invalid/replayed ceremonies.
- AC-R01 — Recovery rejects invalid/replayed/revoked/expired/unverified/cross-actor/inactive-role and competing proofs without session or privilege gain.
- AC-R02 — Real disposable PostgreSQL and WebAuthn prove credential replacement, counter-signature verification, replay, isolation, rollback and durable readback. Genuine supervised Windows Hello registration and separate login remain applicable device/actor proof; never substitute a synthetic credential for original continuity.
- AC-R03 — Document executor security assessment, verify continuity and authorized proof issuance before any protected recovery.
- AC-15 — Affected Customer/Merchant/Captain/Operator Web and Android interactions prove owner-backed admission, reload, logout/recovery, role/Store isolation, IDOR, revocation, pending-response isolation and actual DSH/WLT readback where affected. No cross-owner or production closure inferred from local source or fixtures.

The active baseline, actual native test sources and current owner contracts are selected in [plan.md](plan.md); [tasks.md](tasks.md) identifies evidence responsibilities. Legal identity, protected original-Owner continuity, retained-data upgrade, real-provider activation and production are distinct acceptance/authorization boundaries. Historical requirements, extensions and implementation evidence are preserved in the [prior immutable feature tree](https://github.com/bthwani2-boop/samrim/tree/e7c7513c385650e79adaecbb486090902620c5ed/specs/004-identity-session-verification); historical commands, counts, statuses and reservations are not current instructions or proof.
