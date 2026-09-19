# BThwani / Samrim Agent Operating Constitution

ARTIFACT_CLASS: REPOSITORY_AGENT_OPERATING_CONSTITUTION
REPOSITORY_AGENT_LAW_AUTHORITY: CANONICAL
PRODUCT_SEMANTIC_AUTHORITY: NONE
CURRENT_IMPLEMENTATION_AUTHORITY: NONE

AGENTS.md is the sole repository-local execution and safety law. `REPOSITORY-STRUCTURE.md` owns placement only. knowledge.sources.json binds the exact immutable Governance baseline. Pinned Governance owns durable BThwani Product/System/Policy meaning; exact source/config/schema/runtime/database/readback owns current implementation truth; Git owns history.

## 1. Execution law

Do the smallest complete thing that proves the authorized outcome:

CURRENT STATE
→ PROVEN AFFECTED CONE
→ HIGHEST CAUSAL ROOT
→ SIMPLEST COMPLETE CANONICAL TREATMENT
→ CLAIM-SPECIFIC PROOF
→ FRESH CLOSURE CENSUS

Before material reasoning, pin repository, requested/active ref, exact HEAD, objective, environment and mutation authority. Revalidate live HEAD immediately before a material write. If it moved, reconcile first.

Deep means maximum rigor inside the proven material cone, not repository-wide inspection. Load only evidence that can change need, root cause, owner, boundary, safety, solution, cutover or proof. Expand while evidence can change the decision; stop at the proven causal boundary. Rigor scales with consequence, uncertainty, affected cone and irreversibility.

A CHANGE UNIT is one coherent authorized outcome. Intermediate edits are implementation steps, not closure points. During implementation use proportional source/static/targeted feedback. Run expensive runtime, browser, device or journey proof only when the claim requires it, when diagnosing the current failure, or when prior required evidence became stale. At closure run the smallest adequate claim-specific proof once.

One material meaning has one semantic owner; one mutable fact has one canonical writer; one cross-boundary contract has one executable provenance. Current code proves what exists, not that the design is correct. Treat the highest proven causal root; do not wrap, suppress, document around or preserve a surviving root defect.

For every plausibly material quality dimension, resolve it as affected, proven unaffected, or not applicable with reason using the pinned Quality taxonomy. Do not silently omit a plausibly material dimension or apply a lower correctness standard because another layer is the visible focus.

## 2. Durable meaning and Governance

Every material task classifies exactly one:

GOVERNANCE_IMPACT=NONE
GOVERNANCE_IMPACT=REVALIDATE_ONLY
GOVERNANCE_IMPACT=UPDATE_REQUIRED
GOVERNANCE_IMPACT=DEFECT_FOUND

NONE means durable meaning cannot materially change; REVALIDATE_ONLY means the relevant durable meaning was challenged and remains correct; UPDATE_REQUIRED means the authorized outcome changes durable meaning; DEFECT_FOUND means the pinned durable meaning is stale, wrong, incomplete or duplicated.

Use the pinned Governance only when durable meaning can materially affect the current decision. Relevant durable owners include GOVERNANCE-STANDARDS.md for governance/agent integrity, governance/policy/QUALITY.md for material quality/proof, governance/policy/EXPERIENCE.md for IA/navigation/interaction/RTL/accessibility/recovery, and governance/policy/DESIGN.md for durable visual identity/design language. Load other Product/System/Policy owners only when material.

If UPDATE_REQUIRED or DEFECT_FOUND, correct and merge the canonical Governance owner first, then deliberately repin knowledge.sources.json to the resulting immutable SHA and re-prove the affected implementation cone. A Governance pin change can never be NONE, and normal promotion must not move the pin backward from its previously bound canonical ancestry. Do not duplicate durable Governance meaning into this file or another repository-local Markdown authority.

Donor/history, OSS/product exemplars, Yemen-market evidence, primary technology sources and assurance/experience sources are evidence only. Inspect them only when they can change the current decision, and revalidate mutable external facts at use.

For user-facing work, durable Experience/Design/Quality meaning remains in those Governance owners. The executable Design System owns reusable domain-neutral visual semantics when reuse is proven; each app owns its actor-specific IA, shell, navigation and composition. Arabic/RTL, accessibility, interaction states and rendered behavior are correctness when material, not optional polish. Static checks never substitute for rendered/interaction evidence when the claim is visual or interactive.

## 3. Complexity and cutover

EVERY EXISTING OR NEW COMPLEXITY MUST RE-EARN EXISTENCE.

No proven current material benefit → delete.
Same outcome with fewer states/commands/layers → choose the simpler model.
Future possibility or "just in case" → not justification.

Preference: DELETE → DIRECT USE → EXTEND EXISTING OWNER → REFACTOR EXISTING OWNER → ONLY THEN ADD A NEW MECHANISM. SMALLEST DIFF != SIMPLEST SYSTEM.

Within the affected cone, every material file/module/component/hook/route/handler/service/package/type/DTO/schema/migration/contract/config/env key/script/dependency/state/cache/registry/test/generated artifact must have a current owner, provenance, real consumer and simplest complete form. Do not create a second affected engine, proof registry, cache protocol, state machine, semantic guard or compatibility path when an existing owner can satisfy the requirement.

A replacement is complete only after all material producers, consumers, contracts, persistence/config/runtime paths, tests and current implementation descriptions use the winner; then delete the loser and prove it absent. No old/new shadow truth or partial cutover.

For high-cost-to-reverse identities, persistent data shapes, ownership boundaries or public contracts, prove semantic sufficiency and a defensible evolution/cutover path before committing the design; do not build speculative future machinery.

## 4. Local development and runtime

The stable local interface is intentionally small:

pnpm bootstrap                       → setup/materialization only when setup inputs changed
pnpm dev | pnpm runtime:up           → prepare/reuse backend/state only
pnpm runtime:status                  → backend/state readback
pnpm client|partner|captain|field    → run only that app's package-owned Expo development process
pnpm control                         → run only Control's package-owned Next development process
pnpm scr                             → device transport/reverse mappings/scrcpy
pnpm runtime:down                    → stop repository local development runtime
pnpm verify                          → exact clean-candidate affected static/workspace proof
pnpm safe:push                       → the single final candidate verification, safe push and exact remote SHA confirmation

Executable package/config/runtime code owns ports, process inventory and mutable runtime details; do not duplicate them here.

LOCAL_INTEGRATION has one canonical owner per admitted process/state. Do not run parallel host/container owners for the same responsibility. Reuse valid warm backend, Metro/Next, session, actor and business state. Verification must not bootstrap dependencies, rebuild/restart the whole runtime or re-login merely to manufacture a generic green result. Rebuild/restart only what the affected claim requires.

Normal local Product state is reusable. Proof-only state exists only when a claim requires it; create the minimum through canonical writers and clean only disposable state created by that proof. Do not use direct SQL/seed bypass to manufacture business success. Proof tooling must not reset developer credentials, authorize re-enrollment, revoke unrelated sessions, mutate an established actor merely to regain access, or destroy reusable business state for convenience. Destructive local data loss requires explicit same-invocation authorization.

## 5. Runtime and user-facing proof

A user-facing claim requires the real affected surface and role-scoped session. API/database readback corroborates canonical truth but does not replace real interaction.

For a material multi-role or shared-state claim:

REAL ACTOR ACTION
→ CANONICAL BUSINESS TRANSITION
→ AFFECTED REAL SURFACE OBSERVATION/ACTION
→ CLAIM-APPROPRIATE CANONICAL READBACK

On failure, capture exact failure/state, repair the highest proven root, complete the required cutover, invalidate only stale evidence, remove affected residue, recreate only required transactional state through canonical writers, and replay from the earliest trustworthy point.

## 6. Fast proportional verification and evidence

Use Git plus the canonical Nx project graph. A local change must not trigger unrelated projects; a shared/root/toolchain change may legitimately affect many.

During implementation run the nearest direct/affected checks needed for feedback. A coherent change unit may be reviewed, proportionally proved and committed locally without immediately pushing it. Do not run a separate final full proof immediately before pnpm safe:push, and do not invoke safe:push merely because another local commit exists.

pnpm safe:push is an objective-closure or explicit remote-checkpoint operation. It owns one final local exact-candidate verification for the complete unpushed branch delta, then fast-forward/first-push safety and exact remote SHA confirmation. Multiple coherent local commits may therefore share one final safe:push when they belong to the same authorized objective. If the exact SHA is already remote it is a no-op and must not repeat heavy proof.

The local verifier remains affected-aware and non-runtime-owning. Heavy mobile export/deployability proof is required locally only when the affected change can alter bundling/deployable configuration or when the current claim explicitly requires it; normal source iteration uses targeted checks plus real Metro/device proof when user-facing behavior is claimed. CI remains independent integration/promotion assurance and may be broader.

Cache is evidence only when its inputs cover every material computation input. Prefer Nx's canonical cache/project graph; do not build a parallel cache or dependency engine.

Evidence is valid only for the exact state and claim it proves. If the candidate, semantic owner, contract/schema, persistence/runtime composition, Governance binding or mutable external fact materially changes, invalidate and rerun only the proof made stale; never carry evidence forward by assumption. Use the smallest adequate producer: source/config for source claims, schema/query/readback for persistence, Playwright for web journeys, device/Expo/ADB for mobile interaction, Compose/process/network readback for runtime ownership, measurement for performance, and current primary sources for mutable external rules.

Use subagents only for genuinely independent bounded lanes with exact input state, one material deliverable, bounded scope and required evidence. Parallel mutation lanes require disjoint write sets. Parallelize independent read/reasoning where useful; on a resource-constrained local host avoid concurrent heavyweight builds/exports/runtime/browser/device proof unless measurement shows it reduces total cost without contention. The lead owns final integration, Governance classification, consequential mutations, commit/push and closure. Subagents must not independently push, merge, repin Governance, reset/purge persistent state, expose secrets or declare closure; invalidate their returned evidence if its material inputs change before integration.

## 7. Safety and closure

Do not force-push, blind-merge/cherry-pick, bypass interlocks, suppress failures to manufacture green, retry ambiguous consequential mutations without reconciliation, expose secrets, or perform merge/release/external consequential effects unless explicitly authorized.

Before closure, perform a fresh adversarial census only across the material affected cone. Closure requires:

AUTHORIZED OBJECTIVE = PROVEN
MATERIAL AFFECTED CONE = ACCOUNTED
CANONICAL OWNER/WRITER/READBACK = PROVEN
REQUIRED DATA/CONTRACT/RUNTIME/USER-FACING CLAIMS = PROVEN
REQUIRED FAILURE/RECOVERY BEHAVIOR = PROVEN WHEN APPLICABLE
PINNED GOVERNANCE = EXACT WHEN MATERIALLY REQUIRED
KNOWN MATERIAL DEFECTS = 0
KNOWN MATERIAL WEAKNESSES/REGRESSIONS = 0
KNOWN DUPLICATE/SHADOW OWNERSHIP = 0
KNOWN PARTIAL CUTOVERS/UNJUSTIFIED RESIDUE = 0
UNPROVEN MATERIAL CLAIMS = 0
DECISION-CRITICAL UNKNOWNS = 0
INVALIDATED REQUIRED EVIDENCE = 0
GOVERNANCE_IMPACT = RESOLVED

For each coherent change unit:

REVIEW DIFF → PROPORTIONAL CLAIM-SPECIFIC PROOF → LOCAL COMMIT

At authorized objective closure or an explicit remote checkpoint:

REVIEW COMPLETE UNPUSHED DELTA → REPOSITORY-OWNED SAFE PUSH ONCE → CONFIRM EXACT REMOTE SHA

Commit/push does not authorize merge, promotion, release or other external consequential effects.

Do not ask for "next" when the next safe action is derivable and inside current authority. Stop only for a real authority/scope boundary, missing Product decision, unreconciled target movement, unavailable required credential/environment, material safety/irreversibility risk, or a decision-critical unknown that cannot presently be resolved. Otherwise continue only until current material closure is proven, then stop; do not search for unrelated improvements merely because they exist.
