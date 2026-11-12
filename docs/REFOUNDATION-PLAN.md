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
**Owns:** root `AGENTS.md`, root `REPOSITORY-STRUCTURE.md`, `governance/README.md` (staging index), this plan, `tools/governance/`, `.github/workflows/foundation-guard.yml`.

- Reauthor agent execution safety, smallest coherent refoundation slice, owner/writer law, tested evidence, protected data and Git authorization. Do not transplant the oversized donor law verbatim.
- Reauthor repository placement for a root `governance/`, while making the donor `docs/governance/` **explicitly non-authoritative** and frozen until one coordinated cutover.
- Build a Foundation-only CI guard with positive and adversarial tests; it must not assume Go, SQL, Expo, pnpm or complete Product docs exist. No dummy success for product acceptance.
- Remove obsolete inherited executable CI workflows from the sparse candidate when replaced by the Foundation Guard, while retaining original tests and workflows in branch 41 for later feature-level recovery.
- Prepare one PR template that states affected Product law, same SHA evidence, residual risk and that the branch is NOT MERGEABLE while deliberately sparse.
- **Gate:** stage-aware rules validated locally including negative fixtures; correct paths; exact Git diff reviewed. Foundation checks may PASS while `GOVERNANCE_CUTOVER=NOT_READY`.

## Phase 2 — Semantic governance reconstruction and single-root cutover (NOT_STARTED)
**Owns:** `governance/{product,platform,architecture,identity,stores,catalog,commerce,fulfillment,finance,hr,experience,safety,engineering,journeys}.md`.

- Make a complete line/decision concordance against the current 15 donor semantic-owner documents, all six approved discussion sequences and meaningful ZIP requirements. Record each rule: retained/reworded/merged/superseded/retired/unresolved, owner and rationale.
- Preserve the 26 admitted capability IDs plus all material subfeatures in exactly one appropriate domain-owner section each. No additional Product breadth from donor claims without approval.
- Distinguish actor/Store, relation/fee model/collection/fulfillment, channel publication/checkout readiness; one DSH Store/catalog/order engine, one Identity actor writer, one WLT financial owner.
- Translate approved Current UX: Tamagui for Expo and Ant Design for Operator with one legitimate semantic brand/token source, Arabic RTL, dark/light, low friction, accessible recovery. No independent design authority from archived UX snapshots.
- Review all historic legal/media/OSS/competitor links; preserve original and source date in `docs/reference/` without rewriting citations into purported product laws.
- Classify all unapproved or conflicting contract choices as unresolved. Never invent product values, partner percentages, pricing, subscription charges or service permissions.
- Delete the old `docs/governance/` tree **from this candidate only** in the same coherent cutover after owners, incoming links and guard tests are migrated. Preserve its git history/provenance from original.
- **Gate:** no old active root, one semantic owner per rule, 26/26 capability IDs with exactly one section each, zero broken intra-repo references, negative semantic regression guards. Financial, security, deletion and migration decisions must receive required independent review. Otherwise REVIEW_BLOCKED.

## Phase 3 — GitHub and policy enforcement reconstruction (PARTIAL: foundation only)
- Keep a **single** CI architecture: selective Fast Guard for affected code after sources exist, Sonar/CodeQL analysis where applicable, one final Refoundation Acceptance Gate. Avoid a parallel CI/review platform.
- Correct historic branch routing (36/37/38), ensure SQL changes activate the owning service tests, enforce import/contract/canonical-writer rules and review documented failures; test the routing itself with changed-file fixtures.
- Integrate CodeRabbit configuration only after validating current repo settings; create CODEOWNERS using actual GitHub accounts/teams, never fictitious reviewers. Protect merge rules at the actual repository; local YAML alone does not prove GitHub rulesets.
- Negative guard tests must fail on removed protected policies, duplicate capabilities, outdated paths, authority bypass, missing tests, and unsafe fork-secret exposure.
- **Gate:** reproducible local test + exact candidate action checks, human review of rule weakening, required GitHub branch protection verified externally when submission is authorized. No push/PR/merge without separate explicit approval.

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
| D04 | Retired enrollment/Field workflows and old audit tests | No active new path or role. Investigate only binding retained financial/legal evidence at original owner; never re-enable a retired workflow just to keep a legacy test. |
| D05 | Exact relation defaults and available fulfillment selections | Policy chooses eligible subset through DSH; the UI must not imply unavailable fulfillment or checkout. Do not set commercial defaults by guess. |
| D06 | Fees and actual collection | Both Store relations may use either fee model via WLT accepted/versioned Store agreement. Collector (merchant/platform), custody and fulfillment are separately authorized and need real finance gates. |
| D07 | WLT baseline and history | New canonical SQL for each owner. Deletion of original migrations requires comparing applied state and protected data; no unconditional squash/reset. |
| D08 | Control Panel historic master pack versus modern live Owner UI | Extract unique accepted UX and functional invariants, not archived page names, Field navigation, branches or screenshots. No arbitrary feature addition without Product approval. |
| D09 | Explicit CodeRabbit/CODEOWNERS reviewer names and branch protection | Cannot infer from archived configs. Verify actual GitHub users/rulesets after selecting live credentials; no fabricated team or rules. |
| D10 | Source research/OSS/competitor URLs | Preserve complete original inventories and provenance. External link checks are separate and NOT_RUN until performed. |
| D11 | GitHub Fast Guard/Sonar in a source-sparse tree | Existing code-dependent CI is invalid for current foundation state; don't mark as PASS or silently skip tests. Re-introduce only when their required sources exist. |
| D12 | Fully destructive reset because local dev is experimental | Only exact confirmed synthetic state after ownership/isolation/backup verification; real user/session/financial/media data and concurrent sessions remain protected. |

## Stage completion record
- Phase 0: established and revalidated against local branch 41 and target worktree; no deployable-runtime claims.
- Phase 1: status to be updated from direct file/readback and tests. The staged index and structural guard never close Phase 2.
- Phases 2–6: NOT_RUN, until evidence is produced.
