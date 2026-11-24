# Tasks: Stage-5 Governance and Developer Admission

**Feature source:** [spec.md](spec.md) | **Plan:** [plan.md](plan.md) | **Status:** OPEN — development enabled for existing and proposed capabilities; global cutover and runtime verification remain open.

**Rule:** Each checkbox closes only with source/owner/negative-test evidence at a stated exact Git SHA. Do not mark a documentary row as functioning business code. `[P]` means separate owner/file and no shared Git index operation.

## Phase 1 — Acceptance foundation on the existing branch

- [x] T001 [US2] Verify pinned `specify 1.3.0`, `specify check`, `specify workflow list` and the official no-branch/no-persist feature generation path; preserve current refoundation branch and no `.specify/feature.json` changes.
- [x] T002 [US2] Verify final `spec.md` + `plan.md` + `tasks.md` with `.specify/scripts/powershell/check-prerequisites.ps1 -RequireSpec -RequireTasks -IncludeTasks -Json`, frozen after final content review.
- [x] T003 [US2] Commit **only these three** `specs/002-stage5-admission/` files under exclusive GIT-TURN with no other author's staged content. Push needs separate explicit authorization and remote SHA readback if performed.

## Phase 2 — Human-approved Product semantics, not mere heading inventories

- [ ] T004 [US1] [P] Reconcile still-open donor material clauses (current source census reports 227 `REVIEW_PENDING`) by exact source blob/line, substantive target owner section, retained/superseded rule, and adverse/exception behavior; keep genuinely unresolved ones `REVIEW_BLOCKED` rather than “copy completed” in `governance/`.
- [ ] T005 [US1] [P] Verify 26 distinct capability IDs once in `governance/product.md` owner map, 16 meaningful owner-linked journeys in `governance/journeys.md`; prove no missing material subfeature, orphaned authority or duplicate writer.
- [ ] T006 [US1] Reconcile FIN-01/02/03, SEC-01/02, MIG-01 and LEGAL-01 approved 2026-11-13 target choices with canonical owner texts and internal adverse threat/financial/migration/legal analysis; do not invent external reviews or claim actual ledger/balance/SQL restored.
- [ ] T007 [US1] Validate genuine design/accessibility state of common mobile presentation choices, operator Next.js RTL/CSP and Web; compare native renderer with controlled device evidence before selecting a winner and document untested iOS as `NOT_RUN`.
- [ ] T008 [US1] Review PostgreSQL logical ownership and topology against real donor DB cross-owner read consumers; specify role-denial, search_path, RLS limits, fresh/upgrade/restore, WLT invariants and prove them in a **separately authorized isolated environment** before any data cutover.
- [ ] T009 [US1] Run exact affected positive/adversarial governance and security tests after the semantic changes; present unresolved evidence with named owners to the human Product owner for exact revision approval.
- [ ] T010 [US1] Only after T004–T009 are accepted, review a **separate** `governance/README.md` cutover diff from `NOT_READY` to `READY` and publish the approved policy SHA. Do not include live financial, user or database writes in this cutover.

## Phase 3 — First business implementation concurrently with bounded policy reconciliation

- [ ] T011 [US3] Reuse `specs/001-customer-store-discovery/` and refine its Store/Identity discovery semantics with caller/resource authority, inputs/outputs, error/retry, negative cases and owner readback acceptance. No duplicate feature specification.
- [ ] T012 [US3] Deliver the first real owned API, minimal fresh SQL and scoped app consumer after the progressive stage-aware guard and synthetic isolation are proven; **do not wait for whole-platform governance cutover**. Test denied second actor/Store, published-only visibility, interrupted requests and persisted owner readback.
- [ ] T013 [US3] For money/Order/COD/Mixed/dispatch, separately prove one effect per idempotency key, double-entry conservation, concurrent acceptance, unknown outcome recovery, protected address visibility and isolated database backup/restore before release.
- [ ] T014 [US3] Validate exact signed native application/install, Google/Firebase/EAS credentials from authorized provider owners, real Android access, and iOS only when tested; keep production release/PR/merge behind separate human authorization.

## Remaining evidence handoff — architectural audit retirement (2026-11-23)

This is implementation work in the existing Spec Kit task set, **not** a second capability registry or a new Product/governance authority. Earlier audit statuses and numeric operation counts are historical; each criterion must be re-proven against its affected branch, SHA and owner. Do not mark an item complete from these handoff notes alone.

- [ ] **T015 [US2] Structural drift and cohesion:** use the existing `REPOSITORY-STRUCTURE.md`, `tools/dev/source-inventory.mjs --review`, `verify-workspace.test.mjs` and `verify-application-boundaries.test.mjs` to classify actual placement, naming, generic-directory and oversized authored-code candidates as KEEP, MERGE, REFACTOR or JUSTIFIED_EXCEPTION. Trace consumers and dynamic routes before any move. Prove a legal/illegal fixture for each newly enforced placement restriction; do not impose file-length quotas or delete on Knip signals.
- [ ] **T016 [US2] Contract and transport proof:** after owner changes, verify normalized OpenAPI method/path/security/status/error/schema against generated owner SDK requests, concrete Go HTTP wire behavior, permissions and active consumers. `pnpm check:contracts` currently reports `fullGeneratedClientParity=NOT_RUN`; its structural success cannot close this task. Track the affected Identity/DSH/WLT proof with their own tests and current generated contracts, including unknown-commit POST, readback and idempotent retry cases.
- [ ] **T017 [US3] Connected acceptance:** continue Identity session, Store/Order, Captain dispatch and WLT collection/settlement work **only at their original owners**: `specs/004-identity-session-verification/`, `specs/003-store-orderability/`, `governance/commerce.md`, `governance/fulfillment.md`, `governance/finance.md`, relevant service OpenAPI/Go/SQL and the real Customer/Merchant/Captain/Operator tests. Complete the affected Web/Android, cross-actor/Store IDOR, revocation, concurrency, durable owner readback and CI/review at matching revisions before claiming any cross-owner journey closed; the existing T013/T014 acceptance remains applicable.
- [ ] **T018 [US2] External artifact safety:** keep external work logs, dumps, backups and historical plans outside the runtime/source/contract graph. Prior to any broad artifact cleanup, identify sensitive or protected content, current consumers, ACL/retention and verified restore/rollback needs and obtain separate authorization. The specifically authorized retirement of one reviewed duplicate plan is **not** approval to delete other evidence or shared files.

**Handoff routing of the 76 historical audit entries:** STR → T015 and the existing placement guards; ID → Identity owner / `specs/004`; DSH → DSH owner / `specs/003` and the commerce/fulfillment owners; WLT → WLT and finance owner / T013; APP → affected surface tests / T014; INT → T016 and owner contract/SQL checks; SEC → `governance/safety.md` and affected negative tests; INFRA → `infra/README.md`, existing isolated runner and T014; QUALITY → existing GitHub CI/Nx/security/review checks and T015–T016; ART → T018. An existing passing scoped test is retained, but no historical checkbox is promoted to final PASS without compatible runtime evidence.

## Completion policy

- **Developer Spec Kit template workflow** is compatible with progressive development of existing and newly proposed Product scope; it does not prove any business route works or admit production.
- **Governance READY** is a reviewed *policy-source* gate, not a financial/API/mobile runtime PASS.
- **Service, SQL, native and release acceptance** each require direct evidence and remain `NOT_RUN` until performed on the actual approved revision.

- [x] T017-WLT-RESERVATION (BTH-17, isolated owner foundation): exact-YER WALLET/MIXED reservation from posted customer funding, immutable release, actor-bound checkout payload, per-actor serialization, insufficient balance rejection and prevention of reversal while reserved. Existing reader/sandbox roles have no reservation writer authority. Fresh PostgreSQL + real Identity wallet suite and separate pg_dump/restore proof passed. No payable quote, effective agreement, authenticated DSH command, Order creation, capture/refund or runtime activation yet; parent T017 remains open.

- [x] T017-WLT-AGREEMENT-DECISIONS (BTH-12, isolated owner foundation; PostgreSQL and restore PASS): immutable version-bound Merchant consent/decline and distinct Finance review of the exact latest proposal, once-only operation identity, reject stale/conflicting/self-approval and reader access. Review is not effective activation, billing or checkout authorization; current Identity and DSH authorization must be wired and verified before any public command.

- [x] T018-WLT-AVAILABLE-FUNDING (BTH-17): one owner projection of exact posted and unreserved YER, actor-scoped WLT read with current Identity before/after, generated contract/SDK, Customer checkout review and Web/Native wallet read models; isolated PostgreSQL hold/release/revocation/restore and Customer tests PASS. This is not an authorization to create Orders, debit or activate payment. Browser/device/runtime acceptance remains open.

- [x] T018-WLT-PAYMENT-ALLOCATION (BTH-17, isolated owner foundation): replace the wallet-only reservation record with one immutable COD/WALLET/MIXED allocation and derived exact cash remainder; reserve only positive wallet funding and release the same checkout identity without posting money. RED/GREEN on real disposable PostgreSQL, Identity revocation, concurrent insufficient funding, cross-actor/method/amount conflict, exact-YER preservation, read-only runtime privilege and pg_dump/restore all verified. No authenticated payable quote, effective agreement, actual Order, cash custody or capture authority; parent journey remains open.
