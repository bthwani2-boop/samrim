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
- FR-004: Only `operations`, `partners`, `catalog`, `marketing`, `finance`, `hr`, `platform_policies` are in scope. Unlisted, forged or malformed scope requests fail without an owner read.
- FR-005: A role by itself cannot grant any permission. Different Operators have independent grants; revocation and account/role suspension are observed on every request.
- FR-006: Both reads are no-store, no credential echo, no browser cross-origin bearer access. Caller actor/role headers and query/body cannot change principal or grant decisions.
- FR-007: The isolated Identity owner is restricted to explicit synthetic PostgreSQL data and loopback host publication (or explicitly isolated Docker networking); it never exposes initial-factor credential issuance, Operator bootstrap or Operator grant mutation. The separate FR-010 permits only proof-bound Merchant role-scoped issuance from an already verified Customer session.
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

- In an isolated Identity namespace, reserved test numbers receive proof through a disposable Mailpit inbox. Proof is single-use, attempt-limited and persisted. Concurrent completion issues a single Customer credential and repeat verified login reuses the same actor. A suspended actor or role cannot regain standing.
- Merchant exercises the existing admission and re-entry commands using that verified Customer credential, then reads the resulting Merchant session from Identity. Web scopes the cookie to the local admission route. Native uses app-scoped SecureStore. The Merchant session provides no DSH Store grant.
- Whole-journey acceptance still requires real phone-provider verification, DSH Captain standing and Identity admission, authorized Operator Passkey and recovery, independent security review and supported native-device proof.

The isolated technical checks cover replay, concurrent proof consumption, actor reuse, suspension, wrong-role access and durable revocation. The Web check follows the form through Mailpit, the Identity APIs and PostgreSQL, then verifies reload, sign-out and the protected Store navigation boundary. A separate request to the real DSH process verifies that the newly admitted Merchant cannot access an unrelated Store, that a revoked Identity credential is rejected, and that the Store's owner is unchanged. Physical device execution and protected Identity data remain outside this evidence.

Source authority: `governance/identity.md` and `governance/journeys.md`. Branch 41 read-only.
