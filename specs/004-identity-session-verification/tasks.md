# Spec Kit Derived Tasks — Identity Session Verification (session-03)

CAPABILITY: IDENTITY_ACTIVATION_SESSIONS
COMMITTED_SHA: b0a7187023e6bd7e2dd57f40c1d065d2494be87b
REMOTE_SHA: b0a7187023e6bd7e2dd57f40c1d065d2494be87b
GOVERNANCE: PROGRESSIVE development; production and entire admission journey blocked.

- [x] T001 Read live AGENTS, repository structure, governance, Git branch/HEAD, peer claims and Spec Kit CLI.
- [x] T002 Record Identity-only owner scope claim and peer notices before implementation.
- [x] T003 Add Identity-owned isolated synthetic SQL baseline (actors, actor_roles, auth_sessions) with foreign keys and version checks.
- [x] T004 Implement owner-backed read-only PostgreSQL verifier with opaque bearer digest, issuer time, expiry, revocation and role/actor standing.
- [x] T005 Implement internal HTTP handler, negative fail-closed behavior and exact OpenAPI contract; no protected credential issuer.
- [x] T006 Unit and adversarial tests plus real isolated PostgreSQL readback with two actors, invalid input, revocation/expiry/version, role/actor suspension, cross-header forgery and owner errors.
- [x] T007a Go tests/vet, synthetic Linux PostgreSQL integration, staged secret marker scan, targeted governance server-declaration rejection and git diff check PASS.
- [ ] T007b Full local Foundation after peer-managed Codex Spec Kit integration changes; GitHub SHA Foundation CI PASS but shared local working tree gate currently FAIL until its owner reconciles state.
- [ ] T008 Independent critical security review and full source coverage quality gate; Sonar LCOV source-suite FAIL also occurred on previous parent SHA. CI presentation last seen IN_PROGRESS.
- [x] T009 Acquired exclusive Git turn, staged only 14 agent03 files, created local Commit, ordinary Push and independently verified exact remote SHA, then released Git turn.

BOUNDED_SLICE_DELIVERED: PASS for implemented Identity verifier and isolated persistent PostgreSQL tests on the exact submitted SHA.
FULL_IDENTITY_ACTIVATION_SESSIONS: REVIEW_BLOCKED / NOT_CLOSED.
OUT_OF_SCOPE_NOT_RUN: token issuance from authenticated factor, Passkey operator access, login/recovery, replay-safe rotation/revocation endpoints, DSH Store grants, multi-surface Web/Android and production activation.

SPEC_KIT: 1.3.0 original CLI used for check/integration/artifact/workflow discovery. Original check-prerequisites script with explicit 004 feature dir and no persistence PASS. Agent command execution not claimed; current Codex default integration is owned by another concurrent session, not configured by session03.

## Phase 2: Operator permission owner-read extension — session-03, 2026-11-15

- [x] T010 Scope explicit seven Identity Operator permissions; inspect DSH read adapter and preserve session-02 source ownership.
- [x] T011 Add `services/identity/database/migrations/002_operator_permission_read.sql` as synthetic-only additive grant-read storage; role FK and finite-state/scope constraints, no protected grant endpoint.
- [x] T012 Add canonical `GET /v1/operators/me/permissions/{permission}` session+grant transaction with 200/401/403/404/503 fail-closed cases and no-store/no-CORS behavior; update executable Identity OpenAPI.
- [x] T013 Verify Go positive and negative tests, unauthorized role, client actor spoof, invalid method/scope, streamed request bodies, cross-actor isolation; demonstrated RED→GREEN for streamed-body input.
- [x] T014 Initial native Linux isolated PostgreSQL owner proof PASS with two Operators, grant revoke, auth/role version, session revoke and separate durable connection (before final concurrent/SQL negative edit).
- [x] T015 Add 20 concurrent post-revocation read assertions and SQL constraints denying grants to Customer roles/unknown permission scope.
- [x] T016 Fresh native Linux PostgreSQL owner test for **final** T015 code — **PASS 2026-11-15** after Lenovo SSH and Docker restored, isolated native Linux verifier container exit 0, both Identity durable readback markers, 20 concurrent reads and invalid SQL grant tests executed.
- [x] T017 Go unit regression `-count=1 -shuffle=on`, `go vet`, scoped Foundation guard, locked JS YAML structural/security/ref checks and `git diff --check` PASS after body-rejection fix; full OpenAPI validator NOT_RUN.
- [ ] T018 Full official Codex/Spec Kit flow Constitution→Specify→Clarify→Plan→Tasks→Analyze→Implement→Converge — **BLOCKED**, shared Git held by coordinator, working tree has other owners' changes; last user explicitly specifies high but coordinator HEAD eeaac9821 changed project effort to medium. No duplicate dispatch or auto-approved gates.
- [ ] T019 Receive session-02 DSH owner handoff, integrate effective current Identity permission read without role-only grants, prove protected Merchant/Operator Web/Android behavior and actor/Store ACL at persistent data owner — BLOCKED.
- [ ] T020 Independent product/security and critical identity-risk reviews, relevant Sonar/CI acceptance, actual issuer/Passkey/logout/role permission administration and protected end-to-end commerce — REVIEW_BLOCKED/NOT_RUN.
- [ ] T021 After coordinator's Git-turn release, final affected tests and exact HEAD/diff, commit **only session-03 Identity owner files**, ordinary Push to branch with remote SHA verification — **BLOCKED** (Git turn HELD; no staging).

Current delivery status: `IDENTITY_OPERATOR_PERMISSION_OWNER_READ: IMPLEMENTED_UNCOMMITTED`, full MANAGED_PARTICIPANT_ADMISSION: `NOT_CLOSED / REVIEW_BLOCKED`. No branch 41 changes, service restart, PR, merge or production activation.

## Session-03 continuation — verified hardening without shared Git write

- [x] T022 RED→GREEN: Reader rejects a well-formed but non-isolated PostgreSQL namespace (`public`, DSH namespace, protected identity namespace); only `identity_test_*` legal for this isolated verifier.
- [x] T023 RED→GREEN: Current-session bearer lookup cannot approve an expired, missing, unknown-role, empty/malformed or overlong principal returned with nil owner error; rejects all, independent of the SQL adapter.
- [x] T024 RED→GREEN: Invalid/expired principal on Operator permission endpoint returns 401, not 403; an authenticated Operator without grant still receives 403.
- [x] T025 `go test -count=1 -shuffle=on ./...`, `go test -count=20 -shuffle=on ./internal/session`, `go vet ./...` PASS. DSH session-02 consumer `go test -count=1 ./internal/storeavailability` PASS **only as mock-owner contract test**. Strict locked JS-YAML contract check PASS. `pnpm check:foundation` 190 PASS 2 Unix SKIP, secret markers test 4 PASS. Go session coverage 61.8%, not 80% quality gate.
- [x] T026 Final native Linux PostgreSQL readback including latest SQL constraint, 20 concurrent reads and the strengthened reader checks: **PASS** in restored Lenovo isolated PostgreSQL with native Linux Go test container exit 0; both durable readback markers verified. Earlier evidence was invalidated, now replaced by fresh run.
- [ ] T027 Official Codex Spec Kit full SDD: **BLOCKED**. Shared Git turn held by GPT6_SPEC_KIT_COORDINATOR; current `.codex/config.toml` specifies medium, contrary to explicit requested high; Fast service acceptance not verified. No Codex worker launched to silently replace settings.
- [ ] T028 Real Identity-issued Operator passkey/session, canonical DSH merchant and Store grant journey, real Chrome/Android and WLT/COD/Mixed where affected, protected DB readback, independent product/security reviews: **REVIEW_BLOCKED / NOT_RUN**.
- [ ] T029 Own-file Commit/Push: **BLOCKED** by active coordinator Git turn and three unpushed foreign commits on current branch. No stage, commit, push, merge or deployment.

The scoped implementation is not CLOSED. Local and remote files remain distinct; `specs/` is Git-excluded and these task records are not delivered in Git.

## Phase 3: Canonical session logout — session-03
- [x] T030 Verify latest governing files, new DSH peer claims and original Spec Kit CLI 1.3.0, prerequisites check PASS; no Codex CLI invoked.
- [x] T031 RED→GREEN add DELETE /v1/sessions/current, own SHA256 bearer digest-only authenticated conditional PostgreSQL session revoke, 204/401/503 and no-store; permission path remains read-only.
- [x] T032 Add strict OpenAPI DELETE operation, preserve GET and operator permission contract, update canonical Identity README.
- [x] T033 New unit negative cases: missing, duplicate, invalid bearer, wrong method, unexpected query/body, forged actor header, absent revocation owner. Go tests/vet PASS; 20x focused logout PASS.
- [x] T034 Real isolated bthwani-refoundation PostgreSQL native Linux Go/HTTP test PASS: first logout 204, second 401, independent durable DB readback, 12 concurrent requests exactly one commit, stale/suspended auth version rejects without mutation, unaffected Operator B. Docker runner exit=0. No protected identities or service restarts.
- [x] T035 Foundation: 195 PASS, 0 FAIL, 2 Windows SKIP after correcting README.md case; secret tests 4 PASS, Git diff staged check PASS.
- [x] T036 Only eight Identity files staged under exclusive session03 Git turn, local Commit c9a8b4fb1406cabb28eafd40edb9a5f9801c5898, ordinary branch Push; git ls-remote exact SHA match; Git turn released.
- [ ] T037 Full autonomous Spec Kit SDD workflow BLOCKED by only installed "none" integration; CLI and original prerequisites PASS but not equivalent to official agent phases.
- [ ] T038 Independent security/code review REVIEW_BLOCKED: CodeRabbit CLI 0.9.0 auth status says authenticated, actual review failed Git-provider/session authentication; Sonar Vortex API returned 403 not available. No independently signed-off full journey.
- [ ] T039 Full MANAGED_PARTICIPANT_ADMISSION NOT_CLOSED: original issuer/passkey/recovery/actor standing/grant administration, DSH full protected integration, real login Web/Android and runtime revision alignment, critical security & Sonar quality gates NOT_RUN/REVIEW_BLOCKED. Local runtime was not redeployed.

## Session-03 continuation — owner-backed direct Merchant admission
- [x] T040 EXZA connection PASS, live source branch and peers inspected, 3-agent hard cap retained. Identity source-only claim and peer messages created.
- [x] T041 RED→GREEN first admission test, POST /v1/actors/me/merchant-role with one transaction on Identity actors/roles/sessions; source Customer bearer validated, actual owner verified_at required, new Merchant 256-bit digest-only bearer; no DSH Store rights.
- [x] T042 New isolated additive 003 actor verified_at NULL by default; past 001/002 migrations unchanged. Future-dated proof, missing proof, stale bearer, wrong role, duplicate and suspended role fail closed.
- [x] T043 Actual native Linux Go HTTP -> isolated PostgreSQL -> independent canonical owner readback PASS. Twelve concurrent enrollments exactly one 201/new Merchant session, retries 409, Merchant logout preserves Customer, forged actor headers ignored.
- [x] T044 Go ./... -count=1 -shuffle=on, Go vet and 20x Merchant unit tests PASS. Full isolated Linux Postgres test binary returned EXIT=0 with explicit IDENTITY_VERIFIED_CUSTOMER_MERCHANT_ADMISSION_DURABLE_RACE_PASS marker.
- [x] T045 Identity OpenAPI canonical entrypoint updated with Merchant role endpoint and finite errors; reserved path placeholders remain deliberately unreferenced, no duplicate operation definition.
- [ ] T046 Core initial Customer phone/identity verification, WebAuthn/Passkey, real Operator bootstrap/authorization audit, reliable Merchant session re-entry after unknown submission and full DSH/Web/Android integration NOT_RUN, no production activation.
- [ ] T047 Shared Foundation must pass exact candidate; latest failure originates in peer-owned services/dsh/clients/readme.md lowercase; notified session02, do not overwrite peer.
- [ ] T048 Sonar/CodeRabbit final security and engineering independent reviews remain REVIEW_BLOCKED. Existing Sonar gate FAIL; no external sign-off fabricated.
- [ ] T049 Git: foreign unpublished local commits 6e706c4a root README Spec Kit and eed5d60a session01 prevent ordinary owner-only Push. Stage/Commit only session03 files with exclusive Git turn after testing; Push is BLOCKED until foreign owners have delivered/authorized their commits.
FULL MANAGED_PARTICIPANT_ADMISSION: NOT_CLOSED. Direct Merchant conversion is a bounded tested owner slice, not the original first-factor Identity enrollment.


## Session-03 canonical path-item contract consolidation
- [x] T050 Confirmed all 4 existing admitted Identity HTTP operations in inline root, existing seven legal reserved fragments, and one guard owner (session01). Chose ownership option A; exclusive source paths remain session03, session01 retained tools/governance only.
- [x] T051 Moved exact 4 operation bodies to exactly 3 legal Identity fragments: session.yaml (GET/DELETE current session); managed-enrollment-auth.yaml (POST direct Merchant role); internal-actor-administration.yaml (GET explicit Operator permission). Root now carries 3 local Path Item $refs, no duplicate HTTP definition.
- [x] T052 Rebasing all 18 component $refs within fragments to '../identity.openapi.yaml#/components/...'; kept 4 unrelated Identity reserved groups at paths: {}. Updated contract README to describe linked contract graph.
- [x] T053 Strict byte-exact resolved contract comparison against committed inline OpenAPI passed 3 Path Items/4 methods/18 rebased component links/4 untouched placeholders. Foundation structural PASS. Session01's canonical positive+negative guard suite 4 PASS / 0 FAIL. Identity Go ./... shuffled and vet PASS; git diff --check PASS.
- [ ] T054 Full production / browser credentials / merchant Store grant remains BLOCKED, new Path Item link structure does not itself activate real Identity HTTP or verified sign-in. OpenAPI 3.1 third-party parser NOT_RUN where no approved parser installed; strict lossless and repository guard provide bounded evidence only.

## Session-03 verified Customer Merchant re-entry and atomic session rotation (2026-11-15)
- [x] T055 Verified canonical owner access for re-entry uses ONLY current Customer bearer and separately recorded verified actor proof, same actor active Merchant role. No new role and no Store access.
- [x] T056 POST /v1/actors/me/merchant-session returns one new random digest-only Merchant bearer, atomically revoking all earlier Merchant sessions for the actor without invalidating Customer or unrelated actors. Missing/suspended role, future verification and stale/wrong-role headers fail closed.
- [x] T057 SQL revoked_at uses clock_timestamp() instead of transaction-start CURRENT_TIMESTAMP: first real native PostgreSQL 12-way rotation test FAILED (503) because an earlier transaction clock could predate a newly issued session and violate CHECK(revoked_at>=issued_at); corrected to statement-time database clock and retested. Evidence: native isolated Docker + independent readback IDENTITY_MERCHANT_SESSION_ROTATION_DURABLE_RACE_PASS, 12 simultaneous re-entry requests leave exactly one current Merchant bearer; source Customer still works. Security failures did not convert to 2xx.
- [x] T058 Existing 4 HTTP operations preserved; new fifth POST operation is in same canonical managed-enrollment-auth Path Item fragment with root local ref; YAML strict parsing and 23 canonical component refs PASS; no server/CORS credential sharing.
- [x] T059 Go ./... shuffled, repeated focused Merchant tests, vet PASS; repo foundation structure, contract guard targeted 4/4 and tracked secrets 4/4 PASS.
- [ ] T060 Real initial Customer verification/login, Operator Passkey/Root Owner, protected DSH Store grant, full apps E2E and independent risk/CI/Sonar gates still NOT_CLOSED. No real tokens or historic database migrations touched.
