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

## Completion policy

- **Developer Spec Kit template workflow** is compatible with progressive development of existing and newly proposed Product scope; it does not prove any business route works or admit production.
- **Governance READY** is a reviewed *policy-source* gate, not a financial/API/mobile runtime PASS.
- **Service, SQL, native and release acceptance** each require direct evidence and remain `NOT_RUN` until performed on the actual approved revision.
