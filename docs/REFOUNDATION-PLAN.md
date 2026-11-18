# BThwani — Refoundation Execution Plan (temporary, non-governing)

DOCUMENT_CLASS: EXECUTION_PLAN
OWNER: docs/REFOUNDATION-PLAN.md
STATUS: IN_PROGRESS_FOUNDATION
IMPLEMENTATION_ADMISSION: PROGRESSIVE
ALL_CAPABILITIES_DEVELOPMENT: ENABLED
NEW_CAPABILITIES: ANALYZE_AND_IMPLEMENT_PROGRESSIVELY
PRODUCTION_ACTIVATION: BLOCKED
TARGET_WORKTREE: D:\samrim
SOURCE_BRANCH_AT_START: 41
SOURCE_SHA_AT_START: 426d67b47beb8c66b09acd8c7394086b53ac5aae
WORKTREE_BRANCH: codex/managed-participant-admission (AS_OF_2026-11-18; CHECK_ACTIVE_GIT_BRANCH)
DECISIONS_AUTHORITY: NONE
RUNTIME_SUCCESS_AUTHORITY: NONE

## 2026-11-18 — Active first-journey execution and closure register (CURRENT)

JOURNEY_ID: MANAGED_PARTICIPANT_ADMISSION
SOURCE_BRANCH_AT_AUDIT: codex/managed-participant-admission
SOURCE_HEAD_AT_AUDIT: 0561fea58fba3531c03039690769c86417a1eefd
JOURNEY_STATUS: IN_PROGRESS
JOURNEY_CLOSED: NO
ENVIRONMENT_BASELINE_ACCEPTED: NOT_PROVEN
PRODUCTION_READY: NO
GOVERNANCE_CUTOVER: NOT_READY
PRODUCTION_ACTIVATION: BLOCKED

**Detailed acceptance and evidence file:** `docs/journeys/MANAGED_PARTICIPANT_ADMISSION.md`. It tracks **AC-01 through AC-34**, current code/UI gaps, Root Owner recovery, real owner-backed positive/negative/parallel/retry tests, Web/Android proof and delivery criteria. It is an engineering document **not a business decision owner**. Authoritative rules live only in [governance/journeys.md](../governance/journeys.md), [identity.md](../governance/identity.md), [stores.md](../governance/stores.md), [fulfillment.md](../governance/fulfillment.md) and [hr.md](../governance/hr.md).

**Acceptance boundary:** Operator, Merchant and Captain are the original managed-admission surfaces. Verified Customer authentication is a necessary Identity dependency, not a fourth admitted surface. A Merchant role is not Store ownership or Store publication. Captain eligibility is DSH-owned, role/session Identity-owned. The original Root Operator remains one protected canonical actor; no alternative root, password bypass or unverified recovery.

| Packet | Actual gap observed at this snapshot | Executable next action and proof | State |
| --- | --- | --- | --- |
| J1-01 Customer Identity prerequisite | Customer identity-gate unavailable, synthetic phone proof only | Authorized real first-factor/account reuse/return/logout on Web/Android plus Identity SQL and negative replay | NOT_RUN |
| J1-02 Owner API consistency | Merchant/Captain role/session owners and tests partly implemented | Check Identity/DSH OpenAPI, migrations, clients, versions, current owner writes; no duplicate actor | PARTIAL |
| J1-03 Original Root continuity | Actual original-actor credentials and recovery not proven | Protected authorized identity/credential proof; UV Passkey enrollment on same actor, audited break-glass and session revocation | BLOCKED |
| J1-04 Operator + administrative entry | Control Panel entry/session fail closed; local WebAuthn WIP uncommitted | Signed WebAuthn + BFF protected cookie + real browser FIDO2; HR-to-Root invitation/approval; seven scoped permissions | NOT_RUN |
| J1-05 Merchant direct and assisted | Merchant synthetic admission partly wired; Operator merchant-new screen unavailable | One actor via either self-register or partners-scoped assisted invite; no Store grant; Web/Android and DSH IDOR | PARTIAL |
| J1-06 Captain application and approval | DSH standing exists; Operator captain management screen not complete | operations-authorized standing audit/CAS; Identity role after current approval; Android sign-in/return/suspension/revoke | PARTIAL |
| J1-07 Real E2E and data integrity | Isolated unit/SQL tests not full joined users/devices | Two independent actors/Stores and servers; replay/race/timeout/IDOR; negative DSH/WLT checks; durable SQL readback | NOT_RUN |
| J1-08 Candidate quality and safety | At audited HEAD GitHub dependency audit, CodeQL and Sonar fail; Identity Passkey/Lenovo WIP dirty | Candidate freeze, current Graphify/spec, owner contract/Go/TS/SQL, Web/Android, matching service/app SHA, security review and required CI | FAIL / REVIEW_BLOCKED |

**Execution order:** (1) recheck exact HEAD/status/exclusive file owners; (2) complete Customer verified-account dependency without duplicate accounts; (3) preserve and verify Root original actor using explicit protected authorization, complete Operator Passkey/recovery/permissions; (4) connect Operator BFF and protected administrative screens; (5) direct and assisted Merchant admission; (6) DSH-approved Captain and native sign-in; (7) independent current-owner SQL, concurrency, failure, privacy and Web/Android E2E; (8) review on one final SHA. Parallelize only independent owned files; use one Git coordinator and a serialized Git index. Do not modify protected Root real data in synthetic testing.

**Evidence limits:** Spec Kit CLI 1.3.0 and local Graphify 0.9.73+samrim.3 were run on the audited branch; Graphify index matches tracked HEAD 0561fea58 but **does not cover uncommitted Passkey files**. GitHub Go/Fast Guard/Foundation/Presentation checks were successful on that published SHA, while dependency audit, CodeQL and SonarQube failed. Local Foundation guard also rejected dirty Identity migration 006 before other writer repairs; its current post-repair state requires fresh testing, not an assumed PASS. A prior cryptographic synthetic WebAuthn/SQL PASS is not protected Root proof nor current production/device acceptance.

**Closure:** All applicable AC-01..AC-34 require evidence on one unchanged candidate SHA: role/standing/permission owner readback, denied paths, recovery/concurrency, all affected Web/Android real application journeys, safe original Root recovery, critical security review, required CI, and matching binary/container/migration source. No governance cutover, main merge, production activation or GitHub publication is implied by a green document or an isolated unit test. Current **JOURNEY_CLOSED = NO**.

## Active document boundary and historical source preservation

**Read this file from the top for current execution.** The 2026-11-18 section is the active journey delivery register and its source SHA is an audit snapshot; verify the live repository/CI/runtime before acting. Older implementation and device reports from 2026-11-12 to 2026-11-17 have been relocated to the [non-governing dated execution history](reference/REFOUNDATION-EXECUTION-HISTORY-20261118.md) instead of accumulating as competing "current" summaries.

The historical evidence retained further below is an **existing Foundation-checker dependency**: 112 original Control Panel requirement dispositions, approved human-policy provenance and D01-D12 decisions, the 24-section design source crosswalk, illustrative security/finance/migration risk cases and independent-review sign-off status. They are **documentary source evidence only**, not independent policy owners or verified runtime acceptance. Removing those ledgers requires coordinated test/source migration with the writer of the Foundation guard, not silent deletion. No capability or Root/finance privilege is granted by a historical row.
## Historical program purpose and source-review evidence (NOT CURRENT)
Refound the **architecture itself**, not a succession of local patches. Move correct business meaning, preserve supported capabilities and rights, rebuild SQL and services when admitted, remove redundant sources and routes after verified cutover, and make the result simpler, auditable and maintainable.

This plan is a dated execution index, not a governance constitution, second requirements database, or substitute for canonical Product decisions. Re-evaluate against fresh HEAD at each batch. A plan item is not proof it has executed.

**Current-state interpretation (2026-11-16):** All stage labels (`CURRENT`, `NOT_STARTED`), branch/worktree paths, claims about absent Go/SQL/runtime, CI results and acceptance/signoff statements in dated entries below are **historical snapshots**, not standing execution instructions or current proof. In particular, the source-empty DSH and unstarted Phase 4/5 descriptions predate subsequent progressive implementation. Reinspect the authorized checkout, branch, HEAD, dirty state, source, applied migrations, running services and owner-backed tests before drawing a present-tense conclusion. The comparison donor is the read-only `archive/legacy-pre-refoundation-20261114` branch, never a writable execution target. Earlier external-signoff requirements for *target-policy selection* were superseded by the 2026-11-13 human decision; technical risk and implementation proof remain mandatory when applicable. This temporary plan cannot grant Push, branch changes, production activation or protected-data access.

### Source precedence
1. Latest explicit approved user instruction for the same meaning; later approval supersedes the incompatible older decision and retains compatible earlier decisions.
2. Canonical reconciled `governance/` domain-owner documents **after** an accepted cutover.
3. Current source/contracts/schema/config/runtime readback for implementation-state claims.
4. Branch-41 source and historic `docs/governance/` as provenance and protection of useful behavior.
5. Dated commands, audit archives, Control Panel packs, prior conversations, benchmarks and OSS research as **nonbinding evidence**, never automatically current permissions or product features.

The November 11 Codex Desktop command named a worktree that has since been retired and included tool/Push instructions scoped to that earlier context. **Do not execute those instructions as current authority.** The corresponding checkout selection and development permission were historical, not standing authority over today's branch, files, Push, PR, Merge, deployment or protected data. Resolve the current checkout and task-specific authorizations from the user's present instruction and `AGENTS.md`.

### Sources inspected or carried as review inputs
- Original `D:\samrim`, branch `41`, start SHA as above: `AGENTS.md`, `REPOSITORY-STRUCTURE.md`, `.coderabbit.yaml`, `.github/`, `docs/governance/`, `docs/reference/`, `tools/governance/`, `services/`, `apps/`.
- `D:\samrim-implementation\BTHWANI-REFOUNDATION-CODEX-DESKTOP-EXECUTION-COMMAND-20261111.md` — 20-section implementation command, worktree and direct Codex instructions stale for this worktree.
- Desktop ZIP `BTHWANI_ULTIMATE_REPRODUCIBLE_AUDIT_TRIGGER_BUNDLE.zip`: 3 entries, including ~81 KB audit trigger with source/evidence, coverage, falsification, reproducibility and convergence dimensions; these are methodology prompts, not a tested CI harness.
- Desktop ZIP `BTHWANI-Control-Panel-Complete-Refoundation-Master-Pack-نهائي.zip`: 63 entries with specification, requirements, proof matrices, archived reference snapshot; October 12 content and historical branches are not current runtime proof.
- Shared text transcripts and `BTHWANI-REFOUNDATION-DEEP-AUDIT-ACTION-PLAN-20261112`: approved conversation trajectory and extensive audit requirements. Large repeated descriptions are consolidated into this one execution plan only when relevant to a specific acceptance result.
- `docs/reference/` in source branch: original OSS and competitor links, Elleen observations and research classification, to be conserved after provenance verification.

A source being inventoried does **not** mean every line or external URL has passed deep review. Preserve a verifiable trail; escalate ambiguities.

## 2026-11-13 — Explicit human policy decision and no-external-review process (supersedes prior recommendations)

**Human authority and final scope:** On 2026-11-13 the BThwani Product owner explicitly approved the seven FIN/SEC/MIG/LEGAL target policy directions and clarified that **no external reviewer exists and no outside signoff is a prerequisite to choose these policies**. All seven are HUMAN_TARGET_POLICY: APPROVED. This does not imply a completed external review, tested code, valid contract, permission to change live balances or protected data, or authorization to deploy. Earlier independent-review tables further down record historic missing signoffs, not a current need to hire an external consultant; never overwrite them with invented PASS. The actual normative rule remains with the relevant canonical governance owner, not this temporary plan.

| Gate | Human-approved target policy (2026-11-13) | Canonical owner | Mandatory proof before affected live activation |
| --- | --- | --- | --- |
| FIN-01 | WLT-owned COD, WALLET, MIXED; total Order gross exposure separate from cash-only reserve/debit; integer YER, exactly-once ledger; Captain coverage greater than total payable is initial target pending risk adequacy *technical proof*, not assumed live correctness | finance.md, commerce.md | Balanced debit/credit scenarios, concurrent accept/replay, cancel/refund, unknown result, owner-backed financial readback |
| FIN-02 | One Store engine; MARKETPLACE/DIRECT relation independent from COMMISSION/SUBSCRIPTION and collection/fulfillment; default marketplace PLATFORM_MANAGED, direct STORE_MANAGED, exceptions only under accepted supported Store terms; legal Store owner default payout beneficiary, tightly authorized change and separate Finance settlement | stores.md, finance.md | Effective agreements and customer/cash custody law, Store beneficiary verification, allocation and reconciliation, historical liabilities |
| FIN-03 | Provider gross receipts, actual provider fees, net external remittance and Captain base entitlement/BThwani delivery margin are separate journal facts; no invented fee schedule or duplicate revenue | finance.md | Actual provider terms/fees, balanced ledger scenarios, original transfer receipts and statement reconciliation |
| SEC-01 | Original Root Owner continuity; one-time protected Operator bootstrap; user-verified Passkey/WebAuthn normal Operator login; controlled audited recovery and immediate affected session revocation; no duplicate owner or remotely available local password bypass | identity.md, safety.md | Genuine authoritative Identity state readback, auth/recovery negative tests, revocation and scope tests |
| SEC-02 | Deny by default; Identity actor authentication plus DSH/WLT owner-resource action/current Store/City/grant authorization, fail closed after account switch/revocation; protect unpublished Stores and private Customer addresses from candidate Captains | stores.md, identity.md, safety.md | Route/resource ACL matrix, actual cross-actor/Store/City/role/IDOR and stale response negative tests |
| MIG-01 | Derived one Fresh Baseline per Identity, DSH, WLT solely for isolated empty installations; keep applied historical migration IDs/checksums, preserve every legally or financially protected record; upgrade/backup/restore are distinct proven paths | engineering.md, safety.md | Applied history and source concordance, isolated fresh/upgrade/restore, privilege and ledger preservation, preflight and owner readback |
| LEGAL-01 | New fees, collection and settlement agreements are future-effective only after valid acceptance; preserve historic Merchant/Captain/employee/Customer/provider signed obligations and claims until lawful reconciliation | stores.md, finance.md, product.md | Original accepted contracts, signatures/version/date, outstanding rights/claims, valid consent/changes, no invented legal result |

**Approved assurance workflow without outside staffing:** The Product owner decides the model now. For actual money, authentication, privilege, protected migration and consequential legal effects, internal documented adversarial analysis and *real evidence* are required; the same editor or an AI agent must not claim independent external signoff. A missing real provider agreement, applied migration ledger, actual balance, or Root Owner record is an unknown *fact*, not a pending strategic Product preference; it cannot be safely fabricated. Each affected implementation remains NOT_RUN/REVIEW_BLOCKED until its genuine owner-backed negative/concurrency/restore proofs are run and applicable rights verified. Green syntax/CI and this policy decision cannot confer real transaction readiness.

**Cutover:** GOVERNANCE_CUTOVER: NOT_READY remains until the 14 semantic owners, all 26 admitted capabilities, material historical-source reconciliation and stage-appropriate internal risk evidence are verified together on the accepted exact revision. This is a documentary/technical proof boundary, **not** an external-reviewer scheduling gate. Implementation, irreversible protected state, GitHub merge, and production remain separate approval stages.

### 2026-11-13 — Internal policy-risk adjudication on the seven approved target decisions

**Assessment scope:** This is a critical-path *design and policy* review performed inside the project; no claimed outside reviewer, source-funded transaction, real SQL, provider receipt, identity enrollment or legal professional certification. An unsafe unknown remains unactivated rather than guessed. The following negative/contradictory cases challenge the adopted policy, not a running app.

| Gate | Considered unsafe alternative / attack or failure | Adopted owner-controlled safeguard and resolution | Policy disposition / implementation proof |
| --- | --- | --- | --- |
| FIN-01 | Debit Captain for already prepaid Customer wallet portion; hold gross while also collecting cash; two simultaneous Captain acceptances reuse the same coverage | WLT enforces `total_yer = wallet_yer + cash_yer`, all exact integer nonnegative; for positive COD gross-coverage eligibility is a separately validated initial policy but the actual atomic hold/debit references **cash_yer only**; all events have stable one-time ledger/hold identities and readback. A fully prepaid Order causes no physical COD hold | APPROVED_POLICY; real WLT conservation, contention, reversal and risk-adequacy verification NOT_RUN |
| FIN-02 | Treat Direct as always subscription or put Store-collected cash into platform wallet; approve staff payout destination from a delegated UI; duplicate commission | DSH Store relation, WLT fee agreement, WLT collector and DSH fulfillment are four independent facts; agreement is Store-specific, signed/effective and frozen for previous Orders; legal owner controls beneficiary intent; Finance separately approves/verifies destination, executes and reconciles; Store-collected money becomes a WLT receivable only for actual contractual platform charges | APPROVED_POLICY; agreements, external settlement authorization, real double-entry/custody NOT_RUN |
| FIN-03 | Credit Customer only provider net and silently pass provider fee to beneficiary; record entire delivery fee as platform revenue; invent generic 2% | Credited external funding gross remains the beneficiary amount upon verified actual provider evidence; WLT separately records fee expense/net external receipt, Captain base entitlement and platform fixed margin only for authorized zero-product-commission cases; provider contract decides real fee, not archival rates | APPROVED_POLICY; actual provider terms/fees/ledger rail NOT_RUN |
| SEC-01 | Add another Root Owner to repair missing Passkey; enable global server password fallback or trust self-submitted recovery | Preserve original verified Identity subject, protect one-time bootstrap and user-verified WebAuthn, enforce tightly scoped one-use audited break-glass recovery plus session-family revocation; unknown original credential state prohibits invented recovery success | APPROVED_POLICY; real original Identity credential and recovery negatives NOT_RUN |
| SEC-02 | A valid role token opens another Store, old account's delayed response leaks after switch, candidate Captain reads Customer home address | Identity authenticates and DSH/WLT authorizes each current resource/action grant, city, effective owner and consent; reject IDOR, stale/revoked grants and cross-session pending results; Customer private destination withheld from pre-assignment Captain | APPROVED_POLICY; owner APIs/media links/Web/Android negative readback NOT_RUN |
| MIG-01 | Apply a fresh baseline to already initialized DB, erase 275 old migration identifiers or money history, apply partial migration while active writers change records | Fresh baseline only for isolated empty DB; applied historical versions/checksums stay immutable; preflight inventories actual versions, protected Root Owner/Store/Order/WLT facts, verifies backup **and isolated restore**, controls incompatible writers, proves post-upgrade constraints and exact ledger conservation before resumption | APPROVED_POLICY; real applied migration ledger, isolated fresh/upgrade/restore NOT_RUN |
| LEGAL-01 | Switch an existing Merchant/Captain to Direct/Subscription with retroactive fees; forgive or double-collect historic COD debt; redirect payouts without consent | Signed/effective Store/Customer/Captain/staff/provider obligations remain binding for their periods; new agreement terms affect only eligible future activity after lawful acceptance; retain disputed historic liabilities for actual contract/ledger reconciliation, preserve beneficiaries and right to appeal/record adjustment | APPROVED_POLICY; source contract signatures/fee schedules/legal interpretation per actual transaction NOT_RUN |

**Internal conflict resolution:** Human approval is sufficient to lock the future target choices; no external reviewer signature is planned or retrospectively fabricated. A documented policy safeguard is a testable design requirement, not a finance/security/DB test. Source-proven raw money amounts, previously applied SQL, signed contracts and original Root Owner credential state remain fact-specific preflight inputs at implementation, not unmade Product choices. The tiny static arithmetic tests under `tools/governance/review-examples.test.mjs` cover illustrative funding and fee identities only; they cannot be counted as WLT or legal proof.

### 2026-11-13 — Current source/CI cutover evidence and disposition

**Source use (SRC-01):** `docs/reference/HISTORICAL-SOURCE-INVENTORY.md` records 37 distinct historical public URLs and 5 localhost endpoints, with their donor document. OSS/competitor/media research remains **non-authoritative and not adopted as a source dependency** merely by being indexed. A broken, inaccessible, changed or unlicensed external research URL is not evidence to silently choose a replacement or to import content. Live license/rights/URL verification becomes mandatory *before actual third-party code/media/source reuse*; absent adoption there is no licensing claim or provider activation. The donor's 14 semantic owners are independently indexed as **340 headings**, with review limitation recorded at `docs/reference/DONOR-GOVERNANCE-SECTION-CENSUS.md`.

**GitHub readback (GH-01) on previous exact candidate SHA `20fb8ec1aa520aebf73783d9934e918ef6b98330`:** The actual GitHub repository `bthwani2-boop/samrim` exposes an **active** `main` ruleset ID `22246714` named `samrim-main-canonical` covering `refs/heads/main`; it forbids branch deletion/non-fast-forward, requires pull-request flow and `fast-guard` plus `SonarQube Cloud Quality Gate`, and declares CodeQL scanning thresholds. GitHub check runs on this SHA report both required contexts **SUCCESS**, CI/Presentation/CodeQL JavaScript-TypeScript/Actions checks **SUCCESS**. However, CodeQL's **Go** analysis is **FAIL**: GitHub default setup tries autobuild of Go on the intentionally Go-empty Stage-4 branch; the CodeQL log says `could not process any code written in Go`, exit 32. This is an environment/source-applicability failure, **not proof of a found Go vulnerability**, but it is not a CodeQL PASS and must not be bypassed by adding dummy Go or changing protected GitHub settings without separate authorization. CodeRabbit for this SHA is **SKIPPED**. PR `#189` is Draft and not merged.

**Stage-specific routing decision:** Keep currently empty-Go foundation/Expo source honest; maintain future Go CodeQL coverage when a real approved Go service source exists. Any CodeQL default-setup/ruleset configuration change is an external GitHub policy action and requires its own authorization; there is no invented signed review or fake CI output. On any later governance candidate SHA, rerun/re-read CI, Sonar, negative guards and applicable real scanning; historical check runs do not transfer automatically to a new commit.

### 2026-11-13 — Final Product/architecture disposition for prior D01–D12 decision questions

These are decisions on the *target behavior*, not a second normative owner or a statement of implemented service capability. They supersede the provisional older D01–D12 recommendations later in this chronological plan.

| ID | Adopted disposition and actual owner | Remaining stage-specific evidence only |
| --- | --- | --- |
| D01 | APPROVED: DSH relation is `MARKETPLACE`/`DIRECT`, historical `BTHWANI_PARTNER`/`INDEPENDENT_STORE` translated through one protected compatible transition, not four persisted relations (`stores.md`) | Exact API/SQL compatibility migration |
| D02 | APPROVED: Identity owns one canonical human Merchant Actor; DSH owns each Store resource; one actor may own several Stores, Store grants never create a global Identity role (`platform.md`, `stores.md`) | Real Identity/DSH readback/ACL |
| D03 | APPROVED: Keep the 26 stable capability IDs with old `PARTNER` prefixes as trace anchors until one comprehensive, separately tested rename replaces all consumers; no new semantic duplicate (`product.md`) | Contract/client/guard migration if ever renamed |
| D04 | APPROVED: Retire obsolete field-acquisition onboarding as an active product; preserve verified legal/financial historical liabilities with their original owners, not old screens or writers (`product.md`, `stores.md`) | Historical obligation accounting |
| D05 | APPROVED: Relation admission and fulfillment eligibility are separate DSH Operator policies; each relation can offer a subset of actual three admitted methods only after DSH/WLT/Identity support (`stores.md`, `fulfillment.md`) | Genuine owner-backed method/collection acceptance |
| D06 | APPROVED: MARKETPLACE initially `PLATFORM_MANAGED`, DIRECT initially `STORE_MANAGED`, with either `COMMISSION` or `SUBSCRIPTION` under an effective Store-specific WLT agreement; no hardcoding of signed rates (`finance.md`) | Signed terms, fee schedule, one WLT ledger |
| D07 | APPROVED: One derived fresh baseline per Identity/DSH/WLT for empty installs; historical applied migrations, protected identities, balances, Order/COD and contract history cannot be overwritten (`engineering.md`, `safety.md`) | Real applied versions/restore/upgrade |
| D08 | APPROVED: Reuse only admitted Control Panel/Design source semantics under `experience.md`; original screenshots/dated navigation and duplicate relation-specific editors are not Product law | Actual UI implementation and rendered tests |
| D09 | APPROVED: One contributor means no invented `CODEOWNERS`; use the existing active GitHub main ruleset and actual CI, with internal risk assurance under human decision rather than fictitious external signatures (`AGENTS.md`, `safety.md`) | Real current SHA CI and scan applicability |
| D10 | APPROVED: External OSS/competitor/media references remain nonbinding and unadopted; validate original license/provenance before any concrete reuse (`docs/reference/`) | Per-dependency/license verification at adoption |
| D11 | APPROVED: Current source-sparse stage uses only stage-appropriate Foundation/Presentation/Fast Guard and Sonar; CodeQL Go cannot process a deliberately Go-empty tree; preserve real Go scanning obligation for admitted Go implementation (`engineering.md`) | Cloud default-setup or real Go source stage; never add fake Go |
| D12 | APPROVED: Never assume a local environment is disposable. Confirm authorized isolated synthetic ownership and backup before even test cleanup; protected users/money/data/secrets stay intact (`safety.md`) | Actual environment inventory and data preflight |

**Decision-level disposition:** D01–D12 are resolved as target choices; factual unknowns and implementation tests above are not silently called PASS or converted into policy questions. Every changeable business setting remains scoped, versioned and owner-backed with a safe disabled/unavailable state where no real implementation/accepted legal agreement exists.

### 2026-11-14 — Two journey-ownership decisions and full H2 source-group disposition

**HUMAN_TARGET_POLICY: APPROVED; source group disposition documented; deep semantic cutover NOT YET PROVEN.** The pinned `docs/reference/DONOR-GOVERNANCE-SECTION-CENSUS.md` now records a distinct, non-authoritative parent-H2 disposition for each of the **81 donor level-2 source groups** spanning the original **340 nested headings** across all 14 owners. Choices distinguish RETAIN, REFOUND, REPLACE and MERGE with one current canonical owner. The earlier per-heading `REVIEW_PENDING` markers remain because a parent mapping alone is **not** independent paragraph-by-paragraph semantic confirmation, proof of external contracts, or evidence of any functioning Go/SQL service. This avoids both bulk-copying obsolete policy and claiming 340 semantic results based on heading similarity.

**Last two open Journey-to-capability ownership choices closed now:** donor 41 never assigned `CAPABILITIES:` to `FIRST_THREE_ORDER_CONTACT` or `ORDER_SCOPED_OPERATIONS_EXCEPTION`. The current human-authorized target explicitly assigns the former as a bounded DSH `ORDER_LIFECYCLE` subflow and the latter to DSH `ORDER_LIFECYCLE` with WLT `ORDER_PAYMENT_COLLECTION` only for financial consequences. The remaining fourteen mappings retain actual donor source provenance. All sixteen journey sections now have exactly one validated mapping, against only the twenty-six Product-admitted IDs; three new negative guards reject absent or substituted mappings. This is a target decision, **not** a claim that the two missing donor fields existed historically or that an Operations service/CRM was added.

**Remaining cutover admission check:** compare material paragraphs under all 340 headings and high-risk original rights/obligations to current legal owner meaning; explicitly record any truly retired functionality, scope conflicts and preserved historical liabilities. Real original signed agreements, previously applied DB versions, financial balances and original Root Owner state require separate later owner readback and cannot be made `PASS` from a textual census. GitHub CodeQL Go source-empty default scan on the prior remote commit remains failed until stage applicability is rectified without weakening genuine Go scanning. No claim of `GOVERNANCE_CUTOVER: READY` until the documented acceptance conditions themselves have evidence on the exact candidate revision.
## 2026-11-14 — New human-approved progressive capability execution rule

The latest user decision sets IMPLEMENTATION_ADMISSION: PROGRESSIVE and authorizes analysis and implementation of **existing and newly proposed capabilities** through Close as We Go while whole-platform GOVERNANCE_CUTOVER stays NOT_READY. Earlier passages imposing full cutover or a per-capability vote before development are superseded. New Product choices are analyzed and documented in their journeys, not blocked up front. **Only production activation remains the standing blocked stage**, while safety, protected-state actions and Git/external-authority boundaries continue to apply; journey closure needs verified evidence.

For each journey, identify its existing or proposed Product capability and canonical domain/service owners. Reconcile only the decisions affecting its actors, surfaces, contracts, permissions, data, failure/recovery and dependencies; use the existing owner documents and executable tests as the source of acceptance. Current BThwani engineering instructions require native Spec Kit CLI and a task-scoped Graphify query for every repository engineering task; derived spec.md/plan.md/tasks.md files remain optional, non-authoritative working artifacts. Implement the smallest coherent cross-surface slice, then test, verify and close all applicable acceptance criteria before claiming PASS; keep unrelated development moving. The progressive Foundation guard already admits owner-local Go, SQL and API source paths at a structural level, but this does not prove OpenAPI validity, service behavior, access control or integration; those require affected contract, runtime and negative tests. Use isolated synthetic state when the journey needs persistence, never donor/protected records. A local Commit requires a reviewed diff and coordination with other active writers of the shared Git index; Push requires separate explicit human authorization and remote SHA readback.

The full 14-owner semantic reconciliation continues independently toward GOVERNANCE_CUTOVER: READY; finance, security, migration, legal, native device, authenticated end-to-end and production activation are not automatically green from documentation or structural tests.

## Phase 0 — Safe baseline (read only): DONE, recheck before changes
- Verify original and target branch/HEAD/status/worktree, files tracked, active workers, and change ownership.
- Prevent writes to `D:\samrim` and do not reset/copy/restart existing Docker, PostgreSQL, SeaweedFS or credentials for this stage.
- Establish the target as a **deliberately sparse** worktree, not a runtime build or merge candidate.
- Record historical input versions and distinguish measured evidence from recommendation.
- Proof: git worktree status and exact SHA. Re-run after intervening work.

## Phase 1 — Foundation law and stage-aware CI (HISTORICAL; source guard implemented, final CI open)
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

## Phase 4 — Clean technical foundation and SQL (IN_PROGRESS, NOT_CLOSED; historical steps)
- Re-census all tracked files, source/contract/exported routes, dynamic consumers, migration history and current database state by Identity/DSH/WLT. Record KEEP/MOVE/MERGE/REFOUND/REPLACE/APPROVED_RETIRE and the proof for each materially affected responsibility.
- Re-design schema per owner from first principles using validated business invariants, not copies of old migrations. Preserve protected applied history in source/backup and test a fresh baseline on isolated DB, protected upgrade, schema constraints/index/permission equivalence, restore and financial ledger conservation.
- No second migration writer, no alternative financial truth, and no global schema flattening for fewer files. Include domain service code, OpenAPI and consumer cutover within each applicable SQL slice.
- Rebuild only proven-needed Docker/Expo/Go/TypeScript tooling, preserving external app identities, media and secrets. No actual data/volume reset in this planning phase.
- **Gate:** owner-backed persistent state, negative/concurrent tests and independent migration/finance/security review.

## Phase 5 — Full platform refoundation (IN_PROGRESS, NOT_CLOSED; historical steps)
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
5. Only after full policy reconciliation and sensitivity proof change `GOVERNANCE_CUTOVER` to READY on a coherent reviewed candidate. This is a **full-governance completion gate**, not a prerequisite for progressively developing source, contracts or isolated SQL in individually verified journeys.

## Stage completion record
- Phase 0: established and revalidated against local branch 41 and target worktree; no deployable-runtime claims.
- Phase 1: local staging, path cleanup and structural guard are subject to readback/tests; even a PASS here never closes Phase 2.
- Phase 2: DRAFT_COMPLETE for 14 owner documents, 26/26 structurally assigned capability IDs, with **full donor-line semantic reconciliation NOT_RUN** and independent finance/security/migration approval REVIEW_BLOCKED. Do not declare governance READY until those evidence gates are satisfied.
- Phases 3–6: not complete; implementation and full integration proofs NOT_RUN.


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
