# BThwani — Single Governance Root and Approval Boundary

ARTIFACT_CLASS: GOVERNANCE_INDEX
SEMANTIC_OWNER: governance/README.md
GOVERNANCE_CUTOVER: NOT_READY
BUSINESS_DECISION_AUTHORITY: NONE_WHILE_NOT_READY
IMPLEMENTATION_STATE_AUTHORITY: NONE

## What this directory means
This is the **only intended durable governance home** for BThwani. Each subject has exactly one semantic owner; overlapping documents link to the owner rather than restating independently changeable law. All current domain documents are **drafts**, still subject to source-to-decision reconciliation and risk review. Their existence alone is **not** acceptance for building SQL/services or releasing policy switches.

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
| `hr.md` | limited internal employee HR capability; no parallel Identity role |
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

## What must be true before governance cutover
- All 14 owner documents have been semantically reconciled against accepted decisions, relevant original source/migrations and major archived requirements, not just rewritten or filled with headings.
- All **26** Product capability IDs occur exactly once as substantive owner sections, and no required material subfeature silently disappears. The single Product census routes each ID to one owner; no second catalog.
- Correct reference paths, no old active `docs/governance/`, no duplicate owner/writer/engine or unresolved critical business conflict. Operator policies are actually specified as owner-managed settings, not generic unbounded executors or UI-only switches.
- Security/finance/migration risks receive independent competent review as mandated; any unreviewed material risk is `REVIEW_BLOCKED`. Local test success is evidence about the tested property only.
- Foundation/GitHub guard positive and adversarial tests pass on the exact revision; the temporary plan records unresolved evidence and stage boundary.

When all conditions pass with approval, a separate governed change may set `GOVERNANCE_CUTOVER: READY` and update agent/guard phase. **This only certifies policy readiness for subsequent refoundation**, not SQL/application production readiness. Until then keep `NOT_READY`; do not disguise a draft as a final acceptance.

## Cutover readiness is a policy decision, not a claim of implemented software

`GOVERNANCE_CUTOVER: READY` would mean **the approved target Product/Design/API/SQL/Operational rules are reviewed, internally consistent and safe enough to direct later implementation**, with required independent expert review of financial/security/migration/legal-sensitive **policy decisions**. It does **not** require an already-built Expo app, an OpenAPI refactor, three generated SQL baselines, E2E customer checkout or a published software release. Those implementations have their **own later gates and actual runtime proof**; they remain `NOT_RUN` until authorized.

Do not weaken the **independent policy review** because there is not yet runnable code: reviewers can sign off the normative guarantees, threat models, payout/ledger formula and safe migration *strategy*, explicitly reserving implementation tests for their eventual code revision. Equally, do not label a proposed policy reviewed merely because it names the tests to be run. Any unresolved material legal, financial, account-recovery or data migration choice remains *unactivated*, with exact owner and review evidence requested in the temporary plan.

A final cutover records **which reviewed policy revision and accepted human authorization** it refers to. Approval to author/read/edit draft text and a historical Push are **not** automatic authority to invent reviewer signoffs or to merge/ship/deploy. If one required gate lacks actual reviewer evidence, remain `NOT_READY`, even when all structural/CI checks are green.
