# BThwani — Refoundation Execution Plan (temporary, non-governing)

DOCUMENT_CLASS: EXECUTION_PLAN
OWNER: docs/REFOUNDATION-PLAN.md
STATUS: IN_PROGRESS_FOUNDATION
TARGET_WORKTREE: D:\samrim-refoundation-clean-20261112
SOURCE_BRANCH_AT_START: 41
SOURCE_SHA_AT_START: 426d67b47beb8c66b09acd8c7394086b53ac5aae
WORKTREE_BRANCH: refoundation/clean-house-20261112
DECISIONS_AUTHORITY: NONE
RUNTIME_SUCCESS_AUTHORITY: NONE

## Purpose, limits and acceptance
Refound the **architecture itself**, not a succession of local patches. Move correct business meaning, preserve supported capabilities and rights, rebuild SQL and services when admitted, remove redundant sources and routes after verified cutover, and make the result simpler, auditable and maintainable.

This plan is a dated execution index, not a governance constitution, second requirements database, or substitute for canonical Product decisions. Re-evaluate against fresh HEAD at each batch. A plan item is not proof it has executed.

### Source precedence
1. Latest explicit approved user instruction for the same meaning; later approval supersedes the incompatible older decision and retains compatible earlier decisions.
2. Canonical reconciled `governance/` domain-owner documents **after** an accepted cutover.
3. Current source/contracts/schema/config/runtime readback for implementation-state claims.
4. Branch-41 source and historic `docs/governance/` as provenance and protection of useful behavior.
5. Dated commands, audit archives, Control Panel packs, prior conversations, benchmarks and OSS research as **nonbinding evidence**, never automatically current permissions or product features.

The November 11 Codex Desktop command names another worktree and includes tool/push instructions tied to that context. **Do not execute those as current authority**. The user explicitly selected the existing clean worktree and authorized staged local development; no push, PR, merge, deployment or actual destructive database/data action is authorized by this plan.

### Sources inspected or carried as review inputs
- Original `D:\samrim`, branch `41`, start SHA as above: `AGENTS.md`, `REPOSITORY-STRUCTURE.md`, `.coderabbit.yaml`, `.github/`, `docs/governance/`, `docs/reference/`, `tools/governance/`, `services/`, `apps/`.
- `D:\samrim-implementation\BTHWANI-REFOUNDATION-CODEX-DESKTOP-EXECUTION-COMMAND-20261111.md` — 20-section implementation command, worktree and direct Codex instructions stale for this worktree.
- Desktop ZIP `BTHWANI_ULTIMATE_REPRODUCIBLE_AUDIT_TRIGGER_BUNDLE.zip`: 3 entries, including ~81 KB audit trigger with source/evidence, coverage, falsification, reproducibility and convergence dimensions; these are methodology prompts, not a tested CI harness.
- Desktop ZIP `BTHWANI-Control-Panel-Complete-Refoundation-Master-Pack-نهائي.zip`: 63 entries with specification, requirements, proof matrices, archived reference snapshot; October 12 content and historical branches are not current runtime proof.
- Shared text transcripts and `BTHWANI-REFOUNDATION-DEEP-AUDIT-ACTION-PLAN-20261112`: approved conversation trajectory and extensive audit requirements. Large repeated descriptions are consolidated into this one execution plan only when relevant to a specific acceptance result.
- `docs/reference/` in source branch: original OSS and competitor links, Elleen observations and research classification, to be conserved after provenance verification.

A source being inventoried does **not** mean every line or external URL has passed deep review. Preserve a verifiable trail; escalate ambiguities.

## Phase 0 — Safe baseline (read only): DONE, recheck before changes
- Verify original and target branch/HEAD/status/worktree, files tracked, active workers, and change ownership.
- Prevent writes to `D:\samrim` and do not reset/copy/restart existing Docker, PostgreSQL, SeaweedFS or credentials for this stage.
- Establish the target as a **deliberately sparse** worktree, not a runtime build or merge candidate.
- Record historical input versions and distinguish measured evidence from recommendation.
- Proof: git worktree status and exact SHA. Re-run after intervening work.

## Phase 1 — Foundation law and stage-aware CI (CURRENT)
**Owns:** root `AGENTS.md`, root `REPOSITORY-STRUCTURE.md`, `governance/README.md` (staging index), this plan, `tools/governance/`, `.github/workflows/ci.yml`.

- Reauthor agent execution safety, smallest coherent refoundation slice, owner/writer law, tested evidence, protected data and Git authorization. Do not transplant the oversized donor law verbatim.
- Reauthor repository placement for a root `governance/`. User-approved early deletion of the old donor folder from **this candidate** is now in scope; reference historical source branch `41` without rebuilding a duplicate directory.
- Build a Foundation-only CI guard with positive and adversarial tests; it must not assume Go, SQL, Expo, pnpm or complete Product docs exist. No dummy success for product acceptance.
- Remove obsolete inherited executable CI workflows from the sparse candidate when replaced by the Foundation Guard, while retaining original tests and workflows in branch 41 for later feature-level recovery.
- Prepare one PR template that states affected Product law, same SHA evidence, residual risk and that the branch is NOT MERGEABLE while deliberately sparse.
- **Gate:** stage-aware rules validated locally including negative fixtures; correct paths; exact Git diff reviewed. Foundation checks may PASS while `GOVERNANCE_CUTOVER=NOT_READY`.

## Phase 2 — Semantic governance reconstruction and single-root cutover (DRAFT_COMPLETE; SEMANTIC_REVIEW_PENDING)
**Owns:** `governance/{product,platform,architecture,identity,stores,catalog,commerce,fulfillment,finance,hr,experience,safety,engineering,journeys}.md`. All 14 owner documents now contain first-pass semantic drafts; `product.md` names the one 26-capability census and domain files own 26 matching CAPABILITY_ID sections. This is a **draft completion**, NOT final legal/financial/technical reconciliation and NOT a code-refoundation start approval.

- Make a complete line/decision concordance against the current 15 donor semantic-owner documents, all six approved discussion sequences and meaningful ZIP requirements. Record each rule: retained/reworded/merged/superseded/retired/unresolved, owner and rationale.
- Preserve the 26 admitted capability IDs plus all material subfeatures in exactly one appropriate domain-owner section each. No additional Product breadth from donor claims without approval.
- Distinguish actor/Store, relation/fee model/collection/fulfillment, channel publication/checkout readiness; one DSH Store/catalog/order engine, one Identity actor writer, one WLT financial owner.
- Translate approved Current UX: Tamagui for Expo and Ant Design for Operator with one legitimate semantic brand/token source, Arabic RTL, dark/light, low friction, accessible recovery. No independent design authority from archived UX snapshots.
- Review all historic legal/media/OSS/competitor links; preserve original and source date in `docs/reference/` without rewriting citations into purported product laws.
- Classify all unapproved or conflicting contract choices as unresolved. Never invent product values, partner percentages, pricing, subscription charges or service permissions.
- The old governance folder was deleted from this candidate in Phase 1 by explicit instruction. Its original contents remain readable from branch `41`. Do not reintroduce it; migrate references directly into new `governance/` owners as applicable. This structural deletion does **not** certify that semantic governance reconstruction has completed.
- **Gate:** no old active root, one semantic owner per rule, 26/26 capability IDs with exactly one section each, zero broken intra-repo references, negative semantic regression guards. Financial, security, deletion and migration decisions must receive required independent review. Otherwise REVIEW_BLOCKED.

## Phase 3 — GitHub and policy enforcement reconstruction (PARTIAL: foundation only)
- Keep a **single** CI architecture: selective Fast Guard for affected code after sources exist, Sonar/CodeQL analysis where applicable, one final Refoundation Acceptance Gate. Avoid a parallel CI/review platform.
- Correct historic branch routing (36/37/38), ensure SQL changes activate the owning service tests, enforce import/contract/canonical-writer rules and review documented failures; test the routing itself with changed-file fixtures.
- Integrate CodeRabbit configuration only after validating current repo settings. The user is the sole project contributor; **do not create CODEOWNERS** or invent reviewers. Required independent finance/security/migration review remains a separate acceptance condition where mandated. Protect merge rules at the actual repository; local YAML alone does not prove GitHub rulesets.
- Negative guard tests must fail on removed protected policies, duplicate capabilities, outdated paths, authority bypass, missing tests, and unsafe fork-secret exposure.
- **Gate:** reproducible local test + exact candidate action checks, human review of rule weakening, required GitHub branch protection verified externally when submission is authorized. No push/PR/merge without separate explicit approval.

### 2026-11-13 — Authorized service-directory placement (structural only)
- **Worktree:** `D:\samrim-refoundation-clean-20261112`, existing branch; no new worktree/branch, and no automatic Push, PR, merge or deployment.
- **Scope:** three README-only Git-tracked service placements under `services/{identity,dsh,wlt}/`, future backend/OpenAPI/database directory responsibilities, DSH single bounded employee engine for company and Merchant staff, organizational isolation and separation of Identity/DSH/WLT truths.
- **Structural acceptance:** stage-aware workspace/foundation guards accept only those READMEs and optional empty planned subdirectories, and negative fixtures reject service #4, premature Go/modules, OpenAPI, SQL, generated files, unsafe symlinks and missing service-owner README. Preserve existing governance checks and test their sensitivity.
- **Explicitly deferred:** implementing any service, Go module, OpenAPI document, SQL/migration, database connection, Docker environment or live business workflow; donor source is read-only evidence. Keep `GOVERNANCE_CUTOVER: NOT_READY` and sensitive FIN/SEC/MIG/LEGAL review pending.
- **Evidence and status:** inspect branch/HEAD, active unrelated changes, exact Git diff and UTF-8; run targeted guard tests. Recording a PASS for this organizational slice must never imply completed Phase 4, security, financial or product readiness.

### 2026-11-13 — Authorized service client development tooling (no domain implementation)
- **Added scope:** private exact-pinned packages `@bthwani/identity`, `@bthwani/dsh`, `@bthwani/wlt` with root-extended TypeScript configurations, empty contract-bound `clients/index.ts` and README, managed by the existing pnpm workspace and one lockfile. No Nx project/config or duplicated package manager.
- **Source of truth:** Identity/DSH/WLT retain ownership; a TypeScript entrypoint with `export {}` is not a working client. Keep `clients/generated` and Go client modules empty until actual OpenAPI contract and consumers justify them. No business code, data, SQL, migration, Docker or startup is authorized.
- **Acceptance:** stage guard verifies allowed files, exact package names, versions, empty client exports, configs and frozen lock importers; negative tests reject premature implementations and package drift. Run offline dependency installation only when supply-chain policies permit and independently check the three TypeScript projects; report cache/network blockers honestly.
- **Status separation:** pnpm/workspace readiness and typecheck are structural proof only. `GOVERNANCE_CUTOVER: NOT_READY` and protected FIN/SEC/MIG/LEGAL signoffs remain pending, as do runtime/DB/client-contract tests.

## Phase 4 — Clean technical foundation and SQL (NOT_STARTED)
- Re-census all tracked files, source/contract/exported routes, dynamic consumers, migration history and current database state by Identity/DSH/WLT. Record KEEP/MOVE/MERGE/REFOUND/REPLACE/APPROVED_RETIRE and the proof for each materially affected responsibility.
- Re-design schema per owner from first principles using validated business invariants, not copies of old migrations. Preserve protected applied history in source/backup and test a fresh baseline on isolated DB, protected upgrade, schema constraints/index/permission equivalence, restore and financial ledger conservation.
- No second migration writer, no alternative financial truth, and no global schema flattening for fewer files. Include domain service code, OpenAPI and consumer cutover within each applicable SQL slice.
- Rebuild only proven-needed Docker/Expo/Go/TypeScript tooling, preserving external app identities, media and secrets. No actual data/volume reset in this planning phase.
- **Gate:** owner-backed persistent state, negative/concurrent tests and independent migration/finance/security review.

## Phase 5 — Full platform refoundation (NOT_STARTED)
- Identity, DSH, WLT, all admitted Store/Order/Payment/Captain flows and 26 Product capabilities; Customer/Merchant/Captain Expo, web storefront and Operator/Control Panel, design tokens, policies, integration APIs.
- Each slice: accepted contract → authoritative writer/data → consumers → negative/positive tests → remove losing implementation → proof on verified source/runtime revision.
- Test actor/Store/role/City isolation, IDOR, sessions and stale responses, price/stock at confirmation, wallet/COD/Mixed, ledger replay and concurrency, dispatch races, no premature customer address disclosure, real Web/Android UX and iOS only when tested.
- Keep product/legal decisions authoritative in governance, mutable operational rules in their service owners. Policies UI is a composition, not another rules engine.

## Phase 6 — Final acceptance and protected handoff (NOT_STARTED)
- Candidate coverage census for all admitted functions/subfeatures, files and consumers; no UNKNOWN required feature.
- Fresh/upgrade/restore DB proof, full relevant cross-owner journeys and platform tests on same verified SHA + runtime label, no critical known violations.
- Independent finance/security/migration review, CI mandatory checks, link and accessibility validation as applicable.
- Explicit PASS/FAIL/BLOCKED/NOT_RUN/INVALIDATED/REVIEW_BLOCKED for all gates. Product completion remains BLOCKED while required proof is missing.
- Commit/push/PR/merge/deploy are distinct permissions. Never merge this sparse foundation branch into main as a completed application.

## Open decisions and risk ledger — DO NOT SILENTLY ASSUME
| ID | Question or contradiction | Preliminary recommendation / disposition |
| --- | --- | --- |
| D01 | Old enum `BTHWANI_PARTNER`/`INDEPENDENT_STORE` versus user-approved simpler `MARKETPLACE`/`DIRECT` | One Store relation dimension with two options; preserve external/historic contract only via proven governed migration, not a second engine. Confirm exact API/storage identifier at implementation. |
| D02 | `partner` person role versus Store entity and user-facing term `Merchant` | Keep one Identity human actor and one DSH Store resource; Merchant is a person/business account allowed to manage many Stores. Do **not** merge actor and Store. |
| D03 | 26 inherited Product IDs include historical `PARTNER_*` wording | Keep stable governance capability IDs for traceability until a one-time owner-reviewed rename map proves all consumers updated; do not create duplicate synonyms. |
| D04 | Superseded onboarding workflows and outdated tests | No unapproved active path or role. Preserve binding historical financial/legal evidence at its original owner; never resurrect an obsolete workflow to satisfy an old test. |
| D05 | Exact relation defaults and available fulfillment selections | Resolved at semantic level: Store relation registration and fulfillment are DSH owner-backed, configurable by Operator Policies; either relation can use an eligible subset of all three admitted methods after actual dispatch/WLT acceptance. Runtime defaults and particular availability are NOT_RUN. |
| D06 | Fees and actual collection | Draft `governance/finance.md`: one WLT owner handles fee agreement, collection responsibility, funding, custody and settlement independently. Proposed initial Operator-controlled defaults: MARKETPLACE=PLATFORM_MANAGED, DIRECT=STORE_MANAGED; neither is hardcoded, mandatory or runnable until contracts/consent/readback/independent review. Either relation may use COMMISSION or SUBSCRIPTION. |
| D07 | WLT baseline and history | New canonical SQL for each owner. Deletion of original migrations requires comparing applied state and protected data; no unconditional squash/reset. |
| D08 | Control Panel historic master pack versus modern live Owner UI | Extract unique accepted UX and functional invariants, not archived page names, obsolete navigation, branches or screenshots. No arbitrary feature addition without Product approval. |
| D09 | Solo contributor and GitHub review protections | RESOLVED: do not create CODEOWNERS; user is sole contributor. Inspect actual CodeRabbit/GitHub protection settings only when authorized. Independent critical-risk review remains separately required and cannot be simulated by CODEOWNERS. |
| D10 | Source research/OSS/competitor URLs | Preserve complete original inventories and provenance. External link checks are separate and NOT_RUN until performed. |
| D11 | GitHub Fast Guard/Sonar in a source-sparse tree | Existing code-dependent CI is invalid for current foundation state; don't mark as PASS or silently skip tests. Re-introduce only when their required sources exist. |
| D12 | Fully destructive reset because local dev is experimental | Only exact confirmed synthetic state after ownership/isolation/backup verification; real user/session/financial/media data and concurrent sessions remain protected. |


## Evidence inventory and open contradictions after governance drafting (2026-11-12)

The **current request authorizes only governance, agent law, temporary plan and GitHub scaffolding**. No application/backend/SQL/Docker implementation is authorized yet. This audit is based on branch 41 at `426d67b47beb8c66b09acd8c7394086b53ac5aae`, the consolidated archive in `%USERPROFILE%\Downloads\BTHWANI-REFOUNDATION-COMPLETE-PACKAGE-20261112.zip` (outer 11 entries, 9/9 SHA-256 manifest matches from the earlier read-only validation) and selected donor semantic owner documents. Archive existence or checksum validity does not validate archived decisions, old URLs, live DBs or current product readiness.

**Structured first pass done:** full 14-file owner draft and all 26 existing admission IDs mapped to one section each. **Still required before READY:** semantic line-by-line reconciliation of significant branches of each older owner doc, review of original contracts and all material subfeature coverage, actual references, independent critical-risk review and GitHub provider/branch protection verification. There is no valid basis yet to claim 100% correctness or completed refoundation.

| Finding | Source-grounded observation | Required governance disposition before READY |
| --- | --- | --- |
| G01 | Branch 41 WLT agreement approval refuses any model other than COMMISSION with BillingNotReady. | Finance draft preserves SUBSCRIPTION as policy-permitted but **not automatically active**; reconcile complete billing/invoice/retry obligations and explicit acceptance. |
| G02 | Two DSH current Store flows deny BTHWANI_CAPTAIN on INDEPENDENT_STORE. | Fulfillment draft permits either relation **only after** operational/financial admission; implementation later must replace fixed relation prohibition with guarded owner policy without weakening isolation. |
| G03 | Old `BTHWANI_PARTNER`/`INDEPENDENT_STORE` IDs remain in SQL/API; target `MARKETPLACE`/`DIRECT`. | Preserve two semantic values, never add four competing variants. Later migrate all persistence/contracts/consumers with historical readback. |
| G04 | Branch 41 migration 174 created separate Direct Order tables; 176 retires them with protected-data guards. | Do not infer 176 applied in actual DB. SQL refoundation later proves applied history and no parallel Order writer; no copying 174 into new baseline. |
| G05 | WLT current finance owner describes Captain keeping physical COD and WLT debit/coverage; older historical work has remittance/settlement text. | Independently reconcile binding old obligations and exact flow by operation date. Do not revive physical COD remittance for new Orders without governing proof. |
| G06 | Donor governance has rich details beyond 26 headline IDs: Store privacy, quick catalog, media/video, offers, promotion, cancellation, Store employee delegates, payout beneficiaries, drafts, provider links. | Prepare a source/decision/subfeature concordance, prove each preserved or explicitly excluded before cutover. Draft summaries are **not** enough. |
| G07 | `CODEOWNERS` was explicitly rejected by sole contributor. | Do not create it. Provider review can be optional, while mandatory independent financial/security/migration review still applies. |
| G08 | Branch 41 Sonar routes to old branches 36/37/38; Fast Guard assumes full services/apps. | Foundation CI must only claim structural policy checks; adapt real Fast Guard/Sonar to new root when apps/services exist and verify on actual GitHub. |
| G09 | Policy controls are sometimes mere prospective defaults with no automatic activation and central registry does not cover all categories. | Keep Operator Policies as one UX; owner-backed effective policy, accepted Store contracts and Order snapshots are distinct; later prove actual new Store/order response. |
| G10 | New draft Product scope may compress older detailed design/runtime/financial rules. | Before READY, compare each donor owner doc section and current user's decisions, classify KEEP/REWORD/MERGE/SUPERSEDE/EXPLICIT_RETIRE/UNRESOLVED with reason; resolve material omissions. |

### Governance review closure rubric
1. A reviewer reads each source and new target owner **semantically**, comparing decisions and actor/cash/privacy/concurrency consequences. Automated capability-ID tests only prove structural coverage.
2. Historical conflicting instruction is superseded only with an explicit newer approved decision; ambiguous financial or legal meaning remains OPEN rather than silently chosen.
3. No unwanted new Store/Pricing/Payment/Policy engine, protected state reset, or silent deletion of live rights. All checks runnable against the sparse Worktree alone where applicable.
4. Record reviewed reference paths, finite unresolved risks and precise stage evidence in this **temporary plan**; after a governance cutover, avoid indefinite second decision catalogs.
5. Only after approval and guard sensitivity proof change `GOVERNANCE_CUTOVER` to READY on a coherent reviewed candidate, **before** restoring application source or beginning SQL refoundation.

## Stage completion record
- Phase 0: established and revalidated against local branch 41 and target worktree; no deployable-runtime claims.
- Phase 1: local staging, path cleanup and structural guard are subject to readback/tests; even a PASS here never closes Phase 2.
- Phase 2: DRAFT_COMPLETE for 14 owner documents, 26/26 structurally assigned capability IDs, with **full donor-line semantic reconciliation NOT_RUN** and independent finance/security/migration approval REVIEW_BLOCKED. Do not declare governance READY until those evidence gates are satisfied.
- Phases 3–6: not complete; implementation and full integration proofs NOT_RUN.


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
5. **R5 — CUTOVER_APPROVAL:** only after R1-R4 applicable gates are proven and reviewed may `GOVERNANCE_CUTOVER: READY` and related guards/AGENTS be updated in a separate coherent batch. This is governance readiness for *later* code and SQL work, not implementation success.

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


### 2026-11-12 — Per-ID reconciliation of the 112 historical Control Panel requirements

**Source basis:** `docs/reference/HISTORICAL-CONTROL-PANEL-REQUIREMENTS.md` contains the unchanged historical ID/wording, with owner/next-review routing. This is the **single temporary decision-disposition record** for those historic 112 IDs; it does not replace or restate the normative domain files. The labels below classify the **documentary meaning** against the **current canonical governance target**, **not** whether an app/SQL/API is implemented. `DRAFT_ALIGNED_OWNER` is not a reviewed/ratified financial or security guarantee. Neither past branch-16 pass nor a ZIP manifest is acceptance of the new source.

**Legend:** `DRAFT_ALIGNED_OWNER`: the core principle is covered by the cited present governing owner, pending governance cutover; `POLICY_REFRAMED`: a historical default/limit is a candidate owner-controlled Operator policy; `CONDITIONAL_CANDIDATE`: a UX/technology feature needs proved need and explicit Product admission; `HISTORICAL_ONLY`: the branch/PR/tool command itself is stale, not a current requirement; `MIXED_REFRAME_RETIRE`: preserve current participant capability but retire obsolete field/acquisition path; `INDEPENDENT_RISK_REVIEW`: financially/security/migration-sensitive principle is present but its adoption as final policy is review-blocked.

| ID | Documentary disposition | Legal owner for decision | Why this disposition (not runtime proof) |
| --- | --- | --- | --- |
| R001 | `DRAFT_ALIGNED_OWNER` | `identity.md + experience.md` | صلاحيات المسارات وعناصر التنقل وفق الدور والمالك |
| R002 | `DRAFT_ALIGNED_OWNER` | `AGENTS.md` | حماية Worktree والبيانات والعمل المتزامن قبل الكتابة |
| R003 | `DRAFT_ALIGNED_OWNER` | `experience.md` | مصدر واحد لأدوار التصميم الدلالية دون مالك CSS مواز |
| R004 | `DRAFT_ALIGNED_OWNER` | `experience.md` | تجميع الأعمال حسب المورد والمسؤولية دون صفحات ضخمة |
| R005 | `DRAFT_ALIGNED_OWNER` | `REPOSITORY-STRUCTURE.md` | حذف الوجهات المكررة فقط بعد نقل مستهلكيها |
| R006 | `DRAFT_ALIGNED_OWNER` | `REPOSITORY-STRUCTURE.md` | نقل ودمج الملفات حسب مسؤولية المالك |
| R007 | `DRAFT_ALIGNED_OWNER` | `experience.md` | عرض عناصر الإدخال مناسب للمهمة والحجم |
| R008 | `DRAFT_ALIGNED_OWNER` | `experience.md` | RTL عربي وتنسيق موحد للوقت والعملة والاتجاه |
| R009 | `DRAFT_ALIGNED_OWNER` | `experience.md` | ثيمات النهار والليل والوصول والفوكس والحركة |
| R010 | `DRAFT_ALIGNED_OWNER` | `experience.md` | تنقل سياقي واحد لا يكرر المحتوى |
| R011 | `CONDITIONAL_CANDIDATE` | `experience.md` | طي القائمة وحفظ العرض عند حاجة مثبتة |
| R012 | `CONDITIONAL_CANDIDATE` | `experience.md` | المفضلة والحديثة اختيارات تنقل وليست شاشة إلزامية |
| R013 | `DRAFT_ALIGNED_OWNER` | `experience.md` | استرجاع البحث/الفرز/الصفحة مع حماية الخصوصية |
| R014 | `DRAFT_ALIGNED_OWNER` | `architecture.md + experience.md` | المالك ينفذ البحث والترقيم للمجموعات الكبيرة |
| R015 | `DRAFT_ALIGNED_OWNER` | `architecture.md` | لا إظهار إجمالي مبني على صفحة محمّلة فقط |
| R016 | `DRAFT_ALIGNED_OWNER` | `experience.md` | مؤشر سياقي صحيح مع سبب ووجهة تفاصيل |
| R017 | `DRAFT_ALIGNED_OWNER` | `experience.md` | الرئيسية تشير لأعمال مسموحة وحالات فعلية |
| R018 | `DRAFT_ALIGNED_OWNER` | `experience.md` | حالات التحميل والفراغ والفشل وإعادة المحاولة |
| R019 | `DRAFT_ALIGNED_OWNER` | `identity.md` | الفعل يخضع للحق الحالي وحالة المورد الحقيقية |
| R020 | `DRAFT_ALIGNED_OWNER` | `experience.md` | عدم فقد مدخلات المستخدم أو الكتابة الصامتة |
| R021 | `CONDITIONAL_CANDIDATE` | `experience.md` | الفاحص السريع مفيد للمقارنات مع مسار تفصيلي |
| R022 | `DRAFT_ALIGNED_OWNER` | `catalog.md + experience.md` | الجدول هو عرض افتراضي لعناصر متنامية مع صور |
| R023 | `CONDITIONAL_CANDIDATE` | `experience.md` | المعرض والتكبير إن أفادا دون كتالوج أو Query ثان |
| R024 | `CONDITIONAL_CANDIDATE` | `experience.md` | مقارنة الصور عند حاجة تدقيق موثقة |
| R025 | `DRAFT_ALIGNED_OWNER` | `catalog.md + safety.md` | ملكية الوسائط وحقوقها وسياق عرضها |
| R026 | `DRAFT_ALIGNED_OWNER` | `stores.md + journeys.md` | تسجيل التاجر المباشر ثم جاهزية النشر المستقلة |
| R027 | `DRAFT_ALIGNED_OWNER` | `hr.md + identity.md` | طلب صلاحية الموظف غير منحها مباشرة |
| R028 | `INDEPENDENT_RISK_REVIEW` | `finance.md` | WLT وحده مسؤول عن التسويات لكن القبول المالي المستقل مفتوح |
| R029 | `DRAFT_ALIGNED_OWNER` | `stores.md + identity.md` | تفويض المتجر منفصل عن صلاحية نشره |
| R030 | `DRAFT_ALIGNED_OWNER` | `commerce.md + journeys.md` | إدارة الطلب والاستثناء دون دفتر أو حالة موازية |
| R031 | `MIXED_REFRAME_RETIRE` | `fulfillment.md + product.md` | حفظ وظائف الكابتن؛ الميداني ملغى ولا يُعاد |
| R032 | `POLICY_REFRAMED` | `architecture.md + experience.md` | نطاق وسريان السياسات لدى المالك لا لوحة التحكم |
| R033 | `DRAFT_ALIGNED_OWNER` | `experience.md + commerce.md` | معاينة النشر تقرأ حالة المحتوى الحقيقية |
| R034 | `CONDITIONAL_CANDIDATE` | `product.md` | بحث شامل وCommand Palette اختيار مشروط لا منتج مفروض |
| R035 | `CONDITIONAL_CANDIDATE` | `experience.md` | Saved Views والشرائح والأعمدة وفق تكرار الاستخدام |
| R036 | `DRAFT_ALIGNED_OWNER` | `engineering.md` | Bulk فعل أصلي مفوض بحدود ونتائج جزئية |
| R037 | `POLICY_REFRAMED` | `commerce.md` | SLA قابل للضبط عند وجود أحداث أصلية وموافقة |
| R038 | `DRAFT_ALIGNED_OWNER` | `architecture.md` | تعريف المقام/الفترة/العملة/المصدر لكل مؤشر |
| R039 | `CONDITIONAL_CANDIDATE` | `architecture.md` | Cohorts عميقة عند احتياج وأحداث حقيقية |
| R040 | `CONDITIONAL_CANDIDATE` | `product.md + engineering.md` | AI/Streaming عند حاجة مثبتة لا بمجرد أرشيف |
| R041 | `DRAFT_ALIGNED_OWNER` | `safety.md + AGENTS.md` | عدم تدمير بيانات فعلية أو تصنيع نجاح بـSeed |
| R042 | `DRAFT_ALIGNED_OWNER` | `safety.md + experience.md` | حماية الهوية والهاتف من URL والسجلات |
| R043 | `DRAFT_ALIGNED_OWNER` | `engineering.md + journeys.md` | إيجابي وسلبي وتعافٍ وقراءة دائمة من المالك |
| R044 | `DRAFT_ALIGNED_OWNER` | `engineering.md` | احتفاظ الاختبارات الصالحة وعدم قبول Snapshot تلقائي |
| R045 | `DRAFT_ALIGNED_OWNER` | `REPOSITORY-STRUCTURE.md` | إزالة الكاتب/المسار الخاسر بعد تحويل المستهلكين |
| R046 | `DRAFT_ALIGNED_OWNER` | `REPOSITORY-STRUCTURE.md` | حماية الروابط والهويات والمهاجرات المعتمدة |
| R047 | `DRAFT_ALIGNED_OWNER` | `product.md` | لا إنشاء منتجات ورسوم وموافقات جديدة من تصور واجهة |
| R048 | `DRAFT_ALIGNED_OWNER` | `AGENTS.md` | Push وMerge والنشر وأعمال Git بتفويض منفصل |
| R049 | `HISTORICAL_ONLY` | `docs/REFOUNDATION-PLAN.md` | مقارنة فروع HR القديمة لا تحكم الفرع الحالي |
| R050 | `CONDITIONAL_CANDIDATE` | `engineering.md` | Graphify أداة مشروطة بثبوت الاستخدام والاتصال |
| R051 | `DRAFT_ALIGNED_OWNER` | `experience.md` | قياس جهد المستخدم لا اختراع أهداف رقمية |
| R052 | `DRAFT_ALIGNED_OWNER` | `AGENTS.md` | FAIL وBLOCKED وNOT_RUN بدليل بدل 100% |
| R053 | `DRAFT_ALIGNED_OWNER` | `safety.md` | خصوصية الصادرات والصور ومعاينات البحث |
| R054 | `MIXED_REFRAME_RETIRE` | `commerce.md + product.md` | معالجة طلب محددة دون CRM أو منصة إرجاع عامة |
| R055 | `DRAFT_ALIGNED_OWNER` | `journeys.md` | الإشعارات مشتقات أحداث والعداد ليس حجم الصفحة |
| R056 | `DRAFT_ALIGNED_OWNER` | `experience.md` | فصل التبويب والتصفية عن مورد حقيقي |
| R057 | `DRAFT_ALIGNED_OWNER` | `engineering.md` | عدم إضافة Browser shim أو إطار JS بلا حاجة |
| R058 | `MIXED_REFRAME_RETIRE` | `journeys.md + product.md` | المشاركون عميل/تاجر/كابتن/مشغل؛ استبعاد الميداني |
| R059 | `DRAFT_ALIGNED_OWNER` | `engineering.md` | اختبارات أداء معزولة بحجم واقعي |
| R060 | `DRAFT_ALIGNED_OWNER` | `AGENTS.md + safety.md` | إيقاف آمن عند خسارة بيانات أو اختراق صلاحية |
| R061 | `CONDITIONAL_CANDIDATE` | `experience.md` | معرض اختياري من الاستعلام نفسه مع بقاء الجدول |
| R062 | `DRAFT_ALIGNED_OWNER` | `architecture.md + experience.md` | إجمالي سياقي حقيقي؛ unknown لا يساوي صفر |
| R063 | `DRAFT_ALIGNED_OWNER` | `experience.md` | معنى المورد والتبويب والتصفية واضح بلا تشظٍ |
| R064 | `HISTORICAL_ONLY` | `docs/REFOUNDATION-PLAN.md` | مراجعة الفروع القديمة انتهت صلاحيتها كحالة Git حية |
| R065 | `DRAFT_ALIGNED_OWNER` | `REPOSITORY-STRUCTURE.md` | لا حذف قبل فحص المستهلكين والمصادر |
| R066 | `DRAFT_ALIGNED_OWNER` | `catalog.md + safety.md` | صور خاصة وفق ACL وحقوق وLightbox مصرح |
| R067 | `DRAFT_ALIGNED_OWNER` | `experience.md` | فحص keyboard/focus/sticky وغطاء العناصر |
| R068 | `DRAFT_ALIGNED_OWNER` | `experience.md + engineering.md` | نطاق الإجراء الجماعي ونتائجه الجزئية صريحة |
| R069 | `DRAFT_ALIGNED_OWNER` | `safety.md + experience.md` | لا وضع أرقام هواتف أو هويات في URL |
| R070 | `DRAFT_ALIGNED_OWNER` | `docs/reference/README.md + engineering.md` | التراخيص والإثبات والأحداث قبل الاعتماد |
| R071 | `HISTORICAL_ONLY` | `AGENTS.md` | كل كتابة وفق HEAD الحي لا branch14 |
| R072 | `DRAFT_ALIGNED_OWNER` | `engineering.md` | التحقق من SHA256 ومسارات الحزمة قبل استنتاج السلامة |
| R073 | `HISTORICAL_ONLY` | `docs/REFOUNDATION-PLAN.md` | branch16/main تعليمات مؤرخة لا مرشحًا حاليًا |
| R074 | `HISTORICAL_ONLY` | `docs/REFOUNDATION-PLAN.md` | PR90/91 أدلة مؤرخة لا إثباتًا على المرشح |
| R075 | `DRAFT_ALIGNED_OWNER` | `engineering.md` | عدد الملفات أو Routes لا يثبت رحلة مستخدم |
| R076 | `DRAFT_ALIGNED_OWNER` | `engineering.md` | تصنيف الإثبات/الفشل/الترشيح واضح بالمصدر |
| R077 | `DRAFT_ALIGNED_OWNER` | `experience.md + hr.md` | HR الحالية لا تُخفى بسبب تخطيط تنقل قديم |
| R078 | `CONDITIONAL_CANDIDATE` | `experience.md + catalog.md` | معرض فقط عند الحاجة ونفس Paging والبيانات |
| R079 | `DRAFT_ALIGNED_OWNER` | `architecture.md` | البيان التحليلي مقيد بالمدينة والفترة والحق |
| R080 | `DRAFT_ALIGNED_OWNER` | `experience.md` | استعادة موضع التصفح والمحدد والفوكس والمسودة |
| R081 | `INDEPENDENT_RISK_REVIEW` | `identity.md + safety.md` | رفض API والطرق المباشرة بحسب الدور والمالك |
| R082 | `INDEPENDENT_RISK_REVIEW` | `finance.md` | تمييز مستحقات المستفيد عن التحصيل وعهدة النقد |
| R083 | `INDEPENDENT_RISK_REVIEW` | `finance.md` | الرسوم المقترحة لا تصبح اتفاقية إلا بعد قبولها |
| R084 | `INDEPENDENT_RISK_REVIEW` | `safety.md` | الحد من تسريب الهاتف في الروابط والسجلات |
| R085 | `DRAFT_ALIGNED_OWNER` | `catalog.md + safety.md` | الصورة ذات ACL/ترخيص ولا تعرض عند رفض المصدر |
| R086 | `INDEPENDENT_RISK_REVIEW` | `identity.md + hr.md` | موظف واحد وهوية واحدة دون تكرار |
| R087 | `DRAFT_ALIGNED_OWNER` | `stores.md` | الموافقة ليست نشرًا أو إتاحة للطلب |
| R088 | `DRAFT_ALIGNED_OWNER` | `hr.md` | لا فقد لقواعد حضور وتصحيح الموظف |
| R089 | `DRAFT_ALIGNED_OWNER` | `engineering.md` | تعداد Routes لا يغني عن إثبات الواجهة الفعلية |
| R090 | `HISTORICAL_ONLY` | `docs/REFOUNDATION-PLAN.md` | ملاحظات PR87/90/91 لا تُنفذ بلا مراجعة HEAD |
| R091 | `DRAFT_ALIGNED_OWNER` | `engineering.md` | حمل مع بيانات مؤقتة معزولة لا Seeds يومية |
| R092 | `DRAFT_ALIGNED_OWNER` | `experience.md` | تحقق من تركيز ظاهر ولمس/تكبير/RTL/contrast |
| R093 | `DRAFT_ALIGNED_OWNER` | `REPOSITORY-STRUCTURE.md` | حذف مبرر مع قائمة المستهلكين والبديل |
| R094 | `INDEPENDENT_RISK_REVIEW` | `safety.md + engineering.md` | الهجرات المطبقة لا يعاد كتابتها بلا ترحيل محمي |
| R095 | `CONDITIONAL_CANDIDATE` | `product.md + experience.md` | Column pinning/Saved Views/Palette بحسب جدوى مثبتة |
| R096 | `CONDITIONAL_CANDIDATE` | `product.md + safety.md` | AI استشاري مقروء فقط بعد اعتماد منفصل |
| R097 | `CONDITIONAL_CANDIDATE` | `engineering.md` | SSE/WebSocket فقط بعد حاجة وتحقق |
| R098 | `DRAFT_ALIGNED_OWNER` | `product.md` | منع اختراع شكاوى وRefunds كمنصة جديدة |
| R099 | `INDEPENDENT_RISK_REVIEW` | `finance.md` | مجهول نتيجة الدفع لا نجاح؛ Idempotency ومطابقة |
| R100 | `DRAFT_ALIGNED_OWNER` | `architecture.md` | استعلام وكميات وEmpty/Error دقيقة مع ACL |
| R101 | `DRAFT_ALIGNED_OWNER` | `journeys.md` | العداد الشامل غير المقروء مستقل عن حجم الصفحة |
| R102 | `DRAFT_ALIGNED_OWNER` | `engineering.md` | سلامة ZIP لا تثبت CI أو SQL أو تجربة المستخدم |
| R103 | `DRAFT_ALIGNED_OWNER` | `docs/reference/README.md` | الأصول التاريخية للملفات محفوظة وأصلها معروف |
| R104 | `DRAFT_ALIGNED_OWNER` | `engineering.md` | Manifest وSHA قابلة للتثبت دون تعميم |
| R105 | `HISTORICAL_ONLY` | `docs/REFOUNDATION-PLAN.md` | هدف branch16/V1/V2 استبدلته Worktree الحالية |
| R106 | `DRAFT_ALIGNED_OWNER` | `experience.md` | فصل unknown عن empty وحالات الخطأ |
| R107 | `DRAFT_ALIGNED_OWNER` | `experience.md` | لا تنقل مستقل لكل حالة ولا صفحة عملاقة |
| R108 | `DRAFT_ALIGNED_OWNER` | `engineering.md` | اختبارات بيانات اصطناعية تدريجية ومعزولة |
| R109 | `CONDITIONAL_CANDIDATE` | `experience.md` | Inspector عند حاجة تفاعل مثبتة لا لكل كائن |
| R110 | `INDEPENDENT_RISK_REVIEW` | `safety.md + stores.md` | الاستعادة والحذف لا يزيلان الحقوق والروابط دون إثبات |
| R111 | `DRAFT_ALIGNED_OWNER` | `architecture.md` | Cohort بفترة/مدينة/دور دقيق |
| R112 | `DRAFT_ALIGNED_OWNER` | `experience.md` | تحسين UX بقياس وقت/نقرات/أخطاء |

**Coverage:** 112/112 unique source IDs have a **documentary classification**; of these `DRAFT_ALIGNED_OWNER`: 75; `POLICY_REFRAMED`: 2; `CONDITIONAL_CANDIDATE`: 16; `HISTORICAL_ONLY`: 7; `MIXED_REFRAME_RETIRE`: 3; `INDEPENDENT_RISK_REVIEW`: 9. Source facts and source strings are not rewritten by this crosswalk. True semantic equivalence still needs the exact current contract/SQL/operational/consent review per affected owner and independent review where mandated. Any mixed historical feature omitted from the present Product requires explicit owner-side adoption before a later SQL or UI implementation. A source classification is not authority to publish it or a claim of every archive paragraph being independently validated.


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

### Independent decision gates: evidence and explicit unresolved approvals

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

**Stage boundary:** Policy wording/structural hygiene can improve now without code or SQL. Later owner API/SQL/Web/Expo implementation may not start solely because the tool-only pnpm workspace is ready. No Product apps, Go modules, contracts, PostgreSQL or Docker resources were created in this batch.

### Local exact-version toolchain mismatch closure

- The former reported **missing Go 1.27.3** is resolved for **local CLI availability**: normal Go user toolchain cache contains the original required `go1.27.3`; explicit `GOTOOLCHAIN=go1.27.3`, `GOPROXY=off` gives `go version go1.27.3 windows/amd64`. Global `go version` still says `1.27.1` by design.
- `tools/dev/verify-workspace.mjs --require-exact-toolchain` finds an installed exact `node.exe v24.22.1` despite pnpm's embedded Node `24.19.0`, then executes the user-cache Go `1.27.3` offline. `pnpm run check:toolchain` is therefore **PASS** without any global runtime replacement, version upgrades, app install or new backend code.
- Stage 2 is **PASS for exact CLI readiness**; Stage 3 remains **PASS for the minimal reproducible package foundation**. No `go test`, `go work sync`, RN/Expo/Next boot, contract API integration, Android, Docker or SQL was executed. Their readiness remains `NOT_RUN`, not implied by toolchain presence.


## 2026-11-12 — Design refoundation plan: 24-section decision concordance (this candidate)

**Reviewed source:** `D:\samrim-implementation\BTHWANI-DESIGN-REFOUNDATION-AUDIT-AND-EXECUTION-PLAN-20261112.md`, 688 textual lines (24 numbered sections, dated 2026-11-12), plus original donor branch `41` at `426d67b47beb8c66b09acd8c7394086b53ac5aae`. The design plan is **PLAN_ONLY** except for the later user-approved decisions explicitly identified by source section. An entry below denotes *governance documentary reconciliation*, not migrated source code, API compatibility, runtime implementation or independent critical-risk approval. No companion policy root is created.

| Original section | Determination for current governance | Canonical owner | Rationale / unresolved gate |
| --- | --- | --- | --- |
| 01 Goal and success | ADOPT_BOUNDED | `engineering.md` | True acceptance by end-to-end owner readback; never claim source-file count or "100%" correctness as empirical proof |
| 02 Source-vs-unverified inventory | ADOPT_BOUNDED | `engineering.md` | Old snapshot test counters are not present SHA/runtime results |
| 03 Proposed design decisions | REFRAME_APPROVED | `experience.md` | Tamagui/Ant and single brand owner approved; only supported Studio operations are admitted |
| 04 Initial tree (`partner`) | SUPERSEDE_INTERNAL_NAME | `platform.md`, `REPOSITORY-STRUCTURE.md` | Later section 23 uses `merchant`; internal path decision follows Merchant actor vocabulary; external IDs unchanged |
| 05 Expo/dependency stages | IMPLEMENTATION_DEFERRED | `engineering.md`, `platform.md` | Existing Expo 58.0.19/RN 0.88.0 and pinned donor tools; no Stage-4 app build permitted here |
| 06 Donor design system replacement | REFRAME_APPROVED | `experience.md` | Preserve semantic brand/provider/native unique capabilities, migrate generic primitives only after consumer proof |
| 07 Operator UX | REFRAME_APPROVED | `experience.md` | One Ant shell, SSR/CSP/ACL, owner-filtered server pagination; do not treat every Next route as a business engine |
| 08 Studio publication | REFRAME_APPROVED_WITH_CAPABILITY_GATE | `experience.md` + DSH ownership in `architecture.md` | Verified donor `CLIENT_HOME`; Store customization remains future until canonical contract/authorization actually supports it |
| 09 Design refoundation stages | IMPLEMENTATION_DEFERRED | `engineering.md` | D0–D6 apply later; current governance stage cannot prove platform UX |
| 10 UX acceptance scenarios | ADOPT_BOUNDED | `experience.md`, `safety.md` | Positive/negative, actor/store switch, real browser/Android and future iOS proofs |
| 11 Open issues | PARTIAL_DECISION | `experience.md`, `platform.md`, `safety.md` | Brand/token owner and folder names resolved as policy; exact Studio Store publishing and legal/financial rights remain conditional |
| 12 Delivery and report style | ADOPT_BOUNDED | `AGENTS.md` | Versioned source evidence, local commit only, no automatic Push/PR/Merge |
| 13 First authorized migration slice | IMPLEMENTATION_DEFERRED | `engineering.md` | No Expo/Next or backend code in governance-only stage |
| 14 Max Tamagui/Ant re-use and exclusivity | ADOPT_APPROVED | `experience.md` | Derived adapters from one brand source; platform-specific modules remain valid |
| 15 Proposed folder partition | REFRAME_APPROVED | `platform.md`, `REPOSITORY-STRUCTURE.md` | No new generic brand package or blank directories; Merchant internal folder wins over interim Partner proposal |
| 16 Design task ownership | IMPLEMENTATION_DEFERRED | `engineering.md`, `experience.md` | DS-01–13 tests and consumer inventory are implementation acceptance criteria |
| 17 Anti-duplicate design checks | ADOPT_BOUNDED | `experience.md`, `engineering.md` | Owner and negative checks first; no second audit framework or fake dynamic scan |
| 18 Platform/security scenarios | ADOPT_BOUNDED | `experience.md`, `safety.md` | Real Web/Android, iOS only when tested; financial IDOR tests deferred to actual code stage |
| 19 UI closure prohibitions | ADOPT_BOUNDED | `engineering.md` | Never label a Design System "migrated" by its documentation alone |
| 20 Explicit approved OpenAPI simplification | ADOPT_APPROVED | `engineering.md` | One OpenAPI 3.1 owner entry and flat cohesion-based paths; no silent contract break, no code edits |
| 21 Explicit approved SQL fresh baseline | ADOPT_WITH_INDEPENDENT_RISK_GATE | `engineering.md`, `safety.md` | One **derived** fresh baseline per owner, protected original 275 upgrade files; implementation/deletion review blocked |
| 22 SQL/OpenAPI/service coordination | ADOPT_BOUNDED | `architecture.md`, `engineering.md` | Formal source→contract→writer→consumer→DB evidence; no phase leap |
| 23 Latest four app structure | ADOPT_APPROVED_INTERNAL_NAME | `platform.md` | `customer/merchant/captain/control-panel`; preserve donor Expo slug/package/scheme/EAS project IDs and all consumers |
| 24 UI/contract/SQL integration order | ADOPT_BOUNDED | `engineering.md`, `architecture.md` | This is a later implementation sequence, not proof or permission for Stage 4+ |

**Specific resolved apparent contradictions:** `partner` as a *proposed new internal folder* is superseded by `merchant` but `com.bthwani.partner` as a *published technical app ID* stays unchanged. The historical `design-system` authored colors are preserved pending a proven consumer migration; `tamagui-config` and Ant are two **derived renderer adapters**, not two brand authors. `Studio CLIENT_HOME` currently exists as source observation; Store-scoped customization is **future/not automatically enabled**. The **3** SQL baseline targets are **new empty DB install entrypoints** rather than permission to discard the **275** original applied-upgrade migration files. The OpenAPI refactor rearranges file ownership but must not change actual business/API semantics. This concordance is **24/24 documentary sections handled**, not a complete line-by-line approval of all external archives and not an independent legal review.

### Internal app identity source observations preserved (do not execute rename)

- Donor `apps/app-client/mobile.config.json`: `slug=app-client`, `scheme=client`, Android/iOS `com.bthwani.client`, EAS `4adf3184-fc07-4186-b49e-0dc821a5ab73`.
- Donor `apps/app-partner/mobile.config.json`: `slug=app-partner`, `scheme=partner`, Android/iOS `com.bthwani.partner`, EAS `bcd22a76-d4b2-4de0-93b3-f6d13074a802`.
- Donor `apps/app-captain/mobile.config.json`: `slug=app-captain`, `scheme=captain`, Android/iOS `com.bthwani.captain`, EAS `7efa39e1-895f-44d7-a597-d613c79297b6`.
- All three source files specify owner `bthwani1`, version `0.3.1`. **These are donor-revision files, not a confirmed App Store/EAS runtime identity proof**. The actual native config and signing identity remain protected, and no Expo folder/runtime was modified.

### Operator Policies decision readiness (representative, not a second legal policy inventory)

| Known commercial/operational policy candidate | Legal setting owner | Historical source value where justified | Governance treatment / production state |
| --- | --- | --- | --- |
| Approved service-city reach/radius | DSH | Historical 30 km | CONFIGURABLE once admitted; city/Store and coordinates validated, no non-approved city enabled; runtime NOT_RUN |
| Delivery distance bands, base and excess-distance fee | DSH quote with WLT commercial agreement/collection boundary | Donor distance/fee table | CONFIGURABLE only with version/consent/quote readback; no retroactive charge |
| Captain offer count, location freshness, timeout/escalation | DSH | Three offers, 15-minute freshness, relevant 5/30-minute attention examples | CONFIGURABLE bounded; **one winning assignment** and address privacy SAFETY_INVARIANT |
| First-order contact count/claim expiry | DSH | Three qualifying Orders, 10-minute claim | CONFIGURABLE; actual spoken contact and proven completion SAFETY_INVARIANT; no automatic pre-preparation block |
| Order cancellation/compensation eligibility/window/ceiling | DSH policy, financial posting WLT | No universal value approved by archive | CONFIGURABLE candidate; must preserve frozen Orders and independent financial review |
| Store admission/relation/method readiness/publication | DSH; WLT contract acceptance for financial terms | Two relation modes, three method types | Configurable only for implemented permissions/contracts; Store publication not Studio content publication |
| Commission/subscription/collection responsibility/settlement period | WLT | No universally binding rate or period from archive | CONFIGURABLE only with accepted agreement, legal signoff and versioned financial safeguards; REVIEW_BLOCKED |
| WLT COD coverage/cash reserve/refund/beneficiary limits | WLT | Historical cash-only reserve and gross Order eligibility distinction | Conditional financial values; BALANCED_LEDGER, once-only posting, verified beneficiary SAFETY_INVARIANT, review BLOCKED |
| Catalog popularity window/bulk import/media limits | DSH | 30-day ranking; 5000-row import; 10 MiB/30-second media donor values | CONFIGURABLE when safely supported; no unapproved media/publishing |
| Published design/theme choices | DSH public content version with design renderer consumer | Only CLIENT_HOME evidence confirmed | **Design Studio**, NOT Operator Policies; no arbitrary CSS/JS or unproved Store theme activation |

Each later Owner implementation must specify in its **single canonical contract** the setting name, type/unit, global/city/relation/Store precedence, bounded validation, authorized Operator right, legal readiness, initial effective default or `UNDECIDED`, version/effective date/reason, historical Order/agreement impact, readback/concurrency/rollback and actual support state. The table is **temporary donor evidence**, not a new configuration database or reusable generic rules engine.

### Independent review and GitHub status on the local pre-change candidate

- FIN-01/02/03, SEC-01/02, MIG-01 and LEGAL-01 from the existing `Stage-1 policy cutover decision packet` remain **REVIEW_BLOCKED**; professional independent review and applicable legally accepted source agreements have **not** been provided or performed by a separate qualified reviewer. A self-judged "100%" score is not approval; keep money/authorization/migration gates **nonactivated**.
- The currently pushed local *previous* SHA `65738d6c3ecc94e486ee4f7df62d7f38e3ba0b0b` has **zero legacy combined statuses** and **zero PR-filtered workflow runs** returned by the GitHub connector. This is **not proof of zero CI at all trigger types**, nor PASS for CodeRabbit. The next locally authored SHA will **not** be pushed without separate authorization; real Actions/CodeRabbit for that exact new candidate remain NOT_RUN.
- The supplied shared ChatGPT URL `https://chatgpt.com/share/6af5ea0a-2c6c-83eb-aeeb-f37059c1bbe2` could not be extracted from the available sources, so its text/decisions are **not** represented as independently checked. User's explicit approval in the present turn authorizes implementing the stated plan *within existing safety/independent-review gates*; it does not authorize inventing its contents or manufacturing qualified review.

### Cutover decision, pending independent signoff

**Domain governance decisions have been materially clarified in this batch**, with design, policy, internal app identity, contract and migration placement at their right semantic owners. However, **GOVERNANCE_CUTOVER stays NOT_READY** because mandatory independent critical-risk reviews and full material-source acceptance are not evidenced. This is a **review-blocked adoption boundary**, not a request to build all apps/SQL or a denial of the valid low-risk engineering foundation. The exact evidence necessary for READY remains the existing review packet in this one plan. After a qualified independent decision, review the final changed policy text, rerun guards, and adopt via a separately approved governance cutover revision. No Product apps, service modules, API contracts, SQL, Docker or credentials were changed during this governance-only batch.


## 2026-11-12 — Critical-risk review evidence matrix and executable illustrative checks (candidate governance only)

**Scope of verification:** This pass is an **authoring/proof-preparation pass**, not an independent accountant/security/legal/database review, not a migration, and not a live WLT/DSH/Identity acceptance. References below route to existing canonical owners and donor source `D:\samrim\docs\governance\{finance,identity,safety,commerce,stores,journeys}.md` at SHA `426d67b47beb8c66b09acd8c7394086b53ac5aae`. The previously observed 275 SQL donor files and legal agreement *requirements* are **not proof** of current applied database histories, accepted contracts or provider terms. The eight `tools/governance/review-examples.test.mjs` fixtures use deliberately illustrative whole-YER amounts; they prove elementary example arithmetic only. No mock is an accounting assertion or Product readiness certification.

### FIN-01 — Payment source, cash exposure, refund, replay and race

| Review case | Explicitly proposed policy invariant | Adversarial/failure question and required evidence |
| --- | --- | --- |
| FIN-01-WALLET | Customer Wallet-only Order: **gross payable = Wallet allocation**, no BThwani-Captain physical cash hold; WLT debit and owner entitlement are posted once | Duplicate confirmation, insufficient Wallet, canceled hold or callback replay must not deduct twice; independently review balanced journal examples and accepted DSH/WLT contract |
| FIN-01-COD | For admitted BThwani Captain cash collection, available unheld Captain coverage is **strictly greater** than frozen whole Order payable; only actual positive cash portion is held/debited on lawful cash event | At **exactly equal** coverage the proposal fails; race between two Orders, late Captain acceptance, denied Store/Captain role, return/failed handoff must not bypass atomic coverage |
| FIN-01-MIXED | Example **1000 YER payable = 300 prepaid Wallet + 700 cash**: gross Captain eligibility threshold `>1000`, cash-only hold `700`, Wallet source `300`, not a second Captain debit | Test wallet reversal vs physical cash debt separately and compare real Order/transfer ledger entries; **amounts are illustration, not active tariff** |
| FIN-01-CANCEL | Cancellation **before collected cash** of above illustrative Mixed example releases **700 hold** (not a cash-debit reversal) and resolves Wallet **300** against applicable frozen refund policy | Cancellation after pickup/delivery/posted cash instead requires provenance-bound adjustment, not blindly the same operation; concurrent cancel/complete must have one terminal state |
| FIN-01-UNKNOWN | Provider timeout / cross-owner acknowledgment unavailable cannot become success; one idempotency/transfer business identity owns retries | Read back canonical DSH Order state plus WLT operation/journal; same-key replay unchanged; new-key replay cannot multiply funds; reconcile before further external side effect |
| FIN-01-SOURCE | Donor's gross-coverage threshold and cash-part hold are preserved distinctly in `governance/finance.md`, without inventing a Store-funded, staff-Captain or self-service refund rail | Independent financial/security reviewer must verify whether policy is legally and operationally valid for each admissible fulfillment/collector combination; no live service code exists in new Worktree |

### FIN-02 — WLT commissions, recipient and Store-collected proceeds

| Review case | Explicitly proposed policy invariant | Adversarial/failure question and required evidence |
| --- | --- | --- |
| FIN-02-AGREEMENT | `COMMISSION` or `SUBSCRIPTION` is independent of `MARKETPLACE`/`DIRECT`; one accepted WLT Store-specific version, fees and collection responsibility governs its legal period | An Operator default cannot activate recurring billing or silently change old Orders/periods; require **actual consent/terms version** and permitted model/collection matrix |
| FIN-02-STORE-CASH | Store-managed externally collected proceeds **belong to Store custody**; WLT recognizes only verified commission/platform receivable and admitted offsets | Example Store cash sale **1000 YER**, independently accepted illustrative commission **75 YER**, never credits Store as a second WLT earning. 75 is not an approved percentage |
| FIN-02-REMIT | Commission platform receivable stays open until WLT verifies lawful official receipt or approved offset; Merchant receipt image alone is no payment | Duplicate reference, disputed amount, mismatched Store/recipient, overpayment and provider timeout remain open for reconciliation |
| FIN-02-BENEFICIARY | Per-Store beneficiary: `DEFAULT_OWNER`, `SELECTED_VERIFIED_STAFF` or `RECIPIENT_REVIEW_REQUIRED`; only authorized Store owner changes assignment, Finance verifies official Identity-derived destination | Staff suspension/revocation blocks **future** transfer instruction release; no silent fallback/redirection; already executed transfer retains original evidence and reconciliation |
| FIN-02-PAYOUT | Settlement **intake** is not a reserved balance or an external transfer; verified payout/hold and subsequently posted, statement-matched transfer are separately gated | Read exact entitlement/Store allocation, independently approved counterparty/destination, idempotency, matching provider statement and final WLT release; different beneficiaries require separate transfers |

### FIN-03 — Exact provider fees and separated delivery margin

| Review case | Explicitly proposed policy invariant | Adversarial/failure question and required evidence |
| --- | --- | --- |
| FIN-03-CASHIN | Illustrative official provider funding **1000 gross, 980 net, 20 platform fee**: customer receives 1000 verified gross; provider settlement 980 and platform fee expense 20 are distinct conservation facts | Cannot assume provider fee schedule or settlement finality from old notes; compare official provider agreement/receipt, canonical double-entry postings, callback replay and reconciliation |
| FIN-03-MARKUP | Illustrative BThwani Captain delivery base **500** plus separate **100** optional approved markup gives customer **600**; Captain entitlement remains 500, platform margin 100 | Only eligible zero-product-commission accepted Store agreements; no unapproved fee stacking or WLT double-count. Require independent financial and legal approval |
| FIN-03-ROUNDING | All source monetary amounts are integer YER; authorized basis-point calculation must use versioned WLT rounding consistently across quote, journal and settlements | No floats, UI-computed authoritative totals, negative leakage, unnoticed boundary rounding change or retroactive accepted-term revision |

### SEC-01/02 — Owner authorization, session and privacy negative matrix

| Review case | Required invariant | Negative/continuity proof to demand from actual future Identity/DSH/WLT consumers |
| --- | --- | --- |
| SEC-01-ROOT | Original protected Root Owner remains **one Actor**; approved human-verified Passkey/recovery uses the Identity canonical owner | Wrong user, absent credential, copied old local dev password, second synthetic Root Owner and bypass admission are denied; no live credential inspection in this governance pass |
| SEC-01-SESSION | Role session family rotates on renewal and revokes on replay/disable; role-specific access not transferable | Reuse old refresh, logout/disable, off-device session, stale async cache and unrelated role tokens cannot restore privileges; records remain attributable to one actor |
| SEC-01-FINANCE | Finance-read, payout-intake, beneficiary assignment, transfer approval/execution and independent reconciliation are **separate permissions** | No single self-approval, payout destination chosen by Merchant, Provider-secret leak, or unapproved Operator policy bypass |
| SEC-02-STORE | Store-owner A, Store-owner B and Store-scoped staff each access only their exact currently admitted resources | Forged Store/Offer/Order/Media/cursor ID, unpublished draft, revoked grant, cross-city pricing and expired share link fail at the **canonical owner**, not only the UI |
| SEC-02-SWITCH | Actor/Store/session switch invalidates cached sensitive reads and **in-flight previous-account responses** across Web/Android | Old response arriving after new login must not render previous Customer address, wallet, messages, photos or store permission even briefly |
| SEC-02-CAPTAIN | A Captain **candidate** is not yet the assigned delivery actor | Losing offer contender cannot see private Customer address; late acceptance/assignment race cannot create two winners or two cash holds |
| SEC-02-OPERATOR | Current Operator authority combines role, city/Store scope and action | Request for unapproved financial policy, privileged Root admission, payout destination, CSRF, SSR/session leak or wrong-owner object must fail closed |

### MIG-01 — Fresh-baseline strategy and durable upgrade boundaries

| Review case | Required strategy / precondition | Later implementation evidence, **not available yet** |
| --- | --- | --- |
| MIG-01-EMPTY | One **derived** fresh baseline per Identity, DSH and WLT **only for new isolated empty databases**, reviewed against permitted target schema | Same logical tables, constraints, unique/foreign key, permissions, functions, required reference data as correctly upgraded empty donor DB |
| MIG-01-APPLIED | Existing databases use their actual owner-applied migration/checksum history and a **non-destructive** owner-approved upgrade route | Applied version/epoch before and after; no silently rewritten applied SQL, fabricated success, tombstoned Store/Order, or duplicate identity |
| MIG-01-RESTORE | Verify restricted exact-target backup, independently rehearsed isolated restore and consumers before any destructive/sensitive migration | Backup hash, restore test, preserved human/Store/Order/wallet/COD/beneficiary/accepted-contract/media identities and reconciled totals |
| MIG-01-BOOTSTRAP | Do not discard **182 DSH/30 Identity/63 WLT** historical source migration references merely to obtain three entrypoints | DSH's embedded `migrations/*.sql` loader and historical schema version **182** must move together with code/deployment/upgrade consumers or remain in place |
| MIG-01-FAIL | Transactional failure, interrupted migration, concurrent service writers or partial upgrade cannot be considered success | Stop incompatible writers, record exact first failing step, restore/reconcile in authorized isolated environment, verify owner readback before resumption |

### LEGAL-01 — Accepted agreements and retained entitlements

| Review case | Source-backed concern, **not a newly approved clause** | Independent approval evidence required |
| --- | --- | --- |
| LEGAL-01-MERCHANT | Existing Store commission, payout, collection custody, customer refund and direct/marketplace terms may be legally binding | Actual **accepted** Store-specific agreement IDs, effective versions, signatures/consent and lawful termination/amendment terms; not available from archived engineering summaries alone |
| LEGAL-01-CAPTAIN | Historic physical COD remittance, equipment guarantees, Captain independence, earnings, custody and pending claims may remain valid for earlier activity | Legal/Finance-qualified adjudication of current vs legacy obligations and immutable financial history, no blanket forgiveness or double charge |
| LEGAL-01-EMPLOYEE | HR/staff grants, employment status, retained personal data and outstanding compensation may survive UI/workflow retirement | Authorized contractual/retention basis, Identity/HR segregation, account deactivation rules, protection against unauthorized exposure/deletion |
| LEGAL-01-CLIENT | Customer wallet liability, lawful refund, data privacy and commitments survive Store relation or service refoundation | Accepted customer terms, notification/consent changes, retained balance/Order/communications evidence, reviewer/legal owner authorization |
| LEGAL-01-PROVIDER | Provider fee schedule, official wallet destination, settlement rail, commission/price eligibility and execution authorization require real binding terms | Official contracts/provider terms and Finance/legal approvals, not illustrative fixtures, old rate tables or screenshots |

### Independent review sign-off register — no invented approvals

| Gate | Independent qualified reviewer | Review date | Signed decision/evidence | Current state |
| --- | --- | --- | --- | --- |
| FIN-01 | NOT_ASSIGNED | NOT_RUN | NOT_PROVIDED | REVIEW_BLOCKED |
| FIN-02 | NOT_ASSIGNED | NOT_RUN | NOT_PROVIDED | REVIEW_BLOCKED |
| FIN-03 | NOT_ASSIGNED | NOT_RUN | NOT_PROVIDED | REVIEW_BLOCKED |
| SEC-01 | NOT_ASSIGNED | NOT_RUN | NOT_PROVIDED | REVIEW_BLOCKED |
| SEC-02 | NOT_ASSIGNED | NOT_RUN | NOT_PROVIDED | REVIEW_BLOCKED |
| MIG-01 | NOT_ASSIGNED | NOT_RUN | NOT_PROVIDED | REVIEW_BLOCKED |
| LEGAL-01 | NOT_ASSIGNED | NOT_RUN | NOT_PROVIDED | REVIEW_BLOCKED |

This register is inside the **single temporary execution plan**, not a governance owner, authorization list or extra Product policy engine. To change a gate to `PASS`, obtain actual reviewer-independent signoff and source evidence, record scope/version and any conditional reservations, resolve findings in the legal owner, then rerun affected checks on that candidate SHA. A simulated arithmetic case, a ChatGPT suggestion or GitHub structural test is never a qualified signoff.

### GitHub status confirmed by read-only authoritative CLI (not inferred from an empty PR-only connector result)

- Exact previously **pushed** SHA `65738d6c3ecc94e486ee4f7df62d7f38e3ba0b0b`: official `gh run list` and `gh run view` show `BThwani Foundation Guard (structural only)` **completed successfully** on `2026-11-12T16:57:00Z`; <https://github.com/bthwani2-boop/samrim/actions/runs/43264188781>. Each step, including guard sensitivity, passed. The GitHub check-runs API returns **one** github-actions check (success) at this SHA.
- GitHub `gh pr list --head refoundation/clean-house-20261112 --state all` returned **no PR**. CodeRabbit `.coderabbit.yaml` enables PR auto-review, but none for this branch is evidenced. Do not invent CodeRabbit approval, scan comments or remote review.
- Local HEAD at the *start* of this batch is `9ef916a29384df2507f1128cdcc2ea52f35ddf86`, ahead of published SHA by one; **new staged/committed candidate must not inherit prior GitHub CI pass**. An external Push and separate PR need specific human authorization; none is silently performed.


### Two additional historical execution/audit sources — explicit section-level decision reconciliation

The original donor includes two further **non-authoritative** texts, which were reviewed as source sections during this pass. Both originated on **2026-11-10** and contain dated worktree observations, implementation proposals, and later corrections. Their section-level dispositions are documented below without copying them into a new governance root. This is not a line-by-line ratification of all archived legal or protected runtime details.

**Donor A:** `D:\samrim\docs\governance\BTHWANI-FULL-SYSTEM-REFOUNDATION-PLAN.md` — 15 main sections, 331 lines.

| Source section | Disposition | Canonical owner | Material meaning retained or correctly scoped |
| --- | --- | --- | --- |
| 01 | `GREENFIELD_METHOD_BOUND` | `engineering.md` | Rebuild method adopted only inside authorized source, not an unbounded permission to delete applied SQL or accounts |
| 02 | `HISTORIC_SNAPSHOT` | `engineering.md` | 2026-11-10 source counts are dated observations; not current SHA or E2E proof |
| 03 | `CONSERVE_CAPABILITIES` | `product.md + engineering.md` | Correct Product functions and historic obligations must survive owner-by-owner migration |
| 04 | `PROTECTED_TEST_DATA` | `safety.md` | Local development designation does not imply all data/volumes/secrets are disposable |
| 05 | `IMPLEMENTATION_DEFERRED` | `engineering.md` | Stages and tests are future implementation order, not current migration authority |
| 06 | `NONBINDING_ADVANTAGES` | `engineering.md` | Claimed simplification is rationale, not guaranteed performance/correctness |
| 07 | `HISTORIC_WORKTREE_ONLY` | `AGENTS.md` | Prior 2026-11-10 worktree/branch is not the active authorized clean Worktree |
| 08 | `SEPARATE_PRODUCT_ACCEPTANCE` | `product.md + journeys.md` | Full app/API/DB proof belongs after implementation; governance-readiness is narrower |
| 09 | `EXECUTION_GATES` | `AGENTS.md` | Old approved methodology does not confer Push/PR/Merge or deployment |
| 10 | `PREFLIGHT_REQUIRED` | `safety.md + engineering.md` | Recheck live owners, protected runtime and backups before any destructive slice |
| 11 | `CONSERVE_SUBFEATURES` | `product.md + experience.md` | Full Store Web, Captain opportunity, videos, privacy chat, catalog, finance and Studio survive unless owner retires |
| 12 | `SUPERSEDE_EARLY_UI_PLANS` | `experience.md + platform.md` | 11 Operator centers are a dated snapshot; later one Stores center/10 target and Customer/Merchant labels govern |
| 13 | `LIVE_BEHAVIOR_UNPROVEN` | `engineering.md` | Old interface/routing status does not prove new release; preserve negative-path acceptance |
| 14 | `LATEST_OWNER_DECISIONS` | `finance.md + stores.md + catalog.md` | Commercial defaults require WLT agreement; one Store/Catalog engine; no unimplemented direct checkout |
| 15 | `SOURCE_BOUND_PROOF` | `engineering.md` | Every accepted refoundation slice needs source/owner/contract/DB and exact SHA evidence |

**Donor B:** `D:\samrim\docs\governance\BTHWANI-DESIGN-UX-EXPO-FIRST-REFOUNDATION-AUDIT-20261110.md` — 15 original numbered sections plus a follow-up numbered "11" with newer semantic corrections, 334 lines.

| Source section | Disposition | Canonical owner | Material meaning retained or correctly scoped |
| --- | --- | --- | --- |
| 00 | `AUDIT_SCOPE_ONLY` | `experience.md` | Expo-first UX study informs target, not product release |
| 01 | `OWNER_PRECEDENCE` | `AGENTS.md + governance/README.md` | Canonical owners outrank screenshots and historic reports |
| 02 | `DATED_RESEARCH` | `engineering.md` | Donor source observation and E2E tests must not be reported as current |
| 03 | `DESIGN_TOKENS` | `experience.md` | One navy/orange/semantic source consumed by Tamagui/Ant; font/icons require rendered acceptance |
| 04 | `EXPO_PLATFORM_BOUNDARY` | `experience.md + platform.md` | Three existing mobile apps one Expo host each; no fourth mobile business engine |
| 05 | `STUDIO_SCOPECHECK` | `experience.md` | CLIENT_HOME donor exists, Store-scoped authoring is conditional; one DSH content publisher |
| 06 | `STORES_CENTER_TARGET` | `experience.md` | Early 11-center proposal is superseded by later consolidation to 10; test actual navigation |
| 07 | `UX_REFOUNDER_LATER` | `experience.md` | Rebuild journeys with source owner, not just component refactor |
| 08 | `SCREEN_ACCEPTANCE_LATER` | `experience.md` | Loading/empty/denied/recovery/RTL and accessible states need real render |
| 09 | `GAPS_ROUTED` | `experience.md + safety.md` | UX/DS/AUTH/EXPO/MIG/TYPO IDs preserved as implementation risks, not additional Product admission |
| 10 | `STAGED_IMPLEMENTATION` | `engineering.md` | A–F UX delivery stages after separate authorization |
| 11 | `INDEPENDENT_PROOF_PENDING` | `safety.md` | Visual/browser/device/financial negative tests NOT_RUN for target |
| 12 | `OPEN_DESIGN_CHOICES` | `experience.md` | Scoped Studio and templating limited; actual Store publisher and commercial activation still gated |
| 13 | `NO_AUTO_TECH_UPGRADE` | `AGENTS.md + engineering.md` | Do not update Expo, install icons/fonts, delete old design-system or modify SQL now |
| 14 | `HISTORIC_PROVENANCE` | `docs/reference/README.md` | Donor source pointers are evidence, not licensed copied assets |
| 15 | `AUDIT_NOT_RELEASE` | `experience.md` | Donor 18/18 Studio tests and route observations cannot prove target runtime |
| FOLLOWUP | `SUPERSEDE_EARLY_INFERENCES` | `experience.md + stores.md` | 10 real Operator centers target, single DSH catalog, merchant relation fee independence and retired field workflows |

**Conflict precedence enforced:** the later approved consolidated one-Store/one-Catalog Engine and **10 job-oriented Operator centers target** overrides the earlier eleven-center design snapshot. The earlier phrase "local development data can be regenerated" **does not authorize** wiping any persistent/non-isolated state. DSH/WLT and Identity contracts decide what is actually supportable; Studio's earlier 18/18 donor tests are only donor-version evidence. Preserving original EAS/native identifiers overrides internal `apps/merchant` renaming. Neither older plan authorizes global Nx/Expo/Go upgrades or Stage 4+ work.

**Remaining historical evidence:** the extracted/repeated Control Panel ZIP versions were byte-hash compared earlier; their 112 CSV requirements have a per-ID disposition, but specific **signed agreements, effective provider fee schedules, accepted terms, full third-party license checks and material chronology decisions not expressible from the available archived files** have not been independently reviewed. The user-provided shared ChatGPT URL is presently unreadable; missing contents must not be assigned fictitious decisions. Thus **historical candidate section reconciliation PASS for these two identified documents**, global historic legal/source reconciliation **PARTIAL**.

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

- Pinned donor branch `41` at `426d67b47beb8c66b09acd8c7394086b53ac5aae` and compared 14 historical semantic owner files to their 14 same-named current draft owners on pre-batch target `d4f542df68533b06d42aa3a1a8b3338fd5a757c9`. The [read-only section provenance census](reference/DONOR-GOVERNANCE-SECTION-CENSUS.md) contains **340** donor Markdown headings, **138** target headings, exact donor blob IDs and original line numbers. Exactly **one** heading is an identical Markdown title; neither literal absence nor presence proves missing or retained semantics.
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
