# BThwani — Historical implementation and source-review checkpoints (2026-11-12 to 2026-11-17)

ARTIFACT_CLASS: NON_NORMATIVE_HISTORICAL_EXECUTION_RECORD
BUSINESS_POLICY_AUTHORITY: NONE
IMPLEMENTATION_STATE_AUTHORITY: NONE
ORIGINAL_PLAN_PATH: docs/REFOUNDATION-PLAN.md
ORIGINAL_COMMIT: df93324ee4669869beec1c0ee3f91924662011d6
ARCHIVED_ON: 2026-11-18

This file preserves the exact date-scoped checkpoint narratives moved out of the active plan. Original claims and SHAs below are **historical**, not the current branch, current environment, current protected state, an authorization to operate or a claim of implemented functionality. The only active execution plan remains at [docs/REFOUNDATION-PLAN.md](../REFOUNDATION-PLAN.md); approved Product/domain decisions live only in the 14 canonical owners in [governance](../../governance/README.md). The complete pre-cleanup plan is preserved immutably in Git at the ORIGINAL_COMMIT above.

The four preserved groups below are ordered according to their former position in the plan, not their event dates. They have not been revised as new decisions or endorsed as present-tense evidence.

---

## 2026-11-17 — Historical execution snapshot and acceptance register (SUPERSEDED_ON_2026-11-18)

**Historical register superseded by the 2026-11-18 active journey section above.** Older counts, SHAs, donor instructions and earlier evidence remain provenance only, never proof on a newly changed HEAD or permission to block unrelated safe development. Current execution law remains AGENTS.md, placement remains REPOSITORY-STRUCTURE.md, and business decisions remain in the 14 named governance owners. This plan never becomes another owner.

- **Baseline inspected:** D:\samrim, foundation, ee833ff6ff3e43809155c75550ae2932e70fb70b, local branch one commit ahead of origin/foundation. Exactly one worktree was reported. Read the live HEAD and worktrees again before further changes.
- **Concurrent writer boundary:** services/identity/clients/index.ts was already modified before this tools batch and is **not part of it**. Do not stage, overwrite, format or attribute it to environment work. A future uncommitted or changed diff invalidates older package/CI/test results.
- **Source census:** Customer 50, Captain 31, Merchant 31, Operator 18 tracked files as inspected at baseline; Identity 41, DSH 64, WLT 23. These are NOT feature-completion ratios and will change with development.
- **Tool source (2026-11-17 cross-channel evidence):** Remote Arc runs `pnpm check:toolchain` with Node 24.22.1 and Go 1.27.4 (PASS). MA Commander without a per-command PATH used its internal Node 24.19.0 (FAIL); MA with a process-only PATH pointing at `C:\Program Files\nodejs`, `C:\Program Files\Go\bin` and required Windows/npm/Git paths passed the exact guard (PASS). This is a proven per-command workaround, **not a durable MA setting fix**. Never accept Node 24.19.0 or claim P0-02 closed without default-runner/IDE/CI proof.
- **Spec Kit:** CLI 1.3.0 invoked at this checkout and task-relevant .specify/ constitution and ignored specs/003-store-orderability/spec.md reviewed. All real repo engineering requires native CLI plus relevant task context; created specification files are optional derived artifacts, never business rules or branch authority.
- **Graphify:** real task-related query completed for bthwani2-boop/samrim, but index ccce4247e3bffe1b603ae26f8dd176a80d123753 is stale versus current HEAD and dirty changes. Gate INVALIDATED until official indexing matches the accepted candidate; no parallel indexing engine or implied approval.
- **Architecture decision:** One pnpm/Nx workspace; Customer, Captain, Merchant are Expo presentation hosts (Merchant includes Expo Web), and control-panel is the Next.js Operator host. Identity owns actors/session, DSH owns Store/catalog/order/fulfillment, WLT owns money/ledger. Use merchant for new features; partner is confined to proven historical compatibility IDs/links pending explicit migration. Store is not the Merchant actor.
- **Stage separation:** ENVIRONMENT_BASELINE_ACCEPTED requires its environment G01-G20 acceptance evidence; JOURNEY_CLOSED separately requires actual owner-backed end-to-end criteria; PRODUCTION_READY requires protected delivery/review/operational gates. GOVERNANCE_CUTOVER NOT_READY is not a prohibition on independent progressive development. No 100% correctness or product readiness claim from folders or local static tests.

### P0 — One active register for the 27 environment requirements

A partial local PASS means only that bounded check passed. Unless every acceptance criterion for the P0 row is evidenced on the final candidate, its **closure remains NOT_RUN or REVIEW_BLOCKED**.

| ID | Current evidence / status (2026-11-17) | Remaining acceptance |
| --- | --- | --- |
| P0-01 | NOT_RUN final; baseline Git/worktree inspected, separate Identity writer | Recheck live concurrent writers, clean staged diff, owner and exact candidate SHA |
| P0-02 | PASS scoped: unmodified MA default node --version now v24.22.1; pinned Go 1.27.4 and exact toolchain guard PASS on source host | Verify IDE/Metro/Lenovo other command channels; no global PATH or protected service configuration change authorized |
| P0-03 | PARTIAL: exact local toolchain check PASS Node 24.22.1, Go 1.27.4, pnpm 12.15.0, TypeScript 7.0.2; frozen lock tracked | Independent clean pinned Git installation, all app workspace manifests and cold-cache recovery proof still required |
| P0-04 | PARTIAL: session-04 confirmed strict SSH, four task-backed tunnels/Metro status and Next health on Surface; Lenovo DHCP remains .101 versus intended reservation .102 and Expo Web root timed out | Verify router DHCP reservation and Web/device recovery without affecting protected services |
| P0-05 | PARTIAL: GitHub clean Linux checkout frozen pnpm install PASS in 1e6ed904 CI Presentation (source tests/coverage also passed); separate Windows detached local clone a35bd65 verified four apps and clean Git but offline install timed out at 240s; scratch cleanup WinError 5 | Diagnose bounded Windows pnpm/pack-file retention with approved owner; no cleanup ACL bypass or claim of Windows bootstrap success; revalidate exact final SHA |
| P0-06 | PASS scoped: actual Nx affected regression suite 10/10 on 2026-11-17, including newly added OpenAPI, SQL and Merchant Feature, contract consumers and shell-input safety | Validate graph task cache input hash on independent clean checkout and repeat Linux CI with final immutable SHA |
| P0-07 | PARTIAL: Next typecheck output boundary fixture PASS | Cache inputs/outputs, real base, no false reuse on target change |
| P0-08 | PASS scoped local admission: before repair 20/27 tracked Node tests ran; new workspace-wide discovery includes all 27 and six regression tests cover untracked apps/tools/infra/packages and unsupported formats | Actual source coverage/full CI on final SHA, including deliberate failure injection, pending Identity writer reconciliation |
| P0-09 | PARTIAL: OpenAPI path/ref/security and operation negative tests PASS locally, no generated-client parity | Confirm real Go/HTTP/client contract parity and authorization on final SHA |
| P0-10 | PARTIAL: bounded Identity session/Merchant HTTP client committed in ec35fe994, 10/10 negative/positive tests and TypeScript PASS; DSH public client already verified separately | Real Go/HTTP/TS integration, app credential lifecycle, permissions/IDOR and transport recovery must pass at owner boundary before closure; no first-factor or Store grant implemented |
| P0-11 | PASS local: Nx invoked by process.execPath without shell, 10/10 affected/argument fixtures | Confirm CI/Linux on final revision |
| P0-12 | PASS scoped local: 35e745753 introduced 33 .gitkeep markers rejected by canonical Foundation guard; removed only these markers in 1e6ed904 and reran pnpm check:foundation PASS 219/219, 2 skipped; no business files touched | Repeat required exact-SHA Linux CI and confirm no new service placeholder regressions; full Product and security reviews independent |
| P0-13 | PARTIAL: actual GitHub CI push run 43985893083 for ca3bdf96 passed Foundation, Presentation and fast-guard; CI branch patterns were regression-tested | Validate required PR checks and protected main branch/CodeQL/Sonar behavior on final candidate, including skipped-check fail-closed cases |
| P0-14 | PARTIAL: session-03 Chrome JavaScript/RTL 8/8 on existing SSR builds and Operator HTTP/CSP checks PASS; no real Operator authz | Rebuild exact current source and test 401/403 and recovery using Identity-owned sessions |
| P0-15 | PARTIAL: CI Presentation at ca3bdf96 exported Customer/Merchant Expo Web, Customer/Merchant/Captain Android JavaScript and built Operator Next.js | Actual Android and iOS binaries, user/device E2E/deep links/RTL, live browser auth and interrupted-session recovery NOT_RUN |
| P0-16 | FAIL actual runtime: direct Docker readback DSH container healthy with matching image ID sha256:70cd3195 but image revision 8a439fb, ancestor with changed owner implementation up to local source; Identity container Exited (255). Session-04 runtime cutover safety gate DENIED | Authorized runtime owner must verify safe source-to-image cutover and recovery; do not restart protected services, bypass DENIED or present running DSH as current-source PASS |
| P0-17 | PARTIAL: GitHub Go Quality run 43990345535 on 1e6ed904 PASS Linux race/Go coverage and isolated Identity/DSH Docker image build with non-root user/source SHA/binary check | Isolated Compose boot/readback/rollback and current-running image equivalence still NOT_RUN, WLT has no executable owner |
| P0-18 | PASS scoped isolated: at 3e056f7, five DSH PostgreSQL migrations freshly applied to network-disabled, portless, tmpfs-only disposable DB; reader SELECT PASS and INSERT denied SQLSTATE 42501 | Protected/existing DB roles, all service owners including WLT, upgrade parity and production access are NOT_RUN |
| P0-19 | PASS scoped isolated: at 3e056f7, synthetic pg_dump/pg_restore fingerprint 14:147:1 matched and exact-owned container was removed (zero matching docker ps -a) | Protected upgrade, backup/restore of existing durable DB, rollback under live state and WLT are NOT_RUN |
| P0-20 | PASS scoped prior owner integration: session-02 at d469b3ff ran real Go Identity + DSH + isolated PostgreSQL verifying revoked sessions, Merchant admission and no implicit DSH Store grant; Go/SQL source unchanged at 3e056f7 | First-factor login, real UI session recovery, live protected actor lifecycle and independent critical-risk review remain NOT_RUN |
| P0-21 | PASS scoped prior owner integration: session-02 at d469b3ff verified DSH version/idempotency/audit readback (version 8, audits 7), city policy concurrency (16 attempts, version 4, audits 4), and real owner POST/GET | Whole checkout/dispatch/COD, broader financial consistency, production ownership and concurrent real data are NOT_RUN |
| P0-22 | PARTIAL: tracked-secret guard and tests PASS in local pnpm check and ca3bdf96 CI fast-guard | Provider credentials, secret rotation, secure runtime logging and full security scans on current release candidate still NOT_RUN |
| P0-23 | PARTIAL: local structural Foundation PASS after c5b638aa Captain cleanup, Captain route/access/dispatch 7/7 PASS, TypeScript and Expo Android JS export PASS; local live Knip still reports 27 peer Merchant/Operator WIP files, and source coverage fails Operator root/naming scanner | Complete Merchant/Operator actual consumer routing without fake imports, restore full source admission/coverage and Knip on committed final SHA, Graphify matching index and CI/security reviews |
| P0-24 | INVALIDATED: Graphify indexed SHA ccce4247 | Official matching-revision query and coverage verified |
| P0-25 | PASS scoped: Specify CLI 1.3.0, four no-persist prerequisites and 13 dated derived work artifacts committed in ec888925 and d469b3ff | Semantic/critical-risk reviews still separate; verify these tracked artifacts on remote CI before final gate |
| P0-26 | PARTIAL: GitHub Go Quality 43990345535 PASS on 1e6ed904 including Linux -race, Go modules/coverage and isolated image build; main CI 43990345437 FAIL at Knip for 16 committed Captain unused modules. Candidate c5b638aa removed only Captain unused scaffolds, not tested remotely | Check exact final SHA with CI Presentation and fast-guard, current Go Quality, CodeQL and main Sonar; no automatic Push, PR or merge |
| P0-27 | REVIEW_BLOCKED | G01-G20 final documented acceptance before ENVIRONMENT_BASELINE_ACCEPTED |

### 2026-11-17 — Additional reproduced proof and limits

- P0-25: Official Specify CLI version 1.3.0, check, workflow list and four no-persist prerequisite scripts all passed. A local .git/info/exclude rule hid /specs/. Twelve derived feature spec/plan/tasks files and one dated Customer discovery evidence file were selectively staged and committed in ec888925 and d469b3ff. They remain historical work instructions, NOT a second policy root or current runtime admission. Older branch names and Go/runtime versions in those documents are historical snapshots.
- Go: Identity two packages and DSH three packages passed go test -count=1 and go vet with local Go. Real PostgreSQL owner integration, race, and whole journey acceptance not established by these source checks.
- Fresh install probe: A git archive of e337bc2 passed frozen online pnpm install --frozen-lockfile --ignore-scripts after offline installation failed for one uncached Tamagui tarball. Its workspace verification failed because the extracted archive did not preserve all application directory inputs. Use a clean Git checkout for G03/G05. Temporary Windows deep-path cleanup was incomplete; no protected state was touched.
- Graphify: local CLI generated an ignored graphify-out index, while the Graphify MCP promoted index remains stale at ccce4247 versus current candidate. P0-24 INVALIDATED.
- GitHub CI PASS applies to 1d46a554 only; it does not certify later e337bc2, ec888925 or d469b3ff.

### 2026-11-17 — Donor vs current source census and refoundation decision

Evidence: git ls-tree -r --name-only for archive/legacy-pre-refoundation-20261114 and foundation at d469b3ffe7788206a3a186e3d48aba8f4bc4b748; inspect new HEAD again before acceptance. The two 2026-11-16 Downloads audit files remain historical reference, not runnable proof.

| Owner/presentation host | Donor tracked files | New tracked files | Observed executable scope | Rebuild decision |
| --- | ---: | ---: | --- | --- |
| Customer Expo + Web | 186 | 50 | 25 route files, 14 explicitly deny unavailable capabilities, Store discovery real via DSH | KEEP public Store reads/links, REFOUND Identity/cart/orders/WLT and their tested flows; no empty Features |
| Merchant Expo + Web | 234 | 31 | 10 route files, only access/navigation Feature source; no completed scoped Store/order workflow | KEEP Expo adaptive navigation, REFOUND Store-scoped onboarding, catalog and orders from owner contracts |
| Captain Expo | 78 | 31 | 11 route files, access/dispatch Feature basis; no tested full assignment/delivery/COD | REFOUND readiness/dispatch/proof with DSH ownership and WLT custody |
| Operator Next.js | 607 | 18 | 10 route files and access foundation; no proven operational dashboards | REFOUND permission-scoped workspaces in existing Next host, not a parallel fourth commerce engine |
| Identity | n/a | 41 | 19 Go, 3 SQL; verifier/role admission under isolated synthetic assumptions | KEEP verified server behaviors; first-factor identity and cross-owner auth remain open |
| DSH | n/a | 64 | 26 Go, 5 SQL; public read and Store availability source | KEEP one Store/Offer/Order writer; complete owner readbacks, protected fulfillment and checkout |
| WLT | n/a | 23 | 0 Go, 0 SQL, no owner-backed ledger | NOT_IMPLEMENTED; do not simulate balances, settlements, COD or Finance closure |

Donor full repository: 2,568 tracked files; current: 426 at this snapshot. These counts measure migration scope, not correctness or expected final number of files. Legacy (tabs)/(workspace) route groups are legitimate navigation layouts; new Merchant is Expo for mobile and Expo Web, not Next workspace. partner may remain only in verified backward-compatible permission/URL identifiers (e.g. Identity's historical partners Operator grant), never the new Merchant actor/interface name. Preserving the old URL or grant requires explicit compatibility tests before any rename.

Acceptance and priority: The next high-value end-to-end slice must bind a real currently verified actor to the DSH Store scope before Merchant operations or Operator policy commands are declared usable; the currently disabled Customer checkout and Wallet require later DSH/WLT write-owner proof. OpenAPI placeholders, Route shell screenshots and synthetic test fixtures are not completion. Keep productive independent development admitted while G01-G20 readiness and production reviews remain open.

New G07 regression: The existing source test discovery and coverage runner discover all supported Node tests in apps/, services/, packages/, tests/, tools/, and infra/, excluding generated dependency/build directories. An unsupported JS/TS test format causes an explicit failure until its actual runner is admitted. Before the fix, 7 tracked .test.mjs files were omitted from the source coverage run; with this change they are admitted. Real integration and end-to-end tests remain independent from Node source-line coverage.

### 2026-11-17 — Final scoped verification follow-up

- **Identity client:** its untracked work was completed, reviewed against Identity session and Merchant admission OpenAPI, regression-tested 10/10 (safe origin, strict token/date-time, exact no-store, JSON/body bound, errors, unknown mutation results, stale session), typechecked and committed as ec35fe994. services/identity/clients/README.md now honestly says IMPLEMENTATION_IN_PROGRESS; there is no first-factor login, DSH Store grant, or WLT finance path.
- **Measured source tests:** the expanded runner reported 409 tests, 407 PASS, 2 skipped, 0 failed, 24 LCOV source files, 3643/4193 lines hit (86.9%). This is NOT whole-product coverage. Local pnpm check also passed after the Identity README fix.
- **Runtime Go:** current Go 1.27.4 with GOTOOLCHAIN=local passed gofmt, go mod verify, go vet and go test -count=1 for Identity's two and DSH's three packages. Windows had CGO_ENABLED=0 and no GCC; local -race is NOT_RUN, not a downgrade or pretend PASS.
- **Isolated PostgreSQL:** infra/verify-isolated-postgres.ps1 -DockerContext bthwani-docker returned PG_FRESH_MIGRATIONS=PASS count=5, PG_READER_ACCESS=PASS SQLSTATE42501, PG_RESTORE_READBACK=PASS fingerprint=14:147:1, and PG_ISOLATION=PASS (network none, no host ports, tmpfs only). Exact labelled container cleanup was independently confirmed by empty docker ps -a filter. Never substitute this for protected DB upgrade or WLT ledger proof.
- **GitHub source CI:** run 43985893083 on exact ca3bdf96b17293f95aed0c269b892d21ac19dbde completed success, all three jobs successful. Local source may contain later uncommitted peer work; only a final immutable candidate and its required CI can close P0-26.
- **Runtime provenance:** read-only node infra/verify-runtime-provenance.mjs --context bthwani-docker exited 2 on Docker inspect timeout. The tool did not restart protected services or change volumes. Follow Lenovo/SSH owner workflow; do not fail over to bypass DENIED or infer a matching binary.
- **Graphify:** task query used promoted index at ccce4247, stale against current HEAD; no connected re-index action was advertised. P0-24 remains INVALIDATED.
- **Out-of-scope for 100% closure:** P1 Customer/cart/order, Merchant Store-scoped flows, Captain dispatch/proof, Operator administrative capabilities and WLT financial ledger still require real application/service/ACL/persistence tests. Protected production release remains blocked.

### 2026-11-17 — Verified follow-up: toolchain, Nx graph and runtime provenance

- The direct default MA Commander Node binary now reports v24.22.1; Go reports go1.27.4. The native pnpm check:toolchain PASS (previous MA PATH mismatch must not be retained as a current global FAIL). No system-wide PATH or version was modified by this check.
- Native Spec Kit CLI specify version 1.3.0 and specify check PASS with existing tracked specs. Graphify task-relevant Nx/clean-install query completed, but promoted index at ccce4247 is older than current branch and excludes active uncommitted app work: GRAPHIFY INVALIDATED, never complete acceptance.
- Nx project impact tests 10/10 PASS, including new untracked OpenAPI/SQL and Merchant Feature source names and process.execPath without shell; Next typecheck output scopes proven structurally, not actual hash invalidation under changed source.
- Docker --context bthwani-docker ps/inspect direct reads: DSH container healthy with image ID sha256:70cd31950121599061f35305ad84e27283514ba2545fd82da35a22763c5d34cc, image label com.bthwani.source-sha 8a439fb404c794099af0edd86fe77cb5bfcbc243, which is an ancestor with many newer DSH-owned commits; Identity container Exited (255). Runtime owner session-04 documented source-cutover BLOCKED_BY_SAFETY_CHECK. No Docker lifecycle commands or private state edits were executed.

### 2026-11-17 — Frozen bootstrap and stage-guard regression follow-up

- P0-05: Detached clone of a35bd65 to D:/samrim/.tmp/bthwani-frozen-j_brm7bu returned Git success, verified four app manifests and clean index. pnpm install --frozen-lockfile --offline --ignore-scripts did not return within 240 seconds; no install PASS and no downstream Nx/source smoke can be inferred. On cleanup, Windows returned PermissionError WinError 5 for the owned scratch Git pack index. No ACL bypass, provider-hopping, protected state mutation or false cleanup claim was made. Residual temp clone needs an approved safe cleanup, after checking no process uses it.
- P0-12: Service placeholder commit 35e745753 added 33 empty .gitkeep files across Go capability directories. The actual Foundation gate failed immediately. Their names had no tracked file-reference consumers and no service Go/SQL mutation was in scope. Local fix 1e6ed904 removed only those 33 markers, retained all executable code, and was independently checked with pnpm check:foundation: 219 PASS, 0 FAIL, 2 skipped; git diff --cached --check PASS. This repairs structural CI admission only and does not make those absent capabilities implemented.

### 2026-11-17 — CI failed-coverage investigation and Captain bounded cleanup

- GitHub CI 43990345437 at 1e6ed904: Foundation PASS, OpenAPI PASS, Test Inclusion PASS, Node coverage PASS, Knip FAIL on exactly 16 unused Captain TSX sources; fast-guard correctly FAIL on its failed prerequisite. A separate Linux Go Quality run 43990345535 on the same SHA PASS including race, real source coverage, and isolated Docker image build/provenance inspection.
- Those 16 Captain files were identical placeholder/pending-owner message components never imported by a runtime consumer; three static-only tests read their source strings without running a user behavior. Existing Captain route guard and actual Identity session/dispatch offer tests remain. Local cleanup c5b638aa removed only these 19 files. Scoped Captain behavior 7/7 PASS, TypeScript PASS, Android Expo JavaScript export PASS, Foundation PASS, and no Captain file remains in live Knip unused list. It did not activate a mock assignment, Wallet, COD, order proof or private map.
- On the still-dirty local worktree, Knip now lists 18 uncommitted Merchant and nine uncommitted Operator feature files; Node coverage fails specifically on Operator unadmitted src/navigation, src/session, src/shell, new partners route violating Merchant naming, and unsafe scan of workspace-registry.ts. This failure belongs to concurrently authored app work; owners were notified in coordination messages. No blanket guard/Knip exclusion or interference with their uncommitted files.
- Linux clean frozen install succeeded on that earlier tested SHA even though a separate Windows clone install attempt timed out; neither makes the final dirty checkout or current remote app runtime accepted. P0-05 must preserve these separate platform/provenance outcomes.

### P1 — One active register for the 25 product journey transitions

These are **not prerequisites for a clean directory layout**, but each becomes a required journey acceptance once that capability is implemented. Partial presentation routes and archived functionality are not accepted owner-backed operations.

| ID | Legal owner and observed starting point | Journey acceptance |
| --- | --- | --- |
| P1-C01 | Identity; customer access route disabled | NOT_RUN authenticated account/session/recovery |
| P1-C02 | DSH; public Store discovery partial | NOT_RUN publication/city/orderability owner readback |
| P1-C03 | DSH; offer discovery partial | NOT_RUN full catalog, variants and price/stock proof |
| P1-C04 | DSH + WLT; cart/checkout routes disabled | NOT_RUN quote/confirmation/payment and idempotency |
| P1-C05 | DSH; orders route disabled | NOT_RUN lifecycle/tracking/cancel and durable proof |
| P1-C06 | WLT; no executable WLT ledger backend | NOT_RUN wallet/refund/balanced ledger |
| P1-C07 | Identity/DSH; notification/sharing routes disabled | NOT_RUN consent/token/privacy |
| P1-M01 | Identity + DSH; Merchant Expo gate and tabs exist | NOT_RUN Merchant admission/Store-scope session and onboarding |
| P1-M02 | DSH; product tab disabled | NOT_RUN Store-scoped catalog operations |
| P1-M03 | DSH; order tab disabled | NOT_RUN Store order lifecycle integration |
| P1-M04 | Identity + DSH; private gate only | NOT_RUN per-Store account/team notifications |
| P1-M05 | WLT; wallet tab disabled | NOT_RUN financial readback, agreements and payouts |
| P1-K01 | Identity + DSH; Captain routes exist | NOT_RUN readiness, presence, safe location and isolation |
| P1-K02 | DSH; dispatch/delivery UI disabled | NOT_RUN assignment race, proof, privacy and delivery |
| P1-K03 | WLT; wallet route disabled | NOT_RUN COD/custody/ledger settlement |
| P1-K04 | Identity + DSH; notification route disabled | NOT_RUN token/dedupe/stale assignment |
| P1-O01 | Identity; Operator workspace denies access | NOT_RUN real session, 401/403, role IDOR |
| P1-O02 | Identity + DSH + WLT; Merchant management absent | NOT_RUN merchant/Store onboarding and scoped operations |
| P1-O03 | DSH; catalog/content UI absent | NOT_RUN owner-authoritative content/counters |
| P1-O04 | DSH; operations UI absent | NOT_RUN order/dispatch/city data/commands |
| P1-O05 | DSH + WLT; policy UX absent | NOT_RUN versioned effective policy and audit |
| P1-O06 | WLT; finance UI absent | NOT_RUN real ledger/settlement/authz |
| P1-O07 | Identity + DSH; staff/marketing UI absent | NOT_RUN staff separation and campaign audit |
| P1-O08 | Identity + DSH; customer/notification UI absent | NOT_RUN least privilege and privacy |
| P1-O09 | Design owner + DSH; historical Studio donor evidence only | NOT_RUN single safe editor and consumer proof |

### Next executable order and proof rule

1. Finish P0-08/11/06 with a real Linux CI run; reject unsupported Feature test formats until a native React/Expo runner is configured. Do not make a custom parallel runner.
2. Finish runtime consistency P0-02/03, Spec Kit artifact preservation P0-25 and matching Graphify P0-24 without altering protected infrastructure.
3. Complete isolated DB, Docker, API parity and security proofs P0-09/10/16-22; assign distinct owners to shared infra/DB resources.
4. Run G01-G20 against one candidate, then consider ENVIRONMENT_BASELINE_ACCEPTED. Do not block independent feature slices by unrelated incomplete WLT/production work.
5. Close individual P1 journeys using the service/actor/Store rules and genuine persistent owner readback. Production/Push/PR/Merge/Deploy remain separate human authorizations.

---

---

## 2026-11-12 — Governance donor-reconciliation pass 2 (source-grounded; not final adoption)

**Exact donor:** `D:\samrim`, branch `41`, SHA `426d67b47beb8c66b09acd8c7394086b53ac5aae`; original `docs/governance/` read only. **Candidate:** existing clean worktree/branch at the exact SHA in this batch's local commit record. Do not conflate current approved governance semantics and untested current backend behavior.

### Material decisions recovered and reauthored into their canonical owner
| New owner | Donor-specific invariant recovered | Proof scope / outstanding |
| --- | --- | --- |
| `identity.md` | Normal Operator WebAuthn/user verification, protected one-time admin/bootstrap, finite `operations/partners/catalog/marketing/finance/hr/platform_policies` grants, role/session isolation, identity phone/name authority and browser-host session boundaries. | Semantic source-to-draft comparison; live Identity tests NOT_RUN. |
| `stores.md` | Verified Merchant account versus DSH Store owner, first/subsequent Store idempotence, unpublished/closed fresh Store, separate vertical/type/city, business-only public contacts, store-member acceptance and one DSH create writer. | Actual DSH/API/SQL cutover NOT_RUN. |
| `catalog.md` | Five distinct classification concepts; typed category tree; Product→Variant→StoreOffer; Shared versus Store-scoped within one registry; variable measures/modifiers; controlled 5,000-row preview/commit and Quick Prices. | Data model, import large-run and UI proof NOT_RUN. |
| `commerce.md` | Effective donor `CITY_SCOPE_V2_RADIUS_30KM`, Order recipient independent from purchaser, cancellation snapshot/compensation, governed promo forms and Partner/Platform/Shared funding, short-form media limits, direct/marketplace same DSH Order. | DSH and WLT serviceability/money agreement conflict not yet runtime-tested. |
| `fulfillment.md` | Store-Captain invitation proof, up to 3 offers/one winner, Captain latest-location/privacy/expiry, platform versus Store Captain cash distinctions, customer address after assignment. | Operator/Captain Android mission and private-location proof NOT_RUN. |
| `finance.md` | Exact integer YER, Captain COD gross exposure versus cash-only hold/debit, old physical remittance issue, approved-beneficiary identity/destination, manual transfer receipt+statement, separated approval/reconciliation, cancellation refund safeguards. | Financial independent review REVIEW_BLOCKED; live WLT/DB NOT_RUN. |
| `experience.md` | Five approved brand anchors, Tamagui Expo/Ant Design Operator, eight actual navigation groups, one Studio, Arabic RTL/AA contrast, proper Owner readback and no UI engine. | Rendered Web/Android/iOS and theme publication NOT_RUN. |
| `hr.md` | One employee/optional Operator actor, HR-requested but Identity-approved permissions, unknown ≠ absent attendance, event-based corrections and safe offboarding, money stays WLT. | HR/Identity integration proof NOT_RUN. |
| `safety.md` | Least-privilege DB runtime identities versus migration admin, durable constraints, UTF-8 repair discipline, cursor bounds, explicit failure codes and replay-safe cross-owner operations. | Actual grants, database, backups, E2E NOT_RUN. |
| `product.md` / `journeys.md` | One admission set of 26 capability IDs, recipient versus purchasing Customer, constrained subscription entitlements, bounded Operations contact/exception journeys and financial handoffs. | Headline IDs are mapped once; exhaustive subfeature producer/consumer review NOT_RUN. |

This pass addressed prominent **known omissions** from the first 14-owner drafts; it does **not** declare each line of 14 donor files fully concordant or prove that all dated ZIP decisions are still approved. The full-file and independent-risk review remains a separate cutover gate. Historical media provider/reference URLs and legal agreements must retain provenance; do not invent verification of remote links.

### GitHub and tooling decisions
- One contributor: no `CODEOWNERS` file, no fictitious reviewers or automatic PR/Push. Independent competent review for high-risk finance/security/migration is a **separate acceptance gate**, not a made-up GitHub team.
- `.coderabbit.yaml` is included as a minimal inherited-provider review configuration matching the established local intention (draft reviews enabled); provider-side review behavior and GitHub rulesets are **not** proven by committing YAML.
- Live GitHub repository metadata was read-only checked for `bthwani2-boop/samrim`: default branch `main`, **public** visibility at check time, connected account admin permissions. Do **not** publish credentials or presume branch protections. Repository visibility or protection changes require separate human authorization.
- The old `.specify/memory/constitution.md` is only a derived Spec Kit router, but its text points to **deleted** `docs/governance/`. Do not copy it blindly. Before enabling Spec Kit during implementation, adapt router to root `governance/README.md` and AGENTS/REPOSITORY-STRUCTURE, verify workflow/script dependencies, and treat its constitution as non-authoritative.
- Source branch's Sonar workflow still references branches `36/37/38`; old Fast Guard assumes full applications/services. They remain **not admitted** to the sparse candidate; routing must be updated and proven when source code returns. Foundation Guard local static checks are not a substitute for successful GitHub Actions runs.
- Branch-41 external benchmarking/research links need read-only URL and license checks before any source-derived rule or media reuse. NOT_RUN; no silent product adoption from competitor/archival packs.

### Named remaining cutover blockers
1. **R1 — DONOR_LINE_RECONCILIATION:** compare every remaining material domain section, older archive requirement and explicit user decision, with an evidence-backed KEEP / MODIFY / SUPERSEDE / EXPLICIT_RETIRE / UNRESOLVED disposition. Draft summary parity alone is not enough.
2. **R2 — HIGH_RISK_REVIEW:** separate competent review of finance, privilege, retained historical money, schema migration/destructive cutover rules. Without review: REVIEW_BLOCKED, including for documentary policies that materially alter critical operations.
3. **R3 — GH_PROTECTION_AND_ACTIONS:** validate GitHub workflow syntax/routing locally where supported, then exact candidate GitHub Actions/CodeRabbit/Sonar checks and live main-branch rulesets after authorized remote submission. No authorized push, PR, branch protection change or merge yet.
4. **R4 — SOURCES_AND_LINKS:** record source/quote provenance and preserve non-governing OSS/competitor/media/legal references; external live-link/license verification NOT_RUN.
5. **R5 — CUTOVER_APPROVAL:** only after R1-R4 applicable full-policy checks are proven and reviewed may `GOVERNANCE_CUTOVER: READY` and related guards/AGENTS be updated in a separate coherent batch. This is completion of overall governance reconciliation, **not a gate on progressively authorized code/SQL development** and not implementation success.

No restoration of services, apps, old SQL, Docker or external data was performed by this pass.


### Provenance and CI verification status — same foundation batch

- Created **one non-governing** `docs/reference/README.md` summarizing selected OSS/competitor research sources, their original branch/SHA and evidence limitations without bringing old benchmark dossiers or screenshots into current policy. The index is **curated, not exhaustive**; external URLs, licenses, media rights and missing untracked captures are `NOT_RUN` until deliberately checked.
- GitHub repo `bthwani2-boop/samrim` is reported **public** by read-only live GitHub metadata at this audit. This is not an authorization to alter visibility or push drafts; secrets and untracked local material remain protected.
- Source `.coderabbit.yaml` had inheritance plus draft auto-review enabled. Candidate includes a small single configuration using only those established settings and a negative test that detects deliberate disabling. Whether the provider actually reviews a PR, global inherited settings and review quality remain `NOT_RUN` until authorized GitHub delivery.
- A locally installed `actionlint` executable was detected, but the connected device channel **explicitly denied** executing it. That specific executable validation is `BLOCKED`; no alternate channel will be used to bypass the denial. Foundation test/guard results do **not** substitute for actionlint or an actual GitHub Actions run.
- Existing original Spec Kit constitution is a **derived router** and points at the removed `docs/governance` path. Do not copy or activate it unchanged. Its installation/adapter check belongs before adopting a substantive Spec Kit workflow; root `AGENTS.md` and `governance/` remain the sole authorities. If no substantive workflow currently needs Spec Kit, do not create a misleading partial tool tree.

**Current program decision:** finish semantic and independent-risk review before changing the governance cutover flag. The project architecture can be designed now, but SQL, apps, source-service refoundation and live financial operations remain expressly unstarted.


## 2026-11-12 — Operator-policy variable audit and official Spec Kit integration

### Policy-first refinement accepted by the user
Every supported **legitimately operator-adjustable** business or operational threshold must be maintained through the correct canonical DSH/WLT owner, editable in the **single Operator Policies experience**, validated and versioned without a new application deployment. This includes initial donor values such as the 30 km service radius, three dispatch offers, 15-minute Captain location freshness, 30-minute opportunity-map demand window, 5,000-row bulk imports, 10 MiB/30-second short video, delivery bands, Store availability and cancellation/refund/compensation ceilings, Captain COD eligibility, commission/subscription and settlement timing. These are policy **candidates/defaults**, not proof that all controls are implemented today. Each is admitted at its owner only with a validated safe range, real runtime/financial capability and tested permission/effectivity. The immutable invariants are exactly-once ledger, balance conservation, valid actor and Store rights, single winning Captain assignment and protected customer address.

**Temporary classification at implementation, not a second policy catalog:**
- CONFIGURABLE_APPROVED → one owner-backed editable current setting and one Operator Policies control
- SAFETY_INVARIANT → enforced and never relaxable via a setting
- FUTURE_UNIMPLEMENTED → unavailable until independently accepted backend/contract/finance capability exists

Any implementation slice containing business-number literals must show which classification is intended and ensure the default is defined once at the owner. A policy update cannot rewrite accepted Orders/Store agreements and must be replay/concurrency/audit safe.

### Spec Kit official source and local runtime
- Authoritative upstream: `https://github.com/github/spec-kit`, official instructions `https://github.com/github/spec-kit/blob/main/docs/installation.md`. As of **2026-11-12** official GitHub releases list `v1.4.0` (published 2026-11-10).
- Installed Windows CLI: `specify-cli 1.3.0` from existing `uv tool`; `specify version` and `specify check` **PASS**. `specify self check` reports `1.3.0 → v1.4.0`; this is an **available upgrade**, not a current CLI failure.
- Initialized this existing worktree using **installed pinned package assets**, `specify init --here --force --non-interactive --integration none --script ps --ignore-agent-tools`. No Codex CLI or other coding agent was launched; the existing user-installed CLI was reused. `none` deliberately installs agent-neutral Spec Kit scripts and templates, **not agent Slash commands**.
- The default generated `.specify/memory/constitution.md` was rewritten as a **DERIVED_SPEC_KIT_ROUTER** pointing only at root `AGENTS.md`, `REPOSITORY-STRUCTURE.md` and `governance/README.md`, with no independent Product, Git or financial authority. Old deleted `docs/governance/README.md` is not used.
- Local `check-prerequisites.ps1 -Help` **PASS**; `create-new-feature.ps1 -DryRun -ShortName sample-governance-policy` **PASS** without creating a branch. `check-prerequisites.ps1 -PathsOnly -Json` requires an explicit feature context and **correctly fails** without one; with `SPECIFY_FEATURE_DIRECTORY=governance` and `SPECIFY_FEATURE_NO_PERSIST=1`, path resolution **PASS** without writing `.specify/feature.json`.
- The Foundation Guard now cross-checks CLI-generated integration version, owner router, manifest hashes and approved PowerShell scripts. The installed-vendor `.specify` files are not copies of the old donor tree; preserving generated assets at CLI 1.3.0 is deliberate. Upgrading the **global** CLI to 1.4.0 without impact review could alter other worktrees; no upgrade was performed. If a reviewed upgrade becomes necessary, regenerate/verify the bundle, hashes, commands and scripts on one coherent candidate.
- Spec Kit CLI **operational PASS** is separate from **agent Slash command integration NOT_RUN** and from fully tested feature-spec cycle NOT_RUN. The workflow's implementation step must never create a Branch/Worktree or invoke Codex without separate authorization.

### GitHub read-only verification
- GitHub connector confirms `bthwani2-boop/samrim` has default `main`, visibility `public`, account-level repository admin permission; the local `refoundation/clean-house-20261112` branch **does not exist on the remote**.
- Therefore real GitHub Actions and CodeRabbit checks on this candidate remain **NOT_RUN**. Neither Push/PR nor GitHub protection/ruleset modifications are authorized by this general development instruction.
- Locally prohibited `actionlint` execution remains **BLOCKED by the previously returned tool-policy denial**; do not switch channels to bypass the denial. Local Foundation Guard tests are evidence of only the subset they test, not the full GitHub workflow execution.
- CodeRabbit provider global/inherited review and actual branch protections need separate readback at a delivery stage; the sole human contributor does not require CODEOWNERS.

### Historical URL inventory status
- Extracted `37` distinct non-loopback URL strings and `5` distinct localhost/dev endpoints, across `48` occurrences in six historical branch-41 `docs/reference` documents. Traceable extract: `docs/reference/HISTORICAL-SOURCE-INVENTORY.md`, non-normative and never a Product approval.
- Fresh external HTTP response, changed contents, current license, privacy, media rights and archived ZIP embedded research links: **NOT_RUN** in this extraction; check the exact selected integration or reference before actual adoption.

### Open release gates unchanged
1. **Semantic line/decision concordance** beyond the high-priority donor sample and complete archive review is NOT_RUN.
2. Finance/security/migration independent critical-risk review remains **REVIEW_BLOCKED**.
3. Actual GitHub CI on the candidate, applicable provider review and repo protection confirmation remain **NOT_RUN** or unavailable without separately authorized remote submission.
4. No declaration that the governance policy root is READY until the above are resolved. No SQL/app/backend/Docker implementation was carried out.


## 2026-11-12 — Historical-source reconciliation wave 3: named journeys, policies and control-panel criteria

### Exact source basis (read-only, not governing)
- Original repository `D:\samrim`, branch `41`, `426d67b47beb8c66b09acd8c7394086b53ac5aae` and its 14 domain-governance documents, including `docs/governance/journeys.md`, `catalog.md`, `commerce.md`, `finance.md`, `experience.md`.
- **Relocated consolidated archive**: `%USERPROFILE%\Desktop\BTHWANI-REFOUNDATION-COMPLETE-PACKAGE-20261112.zip`. It contains 11 ZIP entries, of which 9 payload entries match its internal `MANIFEST-SHA256.txt` (**9/9 PASS**). This replaces the obsolete Downloads reference; the archive is source evidence, **not** another Product or agent authority.
- The embedded Control Panel master pack has **63 entries**; its manifest hashes **62/62 PASS**. It contains a nested V1 (30 files) and V2 (36 files): **23 identical, 7 changed, 6 added** in V2. Extracted V2 content repeated in the outer pack is **36/36 byte-identical**. These are duplicated/superseded historic versions, **not** multiple sets of current requirements.
- The master pack's original `03_REQUIREMENTS_AND_PROOFS/REQUIREMENTS.csv` has **112 entries**: **72** historical base items and **40** added criteria, with **112/112 `UNVERIFIED_ON_HEAD_16`** and no filled `proof_pointer`. They are **historical review inputs**, not 112 approved new features or verified defects. Its 10 closure gates are all `UNPROVEN` in that historic snapshot. In particular, legacy Gallery/Inspector/HR additions and PR #90/#91 observations cannot be blindly rebuilt without live consumer/source verification.
- The embedded Audit Trigger bundle contains **3 text inputs**, notably an 81,811-byte instruction set proposing a highly elaborate evidence council; it is a *historic audit method*, not permission to install a second supervision system, exhaustive standing process or Codex CLI. Its useful invariant is evidence traceability/independent challenge and no blanket 100% claim, which are already governed by AGENTS/engineering.
- Historic refoundation execution command and plan documents are scope/risks evidence for **later** code/SQL migration; older branch/worktree/Codex instructions are not executable now. Archives that were not opened, external links not verified and actual runtime/financial states remain `NOT_RUN`.

### Owner-by-owner semantic decisions reconciled this wave

| New canonical owner | Historical decisions preserved or correctly bounded | Outcome |
| --- | --- | --- |
| `governance/journeys.md` | Rebuilt **16 historical named Journey IDs** with current Merchant/Customer vocabulary, actor surfaces, owner boundaries, entry/exit/readback and failure/recovery; no parallel Product capability census | DRAFT_REAUTHORED; structural guard required; live behavior NOT_RUN |
| `governance/commerce.md` | Contact on initial three completed Orders, honest attempts and nonblocking preparation; bounded Order-scoped exception owner, proof-gated financial/custody resolutions, stage-attention vs contractual SLA, exactly-once events | DRAFT_REAUTHORED; DSH/WLT actual data proofs NOT_RUN |
| `governance/finance.md` | Separate Store-collected customer money, platform commission receivable, lawful offset/remittance and WLT beneficiary payout; no duplicate Merchant earnings or automatic COD remittance mapping | DRAFT_REAUTHORED; independent finance review REVIEW_BLOCKED |
| `governance/catalog.md` | Canonical `الأكثر رواجًا` from distinct actually completed Store Orders, Store Offer visibility, deterministic tie-breaks; favorites separate; effective ranking window managed by DSH | DRAFT_REAUTHORED; real counting/query/performance proof NOT_RUN |
| `governance/experience.md` | Explicit WCAG 2.2 AA, current scoped server-owned registries, optional and conditional Saved Views/Gallery/global search, focus/URL privacy, State/RTL and cross-device evidence, restrained branding | DRAFT_REAUTHORED; actual Web/Android/iOS proof NOT_RUN |
| `governance/engineering.md` / `AGENTS.md` | Historic scope, no blind migration, Owner and policy-driven controls, conditional provider/AI/tool admission and protected persistent state | EXISTING_GOVERNED; whole-repo code/SQL implementation NOT_RUN |

The **historical initial business values** (e.g. three first Orders, ten-minute contact claim, 5/30-minute attention, 30-day popularity, three Captain offers, 30-km radius) are **eligible versioned owner policy candidates**, not immutable scattered constants. The first-contact flow is **nonblocking** under the donor's accepted initial semantics; an unimplemented permission to block preparation cannot be enabled just by changing a policy.

### Deliberately not elevated from historical requirements
- Saved views/command palette/general search/AI insights/new WebSocket subscriptions, a new support CRM, predictive logistics or new billing/payment rail: **CANDIDATE/DEFER** until explicit Product need, legal authority and tested Owner implementation. A historical reference or screenshot is not approval.
- Historic `PARTNER`, `CLIENT` and `INDEPENDENT_STORE` API/SQL strings: **compatibility evidence** for later migration, not permission for multiple Store relation types or new engines. Retired acquisition workflows are not revived; surviving legally binding liabilities remain with WLT/Identity as appropriate.
- Branch 16 route counts, CI outcomes, PR merge claims and screenshot snapshots: **point-in-time evidence**, not implementation proof at current branch `41` or the new sparse candidate.

### Still unresolved before governance cutover
1. **Archive/detail equivalence**: original text of all 112 Control Panel requirements and older operational/financial/design manuals needs a documented case-by-case `KEEP/REFRAME/CONDITIONAL/RETIRED/UNRESOLVED` disposition backed by the latest approved decision. Counting and preserving the archive does **not** establish semantic parity. Material copyright/legal/license or live external-link verification remains NOT_RUN.
2. **Source-code/SQL ownership**: verify which historical operating defaults, identifiers, and old SQL migrations actually became persistent/contractual facts; none of the current draft descriptions means they are already safe in running DSH/WLT.
3. **Independent review**: financial formulas, settled liabilities, Identity privilege and database migration/destructive rules remain REVIEW_BLOCKED until qualified independent review. Do not accept a single LLM assertion or CI structural test as the mandatory second review.
4. **External GitHub/CI and change delivery**: real actions/CodeRabbit/Sonar on candidate branch remain NOT_RUN until separately authorized push; protected `main` must not be merged from this source-sparse branch.

**Acceptance of this bounded wave:** source ZIP integrity can be PASS; 16 Journey structural preservation and precise policy wording can be PASS as **draft-document checks**; exhaustive semantic reconciliation and `GOVERNANCE_CUTOVER` stay NOT_READY. No new Product source/SQL/Docker/worktree/branch was added.


### Control Panel 112/112 historical-ID trace — reviewed subset and remaining admission work

The **complete ID+wording census** has been preserved only in non-governing `docs/reference/HISTORICAL-CONTROL-PANEL-REQUIREMENTS.md` and guarded against missing/duplicate IDs. The archived source itself reports **all 112 unverified on historic branch 16**. That means **source inventory PASS**, not 112/112 semantic admission. The original full requirements CSV, original 10 closure criteria, master technical appendices, nested V1/V2 and current code are separate evidence sources.

The following high-risk/structural **source ID dispositions are grounded in the reauthored canonical owner text**, without claiming live implementation:

| Historic source IDs | Source meaning / decision | Canonical disposition and owner |
| --- | --- | --- |
| `R001,R004,R005,R010,R056` | Correct role-aware navigation and avoid duplicate resource routes | **REFRAMED** in `experience.md` and `architecture.md`; a URL is not another writer |
| `R009,R051,R067,R092,R106,R107,R112` | Actual accessible/RTL/efficient UI and failure/recovery | **ADMITTED_ACCEPTANCE** in `experience.md`; genuine Web/device proof NOT_RUN |
| `R013,R015,R016,R017,R021,R035,R036,R037,R062,R063,R069,R080,R100,R109` | Query/action/workspace continuity, accurate counts and safe bulk/inspector behavior | **REVIEWED PRINCIPLE** in `experience.md`, `architecture.md` and Owner boundaries; exact optional widget/feature needs source/user-need proof |
| `R022,R023,R024,R025,R061,R066` | Store Offer media, table/gallery, thumbnails, evidence/provenance | **REFRAMED** as one DSH StoreOffer/read query; Gallery and image comparison are presentation choices, not a second owner |
| `R026,R029,R086,R087` | Merchant onboarding, Store ownership, role, publication/readiness | **ADMITTED** in `stores.md`, `identity.md` and Store journey; no parallel onboarding engine |
| `R027,R077,R088` | HR access request vs Identity admission, employee isolation | **ADMITTED** in `hr.md` and `identity.md`; archived PR-specific status is not present-run proof |
| `R028,R082,R083,R099` | WLT-only settlement, beneficiary vs receivable/custody, accepted agreement, replay/timeout | **ADMITTED** in `finance.md` and settlement journeys; mandatory risk review REVIEW_BLOCKED |
| `R030,R054,R087` | Order operations, exception/remedy, published versus orderable | **ADMITTED WITH BOUNDS** in `commerce.md`/`journeys.md`; no generic CRM, case is not Order writer |
| `R032,R047,R098` | Policy scope and Product admission | **ADMITTED BOUNDARY** in `architecture.md`/`product.md`; only supported business variables are editable and security/ledger invariants remain fixed |
| `R034,R040,R095,R096,R097` | Global search, optional saved views, AI, streaming updates | **CONDITIONAL_CANDIDATE**; no automatic Product adoption or new service |
| `R038,R039,R079,R111` | Truthful analytics, cohorts and exact time/denominator/currency | **ADMITTED READ-MODEL PRINCIPLE** in `architecture.md`; real Owner metric definitions/data NOT_RUN |
| `R041,R042,R053,R081,R084,R085` | Preserve protected data and private URLs/media/role isolation | **ADMITTED SECURITY INVARIANTS** in `safety.md`/`experience.md`; independent security review REVIEW_BLOCKED |
| `R044,R045,R046,R052,R060,R075,R076,R089,R090,R091,R093,R094,R102,R103,R104,R105,R108` | Traceable source and exact candidate proof, safe cleanup, migrations, load tests, ZIP integrity | **ADMITTED ENGINEERING/EVIDENCE PRINCIPLES** in `engineering.md`/`AGENTS.md`; exact code/SQL/PR proof NOT_RUN |
| `R055,R101` | Owner-backed notifications, unread count and paginated inbox | **ADMITTED PROJECTION** in `journeys.md` and `architecture.md`; no duplicate message/event authority |
| `R073,R074,R071` | Branch-specific historic snapshots and merged PRs | **HISTORICAL_SUPERSEDED AS EXECUTION TARGET**; verify new branch/HEAD and current actual code instead |
| `R031,R058` | Historical Captain/operator/multiple-surface next actions | **PARTIAL REFRAME**: retain Captain and authorized current actor handoffs, never recreate retired processes merely to satisfy archived text |

Items not named above remain **UNRESOLVED for individual semantic disposition** even though their IDs and text are inventoried. Several grouped source IDs include mixed UI and technical detail: a mapping to an owning rule does not mean the optional UI/feature is automatically admitted, nor that a local test proved it.

### Additional historical Identity recovery input

The consolidated archive's `نتيجة الفحص الأولي.txt` describes a 2026-10-29 **historical Operator backup** where the original Operator reportedly had no registered Passkey or recovery credential and local development access was previously possible. This is not a check of current credentials or secure recovery. `governance/identity.md` now requires original-actor continuity, verified Passkey/recovery setup, session-family protection and no permanent password bypass or second Root Owner. Current Identity database inspection, login test, privileged recovery and production proof remain **NOT_RUN**; do not put any environment password or secret into governance/ZIP outputs.

### Scope completion rule

- **PASS**: consolidated archive 9/9 manifest, historical Control Panel pack 62/62 manifest, read-only V2 duplicate comparison, 112/112 source-ID inventory, 16/16 named Journey document structural coverage and the relevant foundation tests on the candidate SHA.
- **PARTIAL**: meaning-level final signoff of *all* historical archival decisions, exact business-policy defaults, untouched older source/candidate feature evidence and per-requirement current app behavior.
- **REVIEW_BLOCKED**: independent finance/security/migration policy risk review.
- **NOT_RUN**: current code/SQL/runtime integration, complete attached-content-by-line proof, external URL/license revalidation, and remote GitHub Actions/CodeRabbit tests for the unpushed candidate.

Do not set `GOVERNANCE_CUTOVER: READY` based on a manifest, a 112-row index, 16 named Journey sections or all-green structural assertions. Review semantic conflicts and mandate an independent qualified review before any final adoption.

---

### Archived source bundle integrity and authority review

Consolidated archive at `%USERPROFILE%\Desktop\BTHWANI-REFOUNDATION-COMPLETE-PACKAGE-20261112.zip`:
- Size **527,304 bytes**; whole-container SHA-256 `9a245787302f9f9ee31832b731650b89d19692587033b230938ada7d8648f8f1`.
- **11 ZIP entries**: `9` payload files listed in `MANIFEST-SHA256.txt` and `README.txt` plus the manifest itself; content hashes and lengths **9/9 PASS** on this audit. No extraction into the candidate source tree, no external code execution.
- Embedded October Control Panel original CSV **112/112 historical requirement wordings matched** against `docs/reference/HISTORICAL-CONTROL-PANEL-REQUIREMENTS.md` after the table's documented whitespace/escape normalization. This is *source-fidelity*, not implementation or legal verification.

| Consolidated member/source | Role and current authority |
| --- | --- |
| `01-Execution-Command/...` | Older full-system implementation scope and risks, **future refoundation input**, not authorization to execute Codex CLI or target an old worktree |
| `02-Reference-Bundles/BTHWANI_ULTIMATE_...zip` | Historic audit trigger methodology and integrity inputs; avoid new parallel orchestrator/CI or unconditional framework adoption |
| `02-Reference-Bundles/BTHWANI-Control-Panel-...zip` | Oct 2026 UI requirements and repeated V1/V2 evidence; 112 IDs inventoried, changes filtered by current decisions |
| `03-Attachments/Pasted text(20261111-214531)(1)(3).txt` | Past governance/reconstruction discussion, not present implementation/branch proof |
| `03-Attachments/Pasted text (2)(20261111-214538)(1)(3).txt` | Past CI/cleanup suggestions; reuse one current stage guard and future real-code checks instead of duplicating CI |
| `03-Attachments/Pasted text(20261111-235836)(3).txt` | Past SQL/Docker/code redesign discussion; preserve constraints, defer actual changes to the authorized next phase |
| `03-Attachments/BTHWANI-REFOUNDATION-DEEP-AUDIT-ACTION-PLAN-20261112(1)(3).md` | Branch-40-era audit and refoundation advice; no old SHA/SQL counts/PR state treated as current |
| `03-Attachments/Pasted text(20261110-042824)(1)(3).txt` | Chronological decision discourse and code observations of branch 40. Latest explicit user approvals and branch-41 live source take precedence; former Field flows remain retired |
| `03-Attachments/نتيجة الفحص الأولي.txt` | Historic local Operator login/recovery observation. Original user/credentials are protected; no current access or production recovery conclusion |

**Meaning-level reconciliation limit:** each archived record can contain a historical proposal, assistant inference, source-dated observation, rejected approach and later approval *in one file*. Chronology alone does not elevate a speculative technical mechanism to Product law, and an earlier statement that all local data were disposable does not authorize current protected-data deletion. No old '100%' assertion is proof. Owners are reauthored in `governance/` and execution protections in `AGENTS.md`; current implementation must later be read from its actual current code, contracts, running services and protected data. Specific legal agreements and independently reviewable financial/security/migration obligations are NOT fully ratified from archives.

**High-priority documentary reconciliation completed in this wave:** 16 named Journeys, early-Order factual contact and claim, DSH Order-bound operations exceptions/SLA, WLT remittance/beneficiary distinction, DSH StoreOffer popularity, Operator keyboard/RTL/accessibility/query continuity, identity recovery safety, all 112 historic Control Panel ID decisions classified in the sole temporary plan. **Still outstanding:** full paragraph-level legal/contract interpretation, other source/ZIP narrative items not materially selected into canonical Owner decisions, independent finance/identity/DB risk review and live implementation acceptance. These are NOT_RUN/REVIEW_BLOCKED rather than a fake 100% score.


### 2026-11-12 — Original 14-owner section comparison, material corrections and remaining review boundary

A read-only pass compared the **14 domain-owner files** in source branch `41` with their target files under root `governance/`. Heading/uppercase-identifier coverage is a **gap-finding heuristic**, not a semantic-equivalence proof. The comparison surfaced and this batch reauthored missing **business consequences** at their existing owner rather than copying donor paragraphs:

| Source owner/section | Corrected in target | Critical distinction preserved |
| --- | --- | --- |
| `stores.md` / `STORE_OPERATIONAL_AVAILABILITY` | `governance/stores.md` | `OPEN_FOR_ORDERS`, `CLOSED_BY_SCHEDULE`, `PAUSED`, `OPERATIONALLY_UNAVAILABLE` are derived DSH orderability results; publication, Offer, Service City and durable delivery-mode admission remain separate |
| `commerce.md` / `ORDER_LIFECYCLE` | `governance/commerce.md` | Actual Order freezes one supported fulfillment mode; `DELIVERED`, `PICKED_UP`, `REJECTED`, `CANCELLED` cannot be conflated; original Order snapshot and lawful adjustment are separate |
| `finance.md` / fees and commissions | `governance/finance.md` | Official Cash-In provider **gross** beneficiary credit is distinct from actual external net proceeds and platform provider-fee expense; historical account labels are **economic meanings**, not new SQL schema |
| `finance.md` / BThwani Captain delivery margin | `governance/finance.md` | Initial zero-product-commission eligible fixed markup is shown separately to Customer; full base delivery fee belongs to Captain, markup to platform, subject to approved future-effective financial policy and independent review |
| `finance.md` / recipient readiness | `governance/finance.md` | `DEFAULT_OWNER`, `SELECTED_VERIFIED_STAFF`, `RECIPIENT_REVIEW_REQUIRED` preserve explicit Store beneficiary routing and fail-closed staff revocation; no silent fallback or redirection |
| `finance.md` / historical COD | `governance/finance.md` | Old `FINALIZED`/`REMITTED` obligations retain settlement evidence; new internal Captain wallet top-up never manufactures earlier physical remittance or double debit |
| `journeys.md` / named scenarios | `governance/journeys.md` (prior batch) | 16 exact historical Journey IDs and owner handoffs with versioned policy values, including contact, Operations evidence, remittance and payout |
| `catalog.md` / popularity and `experience.md` / operational UX | Prior batch already placed in canonical owners | Genuine completed-Order popularity, server-owned query/filters, WCAG 2.2 AA, RTL/privacy/focus and optional widget admission |

**Reference checks performed**: all 112 Control Panel historic ID+wording entries matched the original October CSV; per-ID documentary classification covers 112/112 and is guarded against missing/duplicate/false `PASS` entries. The consolidated ZIP 9/9 payload hash verification and branch-41 original `HEAD` are recorded above. None is a verified actual Owner API, applied SQL migration, external transfer or legal contract approval.

**Explicit remaining gates**:
- Legal/payment agreement version, Cash-In actual provider contract/fee, WLT ledger account mapping, gross/COD/markup conservation, owner-vs-Finance authority and paid historical remittance require **qualified independent review**; status `REVIEW_BLOCKED`. This prose cannot activate or post money.
- `R049/R064/R071/R073/R074/R090/R105` were old branch/PR-specific instructions, superseded by read-only current revision inspection and source-specific later migration; do not run them now.
- Full per-paragraph review of the large chronological pasted conversations, nested archival documents, all project code/SQL/contracts and the protected production-state truth remains **NOT_RUN/IN_PROGRESS**. A completed 112-ID **source catalog** is not an exhaustive historical Product signoff. Latest explicit user choices override earlier incompatible observations; ambiguous legal/financial choices remain safely unavailable.
- The current foundation stage needs its own reviewed governance cutover decision; `GOVERNANCE_CUTOVER` stays `NOT_READY`, with no remote Push, PR, Merge, full system CI, app/service/SQL edits or production modifications.


## 2026-11-12 — Engineering house setup, stages 1–3 ONLY (user-authorized; NO version upgrades)

**Scope and stop condition:** prepare the already authorized clean Worktree through (1) governance/reference assessment, (2) inspection/pinning of original existing tools, and (3) minimal pnpm workspace. Explicitly stop before Stage 4 Expo/mobile/Web, Stage 5 Go services/OpenAPI contracts, Stage 6 Docker/PostgreSQL/SQL and Stage 7 production/global CI. No new Branch/Worktree, remote Push, PR, Merge or global tool upgrade.

**Donor evidence:** `D:\samrim` branch `41` at `426d67b47beb8c66b09acd8c7394086b53ac5aae`, especially root `package.json`, `pnpm-workspace.yaml`, `pnpm-lock.yaml`, `.node-version`, `.go-version`, `.nvmrc`, `tsconfig.base.json`, `biome.json`, 3 surface package manifests, Control Panel and Tamagui design package manifests, and four `go.mod` owners. Exact values and later Stage-4 versions recorded in **non-governing** `docs/reference/TOOLCHAIN-SOURCE-VERSIONS.md`. Historical reference manifest and consolidated archive remain read-only, not executable policy.

### Stage 1 — governance and references: PARTIAL / REVIEW_BLOCKED

- **PASS scoped:** existing 14 draft domain owners, 26 capability IDs, 16 named journeys, Control Panel 112-ID historical source inventory/crosswalk, one normative target `governance/`, non-normative `docs/reference/`, protected agent/placement boundaries. These existed before this tooling batch and are retained.
- **REVIEW_BLOCKED:** independent competent finance/Identity/security/protected database migration review, legal agreements and final acceptance; **NOT_RUN** exhaustive source-to-final-product legal validation, current production data and GitHub remote checks. Remain `GOVERNANCE_CUTOVER: NOT_READY`. Do not call Stage 1 fully finished or commence real business implementation on the strength of structural passes.
- **Stage-gate decision:** low-risk, reversible *toolchain/workspace scaffolding only* may proceed while those documentary reviews are pending. It is not Product/financial/SQL code and grants no permission to alter protected data.

### Stage 2 — exact donor versions, no upgrade: PASS for CLI availability

| Source owner/version | Installed observation / action | Status |
| --- | --- | --- |
| Node `24.22.1` in `.node-version` and `.nvmrc` | Local `node --version=v24.22.1`; new root pins unchanged; source engine range `>=24.17.0 <25` preserved because pnpm standalone bundles a separate Node `24.19.0` | PASS |
| pnpm `12.15.0` | Installed exactly `12.15.0`, created slim frozen lock and installed **offline**, 0 registry downloads, 0 version upgrades | PASS |
| TypeScript `7.0.2`; Biome `2.5.12` | Exact `pnpm exec tsc --version` / `pnpm exec biome --version` readbacks; separate isolated local node_modules | PASS |
| Go `1.27.3` source `.go-version` and go.mod | Exact Go `1.27.3` now available in user toolchain cache and verified with `GOTOOLCHAIN=go1.27.3` and `GOPROXY=off`; system Go remains `1.27.1`, neither project pin nor global binary was changed | **PASS exact CLI; Go services/builds NOT_RUN** |
| Git `2.55.0.windows.3` / Docker CLI `29.9.2` / Compose `5.6.1` / Java `21.0.12.1` / adb `37.0.1` | Presence/version read only; Java/ADB app builds, Android SDK completeness and running containers **NOT_RUN** | inventory PASS; runtime checks NOT_RUN |
| Nx `24.0.1`, Expo `58.0.19`, RN `0.88.0`, Tamagui `3.3.1`, Next `16.4.3`, Ant Design `6.6.7` | Exact donor versions recorded; **not installed in new Worktree** because no affected runnable projects yet | DEFERRED, no upgrades |

The initially missing exact Go toolchain was resolved using Go's standard user-managed toolchain at the same required version `1.27.3`. The global `go` command still reports `1.27.1`; only explicit `GOTOOLCHAIN=go1.27.3` is a correct exact-version proof. Both `pnpm run check:toolchain` and its direct verifier now PASS with `GOPROXY=off`, without installing Go globally.

The installed pnpm program has its own Node runtime that differs from `node --version`; copying a narrower `engines.node: 24.22.1` was rejected as incompatible. The correct source-compatible `engines.node: >=24.17.0 <25` was retained without any version upgrade. No change to the existing system's runtime, source branch or globally managed tooling was performed.

### Stage 3 — minimal reproducible pnpm workspace: PASS structurally

- `package.json` is private, `pnpm@12.15.0`, exact `typescript@7.0.2` and `@biomejs/biome@2.5.12`; no legacy source apps/dependencies/overrides/patches copied. `pnpm-workspace.yaml` reserves future `apps/*`, `packages/*`, `services/*` **as globs only**; no directories or business source created.
- `pnpm-lock.yaml` freshly generated using existing pnpm offline, then `pnpm install --offline --frozen-lockfile --ignore-scripts` **PASS**. No new registry fetches, dependencies selected only from the local content-addressable store, and no package scripts executed. `node_modules` is Git-ignored.
- `tsconfig.base.json` keeps source strict TypeScript/noEmit; `biome.json` reuses Biome `2.5.12` for lint rather than installing a second ESLint/formatter stack without proof. `.editorconfig`/`.gitattributes` enforce clean UTF-8/LF; `.gitignore` protects credentials and builds. Old SQL checksum-specific `.gitattributes` exceptions are **not copied** because no migrations are present.
- `tools/dev/verify-workspace.mjs` verifies source-matching version pins, root private package, expected workspace globs/config, unchanged versioned lock and absence of premature apps/services/contracts/infra/Nx configuration. Optional `--require-exact-toolchain` now **PASS** by finding an installed exact Node binary and using cached Go `1.27.3` offline; this does not assert that Go services were built/tested.
- **Nx decision:** defer local Nx `24.0.1` install/`nx.json` until one or more real Project targets exist, then confirm affected graph/caching benefit at the **same exact source version**. No Nx Cloud and no empty placeholder projects/packages. **ESLint decision:** do not install redundant ESLint; exact donor Biome is the existing lint solution.
- **Scope of PASS:** workspace syntax, pinned tool binaries and clean offline lock reinstallation. There is **no** TypeScript application project or Go module to compile yet; no Expo/Metro Web/RTL, Nx affected graph, OpenAPI generator, Go build/test, SQL migration, browser/Android/iOS or Docker service acceptance. These remain **NOT_RUN** by deliberate user stop at Stage 3.
- GitHub remote Actions/CodeRabbit are not proven for the local unpushed candidate. Foundation guard's structural checks and adversarial tests are local evidence only.

**Forward boundary:** Do not enter Stage 4 or higher without a separate user directive. No need to "upgrade everything" when later creating consumer packages: use the exact donor package versions above, and re-evaluate any required upgrade **only after an explicit independent decision and separate permission**.


## 2026-11-12 — Stage-1 policy cutover decision packet (scope-limited; independent signoff OPEN)

**Revision basis:** existing Worktree `refoundation/clean-house-20261112`, donor original branch `41` at `426d67b47beb8c66b09acd8c7394086b53ac5aae`. Current draft owner documents are the review subjects, not implementations. The historical consolidated archive was SHA-256 checked and its 112 archived Control Panel requirement IDs are individually classified earlier in this plan; **their documentary mapping does not imply independent legal or financial ratification**.

### Stage-1 scope actually proven by local review

- 14 canonical draft domain files and one `governance/README.md`; original `docs/governance/` absent. Exactly 26 admitted Product capability IDs, 16 named cross-owner Journeys and 112 unique historical Control Panel ID classifications retained by adversarial tests.
- One owner/one writer boundaries, mutable **owner-backed Operator Policies**, and preserved distinction between Product features and immutable security/accounting/data safeguards. No policy may activate an unimplemented service/payment method or rewrite previous accepted Orders/agreements.
- Internal Markdown link resolution is now checked by the existing `tools/governance/verify-foundation.mjs` with positive and negative fixtures (broken local link and path escape). External OSS/media/source links remain archival, **not** live-verified licensing rights or authorization to import copied assets.
- Spec Kit derived router and provenance manifest remain under guard; official CLI availability does not establish commercial semantics. GitHub Actions/CodeRabbit/CodeQL/Sonar *remote execution* remains NOT_RUN without authorized Push/PR; `actionlint` previously denied by the device channel remains BLOCKED, not bypassed.

### Independent decision gates: evidence and explicit unresolved approvals (historical 2026-11-12 snapshot; later human decision above supersedes external-reviewer prerequisite)

| Gate and owning document | Exact high-risk question to resolve **before** READY | Required independent reviewer/evidence | Current status |
| --- | --- | --- | --- |
| FIN-01 `finance.md`, `commerce.md`, `journeys.md` | COD/WALLET/MIXED quote splits; Captain gross coverage compared with whole payable Order versus **actual cash-only reserve/debit**; concurrent accept, cancellation, replay and refund; exact integer YER and ledger balance | Independent finance/accounting reviewer examines one versioned policy/accepted-agreement specification, formal debit/credit examples for each admitted mode, and later owner-backed concurrency evidence | **REVIEW_BLOCKED** |
| FIN-02 `finance.md`, `stores.md` | Commission or subscription independent of MARKETPLACE/DIRECT; who legally collects Store proceeds; platform commission receivable/offset and Store-settlement beneficiary, including revoked staff; no duplicate credit | Independent finance/legal review of accepted contract terms, permitted collection custody, payout destination approval, reconciliation and historical liabilities | **REVIEW_BLOCKED** |
| FIN-03 `finance.md` | Provider gross customer funding versus provider net/fee expense, zero-product-commission BThwani Captain delivery markup, and segregation of Captain base fare/platform margin | Verified provider agreement/fee schedule, independently balanced posting examples and legal charging approval; avoid copying old SQL account names as canonical schema | **REVIEW_BLOCKED** |
| SEC-01 `identity.md`, `safety.md` | Original Operator continuity, Passkey enrollment/recovery and controlled bootstrap; no duplicate Root Owner or globally accepted local-password bypass | Independent Identity/security reviewer confirms allowed recovery model, signer/session revocation and privilege grants; later protected owner-state proof only via authorized isolated methods | **REVIEW_BLOCKED** |
| SEC-02 `stores.md`, `catalog.md`, `commerce.md`, `safety.md` | Cross-Store/actor/city/role isolation, delegated access, IDOR, old-session pending response, unpublished Store privacy and prospective Captain Customer address secrecy | Independent threat-model reviewer signs route/resource/ACL matrix; subsequent negative Web/Android/owner tests when code exists | **REVIEW_BLOCKED** |
| MIG-01 `safety.md`, `finance.md`, `engineering.md` | Applied SQL migration history/checksums, existing real Store/Order/user/wallet/COD data, rollback limitations and reproducible isolated backup/restore; no destructive clean-slate assumption | Independent database/migration reviewer, donor schema/applied-ledger concordance and protected upgrade plan, later real isolated fresh/upgrade/restore outcomes | **REVIEW_BLOCKED** |
| LEGAL-01 `stores.md`, `finance.md`, `product.md` | Which historic signed merchant/Captain/employee and payout obligations survive? Are new commission/subscription/collection defaults actually lawful and consented? | Authorized Product/legal decision-maker and independent finance/legal reviewer check the effective accepted agreements and consent changes; no inferred date or unsigned contract is authoritative | **REVIEW_BLOCKED** |
| SRC-01 `docs/reference/`, all owners | Remaining archive paragraphs, source research links/licenses and real status of feature proposals that are not in the 112-ID Control Panel inventory | Owner-led source-by-source adjudication with dated evidence; rights/legal reviewer where protected or third-party material is adopted, not blanket inclusion | **PARTIAL / NOT_RUN for external URLs** |
| GH-01 `.github/`, `AGENTS.md` | Actual branch protection, CodeRabbit/GitHub workflow results on identical final candidate and required independent reviews | Separate authorized GitHub submission, actual check URLs/SHAs, approval record and branch-rule inspection; **no current Push/PR authorization** | **NOT_RUN** |

**Acceptance evidence format for each gate (not a second governance registry):** reviewer and independence/competence basis; exact `governance/` owner paragraph and donor evidence; affected policy versions/agreements/actors; scenario and negative/rollback/retry evidence; reasoned PASS/FAIL/REVIEW_BLOCKED; approved resolution or documented rejection; reviewed SHA, date and scope. An AI self-review, structural checksum or assertion by the same editor cannot substitute for the mandated independent review. If a gate is unresolved, maintain safe nonactivation and do not mark `GOVERNANCE_CUTOVER: READY`.

**Stage boundary (historical before the 2026-11-13 human policy decision above):** Policy wording/structural hygiene can improve now without code or SQL. Later owner API/SQL/Web/Expo implementation may not start solely because the tool-only pnpm workspace is ready. No Product apps, Go modules, contracts, PostgreSQL or Docker resources were created in this batch.

### Local exact-version toolchain mismatch closure

- The former reported **missing Go 1.27.3** is resolved for **local CLI availability**: normal Go user toolchain cache contains the original required `go1.27.3`; explicit `GOTOOLCHAIN=go1.27.3`, `GOPROXY=off` gives `go version go1.27.3 windows/amd64`. Global `go version` still says `1.27.1` by design.
- `tools/dev/verify-workspace.mjs --require-exact-toolchain` finds an installed exact `node.exe v24.22.1` despite pnpm's embedded Node `24.19.0`, then executes the user-cache Go `1.27.3` offline. `pnpm run check:toolchain` is therefore **PASS** without any global runtime replacement, version upgrades, app install or new backend code.
- Stage 2 is **PASS for exact CLI readiness**; Stage 3 remains **PASS for the minimal reproducible package foundation**. No `go test`, `go work sync`, RN/Expo/Next boot, contract API integration, Android, Docker or SQL was executed. Their readiness remains `NOT_RUN`, not implied by toolchain presence.

---

## 2026-11-13 — Presentation-foundation-only closure gate (DESIGN-04; no feature screens)

**Explicit current human scope:** prepare the existing four apps and their two justified design packages to receive future screens. **Do not create Customer/Merchant/Captain/Operator business routes or features, duplicate Tamagui/Ant/Expo components, native builds, EAS/OTA, commercial API clients, services, SQL or Product activation in this design slice.** The independently active service-infrastructure worker owns its own files and pnpm dependencies; avoid simultaneous edits of root lock/workspace governance/Git index. This plan is execution evidence only; normative visual constraints belong exclusively to governance/experience.md. Governance remains NOT_READY.

**Candidate context when the design change began:** branch refoundation/clean-house-20261112, HEAD 5113e03d27e0deebff321457c328ddb2d2021a38; service worker may advance HEAD afterward. Any test result refers only to its observed tree; no CI or device result can be inherited for a different final SHA.

| Gate | Scope and canonical owner | Evidence completed / remaining | State |
| --- | --- | --- | --- |
| UX-FND-01 | Small single-source design-system brand/semantic colors and generated CSS | Existing parity/contrast source guard passes; real Android/iOS/Operator accessibility and all role-pair contrast need runtime proof | PASS for source, PARTIAL visually |
| UX-FND-02 | Tamagui 3.3.1 sole Expo renderer, official web/native animation drivers | Existing module and customer preview smoke tested on Web/Android; no new components required. Need platform-aware reduced motion, focus, native gesture/keyboard evidence | PARTIAL |
| UX-FND-03 | Existing tamagui-config mobile appearance controller | Regression tests cover restore race, concurrent persistence order, failed storage rollback, dispose and System scheme; changes local and subject to final clean Git review | PASS tests, final integration pending |
| UX-FND-04 | Expo SDK 58 pinned configuration and original mobile identity | Actual expo config --json checked for Customer/Merchant/Captain; central locale forced RTL and web server mode. Fresh matching native binaries and iOS not built or tested | PASS source; NOT_RUN native |
| UX-FND-05 | Expo module/plugin and permissions census | Before any removal or native rebuild enumerate actual consumer or approved future capability, config plugin, platform, sensitive permission and provenance for expo-font, image, localization, router, notifications, location, secure store, audio/camera/media/maps, @expo/ui and other pinned dependencies. No invented package replacement | NOT_RUN complete census |
| UX-FND-06 | Arabic typography and accessibility | Evaluate system Arabic font first; custom font only with license/shaping/fallback evidence; test mixed numerals, long RTL content, font-scale, keyboard and screen reader across the real platform | NOT_RUN comprehensive |
| UX-FND-07 | Next 16.4.3 / Ant 6.6.7 SSR and CSS | Single AntdRegistry/ConfigProvider/semantic projection exists. Enforced request-scoped CSP nonce, SSR/Hydration/Portal/Modal/Select tests and exact pinned Ant CSP patch removal proof not yet established | PARTIAL; CSP NOT_RUN |
| UX-FND-08 | Web and Android acceptance without business screens | Test existing lightweight foundation shells for SSR ar/rtl, appearance persistence, focus, reduced motion and runtime errors with Playwright/Android; no need to add more labs/screens. Device-specific screenshots are supplementary | PARTIAL |
| UX-FND-09 | Reproducible CI and negative guards | Local design/app guard, deterministic appearance race and Expo resolved-config tests added. Linux runner exact pnpm lock install, workflow execution, full Next/Expo build and SHA-bound results are NOT_RUN until separately authorized GitHub submission | PARTIAL |
| UX-FND-10 | Performance and installation behavior | Verify export/build, responsiveness, slow startup, permission denial, app resume, memory under representative conditions; retain exact source dependency pins, no speculative upgrade or duplicate platform plumbing | NOT_RUN comprehensive |

**Delivery sequencing:** (1) keep current owner/branch and separate ownership from service worker; (2) finish deterministic appearance/native-config regression tests, source parity and exact-package build; (3) prove Next/Expo SSR plus CSP and accessibility using actual browsers; (4) prove installed Android, native permission/RTL/reduced-motion behavior, and iOS only when a valid environment is actually provided; (5) run final candidate-specific CI and independent review where required; (6) close stage only when all mandatory gates have tangible evidence. Scope of completion is **presentation foundation only**, never commercial platform readiness. Do not label any untested behavior 100% PASS.

**Coordination and risk:** Service-worker changes under services/, root lockfile or common workspace may invalidate cross-repository checks while design checks still pass. Recheck actual HEAD, owners, lockfile and modified paths before any commit; do not stage, discard or overwrite the service worker's uncommitted changes. A local design commit is permissible only as a coherent verified batch under one Git writer and must never imply Push/PR/Merge authorization.

## 2026-11-13 — Source-ready app boundaries and protected CI recovery (implementation batch)

**Scope/authority:** The human authorized starting the prior comprehensive readiness plan. This batch changes only repository placement rules, source guards and GitHub check wiring, without app screens, source service operations, Go, executable OpenAPI, SQL, databases, secrets, Docker, upgrades, EAS builds or runtime deployments. No Push, PR, Merge or main change is authorized by this batch. HEAD at start: `852584530e8a58b93e2c744559b2fc025bb1e50b`; all fresh CI must be tied to a later exact candidate SHA.

| Work | Implementation in this batch | What can be proven before publishing | Pending external gate |
| --- | --- | --- | --- |
| DEV-BOUND-01 | `tools/mobile/verify-application-boundaries.mjs` and adversarial tests scan app/package/service-client literal imports, forbid private cross-owner imports, and reject dual route roots; wired into `check:apps` | Negative fixtures and current candidate scans | Computed imports, full package graph/cycles and future real feature consumers remain untested |
| DEV-SEC-01 | `tools/security/verify-secrets.mjs` with negative tests; checks tracked credential filenames and likely source markers without logging values; wired into `pnpm check` | Current tracked candidate scan | Full Git history, provider-side token validity and repository secret scanning configuration are separate |
| CI-FAST-01 | Existing Foundation Guard also runs for PRs targeting `main`, and adds a `fast-guard` check that **depends on real foundation/presentation success** plus independent stage-appropriate ownership/secret checks | `actionlint`, local tests and source scripts | GitHub execution on exact new SHA and integration with main rules are NOT_RUN until authorized Push and PR |
| CI-SONAR-01 | One `sonar-project.properties` for existing project key `bthwani2-boop_samrim`, and `.github/workflows/sonar-quality.yml` for same-repository PRs to main and main pushes with unchanged actual Sonar Quality Gate; fork tokens remain inaccessible | `actionlint`, exact project key and no override/bypass | Sonar execution on new candidate NOT_RUN, legacy main Quality Gate still failing; root cause must be read from live Sonar findings |
| CI-CODEQL-01 | No duplicate CodeQL workflow introduced because repo has default CodeQL setup and main rules enforce code scanning | Current main settings and historical CodeQL check known | New PR candidate code scanning and alerts NOT_RUN |
| PLACE-01 | Root `REPOSITORY-STRUCTURE.md` differentiates route roots, private feature ownership, legacy external app IDs, service clients and domain terminology | Source-law review plus current tests | Do not lift `src/features` phase guard before a separately admitted first feature |

**CI semantics:** Foundation Guard PASS means structural/sparse presentation evidence only, and `fast-guard` here is a protected merge status **for the admitted sources**, not a resurrected donor Go/SQL/finance test. When service code/operations/migrations are admitted, replace the current stage prohibition with real affected-service tests before claiming coverage; do not let a green source-only job stand in for running engines. Sonar must evaluate its actual Quality Gate and may legitimately FAIL; never remove the requirement or fake a status.

**Open readiness work (not delegated to a fake placeholder):** (1) independent review for blocked governance/material finance/security/migration/legal choices; (2) new Worktree environment-key mapping and safe secret stores without copying donor `.env`; (3) real OpenAPI operations and generated owner clients **after contracts are approved**; (4) Go/SQL/backups/isolated Docker as separate authorized implementation slices; (5) app UX/CSP/native RTL/iOS proofs and permission testing; (6) real CI/CodeQL/Sonar on the final PR candidate, Sonar findings and existing open PR impacts; (7) protect old main and branch 41, PR and merge only after distinct human authorization. See the existing domain owner sections for legal meaning; no second Product glossary is created here.

**Terminology boundaries:** `Merchant` is an Identity actor, `Store` is a DSH resource; relation `MARKETPLACE/DIRECT`, financial model `COMMISSION/SUBSCRIPTION` and collection responsibility `PLATFORM_MANAGED/STORE_MANAGED` are independent. Internal `apps/merchant` is NOT an EAS `app-partner` rename. Client package is NOT a running service. Path fragment is NOT an endpoint. A baseline for a fresh empty DB is NOT an applied historical migration. `CI PASS` is NOT `governance READY`, product security approval, or production readiness. The canonical meaning remains with the owner; these are implementation disambiguations only.

## 2026-11-13 — Foundation CI runtime pin and cross-app package import closure

**Scope:** This is a foundation/CI guard correction in the existing worktree only; it is not domain implementation or governance cutover. Baseline branch `refoundation/clean-house-20261112`, SHA before changes `26bfa42d352a299b103bef669157110b117ff863`.

- The application boundary guard now rejects `@bthwani/<other-app>` package-name imports as well as relative private source imports. The negative test failed before the fix and passed afterward. Same-app imports and public service-package exports remain permitted.
- Foundation and `fast-guard` jobs use the exact `.node-version` via `actions/setup-node` (the presentation job already did). Two new negative governance tests reject an unpinned CI job.
- Local verification at this tree before the final commit: `actionlint` PASS; `pnpm check` exit 0 (governance 119 pass / 1 Unix-only skip, application/RTL/appearance 28 pass); TypeScript, theme, stage and source guards PASS. Biome emitted existing non-blocking style information.
- **Not proved:** GitHub execution of the new SHA, remote Sonar/CodeQL required checks, browser/Android/iOS runtime acceptance, services/SQL/financial transactions or independent FIN/SEC/MIG/LEGAL review. Those gates remain NOT_RUN or REVIEW_BLOCKED.
- No secrets or protected runtime data were read for this change; no Push, PR, Merge, deployment, new branch or worktree was authorized.

## 2026-11-13 - Main cutover deferred and source-first execution initiated

**Latest human instruction:** Do not merge or switch main now. Work in the already authorized refoundation/clean-house-20261112 worktree/branch to implement applicable tasks first, then evaluate main cutover separately once the whole admitted target has evidence. This does not authorize Push, PR mutation, Merge, deploy, protected-data change, branch/worktree creation or a forced governance approval. Existing Draft PR #189 remains a historical in-progress delivery candidate, not the current implementation completion gate.

**Audit basis:** BTHWANI-REFOUNDATION-CURRENT-DEEP-AUDIT-COMPLETE-A2Z-20261113.md (Downloads, SHA256: C4D7A3F875A71AB3183E4E903E8948ED649262E2B5BE442820517AE10F33D177). Its 138 indexed tasks are a requirements/backlog reference; its HEAD 26bfa42d3 and CI statuses are historical, not present-tense proof. Live candidate at entry: ebb050024dba6950de7ad76c44c0753cef6f0942; donor reference: branch 41, 426d67b47beb8c66b09acd8c7394086b53ac5aae. Keep all current source-of-truth instructions and single-writer ownership.

**This source-first batch, not domain activation:**
- BASE-01/BASE-02/BASE-06: checked branch, worktrees, HEAD, clean worktree, donor SHA and no implicit Git/DB authority. PASS for this preflight only.
- SRC-01 / SQL-01: the new non-normative docs/reference/DONOR-SERVICE-SQL-SOURCE-CENSUS.md preserves the exact donor Git object ID of **all 277 tracked SQL source files**, establishes three continuous migration filename ranges (Identity 30, DSH 182, WLT 63), and names the WLT baseline + infrastructure runtime roles. No SQL or Go execution, migration parity or applied-DB readback. SOURCE_FILE_CENSUS_PASS; semantic/runtime SQL remains NOT_RUN and MIG/FIN REVIEW_BLOCKED.
- UX-FND-05 / BASE-03: docs/reference/MOBILE-EXPO-MODULE-CONSUMER-CENSUS.md lists the pinned Expo/@expo dependencies across the current three apps (Customer 37, Merchant 38, Captain 33) and their literal source references. No package removal, downgrade, plugin/license assumption, native build or EAS change. MANIFEST_CENSUS_PASS; native permissions, actual consumers and future-feature admission PARTIAL/NOT_RUN.
- GOV-01 donor reconciliation began with a bounded Store-delegation gap: historical branch-41 docs/governance/platform.md requires an allowlisted Store grant with expiry/revocation/audit. The missing explicit validity/expiry constraints were restored as DRAFT text at the canonical owner governance/stores.md; DSH/Identity/Finance semantics remain separately owned. This is not a blanket donor-law import or independent security approval. The 14-owner full semantic concordance, 26 subfeature reconciliation and remaining GOV-01 through GOV-12 approvals remain PARTIAL/REVIEW_BLOCKED. The source inventory cannot certify or activate financial, security, legal or SQL implementation. GOVERNANCE_CUTOVER: NOT_READY.
- Postponed main transition: do not auto-close, mark Ready, merge or deploy PR #189; any future final cutover must be separately authorized and tested against the final SHA and mandatory review. Earlier Sonar PASS, CodeQL/Go FAIL and draft PR checks do not establish functional product readiness.

**Execution order from the deep audit:** (1) semantic donor-to-14-owner concordance plus 26 capability/subfeature evidence, with unresolved decisions recorded; (2) independent FIN/SEC/MIG/LEGAL policy reviews and explicit governed cutover; (3) contract + Go/SQL implementation only at admitted service owners with protected fresh/upgrade/restore gates; (4) actual Customer/Merchant/Captain/Operator feature slices backed by those owner contracts and real Web/Android/device/API tests; (5) run final CI and external provider/deploy review on the *final* candidate, then request a separate main transition approval. No bulk donor-code copy or live database migration is implicit.

## 2026-11-13 — Governance source heading census (evidence only)

- Pinned donor branch `41` at `426d67b47beb8c66b09acd8c7394086b53ac5aae` and compared 14 historical semantic owner files to their 14 same-named current draft owners on pre-batch target `d4f542df68533b06d42aa3a1a8b3338fd5a757c9`. The [read-only section provenance census](DONOR-GOVERNANCE-SECTION-CENSUS.md) contains **340** donor Markdown headings, **138** target headings, exact donor blob IDs and original line numbers. Exactly **one** heading is an identical Markdown title; neither literal absence nor presence proves missing or retained semantics.
- `SOURCE_HEADING_CENSUS: PASS` is **navigation and provenance only**. Comprehensive paragraph/decision reconciliation, archived contracts/discussions, independent FIN/SEC/MIG/LEGAL reviewers and latest policy approval remain **NOT_RUN/REVIEW_BLOCKED**. No normative owner was amended by this inventory, and `GOVERNANCE_CUTOVER: NOT_READY` remains unchanged.

## 2026-11-13 — Safety owner source-grounded reconciliation (draft only)

The pinned original branch-41 `docs/governance/safety.md` (Git blob `24dd35f1bddfc2129422183b4c81e6b43bcaa23f`, lines 10–20, 25, 35–40, 49–55) was compared **paragraph by paragraph within the 56-line donor safety file** against the current `governance/safety.md` draft. The following details were explicitly carried into the canonical safety *draft*: trusted actor/recovery proof, anti-enumeration, challenge expiry/attempts/throttling/replay, credential rotation and log minimization; ingestion-only legacy encoding conversion and Arabic/identifier round trips; owned/isolation-verified test-data cleanup and provenance/retention boundaries; no owner-swapping silent fallback, authoritative timeout consequence, health states and correlation. Existing owner-scoped DB privileges, bounded deterministic pagination, multi-record partial-failure semantics and preserved migration history were also checked in the draft rather than reintroducing duplicate owners.

**Disposition:** DRAFT_RETAIN/REFRAME for the cited safety requirements, **not independently accepted security policy**. No runtime authentication test, protected migration, native platform or WLT ledger was exercised by these prose edits; `SEC-01`, `SEC-02`, `MIG-01` and critical legal/financial review remain **REVIEW_BLOCKED**, and the full cross-domain/archives concordance remains **NOT_RUN**. The Stage-4 guard protects the named security assertions as *source text* only, not E2E compliance.

## 2026-11-13 — Identity admission and authorization source reconciliation (draft only)

Compared the pinned donor `docs/governance/identity.md` at blob `bc68ed1256c3b493b5c4366b1bc47dedb47b668a` (material sections at source lines 16–76) with the existing `governance/identity.md` draft. Restored explicit draft distinctions: verified Client-to-Merchant workspace admission without requiring a Store/Operator enrollment case, DSH-approved Captain standing and Store-grant preconditions, preservation of eligibility after loss of the final accepted Store association, forbidden cross-domain credential transfer, and **only** the originally bootstrapped Operator granting/revoking finite workspace permissions. Existing single-actor, role-isolation, Passkey-only Operator login, Root Owner continuity and finance-grant boundaries were retained.

**Disposition:** DRAFT_RETAIN/REFRAME of the specified source clauses, with compatibility of the donor `partner` identifier and current Merchant name still subject to approved API/storage reconciliation. The added negative source tests prevent silent removal of high-risk clauses but cannot certify live Identity, DSH eligibility, user sessions or cross-origin browser security. Independent `SEC-01`/`SEC-02` review remains **REVIEW_BLOCKED**; no real identity or permission records were read or changed.

## 2026-11-13 — Original Platform and HR owner reconciliation (draft only)

Compared the complete pinned branch-41 `docs/governance/platform.md` (Git blob `94050e7f56d957c411331407615b20ec0c9fb86b`) and `docs/governance/hr.md` (blob `decf9fe861166552db27c72ed02d595d824204ef`) against their current canonical owner drafts. **Draft retained/refined:** one permanent natural-person actor with current technical `client`/`partner`/`captain`/`operator` compatibility and new Customer/Merchant/Captain/Operator UI language; no revived acquisition role or parallel Store/Captain actor; delivery recipient remains only a bounded DSH contact snapshot, never purchasing/payment authority; DSH Store grants remain allowlisted, scope/time/revocation bounded. HR now explicitly preserves pending/claimed/rejected initial-Operator access request semantics, one employee-to-actor link, live Identity permission subset readback and retry safety, bounded append-only HR audit and no automatic payroll/biometric deductions. This does not create a new entitlement, employee engine, identity ID or finance writer.

**Evidence limit:** These are source-derived **DRAFT_RETAIN/REFRAME** text decisions, with old vs new role value compatibility and operational/legal acceptance still subject to the contract/data owner and independent FIN/SEC/LEGAL reviews. Material whole-system archive/conversation reconciliation, protected DB and live actor/readback tests remain **NOT_RUN/REVIEW_BLOCKED**. Guards detect loss of key draft assertions but cannot prove policy adoption, payroll correctness or real authorization. `GOVERNANCE_CUTOVER: NOT_READY` remains.

## 2026-11-13 — Customer/Merchant Expo Web production SSR and browser foundation proof

- The pinned Stage-4 Expo configuration explicitly admits **Customer and Merchant Web SSR**, while **Captain has Android/iOS only**; forcing an ad hoc Captain static Web export and receiving a 404 for `/health` does **not** indicate a supported Captain Web defect or authorize adding a new public host. No Captain Web service was admitted.
- On the audited Windows host, the existing Expo 58.0.19 dependencies exported Customer and Merchant `dist/server` SSR bundles, `dist/client` assets and `_expo/routes.json`, **not** standalone `dist/index.html`. Their production `expo serve` hosts each returned HTTP 200 for `/` and `/health`, HTTP 404 for nonexistent routes, and rendered `lang="ar"` with `dir="rtl"`. Customer also served `/lab` at HTTP 200.
- A real browser verified Customer and Merchant Arabic presentation, appearance switch (system to dark), Customer Arabic text input, and client-side navigation to `/health`. Merchant did not inherit Customer's distinct stored theme when opened on its own origin. Browser proof is limited to these Stage-4 presentation shells, not commercial/auth/permissions or actual Store-specific isolation.
- Added `tools/mobile/verify-expo-web-http.mjs` for a **production HTTP/SSR** regression check on separately allocated loopback ports, and wired it immediately after both exports in the existing `.github/workflows/ci.yml` presentation job. It uses the pinned local Expo CLI, does not install libraries and closes its servers after each check. The existing exact-version/owner guards still forbid an unapproved Captain Web host. CI performs HTTP/SSR evidence, **not real browser hydration**, native Android/iOS, auth, financial or owner-backed service integration.

**Status:** Expo Customer/Merchant Web presentation exports and narrowly described local browser/SSR smoke **PASS** for the tested SHA and local build. GitHub CI on the new committed SHA must be separately verified; business/runtime authorization tests and iOS/Android native builds remain **NOT_RUN**. `GOVERNANCE_CUTOVER: NOT_READY` remains unchanged.

## 2026-11-13 — Actual GitHub supply-chain alert triage (not vulnerability closure)

**Observed GitHub source:** `bthwani2-boop/samrim` Dependabot alerts queried live on 2026-11-13, original branch `41` SHA `426d67b47beb8c66b09acd8c7394086b53ac5aae`, candidate branch before this documentation addition `c16d23f5fa96a214c36716818e69b65e9b0708b2`. Do not transpose an alert on the default branch into proof that the new sparse candidate runs that same code. Conversely, a green foundation CI does not resolve known supply-chain findings.

| GitHub alert / severity | Declared dependency and verified source | Verified candidate vs donor scope | Status and admission requirement |
| --- | --- | --- | --- |
| [#130](https://github.com/bthwani2-boop/samrim/security/dependabot/130) HIGH / `CVE-2026-107223` | `github.com/xuri/excelize/v2`, donor `services/dsh/backend/go.mod` at `v2.11.1-0.20261003002531-6258dcebc4e2`, advisory first safe release `2.11.1` | **Donor/main Go runtime affected** as reported by GitHub. New candidate has **no executable Go backend**; no service-runtime PASS follows. | OPEN. Before copying or reintroducing any DSH Excel import/export path, approve the exact patched module version, test malformed spreadsheet/column limits and Go API consumers; review any deployed donor/main instance separately. Do **not** silently alter branch `41` or `main`. |
| [#129](https://github.com/bthwani2-boop/samrim/security/dependabot/129) MEDIUM / `CVE-2026-118764` | Candidate `pnpm-lock.yaml` has `minimatch@10.2.6`, via `@expo/fingerprint@0.21.6`/Expo CLI; advisory range `>=7.0.0, <11.0.1`, first patched `11.0.1` | **Present in candidate frozen dev dependency graph**; GitHub marks alert scope development. It is not proof that an attacker can reach a Customer runtime path. | OPEN. Require an authorized exact version/Expo compatibility strategy and reproducible Android/Web build, imported function behavior and CI before changing frozen dependencies; no unreviewed major-version override. |
| [#126](https://github.com/bthwani2-boop/samrim/security/dependabot/126) LOW / `CVE-2026-93753` | Candidate `pnpm-lock.yaml` has `deepmerge@4.3.1`, via `@expo/config@58.0.8`; advisory lists **no first patched version** | **Present in candidate frozen dev graph**; alert scope development. Exact malicious-config exploitability is not independently established for this Worktree. | OPEN. Check upstream Expo remediation, safe config-input boundaries and an independently reviewed source-compatible fix when one exists; do not invent a patched version or automatically install `latest`. |

**Security disposition:** `SUPPLY_CHAIN_REVIEW_BLOCKED` for the three open alerts; no dependency changes, dismissals, alert suppressions or CVE fixes were performed. GitHub CodeQL Default Setup was observed configured previously, but the current code-scanning alerts endpoint returned HTTP 404 to the available token; **its lack of returned findings is NOT a CodeQL PASS**. Review the default-branch alert closures and the final candidate's security checks independently at the appropriate release gate. Toolchain version parity and presentation SSR tests are distinct scoped PASS results; do not label the whole supply chain, services or production release safe.

## 2026-11-13 — Verified global Go alignment and development environment source boundaries

**New authorization and target:** Later explicit user instructions authorize Commit and Push of reviewed, tested foundation batches to the existing `refoundation/clean-house-20261112` branch. Branch `41` remains read-only reference. No authorization to create a new branch/Worktree/PR, merge into main, deploy, alter live databases or bypass mandatory independent critical-risk reviews follows.

- **Toolchain alignment:** Original source pins are Node `24.22.1`, pnpm `12.15.0`, Go `1.27.3`, TypeScript `7.0.2` and Biome `2.5.12`; the admitted app libraries remain frozen at their existing lockfile versions. The Bthwani Windows host's official Go `1.27.3` machine installation was completed by the previously started WinGet operation and independently read back from `C:\\Program Files\\Go\\bin\\go.exe` with `GOTOOLCHAIN=local` (no Go user-cache substitution). A different machine is **NOT_RUN** until checked independently.
- **Source guard correction:** `pnpm check:toolchain` must verify the actual global Go binary against `.go-version`, not merely force a cached compiler of the right version. The existing `tools/dev/verify-workspace.mjs` implements the check; there is no new version manager or duplicate configuration owner.
- **Environment mapping:** `docs/reference/environment-config-inventory.md` maps non-secret current mobile key names, deferred Identity/DSH/WLT ownership and future Docker isolation constraints. This is historical/configuration evidence, neither provisioned credentials nor a production startup specification.
- **Remaining readiness:** `GOVERNANCE_CUTOVER: NOT_READY`, independent FIN/SEC/MIG/LEGAL policy review, real owner-backed Go/SQL services, protected fresh/upgrade/restore, isolated Docker and native Android/iOS acceptance all remain **REVIEW_BLOCKED/NOT_RUN** as applicable. No progress on tooling alone changes these gates.

## 2026-11-13 — Governance donor-to-owner preservation wave 4 (bounded policy editing; no cutover)

**Authority and baseline:** A human asked to complete remaining governance work immediately. The review used donor branch `41` at `426d67b47beb8c66b09acd8c7394086b53ac5aae`, the existing single-root candidate at starting HEAD `c5512e982330db86079dbe71b79852533997bae2`, `AGENTS.md`, `REPOSITORY-STRUCTURE.md`, the fourteen current owner drafts, their fourteen donor counterparts, the existing heading census and the independently review-blocked policy matrix above. This is a **policy-source editing batch**, not a new Product catalog, certified line-by-line audit of all historical ZIPs/conversations, reviewer approval, migration or service implementation. Canonical decisions belong exclusively to the named `governance/<owner>.md` file; this table routes provenance and unresolved review only.

| Owner | Donor facts reviewed / current semantic placement | This batch and remaining boundary |
| --- | --- | --- |
| `product.md` | Single 26-capability admission census, exclusions, Merchant/Store distinction, no independent Direct commerce | Existing owner retained; 26-ID owner/section machine guard is limited structural evidence. Material subfeature review of full archives still pending |
| `platform.md` | One actor, four role values, Merchant != Store, Store staff and affiliated Captain are resource relationships, external mobile identities | Existing draft retained; legacy `client/partner` contracts and registered app identifiers still require implementation-stage consumer parity |
| `architecture.md` | Identity/DSH/WLT single-writer engines, adapters/projections only, immutable canonical IDs and cross-owner reconciliation | Added explicit untrusted input validation sequence, stable handoff/reconciliation and recipient-identity boundary. No claim of deployed runtime |
| `identity.md` | Direct verified Merchant admission, finite Operator grants, Passkey and Root Owner recovery, session switch/replay | Earlier draft reconciliation retained. Current Root Owner/Passkey/recovery readback and independent SEC review remain unperformed |
| `stores.md` | One Store writer with two relation channels; future prospective conversion, Store URL continuity; current orderability distinct from publication; scoped delegation | Added atomic relation-admission at every Store creation, same identity replay, prospective cutover, preserved GET links, one Customer Web public view and denied unpublished reads. Source historical initial enrollment defaults require current effective policy/consent verification before activation |
| `catalog.md` | Shared and Store-scoped Product as one model; Variant/Offer, typed taxonomy, measured quantities, Store import/quick prices and populated customer projections | Added single `CUSTOMER_VISIBLE_OFFER` eligibility evaluator and idempotent preview/commit/per-row batch outcomes. No new API or copied SQL |
| `commerce.md` | Seven commerce capabilities; serviceability/quote/Order snapshots; promotions, funded discounts, discovery and bounded Order conversation | Added sender-selected per-message recipient checks, terminal message closure, atomic private attachment and donor initial media bounds. Checkout/financial handoff proof remains NOT_RUN |
| `fulfillment.md` | Three modes, five fulfillment capabilities, one winner, WLT cash hold, custody and privacy-safe Captain availability | Corrected a material overbroad phrase to deny Customer/Merchant mission-GPS access; only Order-authorized Operations may read a latest active mission fix. Native/location retention proof remains NOT_RUN |
| `finance.md` | Exact integer YER WLT ledger, gross COD coverage vs cash-only reserve, accepted agreement, official destination, independent settlement | Added transfer-instruction prerelease eligibility and no silent recipient fallback, per-transfer receipts and independent statement reconciliation. FIN-01/02/03 independent review remains REVIEW_BLOCKED |
| `hr.md` | One bounded DSH employee engine for company/Merchant, HR request versus Identity permission, audited leave/attendance and safe offboarding | Existing earlier source-grounded draft retained; no employment or payroll entitlement activation, LEGAL/SEC review pending |
| `experience.md` | Expo/Tamagui and Operator/Ant, one brand source, Arabic RTL/accessible operation, Studio not publication owner | Existing design decisions retained; real native, browser CSP/hydration, fonts and accessibility remain separately tested implementation gates |
| `safety.md` | Identity/session/Store permission, WLT conservation, migration parity, data privacy and owner-side bounded failures | Added mission-location consent/retention/least-privilege prohibition; not a real device or production privacy audit. SEC-01/02 and MIG-01 independent review pending |
| `engineering.md` | Conservative owner-led refoundation, OpenAPI parity, SQL fresh/upgrade, policy admission and exact-SHA proof | Existing plan and source law retained; no GO/SQL schema execution is authorized by this documentary review |
| `journeys.md` | Sixteen canonical cross-owner proof lenses with actual entry/exit/readback and negative paths | Tightened Order-message per-recipient + terminal semantics to match Commerce. Real journey proof deferred |

**Decision classification:** `DRAFT_RETAIN/REFRAME` for the material source constraints explicitly reflected in the above owner edits; `HISTORICAL_ONLY` for obsolete enrollment/referral/physical COD execution that survives only as protected evidence; `IMPLEMENTATION_NOT_RUN` for Go/OpenAPI/SQL/actual Owner APIs; `INDEPENDENT_REVIEW_BLOCKED` for financial, account security, privacy, contract and migration decisions. No other source paragraph is deemed approved by silence, and an unreviewed mismatch must be recorded with its owner rather than guessed. This is not a blanket `PASS` for all 14 semantic documents.

**Acceptance work still outside this editing batch:** (1) qualified independent decisions for `FIN-01/02/03`, `SEC-01/02`, `MIG-01` and `LEGAL-01` in the existing sign-off register above; (2) exhaustive material clause/archived-agreement and six-discussion concordance with no unclassified legally binding feature; (3) source-compatible enum/contract choices and exact external/mobile credentials only at authorized owner implementation; (4) verify current protected data histories, users/Root Owner and published terms when separately authorized; (5) test the **final** source/CI revision and record a reviewed governance-cutover approval. These are prerequisites for changing `GOVERNANCE_CUTOVER: NOT_READY`, not a requirement to finish all applications before governance approval.

**Local test caveat:** During this batch the working directory contained an **untracked empty `infra/local` directory** (created before these governance edits). Both `pnpm check` and `pnpm check:foundation` fail closed because their Stage-4 guards intentionally refuse the very existence of `infra/`; no `infra` file was edited or deleted, and this non-governance directory must be resolved with its owner rather than silently bypassing the guards. Independent negative governance fixtures and tracked-secret tests may still be run as narrower evidence; neither constitutes a full candidate gate PASS. All policy and test changes remain local until separately reviewed and committed; no Push/PR/Merge/DB/deployment action is implicit here.

## 2026-11-13 — Customer/Merchant EAS cloud-build preparation and risk gate (source-only)

**Scope and authority:** Explicit user request to finish governance work and make the **existing Customer and Merchant** projects prepared for a *later* remote Expo build, without starting a paid build, publishing an OTA update, creating EAS projects, touching signing keys or overwriting external credentials. Worktree `D:\samrim-refoundation-clean-20261112`, branch `refoundation/clean-house-20261112`, starting HEAD `72ab3d2287aeffe47678f9927f4ca5f1880d31ca`. Branch `41` is reference only. EAS CLI is the existing pinned `24.7.0` running on Node `24.22.1`; no dependency upgrade.

**Authenticated read-only EAS project proof:** `eas whoami` reported account `bthwani1`. `eas project:info` in `apps/customer` confirmed `@bthwani1/app-client`, ID `4adf3184-fc07-4186-b49e-0dc821a5ab73`; `apps/merchant` confirmed `@bthwani1/app-partner`, ID `bcd22a76-d4b2-4de0-93b3-f6d13074a802`. This verifies cloud **link identity only**, not signing rights, credentials or an app-store release.

**EAS environment name-presence checks only** (no variable values were printed, decoded, copied or modified):

| EAS project | Environment | `GOOGLE_SERVICES_JSON` | Relevant Android Maps key | `GOOGLE_MAPS_IOS_API_KEY` | Meaning |
| --- | --- | --- | --- | --- | --- |
| Customer | development | PRESENT | `GOOGLE_MAPS_ANDROID_API_KEY_APP_CLIENT`: PRESENT | PRESENT | Name metadata only; key validity, Firebase package and signing remain UNVERIFIED |
| Customer | preview | PRESENT | `GOOGLE_MAPS_ANDROID_API_KEY_APP_CLIENT`: PRESENT | PRESENT | Same limits |
| Merchant | development | PRESENT | `GOOGLE_MAPS_ANDROID_API_KEY_APP_PARTNER`: PRESENT | PRESENT | Same limits |
| Merchant | preview | PRESENT | `GOOGLE_MAPS_ANDROID_API_KEY_APP_PARTNER`: **NOT_SEEN** | **NOT_SEEN** | **BLOCKED** for approved native Maps build; account-scoped preview alternatives `GOOGLE_MAPS_ANDROID_API_KEY_APP_PARTNER`, generic Android Maps key and iOS Maps key were also NOT_SEEN |

Presence was checked by running `eas env:list` on each authenticated Expo project and printing only boolean variable-name matches; **presence does not establish permission, provider restrictions, content validity or cloud builder delivery**. The Google Services variable is intended as an EAS **file** variable, not a JSON string. Do not copy Customer Firebase, private credentials, or Development Maps keys into Merchant Preview without provider restrictions and approved environment scope; the absent Preview keys require an authorized EAS environment update.

**Source changes admitted in this batch:** Keep internal folder names `customer`/`merchant` while retaining original mobile/Expo identities and CNG plugins. In the two existing `eas.json` files, select Expo-managed `credentialsSource: remote` for `development` and `internal` (since neither project archives local `credentials.json`), retain pinned Node/pnpm/EAS CLI and `requireCommit`, internal APK-only profiles, explicit EAS environment/channel, and no production/store auto-submit profile. Neither credential existence nor the certificate's correspondence to the published Android signing fingerprint has been proven; **do not generate replacement signing identities at a future interactive prompt without independent continuity verification**. Native app config now refuses an EAS cloud build with missing Android/iOS Maps keys; for Android it additionally requires a real `GOOGLE_SERVICES_JSON` file variable and its package identity to match the selected Customer or Merchant app. Error text is metadata only, never key values. Negative synthetic tests cover missing/invalid/wrong-package input; they are not a live provider/notification proof.

**Required later gates before remote build is marked accepted:** Validate Merchant Preview Maps key presence, allowed Android package+certificate and iOS bundle restrictions; confirm appropriate EAS project-managed Android/iOS signing credentials and release identity; check approved Firebase app mapping and notifications; use actual signed artifact and native device tests for Arabic RTL, permissions, maps, media, notification payload, deep links, Expo Update channel/runtime and account switching. `eas build:inspect --stage archive` may establish archive composition but is **not** a remote native build. No build, store submission, OTA rollout, production signing mutation or iOS runtime proof was authorized/executed by this work. A successful Expo Web export/typecheck or an EAS environment name read is *not* a claim of readiness at 100%.

**Local checks after edits:** The pre-existing untracked empty `infra/local` directory was inspected and removed with nonrecursive empty-directory operations only, clearing the earlier Stage-4 structural false blocker without deleting any source file or service. `pnpm check` completed successfully on this candidate working tree, including 14-owner/26-capability scaffold guards, security checks, design/theme, native Expo config, EAS profile negative cases, RTL/source isolation and all workspace TypeScript checks. A separate post-edit `verify-app-foundations.mjs` run confirmed valid square native PNG headers/dimensions (1254×1254 in each Customer/Merchant asset), preserved original dependencies and external app identities. This is source/config verification: EAS archive proof, signed Android/iOS builds and devices still require separate evidence.

**Governance still blocked:** Seven independent sign-offs in the existing FIN-01/02/03, SEC-01/02, MIG-01, LEGAL-01 review register are still `REVIEW_BLOCKED`. Full historical material/contract review and protected owner runtime proof remain unresolved; no synthetic check, tool report or project owner EAS login may substitute for independent finance/security/legal/database approval. Keep `GOVERNANCE_CUTOVER: NOT_READY` and do not begin unapproved service/SQL/product screen migration.

## 2026-11-13 — Customer/Merchant Expo remote-build preflight and governance closure attempt

**Authorized scope:** finish the safely executable governance source reconciliation and prepare the `apps/customer` and `apps/merchant` Stage-4 native/EAS configuration for a **later** authorized remote build; use the protected `C:\\BTHWANI-Secrets` path only to validate local credential *presence and app-package match*. No cloud build, store release, provider billing, new app identity, signing-key replacement, SQL, production secret copy, push or merge was authorized by this step. This is evidence for the current candidate, not release approval.

- Read-only `eas whoami` and `eas project:info` proved original `bthwani1` account and both original Customer/Merchant EAS UUIDs; original `com.bthwani.client`/`com.bthwani.partner`, `app-client`/`app-partner`, schemes, `0.3.1`, RTL and Expo Web SSR remain unchanged.
- Examined the protected original secret directory by **names and package-match outcomes only**; both Firebase JSON files name the proper Android application ID and both Android Google Maps-specific variable names plus shared iOS name exist in `samrim/env/mobile.env`. Never embed these local paths or secrets in Git or rely on a developer Windows directory existing on Linux EAS builders.
- Corrected Stage-4 `development`/`internal` profiles to use remote EAS internal-build credential handling instead of absent local `credentials.json`. This is **not proof of update-signing compatibility**: require original signing fingerprint comparison before publishing any update; no production/store distribution profile was added.
- Added native EAS fail-closed Maps-key and Customer/Merchant Android Firebase File-secret/package validation. Added EAS profile regression checks and synthetic absent/malformed/wrong-app/valid-secret negative tests. Expo JS config, EAS project mapping and cloud-signed binary are different proof levels.
- Authenticated read-only EAS variable-name checks show Customer development/preview and Merchant development include relevant Google Maps and `GOOGLE_SERVICES_JSON` names. Merchant **preview lacks** Google Maps names, although its `GOOGLE_SERVICES_JSON` name exists. These checks do **not** inspect remote secret content, visibility type, provider restrictions or signing state.
- Attempted a scoped transfer of only the missing Merchant preview map values from the user-directed secret directory; the tool **rejected the sensitive transfer**. Respect the denial; do not use another channel to bypass it. **`BLOCKED`** for the missing environment keys. No remote value was successfully written.
- The empty and untracked `infra/local` / `infra` folders that defeated Stage-4 structural checks were verified empty and removed without deleting owner files; subsequent `pnpm check` returned exit 0. A local `eas build:inspect --stage archive` initially failed as designed on **uncommitted Git work** because `requireCommit: true`. Inspect only the final committed candidate and identify exact tool limits.
- Existing governance approvals remain **REVIEW_BLOCKED**: FIN-01/02/03, SEC-01/02, MIG-01 and LEGAL-01 still lack actual qualified independent signoff. A new Expo config test, a donor secret presence check or a green CI cannot close these gates. `GOVERNANCE_CUTOVER: NOT_READY` remains the correct state.

**Remote-build acceptance boundary:** `SOURCE_CONFIG_PASS` after tests, but `CLOUD_EAS_CONFIG_BLOCKED` for Merchant preview Maps and `NATIVE_BUILD_NOT_RUN` for both apps. Do not promise “100% ready” until the missing remote keys, remote file-secret scope/type, signing key identity, actual archive and the genuine remote build + Android install (and iOS tests if applicable) are demonstrated on the same submitted revision. This plan entry reports current evidence; executable app config and the single existing governance owners remain the respective sources of truth.

## 2026-11-13 — Committed EAS archive inspection, exact candidate proof (session 01)

**Candidate:** `refoundation/clean-house-20261112` at `622ba38185fbc21e089945dcb47fc6bc837dbb9b`. After the source/config adjustments were committed with a clean Git working tree, two **local** authenticated `eas build:inspect --platform android --stage archive --profile internal` calls exited **0** in the correct app working directories. Their isolated output paths are under `C:\Users\bassa\AppData\Local\Temp\bthwani-eas-archive-{customer,merchant}-622ba381`, and are not production deployments.

**Independent readback of each inspected archive:** `git rev-parse HEAD` inside the copy matched the exact candidate SHA, and the required root `pnpm-workspace.yaml`, `pnpm-lock.yaml`, both workspace design package manifests, per-app `app.config.ts`, `mobile.config.json`, `eas.json`, `package.json`, square PNG icon/adaptive/splash assets, and `tools/mobile/define-bthwani-expo-app.cjs` were all present. The two inspected archive copies each contained 265 files. An archive-wide filename scan found **zero** `.env*`, `credentials.json`, `google-services.json`, `.jks`, `.keystore`, `.p12`, `.pem` or `.key` files; this is a targeted archive scan rather than a claim of secret-free application code or a full source-history audit. Both archived `eas.json` profiles reported `development.credentialsSource=remote` and `internal.credentialsSource=remote`; Customer retained `com.bthwani.client`/`app-client`/`4adf3184-fc07-4186-b49e-0dc821a5ab73`, Merchant `com.bthwani.partner`/`app-partner`/`bcd22a76-d4b2-4de0-93b3-f6d13074a802`.

**Evidence status:** `EAS_ARCHIVE_INSPECT_PASS` (both apps, local archive only); `SIGNED_NATIVE_BUILD=NOT_RUN`; `CLOUD_EAS_SIGNING_FINGERPRINT=NOT_RUN`; `MERCHANT_PREVIEW_GOOGLE_MAPS=BLOCKED` (absent remote environment values; tool denial of secret transfer respected); `REMOTE_FIREBASE_FILE_CONTENT_AND_TYPE=NOT_RUN`; `GOVERNANCE_CUTOVER=NOT_READY` pending seven independent risk approvals and unresolved historical material source decisions. Recheck archive after any app/EAS/pnpm lock or revision change; do not infer a live device, provider or store distribution PASS from this archive result.

## 2026-11-14 — DSH owner execution evidence for the 19 admitted capabilities (session 04)

STATUS: SOURCE_ROUTING_PREPARED; GOVERNANCE_CUTOVER_NOT_READY; DSH_OWNER_RUNTIME_NOT_RUN; SECURITY_FINANCE_MIGRATION_REVIEW_BLOCKED.

This is a temporary execution checklist derived from the single Product capability census in governance/product.md, not an independent Product catalogue or a new business authority. The 18 distinct donor SQL filenames used below were confirmed present with read-only git ls-files on branch 41 at 426d67b47beb8c66b09acd8c7394086b53ac5aae. Their *existence*, rather than applied-history or runtime correctness, was checked. Exact new semantics remain with governance/hr.md, stores.md, catalog.md, commerce.md, fulfillment.md. The target currently has no executable DSH Go/SQL and its reserved OpenAPI fragments contain zero operations.

| Capability / semantic owner | Donor DSH SQL filename(s), read-only source locators | Required target owner evidence and negative test — all NOT_RUN |
| --- | --- | --- |
| EMPLOYEE_HR / hr.md | 114_hr_employee_directory.sql and HR 115–120 | Company/Merchant employee scope, same-org manager, one Identity actor and negative cross-organization IDOR; HR cannot mint Operator or WLT payee |
| PARTNER_ONBOARDING_STORE_PUBLICATION / stores.md | 001_partner_store_baseline.sql; 002_store_publication.sql | Verify authorized Store admission, publish readback and no unpublished discovery or cross-Store writes |
| STORE_RELATION_MODEL / stores.md | 001_partner_store_baseline.sql | One Store under MARKETPLACE or DIRECT; reject relation switch rewriting accepted WLT agreement or Order |
| STORE_OPERATIONAL_AVAILABILITY / stores.md | 085_store_operational_availability.sql | Publication is separate from pause/readiness; deny checkout when unavailable without discarding existing Orders |
| STORE_SCOPED_ACCESS_DELEGATION / stores.md | 086_store_scoped_access_delegation.sql | Two-Merchant/two-Store grant isolation and revoked-session/account-switch negative tests |
| CENTRAL_CATALOG / catalog.md | 010_central_catalog_refoundation.sql | Distinguish SHARED/STORE_SCOPED, GTIN/Store SKU and preview/replay-safe imports; deny ambiguous matches |
| CUSTOMER_STORE_CATALOG / catalog.md | 078_catalog_offer_visibility_views.sql | Revalidate StoreOffer visibility, price/stock/readiness/media rights; deny hidden or stale Offer |
| SERVICEABILITY_ADDRESSES / commerce.md | 007_location_core.sql | Deny other Customer address, forged recipient location and out-of-service checkout |
| CART_CHECKOUT / commerce.md | 011_cart_checkout_order.sql | Reprice/revalidate server-side; reject cross-actor cart, stale inventory, unsupported mode or repeated submit |
| MULTI_STORE_CHECKOUT / commerce.md | 040_multi_store_checkout.sql | One parent intent with one accepted child per Store; recover partially failed and retried checkout without duplicates |
| ORDER_LIFECYCLE / commerce.md | 011_cart_checkout_order.sql; 087_order_recipient_and_adjustments.sql | Reject stale status, cancellation race, altered accepted recipient/fee snapshot; WLT alone posts money |
| ORDER_CONVERSATION / commerce.md | 038_order_conversation.sql | Deny wrong Order recipient, removed participant and revoked-session access to private media |
| COMMERCE_PROMOTIONS / commerce.md | 039_promotions_discovery_content.sql | Verify eligible accepted promotion snapshot; reject double redemption and retroactive Order discount |
| DISCOVERY_CONTENT / commerce.md | 039_promotions_discovery_content.sql | Hide unpublished or ineligible Store and disallowed DIRECT exposure; verify geographical/media permission |
| STORE_CAPTAIN_MEMBERSHIP / fulfillment.md | 047_store_captain_membership.sql | Identity actor consents; reject Store-owner impersonation, cross-Store assignment and global Captain role invention |
| CAPTAIN_DISPATCH / fulfillment.md | 051_store_captain_dispatch_offers.sql | Exactly one DSH winner under competing accepts; deny precise recipient address to losing Captains and reconcile WLT holds |
| STORE_CAPTAIN_HANDOFF / fulfillment.md | 054_partner_captain_store_cash_handoff.sql | Both Store and assigned Captain prove one goods custody handoff; reject missing items/wrong party/replay |
| FINAL_MILE_DELIVERY / fulfillment.md | 029_order_delivery_proof.sql | Evidence-bound completion, deny stale location, third-party mission read and duplicate terminal/WLT effects |
| CUSTOMER_PICKUP / fulfillment.md | 045_customer_pickup_fulfillment.sql | Same DSH Order, verified eligible Customer/Store proof, no fictitious Captain assignment or custody |

**Cross-owner execution gates (not automatically authorized work):**

1. For each business operation under development, settle its **relevant** owner policies and permissions, then implement and test the scoped contract and journey without waiting for global governance cutover. Before real-world or production activation, require the affected security, finance, legal and operational proofs and distinct release authorization. Zero-operation OpenAPI scaffolds and empty TypeScript client packages are not usable APIs; preserve external identities and existing contracts until lawful consumer migration is proven.
2. DSH first proves canonical Store/employee/address identity and two-actor/two-Store authorization through its own persistent owner readback. Identity owns actor, verified credentials, session, global role and Operator admission. A Merchant Store grant does not authorize HR Operator, Captain role or WLT write. MARKETPLACE and DIRECT are Store relation modes, not parallel engines.
3. After isolated Fresh-vs-protected-Upgrade analysis and correct independent owner contracts, admit real checkout, merchant acceptance, Store-Captain and Customer Pickup journeys incrementally. Test unsupported modes, stale inventories, racing accepts, retry after network loss, lost callback, unauthorized recipient/location, unknown payment outcome and one canonical persisted result.
4. WLT alone verifies COMMISSION/SUBSCRIPTION agreements, COD/wallet/mixed funding, one authorized balance/custody/fee effect, ledger conservation, receipt/settlement/refund and no duplicate event in replay/race. DSH pricing and accepted Order snapshots never mutate WLT ledger directly. Preserve historical financial/legal records and user state; no hidden fixture or donor volume copy is acceptance evidence.
5. Each new capability requires approved API operations and schemas, real owner-backed positive/negative/concurrency readback, privacy/security checks, actual browser/Android journey when affected, migration/restore evidence if relevant, and required internal risk review. Record exact code/contract/DB SHA and the limitation of every skipped check; source inspection and green foundation CI remain only source evidence.

**Bounded result:** all 19 DSH-owned capability IDs have a source locator and explicit later acceptance failure case. This is an execution route, not a new implementation, migration permission, proof of 19 working capabilities, approval of old SQL semantics or governance READY decision. All mentioned runtime/contract/financial/security scenarios remain NOT_RUN until separately authorized and executed.

## 2026-11-16 - Worktree retirement and branch-independent CI routing

Source checkout was consolidated to `D:\samrim`, with temporary branch `foundation` and default `main` at `ccce4247e3bffe1b603ae26f8dd176a80d123753`. The previous `D:\samrim-refoundation-clean-20261112` worktree was removed. Branch names are not permanent configuration values. Historical names and SHA references recorded in dated sections above remain evidence of what was inspected, not operational instructions.

GitHub CI workflows `.github/workflows/{ci,dependency-nx-safety,go-quality}.yml` now include pushes to any present/future development branch except `archive/**` and `41`. Protected-main PR checks stay in place; `fast-guard` has no path filter, while Go/Nx keep their affected-file filters. Local source checks cannot prove remote execution until the revision is pushed and actually evaluated on GitHub.

Docker project `bthwani-refoundation`, PostgreSQL/media volumes, container labels, active SSH tunnels and Lenovo runtime were not renamed/restarted. The old `com.bthwani.worktree` label remains a runtime compatibility identifier, not a source path. Mobile config no longer implicitly reads secrets from the removed worktree; environment and EAS secrets must be explicitly selected and authorized. The four Windows tunnel Scheduled Tasks have been redirected to a branch-independent launcher under the user LocalAppData BThwani Operations Tunnels directory, after parser and non-network configuration checks and with all original task XMLs archived there. Existing listening ports were not deliberately restarted; verify an actual restart in a separately authorized maintenance window.

`GOVERNANCE_CUTOVER: NOT_READY` and `PRODUCTION_ACTIVATION: BLOCKED` remain. No new finance, Identity/DSH/WLT integration, SQL upgrade, real-device or protected-state acceptance is implied. Push, PR, merge, credential transfer and changes to running services remain separately authorized actions.


## 2026-11-17 - Latest verified engineering checkpoint (supersedes earlier present-tense status claims)

ARTIFACT_CLASS: DATED_LOCAL_EXECUTION_EVIDENCE
SOURCE_CHECKOUT: D:\samrim
SOURCE_BRANCH: foundation
INSPECTED_HEAD: 0579379740e551e732e3c11ecc6dd953fbf925df
ACCEPTANCE_SCOPE: BOUNDED_LOCAL_ONLY
ENVIRONMENT_BASELINE_ACCEPTED: NOT_RUN
ALL_JOURNEYS_CLOSED: NOT_RUN
GOVERNANCE_CUTOVER: NOT_READY
PRODUCTION_READY: BLOCKED

This is the newest checkpoint of this same temporary plan. Earlier "CURRENT" and P0/P1 status entries describe historical source revisions, not today's immutable acceptance. All protected operations, Push, PR, merge, deploy and branch changes require their separate authorization.

### Source-verified results and corrections

- Spec Kit: native specify version 1.3.0 executed in the target checkout; reviewed .specify/memory/constitution.md and specs/002-stage5-admission/spec.md. CLI/context PASS only.
- Graphify: the relevant bthwani2-boop/samrim query succeeded but promoted index ccce4247e3bffe1b603ae26f8dd176a80d123753 is older than inspected HEAD 057937974 and dirty files: INVALIDATED, not automatically reindexed.
- Toolchain: pnpm check:toolchain PASS with Node 24.22.1, Go 1.27.4, pnpm 12.15.0; other source hosts and clean-install acceptance remain separate.
- OpenAPI: structural checker PASS for Identity (6), DSH (8), WLT (0) operations. Generated client / real Go / HTTP / DB parity NOT_RUN. Previously committed 057937974 admits new root-linked owner path fragments while blocking orphan paths, wrong pointers and missing security declarations.
- Foundation guard: the historical Control Panel R001-R112 documentary crosswalk used to depend on an exact dated Markdown heading. A new negative-to-positive regression verified the defect and its local correction: validate 112 unique archival classification records by content instead, preserving missing, duplicate and fabricated-implementation rejection cases. Full guard and exact-SHA CI still require final verification.
- Concurrent source: one foundation worktree, with multiple staged Merchant and Operator edits by other sessions. This work owns only the foundation guard/test and this plan checkpoint; no other session's route, client or staged change is approved for inclusion.
- P0-23 FAIL on this dirty candidate: pnpm run knip:files reports 18 unused Merchant sources; pnpm run check:apps reports 2 Merchant route-structure failures plus a boundary-scanner test failure during incomplete path-group migration. An earlier APP_OWNER_BOUNDARIES_PASS over 310 files was invalidated by subsequent writes. Finish the owned migration and preserve route/client compatibility before rerunning actual tests; do not blanket-exclude, delete peer work or mask this FAIL.
- Not implemented/proven: Identity first-factor and DSH Store-scoped grants/IDOR with real UI and isolated persistent readback; WLT ledger, wallets, cash/COD/Mixed, agreements, payouts and settlements; owner-backed checkout/fulfillment/device E2E; final CI, clean bootstrap, current Docker source parity, protected upgrade/restore and production authorization. Their acceptance remains NOT_RUN, BLOCKED or REVIEW_BLOCKED rather than PASS.

### Next execution boundary

1. Merchant/Operator route owners finish and release their staged changes; rerun app boundaries, Knip, source-test inclusion, TypeScript and navigation/deep-link behavior on the stable candidate.
2. Re-run all foundation positive/adversarial tests and OpenAPI checks. Only the shared Git coordinator selectively commits the guard/test/plan correction when the Git index is released. Do not stage others' changes.
3. Obtain a matching official Graphify index, repeat reproducible clean pnpm/Nx plus final-SHA CI, and verify authorized isolated Docker/SQL source-to-runtime parity.
4. Implement and test one fully connected Identity actor-to-DSH Store-scoped journey including two actors, two Stores, permission revocation, UI, real HTTP/Go and persisted owner readback. This has priority over finance UX placeholders.
5. Complete DSH order/dispatch and WLT financial journeys progressively under sole owners with concurrency, idempotency, ledger conservation, failure recovery and isolated restore evidence. Close only the exact journeys whose complete criteria have passed.

This checkpoint supersedes stale statuses, not the preserved 27 P0 and 25 P1 requirements. The project is not globally closed and production activation remains blocked.


### Follow-up evidence for this same checkpoint (local, before any new SHA or peer-file change)

- Foundation verifier and full governance regression tests: PASS, 226 total, 224 passed, 0 failed, 2 Unix-only skipped; guard executed on the amended governance/plan tree. Exact-SHA Linux CI remains NOT_RUN.
- Go 1.27.4 (GOTOOLCHAIN=local): Identity's 2 packages and DSH's 3 packages passed go test -count=1 ./... and go vet ./...; no live owner/Android/financial E2E is inferred.
- Node test discovery: six regression tests PASS and SOURCE_TEST_DISCOVERY_PASS count=63. Nx affected-graph regression: 10/10 PASS, including untracked DSH OpenAPI/SQL, Merchant source and Windows argument safety.
- Local workspace, tracked-secret marker check (4/4), design tokens/generated CSS, independent OpenAPI checker and git diff --check PASS. Secret audit excluded Git history; native appearance/device usability NOT_RUN.
- P0-23 continues FAIL on the concurrently moving Merchant tree; app tests/Knip are not overwritten by independent green source checks. The shared Git index holds peer-staged Merchant files, so no local commit/push of this checkpoint was attempted by this session.


### Same-day later revision: source test recovery and scope-limited update

- The concurrent Merchant route migration advanced and was committed as a5d339077 before the checks below. After that change, pnpm check:apps PASS (66/66 tests, app boundaries 309 files, Expo/RTL configuration and workspace TypeScript typechecks). This supersedes the prior transitory check:apps FAIL and the old count of 310/319 files. It is not installed Android or authenticated E2E evidence.
- pnpm check:coverage PASS on the resulting working tree: 463 tests, 460 PASS, 0 FAIL, 3 skipped; 41 measured source files, line coverage 3840/4392 = 87.4%. This percentage is for instrumented source, not the entire business product.
- pnpm run knip:files remains FAIL on 18 Merchant TSX files without proven live consumers; their owning session must reconcile them. P0-23 and global pnpm check cannot close while this persists. No file was deleted/excluded merely to make Knip green.
- The guard/plan correction was subsequently committed locally as c8c55b10de70014fe886e6252ba99b47de705a03 by the shared Git writer. This checkpoint distinguishes prior test working-tree content from final immutable CI; external GitHub required checks on c8c55b10d and Graphify matching that SHA are NOT_RUN/INVALIDATED respectively. Surface-to-Lenovo runtime cutover and production are still unauthorized.


### 2026-11-17 - Verified Lenovo isolated database and exact-SHA CI blocker

- **Current committed source:** foundation HEAD d78699fa1266963ecc64c0c155bd7bf368130f20; at readback origin/foundation matched and Git status was clean. Other sessions produced commits on the same branch; do not infer this assistant was the Git coordinator for those commits.
- **Lenovo connection (read-only):** Surface host Bthwani reached 192.168.0.101 TCP/22; authorized Docker context bthwani-docker lists the existing runtime. Identity container bthwani-refoundation-identity-1 remains Exited(255) (finished 2026-11-16 14:32:59Z, no Docker state error), while DSH container remains healthy. DSH image declares source 8a439fb404c794099af0edd86fe77cb5bfcbc243, an ancestor of HEAD with substantial DSH Go/client/OpenAPI/SQL changes; health does not certify source parity. No existing container restart or protected volume modification was performed.
- **Fresh isolated SQL proof on Lenovo:** reviewed and ran infra/verify-isolated-postgres.ps1 against a unique --network none, zero-host-port, tmpfs-only disposable PostgreSQL. All five DSH migrations applied. Reader SELECT succeeded and denied INSERT with SQLSTATE 42501. pg_dump/pg_restore fingerprint matched 14:147:1. No test-scope container remained after owned cleanup. This supports P0-18/P0-19 ONLY for isolated DSH; it does not establish protected upgrade, WLT finance or application E2E.
- **Exact-SHA GitHub CI:** read-only gh run view 43995358429 at d78699fa: Foundation structure job PASS, Presentation job FAIL at Reject orphaned JavaScript and TypeScript files, fast-guard FAIL because its required predecessor failed. Knip locally reports 18 unconsumed Merchant placeholder TSX modules. Their basenames are referenced by static-only Merchant tests, but no live screen route imports these wrappers. Do not delete tests/placeholder code merely to spoof clean coverage or wire false consumers; reconcile actual route requirements and migrate affected tests under the Merchant owner.
- **Limits:** The passing 460/463 measured source tests, 66/66 app config/source tests and isolated SQL are independent scopes. Current CI is FAIL, Graphify evidence is stale, DSH/Identity runtime source parity FAIL, WLT executable ledger and full actor-to-Store/checkout/delivery/browser/Android journeys remain NOT_RUN/REVIEW_BLOCKED. ENVIRONMENT_BASELINE_ACCEPTED, JOURNEY_CLOSED for these flows, GOVERNANCE_CUTOVER READY and PRODUCTION_READY must not be asserted.

---
