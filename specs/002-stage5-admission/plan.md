# Implementation Plan: Stage-5 Governance and Developer Admission

**Worktree branch:** `refoundation/clean-house-20261112` (reused; **no feature branch created**)
**Spec:** [spec.md](spec.md) | **Status:** DRAFT / PROGRESSIVE_DEVELOPMENT_ENABLED / GLOBAL_GOVERNANCE_NOT_READY | **Date:** 2026-11-14

## Summary

Use the installed Spec Kit tooling as the workflow for a **bounded, executable readiness decision** rather than maintaining another historical inventory. All existing and newly proposed capabilities are authorized for progressive analysis and implementation; whole-platform governance reconciliation remains separate from executable Identity/DSH/WLT code, SQL and native app acceptance. This feature makes those handoffs reviewable without activating commercial behavior.

## Technical context

- **Pinned host:** Windows 11; Node 24.22.1, pnpm 12.15.0, Go 1.27.3, Spec Kit 1.3.0, TypeScript 7.0.2, Biome 2.5.12.
- **Existing workspace:** Next.js Operator and Expo Customer/Merchant/Captain presentation hosts; shared semantic colors and Tamagui adapter; three private service-client placeholders.
- **Sources of authority:** `AGENTS.md`, `REPOSITORY-STRUCTURE.md`, `governance/README.md`, the 14 owner docs. The canonical domain owners govern meaning; `docs/journeys/` holds bounded integration evidence, and `docs/reference/` is historical provenance only.
- **No database changes:** the currently running `samrim-local` Docker containers belong to another runtime; do not reuse, restart, drop or migrate. First new SQL tests require separately scoped isolated PostgreSQL with roles, schema ownership and restore.
- **No web/business operations:** identity/auth, finance, Order/COD and data migration remain gated until approved contracts and internal adverse tests.
- **Test entrypoints:** `specify --version`, `specify check`, `specify workflow list`, bundled PowerShell prerequisite scripts; `pnpm check` and targeted owner tests after corresponding changes.
- **Performance:** no invented SLA or device-FPS PASS; measure native/web performance on actual candidate before selecting a renderer.

## Constitution and ownership check

1. **PASS (workflow source):** This plan does not create a new business owner, API/DTO catalog, service, SQL schema or policy.
2. **PASS (branch authorization):** Continue on existing `refoundation/clean-house-20261112`; donor `41` read-only; Spec Kit official scripts run with `SPECIFY_FEATURE_NO_PERSIST=1`; no new branch/PR/worktree.
3. **IN_PROGRESS (full governance reconciliation, not a development stop):** `governance/README.md` is still `NOT_READY`. The human-approved 2026-11-13 policy targets must be reconciled with the significant donor source/acceptance gaps; do not present the cutover as already achieved.
4. **NOT_RUN (business proof):** No new Go owner services, executable OpenAPI, fresh or upgrade SQL, authorization E2E, wallet/concurrency checks or signed native builds are yet proven by this feature. They are **separate** acceptance gates.

## Workflow and implementation

### Phase 0 — Prove unambiguous inputs (source review, no policy mutation)

1. Pin the candidate branch, SHA, status and active file/Git owners. Pin donor 41 blob/line evidence without writing there.
2. Read 14 canonical owner documents and the Product/Journey census. Cross-map all material historic obligations and latest human choices; allow `REVIEW_BLOCKED` for genuinely missing decisions.
3. For the seven FIN/SEC/MIG/LEGAL topics, enumerate risk assumptions, denial/negative conditions and evidence needed for later activation; apply only the human-approved policies without fictitious signatures.

### Phase 1 — Reconcile journey semantics and verify developer workflow

1. Close material owner-to-source meaning and duplicated-engine conflicts in **canonical** `governance/` files; tests must reject negative policy/census counterexamples. Preserve old records and historical legal liabilities.
2. Run Spec Kit exact local CLI, existing branch, no-persist feature and prerequisites. Do not use `specify init`, vendor-upgrade or an agent-specific CLI.
3. Verify TypeScript/Web/Android design and security foundation with appropriate affected tests. Mobile renderer/SQL topology choices remain open where real device/role tests are absent.
4. Continue remaining full-platform governance reconciliation in parallel, separately from admitted development; reserve final cutover for exact human review of the complete scope. Do **not** mix policy documents with first financial/SQL implementation.

### Phase 2 — Start the first existing-capability vertical business journey

1. Use the existing Spec Kit customer-store-discovery feature and relevant Product+owner semantics; reconcile affected source details during the journey, not the whole donor OpenAPI inventory first.
2. After adapting the stage-aware verifier, author **real** OpenAPI operations with operationId, schema, auth, negative error codes, version and retry rules at the correct owner; select generated consumer when justified.
3. Build corresponding Go/SQL fresh scope **in an isolated environment** and real UI consumer. Prove two account/Store denial, owner persistence, deployment-specific SSR/RTL and failure/retry. Review owner tests and do not merge or deploy without separate authorization.
4. Extend to Order, WLT and dispatch only after per-stage idempotency, ledger, unknown-outcome and privacy proof.

## Concrete paths — no parallel truth store

```text
governance/                 # only normative Product/domain authority
.specify/                   # pinned vendor workflow files (unchanged)
specs/002-stage5-admission/ # derived executable admission specification (this feature)
services/identity/          # future owner-backed API + data after cutover
services/dsh/
services/wlt/
apps/customer/              # presentation only
apps/merchant/
apps/captain/
apps/control-panel/
```

## Delivery and gate criteria

- Each owner uses a separate exclusive file scope. Shared index controlled with one `GIT-TURN` claim, check foreign staged changes, exact diff and UTF-8, test the slice and local Commit. Push is a distinct operation requiring explicit human authorization and subsequent SHA readback. Do not combine other agents' changes.
- Mark `PASS` only for executed checks on exact revision and environment, `REVIEW_BLOCKED` for missing material policy/assurance, `NOT_RUN` for unbuilt backend/native/SQL. Never update cutover or promote Stage5 silently.
- No project-wide “100%” conclusion from the existence of this plan or a structural `pnpm check`.
