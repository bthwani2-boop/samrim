# BThwani — Single Governance Root and Approval Boundary

ARTIFACT_CLASS: GOVERNANCE_INDEX
SEMANTIC_OWNER: governance/README.md
GOVERNANCE_CUTOVER: NOT_READY
IMPLEMENTATION_ADMISSION: PROGRESSIVE
ALL_CAPABILITIES_DEVELOPMENT: ENABLED
NEW_CAPABILITIES: ANALYZE_AND_IMPLEMENT_PROGRESSIVELY
DEVELOPMENT_ISOLATION: REQUIRED_NOT_YET_VERIFIED
PRODUCTION_ACTIVATION: BLOCKED
BUSINESS_DECISION_AUTHORITY: JOURNEY_SCOPED_CANONICAL_OWNERS
HUMAN_TARGET_POLICY_DECISION: APPROVED_2026-11-13
IMPLEMENTATION_STATE_AUTHORITY: NONE

## What this directory means
This is the **only intended durable governance home** for BThwani. Each subject has exactly one semantic owner; overlapping documents link to the owner rather than restating independently changeable law. Current domain documents remain subject to complete historical reconciliation, while journey-scoped Product/domain decisions may be resolved incrementally in their canonical owner and used to guide isolated SQL/service development. Their existence alone never proves runtime acceptance or authorizes production activation.

Historic `docs/governance/` was removed from this candidate. Read older content and verified code from original branch `41`, ZIP archives, dated reports and external sources as **donor evidence only**, not another editable authority. Preserve any materially binding historical legal/financial records and original research links in a non-normative `docs/reference/` when later admitted; never reintroduce another governance root.

## The canonical owner index
| Owner file | What its decisions control |
| --- | --- |
| `product.md` | admission of 26 capability IDs, scope/exclusions; **single** Product census |
| `platform.md` | actor/Store terminology, roles versus resources and surface identities |
| `architecture.md` | single owner/writer/engine, domain boundaries, service-to-service and **policy-driven** law |
| `identity.md` | identity, sessions, global permissions, recovery |
| `stores.md` | Store registration, relation, publication, availability and Store delegation |
| `catalog.md` | one product/catalogue/Offer engine, media, availability and Customer readback |
| `commerce.md` | city/location, cart, Order, multi-Store orchestration, adjustments, communication and promotions |
| `fulfillment.md` | method eligibility, assignment, Captain membership, handoff, delivery, pickup |
| `finance.md` | WLT fees/agreements, collection/custody, balances, ledger, settlements and beneficiary routing |
| `hr.md` | bounded employee administration for BThwani and Merchant staff inside DSH; no parallel Identity role or fourth HR service |
| `experience.md` | Tamagui Expo, Ant Design Operator, brand, Arabic RTL, accessibility, recovery |
| `safety.md` | security, privacy, financial/data integrity, migrations, incident and independent review |
| `engineering.md` | acceptance, staged refoundation, policy admission and measurable engineering proof |
| `journeys.md` | observable cross-owner handoffs, failure and recovery; not another Product list |

Root `AGENTS.md` governs **agent execution/authority**, root `REPOSITORY-STRUCTURE.md` governs **path placement**, and `docs/REFOUNDATION-PLAN.md` is **temporary execution sequencing, conflicts and evidence**, not business law. GitHub CI checks the existence and structural coherence of this arrangement; it cannot independently judge commercial/legal correctness.

## Authority and conflict protocol
1. A **latest explicit human approval** for the same subject supersedes an incompatible earlier decision; retain all compatible requirements. Don't infer values, permissions or legal statuses from a historic archive.
2. Before cutover, treat these draft decisions as reviewed *targets* but not yet a certified complete constitution. Use the Product admission census and the business-owner documents to reconcile older source and requirements, identify what moved, what was superseded and what remains disputed.
3. Once the cutover is approved, each material decision lives in exactly one above owner and consumers link to it. `architecture.md` names the boundary; `finance.md` owns money; `stores.md` owns Store relation; `fulfillment.md` owns delivery eligibility. UI presentation and technical contracts do not become alternate rules.
4. Implementation state is proven independently by code, contracts, applied migrations and runtime owner readback. A document or passing mocked test cannot assert the service is live or that financial operations are safe.
5. Unknown or disputed material choice is recorded with an owner and a safe default **of no unauthorized activation**, not guessed away. A policy choice is only enabled when service implementation/legal acceptance makes it operable.

## Progressive capability admission — 2026-11-14 human approval

The global GOVERNANCE_CUTOVER remains NOT_READY solely as a whole-policy reconciliation marker, not a stop sign. The latest human approval enables **Close as We Go analysis, design and implementation of all existing and newly proposed Product capabilities**, without preliminary admission voting or full-platform cutover. For each journey, evaluate all affected actors, surfaces, contracts, owners, persistence, permissions, dependencies, errors, races and recovery; record newly resolved capabilities in the single canonical Product/owner documents as part of that journey. Proposed capabilities are not automatically certified as legally effective, fully tested or production-ready merely because development is open.

**Before each journey is declared complete, its affected implementation and acceptance must satisfy the following evidence requirements; these are not development admission votes:**
1. Map the journey to existing or newly proposed Product capability IDs in the single canonical Product owner, with one semantic owner and one Identity/DSH/WLT writer per mutable fact; record the affected scope and consumers. Adding a new ID during its journey does not require a prior project-wide governance cutover.
2. Material original-source rights, obligations and unsafe choices for this capability are reconciled against the accepted owner policy. Unresolved material decisions fail closed **for the affected action**, without blocking unrelated accepted capabilities.
3. Track each journey's affected owners, surfaces, dependencies, positive and negative cases and recovery through the existing Product/Journey/domain owners and executable acceptance tests. Spec Kit may help organize a complex journey, but its spec.md/plan.md/tasks.md are optional derived artifacts, never mandatory approval gates or parallel business policy. Do not duplicate a specification or require additional ceremony for a small change.
4. The current stage-aware verifier is extended to allow genuine implementations in the legal owners, while rejecting unknown business scope, unauthorized permissions/operations, unsafe migrations and duplicate writers. **Adapting this technical guard is the initial enablement task, not permission to delay all commercial code until the global governance cutover.** Its positive and negative tests must pass before relying on it as implementation acceptance evidence.
5. Development runtime must use a separate, verified synthetic database/media namespace before a journey needs it; do not reuse donor Docker volumes, live sessions, money or provider credentials. Prove the affected security, finance, migration, privacy and legal invariants proportionately to actual risk before closing that behavior, not as a platform-wide prerequisite to unrelated development.

IMPLEMENTATION_ADMISSION: PROGRESSIVE authorizes **development of existing and new capabilities**, which are analyzed and reconciled within their journeys rather than held behind pre-development approvals. GOVERNANCE_CUTOVER: NOT_READY records unfinished whole-platform semantic review and never blocks development. **Only PRODUCTION_ACTIVATION: BLOCKED is the standing deployment/release gate**; separate authority is still required for destructive changes, real financial effects, credential access, Push/PR/merge and protected-state operations. This is not permission to bypass security boundaries during development. A journey becomes CLOSED only with 100% of its defined applicable criteria proven by owner-backed evidence; failed/untested checks stay FAIL/NOT_RUN and are repaired while development proceeds.

## What must be true before governance cutover
- All 14 owner documents have been semantically reconciled against accepted decisions, relevant original source/migrations and major archived requirements, not just rewritten or filled with headings.
- All **26** Product capability IDs occur exactly once as substantive owner sections, and no required material subfeature silently disappears. The single Product census routes each ID to one owner; no second catalog.
- Correct reference paths, no old active `docs/governance/`, no duplicate owner/writer/engine or unresolved critical business conflict. Operator policies are actually specified as owner-managed settings, not generic unbounded executors or UI-only switches.
- **Approved 2026-11-13 review process:** the sole human Product owner has approved the target commercial/architecture/security/migration/legal *policy choices*. No external consultant or independent sign-off is required merely to settle those choices. A material unsafe or unverified *technical implementation* remains unactivated until documented internal critical-risk assessment, negative/adversarial tests, protected historical-record reconciliation and applicable real-world legal/contract evidence are sufficient for that specific action. Missing proof is `NOT_RUN`/`REVIEW_BLOCKED` for the affected verification, never fictional `PASS`. External certification is not claimed.
- Foundation/GitHub guard positive and adversarial tests pass on the exact revision; the temporary plan records unresolved evidence and stage boundary.

When all conditions pass with approval, a separate governed change may set `GOVERNANCE_CUTOVER: READY` and update agent/guard phase. **This certifies complete policy reconciliation**, not permission to start development (already progressively authorized) and not SQL/application production readiness. Until then keep `NOT_READY`; do not disguise a draft as a final acceptance.

## Cutover readiness is a policy decision, not a claim of implemented software

`GOVERNANCE_CUTOVER: READY` would mean **the approved target Product/Design/API/SQL/Operational rules are reviewed, internally consistent and safe enough to direct later implementation**, with the latest explicit human-approved target policy decisions and internally evidenced risk-assurance criteria for financial/security/migration/legal-sensitive **implementation and activation**. It does **not** require an already-built Expo app, an OpenAPI refactor, three generated SQL baselines, E2E customer checkout or a published software release. Those implementations have their **own later gates and actual runtime proof**; they remain `NOT_RUN` until authorized.

**The 2026-11-13 human decision supersedes the earlier external/independent-reviewer prerequisite for target-policy adoption.** Record the chosen normative financial rules, threat model, payout/ledger formula and protected migration strategy now, with documented internal adversarial analysis and attributable human approval. No missing external signature alone reopens an approved strategic choice. Equally, approval of policy is not evidence of working money, legal consent, secure credential recovery or restorable SQL. Those effects remain disabled or unreleased until verified by actual owner-backed tests, contracts and protected-state evidence at implementation time.

A final cutover records **which reviewed policy revision and accepted human authorization** it refers to. Approval to author/read/edit draft text and a historical Push are **not** automatic authority to invent reviewer signoffs or to merge/ship/deploy. Until semantic source reconciliation, the applicable internal risk-assurance evidence and stage-specific guard checks are verified on the accepted candidate, remain `NOT_READY`, even when all structural/CI checks are green. Never fabricate or relabel the historical independent-review sign-off register as completed.
