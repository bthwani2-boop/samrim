# CUSTOMER_STORE_CATALOG — Close as You Go evidence (session-01)

STATUS: IN_PROGRESS — NOT CLOSED
DATE: 2026-11-14
BRANCH: refoundation/clean-house-20261112
SEMANTIC_OWNERS: governance/stores.md + governance/catalog.md
WRITE_OWNERS: services/dsh (Store, Offer, public projection), apps/customer (public presentation)
COORDINATION: agent-02 exclusively owns STORE_OPERATIONAL_AVAILABILITY and the 002 additive operational migration; no duplicate operational writer in discovery schema.

## Implemented source
- DSH Go REST: GET /health, /v1/public/stores, /v1/public/stores/{id}, /v1/public/stores/{id}/offers with query-time Store/city/vertical/publication/relation and Offer/Product/Variant/stock/positive-YER eligibility.
- Exact schema-owned PostgreSQL Store, Product, Variant, StoreOffer and monotonic public revision; isolated migration and synthetic owner command available only under explicit dsh_test_* schema/test mode.
- Bounded id-scoped pagination with revision invalidation, 400/404/409/503, read-only HTTP, public allowlists and safe denied state.
- Canonical Store operational status is not written or stored by discovery. Until admitted fulfillment/payment/method state exists, orderability is OPERATIONALLY_UNAVAILABLE; agent-02 owns later derived operational facts.
- Customer Expo routes /stores and /store/[id], Arabic RTL, theme tokens, Store and Offer public reads via typed DSH transport, stale request cancellation/generation, empty/error/retry, truthful unavailable checkout. Customer root now links /stores; commit 5359efe3 and later updates.

## Evidence, scoped strictly to current implementation
- PASS: Go integration tests against isolated PostgreSQL on a fresh dsh_test_agent01_final schema with current 001 migration, synthetic owner fixtures, final Go test binary, Docker test exit code 0.
- PASS: DSH live HTTP from Surface through SSH local 127.0.0.1:3202 into the isolated Lenovo Docker network; genuine PostgreSQL-backed Sanaa marketplace Stores and eligible Offers read and negative method/CORS cases verified. Docker host is remote, so old localhost forwarding failure was resolved without restarting shared runtime.
- PASS: Customer Expo TypeScript typecheck and DSH client TypeScript typecheck on current source.
- PASS: Go package compilation including peer-owned storeavailability module.
- PASS: full Foundation (191 tests, 189 PASS, 0 FAIL, 2 Windows-skipped), app boundary checks and DSH TypeScript. Added independent per-operation OpenAPI negative cases and addressed Sonar-reported Compose sorting BUGs.
- PASS: installed Spec Kit CLI 1.3.0 specify check. Original spec.md/plan.md/tasks.md retained, no feature branch created.
- PASS: real browser Web home -> /stores -> /store/market-sanaa -> genuine DSH Offers; city change, empty, invalid input and retry. Expo export --platform all generated Web, Android and iOS JavaScript bundles successfully. Native iOS NOT_RUN.
- PASS: Samsung SM-S9280 real Android com.bthwani.client via Surface Metro :3102 and adb reverse :3202; Maestro 9/9 Store/Offer assertions and stale-item exclusion. Native iOS NOT_RUN; existing Lenovo-managed mirror at source 3b2f744 differs from candidate HEAD 8cd87589, and cannot be called aligned.
- NOT_RUN: effective Identity and Merchant/Operator Store authorization, current WLT agreement, cart/checkout and publish/revoke across real accepted Store sources.
- PASS: 8 targeted DSH TypeScript transport boundary tests, real Node coverage LCOV files=14 and measured 95.1% of instrumented lines at SHA 8cd87589; separate owner-backed PostgreSQL tests were previously PASS on unchanged DSH source. NOT_RUN: generated-client parity, critical Identity/WLT/checkout authorization and final independent complete review. The last observed Sonar Quality Gate failed on earlier SHA; latest SHA is not thereby cleared.

## Release / closure gates
Both (1) business behavior/integration and (2) engineering/security quality are not fully accepted. Guest discovery and owner query are genuine isolated-development slices, not a production-ready marketplace. Never mark CLOSED while browser/Android, final contract gate and full acceptance remain unproven. Commits and Push require exclusive Git turn, independent diff review and verification of local/remote SHA. No merge/PR/deploy.

## 2026-11-14 follow-up evidence at SHA 8a439fb404c794099af0edd86fe77cb5bfcbc243
- PASS: `specify --version` and `specify check`; original CLI 1.3.0 artifacts/workflow composition inspected. Existing SDD prerequisite script `check-prerequisites.ps1 -Json -RequireSpec -RequireTasks -IncludeTasks` passed using SPECIFY_FEATURE_DIRECTORY pointing at this same spec. No branch, parallel spec or Codex CLI created.
- PASS: governance owner guard refactored with bounded operation parsing; negative security/duplicate-ID tests PASS. Full Foundation 191 tests: 189 PASS, 0 FAIL, 2 Windows-skipped. Three true Sonar BUGs on Compose sorting fixed; latest Sonar reliability rating now A.
- PASS: eight tests of public DSH TypeScript transport safety; `pnpm check:coverage` produced real LCOV 95.1% of instrumented Node-source lines and included DSH client. Sonar separate new-code coverage 69.6% remains FAIL against 80%.
- PASS: three Go unit tests on the DSH discovery boundary reject malicious SQL schema identifiers, forged Store path IDs and cross-Store/cross-resource/stale pagination cursors. `go test`, vet and independent git SHA readback PASS.
- PASS: SHA 8a439fb404c794099af0edd86fe77cb5bfcbc243 local+remote identical after Push. Git turn released. Concurrent, unrelated `infra/**` modifications were left untouched and unstaged.
- BLOCKED: external Sonar Quality Gate fails new-security rating C with 15 dynamic SQL review findings (some peer-owned) and new-code coverage under threshold. Earlier SHA 8cd87589 CI PASS; new SHA CI verdict not yet attested.
- BLOCKED: Lenovo-managed mirror stays at 3b2f744 despite its four processes, SSH tunnels and existing Chrome CDP tabs being alive. Existing browser customer tab therefore does not show currently committed /stores root link. No shared Lenovo process or server was restarted.
- NOT_RUN: Identity real sessions, Merchant/Operator grants/revocation, DSH checkout/WLT revalidation, actual iOS device, final independent security review. No CLOSED or production claim.


## 2026-11-15 — Spec Kit direct remote execution (Remote Arc, Surface)
- REQUEST: Run full Spec Kit SDD cycle for existing 001-customer-store-discovery in D:\\samrim-refoundation-clean-20261112, without new branch/worktree, Codex CLI or modification of peer-owned files.
- PASS: `specify --version` = 1.3.0; `specify check` = ready; installed Full SDD Cycle `speckit` v1.0.1 confirmed, six steps (specify / review-spec / plan / review-plan / tasks / implement).
- FAIL/BLOCKED: actual `specify workflow run speckit -i spec=... -i integration=none --json`, run ID `1cb6a4b6`, status `failed` at first `specify` dispatch because installed integration `none` is shared scaffolding and does not support CLI command dispatch. `specify workflow status 1cb6a4b6 --json` confirmed failure. No automated specification/planning/implementation executed by that workflow, and no coding agent was launched. Do not describe as complete SDD cycle.
- PASS: built-in PowerShell `check-prerequisites.ps1 -Json -RequireSpec -RequireTasks -IncludeTasks` with existing feature directory; `setup-plan.ps1 -Json` reused plan.md without replacement; `setup-tasks.ps1 -Json` resolved the tasks template without generating competing tasks. The script's output `BRANCH=001-customer-store-discovery` is a Spec Kit feature label, not the Git branch.
- PASS: on Git HEAD `7bd86529a4fb524d34a42115d0a2ad2ca1252a33`, DSH TypeScript typecheck, Customer TypeScript typecheck, Go discovery unit tests and vet; full Foundation 191 tests: 189 PASS, 0 FAIL, 2 platform SKIP. `pnpm run check:coverage`: real instrumented Node LCOV files=14, hit=2456/2582, 95.1% (not comparable to external Sonar new-code coverage). All these process exit codes 0.
- CURRENT SOURCE: `services/dsh/contracts/openapi/dsh.openapi.yaml` already contains four executable public-read operations. Feature group reservation fragments `paths/{customer-discovery,stores,offers}.yaml` remain empty intentionally; earlier plan text describing no OpenAPI operations or service is historical, not current.
- CONCURRENCY: peer-owned infra commit `7bd86529a` arrived while running checks; no foreign infra file staged or edited. Spec Kit CLI created only untracked `.specify/workflows/runs/` run data and local ignored specification evidence. Main branch `41` read-only, no branch/worktree/PR, push, merge, deployment, Codex CLI or Lenovo process restart.
- REMAINING: full native workflow BLOCKED on integration; real authenticated Identity/Operator grants, final orderability/checkout/WLT cross-owner acceptance, native iOS and independent security/release review remain NOT_RUN or REVIEW_BLOCKED. Do not mark this feature CLOSED.

## 2026-11-15 — Transaction-scoped discovery SQL follow-up, commit 5730002c
- Applied only to three DSH discovery files: static bound query text, validated transaction-scoped PostgreSQL search_path, and new pool reuse/cross-schema isolation regression test. Owner remains DSH. No Identity/WLT or Storeavailability source modified by agent01.
- PASS real PostgreSQL Go tests in existing isolated dsh_test_agent01_current_20261114 schema: 7 tests passed, including canonical Store visibility/Offer pricing, 20 concurrent reads, invalid IDs/cursors and search_path reset. Local Go test/vet, gofmt, Foundation structural guard, diff check PASS. Commit and Push exactly matched 5730002cbbb5d55399899e6468c7346cae9796a6; git-turn release confirmed.
- Native user journey: Samsung client Maestro 9/9 PASS on existing app against synthetic DSH; Web Lenovo still pinned to older source mirror 3b2f744, while app and DSH ports respond. Separate current Expo Metro :3101 not listening. Native iOS NOT_RUN.
- GitHub CI run 43646375924 IN_PROGRESS at read; Sonar 43646375831 FAIL. Sonar PR gate security C and new-code coverage 68.3% (<80%), reliability/maintainability A. http.go S2077 resolved, migration SQL S2077 owner.go:56 remains for independent review.
- Spec Kit 1.3.0 prerequisites/setup-plan/setup-tasks and safe feature dry-run PASS; actual Full SDD Cycle 1cb6a4b6 still FAIL at first dispatch: installed integration none cannot run agent commands. Full Specify/Clarify/Plan/Tasks/Analyze/Implement/Converge autonomous cycle NOT COMPLETED. No Codex CLI executed because requested model/profile not verifiable. Not CLOSED.
