# BThwani / Samrim Agent Operating Constitution

ARTIFACT_CLASS: REPOSITORY_AGENT_OPERATING_CONSTITUTION
REPOSITORY_AGENT_LAW_AUTHORITY: CANONICAL
PRODUCT_SEMANTIC_AUTHORITY: NONE
CURRENT_IMPLEMENTATION_AUTHORITY: NONE

`AGENTS.md` is the sole repository-local agent law. `REPOSITORY-STRUCTURE.md` owns placement only. Pinned Governance/Docs are challengeable durable evidence. Exact source/config/runtime/database/readback proves current state.

## 0. Operating rule

Do the smallest complete thing that proves the authorized outcome.

```text
CURRENT STATE
→ PROVEN AFFECTED CONE
→ HIGHEST CAUSAL ROOT
→ SIMPLEST COMPLETE CANONICAL TREATMENT
→ CLAIM-SPECIFIC PROOF
→ FRESH CLOSURE CENSUS
```

Before material reasoning, pin repository, branch/ref, exact HEAD, objective, environment and authority. Revalidate live HEAD immediately before a material write. If it moved, reconcile first.

Load only evidence that can change need, root cause, owner, safety, solution, cutover or proof. Do not inspect Governance, Docs, history, OSS, runtime, databases, surfaces or quality dimensions merely because they exist.

RIGOR SCALES WITH CONSEQUENCE + UNCERTAINTY + AFFECTED CONE + IRREVERSIBILITY.

`UNEXAMINED != UNAFFECTED` applies only to a dimension that is plausibly material to the current outcome. It does not make every platform dimension material to every task.

### 0.1 Materiality and proof cadence

`MATERIAL CHANGE` means a change capable of altering behavior, meaning, public contract, persistence, runtime composition, user-visible outcome or the validity of required evidence.

`CHANGE UNIT` means one coherent authorized outcome or claim. Intermediate edits and patches inside the same change unit are implementation steps, not closure points; a new explicit user objective may redefine the unit.

During implementation, use proportional source, static and targeted checks. Do not open browser/device apps, restart runtime, re-login or run full journey proof until the change unit is complete, unless the current failure requires it for diagnosis or prior evidence became stale. At change-unit closure, run the smallest claim-specific proof once; do not repeat it for every intermediate patch. The repository-owned candidate verifier and `safe:push` remain the final static/push gates.

## 1. Scope and ownership

For every material task:

```text
IDENTIFY USER/BUSINESS OUTCOME
→ FIND CANONICAL OWNER/WRITER/READBACK
→ TRACE REAL CONSUMERS AND BOUNDARIES
→ EXPAND ONLY WHILE EVIDENCE CAN CHANGE THE DECISION
→ STOP AT THE PROVEN CAUSAL BOUNDARY
```

Include every materially affected current participant and no irrelevant participant.

One material meaning has one semantic owner. One mutable fact has one canonical writer. One cross-boundary contract has one executable provenance. Parallel/shadow truth is a defect.

Current source is evidence of what exists, not automatic proof that the design is correct. Documentation, Governance, tests, donor code, OSS and best practice are evidence, not oracles.

Treat the highest proven causal root. Do not move, wrap, suppress or document around a surviving root defect.

### 1.1 Governance impact and evidence

Every material task must classify exactly one:

```text
GOVERNANCE_IMPACT=NONE
GOVERNANCE_IMPACT=REVALIDATE_ONLY
GOVERNANCE_IMPACT=UPDATE_REQUIRED
GOVERNANCE_IMPACT=DEFECT_FOUND
```

Use the exact pinned Governance as the durable baseline and actively challenge the owners that the affected cone can change. `NONE` means durable meaning cannot materially be affected; `REVALIDATE_ONLY` means the relevant meaning was examined and remains correct; `UPDATE_REQUIRED` means the authorized outcome changes durable meaning; `DEFECT_FOUND` means the pinned durable meaning is stale, wrong, incomplete or duplicated.

If `UPDATE_REQUIRED` or `DEFECT_FOUND`, correct and merge `governance-and-docs` through its canonical lane first, then deliberately repin `knowledge.sources.json` to the required merged immutable SHA and rerun affected proof. A change to the Governance pin can never be classified `NONE`. Normal promotion never moves the Governance pin backward; a newer pin must descend from the previously bound canonical Governance state.

The pinned `GOVERNANCE-STANDARDS.md` defines Governance/agent integrity but owns no BThwani Product/System/Policy meaning.

Use donor/history, relevant OSS/product exemplars, Yemen-market/competitor evidence, current primary technology sources, assurance/experience sources and ecosystem discovery only when a lane can materially change the current need, owner, boundary, risk, solution or proof. Revalidate mutable external facts at use. A newer tool/version is a candidate, not an automatic upgrade; apply the pinned Knowledge/Integration maturity and adoption gates.

Do not create a second local Governance tree, standards registry, evidence ledger, technology-radar database or semantic guard. The pinned Governance plus the existing repository knowledge materialization/query/verification path is the canonical knowledge system.

### 1.2 User-facing surface correctness

User-facing presentation is part of correctness, not post-functional polish. A logically working feature is incomplete when its information architecture, application shell, navigation, hierarchy, Arabic/RTL behavior, interaction states, accessibility, visual-system use or real-device behavior is materially weak or incomplete.

For every materially affected user-facing surface:

```text
ACTOR / USER OUTCOME
→ APPLICABLE PRODUCT / EXPERIENCE / DESIGN MEANING
→ INFORMATION ARCHITECTURE
→ SHELL / NAVIGATION
→ SCREEN HIERARCHY
→ INTERACTION / STATE MODEL
→ FEATURE PRESENTATION
→ RENDERED + INTERACTION PROOF
```

Establish the simplest complete canonical shell/navigation model required by the affected actor and capability set before deepening screens that depend on it. Do not force distinct actor-facing surfaces into the same shell merely for visual consistency, and do not create empty destinations or speculative navigation to make a surface appear complete.

Arabic-first RTL is an end-to-end interaction invariant where the admitted surface is Arabic: prove layout/order, reading/alignment, directional icons and navigation, scrolling, forms, mixed-direction values, focus/keyboard behavior and direction-sensitive gesture/animation semantics as applicable. `textAlign: right` is not RTL proof.

Pinned Governance owns durable Product/Experience/Design meaning within its fact-specific authority. If stronger evidence proves durable meaning stale or defective, correct Governance through its canonical path before relying on an implementation exception. The repository's canonical executable Design System owner, discovered through current placement/public exports, owns reusable visual tokens/themes/primitives/patterns only when reuse is proven. Apps own host-specific IA, shell, navigation and presentation/composition. No repository-local Markdown or app-local visual foundation may become parallel durable Design/Experience authority.

For significant surface establishment or refoundation, inspect relevant donor implementation, current Product evidence, applicable platform guidance and proportional OSS/current practice only when they can change the decision. They are evidence, not copy authority or automatic truth.

Account for every applicable user-visible state and transition, including loading, empty/no-results, forbidden, conflict, offline, error/recovery, busy, validation, disabled/pressed/selected, keyboard/safe-area, long/constrained content, theme and accessibility behavior. Missing applicable states are incomplete implementation.

Static/source checks do not close rendered or interaction claims. Use representative runtime/device/browser evidence appropriate to the affected surface and exercise the material navigation, interaction, RTL, state transitions, clipping/overflow, touch/focus behavior and visual consistency. A green typecheck/test does not override a visibly, structurally or interactively defective surface.

Any known material shell/navigation, IA, RTL/accessibility, visual hierarchy, Design-System divergence, interaction-state, misplaced presentation ownership, duplicate visual authority or unproven rendered claim is a closure failure.

## 2. Complexity survival law

EVERY EXISTING OR NEW COMPLEXITY MUST RE-EARN EXISTENCE.

A script, wrapper, abstraction, guard, mode, cache, registry, verifier, configuration layer, service, dependency, compatibility path, state or orchestration mechanism survives only when it has a proven current material benefit that cannot be achieved more simply by an existing mechanism.

```text
NO PROVEN CURRENT MATERIAL BENEFIT → DELETE
SAME OUTCOME WITH LESS CODE/STATES/COMMANDS/LAYERS → CHOOSE THE SIMPLER MODEL
COMPLEXITY ADDED > COMPLEXITY REMOVED → REJECT
FUTURE POSSIBILITY / "JUST IN CASE" → NOT A JUSTIFICATION
```

Preference order:

```text
DELETE
→ DIRECT USE
→ EXTEND EXISTING OWNER
→ REFACTOR EXISTING OWNER
→ ONLY THEN ADD A NEW MECHANISM
```

No speculative scaffolding. No compatibility just in case. No new execution mode, proof registry, state machine, custom dependency graph or cache protocol when an existing mechanism can own the requirement.

Minimum means smallest complete current model, never partial behavior or lost meaning.

### 2.1 Material artifact survival

Within the proven affected cone, every material file, module, component, hook, route, handler, service, package, type/DTO, schema, migration, contract, config/env key, script, dependency, state/cache/registry, test and generated artifact must re-earn existence through:

```text
EXISTENCE
→ OWNERSHIP
→ PLACEMENT
→ PROVENANCE
→ CURRENT CONSUMER
→ SIMPLEST COMPLETE FORM
```

If current need, canonical ownership, correct placement/provenance, a real consumer or the simplest complete form cannot be proved, delete, merge, rehome or refound it within the affected cone. Existing code has no preservation right merely because it already exists.

Any treatment that increases one-off exceptions, copied truth, manual synchronization or suppressions instead of strengthening/simplifying the canonical model is rejected; revisit the design rather than normalizing patch culture.

### 2.2 Equal correctness across material dimensions

Every plausibly material engineering dimension is held to the same correctness standard. Use the pinned Quality taxonomy to discover applicable Product, ownership, data/migration, contract/API/event, security/authorization, privacy/location, finance, reliability/recovery, performance, observability/audit, UX/IA/content, accessibility/RTL/localization, visual-system, platform/device, runtime/config/infra, dependency/supply-chain, release/deployable-identity, verification/evidence and governance/residue concerns.

```text
PLAUSIBLY MATERIAL DIMENSION
→ CORRECT OWNER / BOUNDARY
→ FAILURE + RECOVERY SEMANTICS AS APPLICABLE
→ CLAIM-SPECIFIC PROOF
```

No language, framework, service, UI or tooling layer gets a lower correctness standard merely because another layer is the visible focus.

## 3. Repository and runtime execution

LOCAL_INTEGRATION has exactly one canonical runtime owner for every admitted process/state. The current process/service/container inventory and environment composition are discovered from executable runtime configuration and readback; this agent constitution does not duplicate that mutable inventory. Parallel host/container ownership for the same responsibility is forbidden. Device/host tooling remains where the executable runtime contract assigns it.

The human LOCAL_INTEGRATION lifecycle has one daily bootstrap and targeted aliases, all owned by `tools/dev/dev.ps1`:

```text
pnpm dev            → reuse/prepare backend, ADB reverse, all four Metro servers, Control and scrcpy, then return
pnpm runtime:up     → ensure backend/state only
pnpm runtime:status → display backend/state
pnpm control        → ensure Control only
pnpm client|partner|captain|field → ensure/open the selected mobile surface
pnpm scr            → ensure scrcpy only
```

The daily bootstrap reuses healthy listeners/processes and must skip Docker reconciliation when backend endpoints are already live. Missing host development servers may be started concurrently because startup is lightweight; heavyweight bundles/builds and runtime proof remain serialized on resource-constrained hosts. Source-only edits reuse valid processes, device state and sessions; Expo Fast Refresh / Next HMR is the inner development loop.

`runtime:up` reconciles backend/state without rebuilding existing images by default; on a fresh machine Compose may build a missing image. One-shot migrations must not be rerun merely because `pnpm dev` was invoked while the backend is already live. When baked backend source changes, use explicit targeted service rebuild before the runtime proof that needs the new binary. Application-source changes do not rebuild Docker.

A task-specific runtime proof may exercise only the services/surfaces causally required by its claim. Verification must not start, stop, rebuild or restore the complete runtime merely to manufacture a generic green result.

Setup is not verification. Dependency installation/materialization belongs to bootstrap/setup and must not be repeated inside normal candidate proof when inputs are already ready.

Valid LOCAL_INTEGRATION operational state is reusable: normal verification must not destroy it, business proof state is created through canonical owners rather than direct SQL/seed bypass, and destructive reset/purge requires explicit same-invocation data-loss authorization.

Actor-facing LOCAL_INTEGRATION claims require the affected actor's real surface and role-scoped session; API/database readback verifies canonical truth but does not substitute for real interaction. Reuse valid actors and resources, create fresh transactional state only when the current claim requires it, and preserve valid state during normal verification.

### 3.1 Synthetic local proof state law

This law applies to every synthetic/local-development state: actors, roles, sessions, stores, catalog, business data, credentials, locators, scenarios and proof tooling.

```text
CLEAN + CANONICAL + PROVEN → REUSE

TRANSACTIONAL / SCENARIO NOISE ONLY
→ PRESERVE VALID BASELINE
→ CREATE FRESH TRANSACTIONAL STATE

SMALLEST AFFECTED SYNTHETIC STATE IS UNTRUSTED
→ STOP USING IT
→ DISCARD / REBUILD THROUGH CANONICAL OWNERS WHEN A SAFE OWNER BOUNDARY EXISTS

BASELINE INTEGRITY CANNOT BE PROVEN
→ STOP USING THE WORLD
→ USE THE EXISTING EXPLICITLY AUTHORIZED LOCAL RESET/PURGE BOUNDARY
→ PROVE CLEAN STATE
→ REBUILD THROUGH CANONICAL OWNERS

PRODUCT / SCHEMA / CONFIG / TOOLING IS POLLUTED
→ FIX HIGHEST ROOT
→ REMOVE RESIDUE
→ PROVE NEGATIVE SPACE
→ ONLY THEN REBUILD SYNTHETIC STATE
```

Baseline actors and resources are reusable proof anchors, not exclusive test accounts. Additional synthetic clients, partners, stores, captains, fields or scenario resources are permitted only when claim-justified, local, canonical-owner-created, isolated and free of uncontrolled external effects. Synthetic proof state is never Product truth, migration/bootstrap data or authority, and it never authorizes direct SQL business setup or test-only Product/schema branches.

### 3.2 Closed-loop multi-role journey proof

When a material claim crosses actor-facing surfaces, shared mutable business state or cross-boundary behavior, validate it as a closed runtime repair loop across every causally participating real surface discovered from the exact current state.

```text
REAL ACTOR ACTION
→ CANONICAL BUSINESS TRANSITION
→ AFFECTED ACTOR/SURFACE OBSERVATION OR ACTION
→ CLAIM-APPROPRIATE CANONICAL READBACK
```

Use the canonical LOCAL_INTEGRATION runtime and synthetic baseline through their existing owners. Reuse clean proven baseline state and create fresh transactional state only through canonical writers. Do not manufacture a green journey through direct SQL, manual synchronization, hidden test-only Product paths or persistence bypass.

A user-facing claim requires the real affected surface; API/database readback corroborates canonical truth but does not substitute for the interaction.

On any material failure:

```text
CAPTURE EXACT FAILURE + STATE
→ TRACE HIGHEST PROVEN CAUSAL ROOT
→ REPAIR ROOT + COMPLETE REQUIRED CUTOVER
→ INVALIDATE AFFECTED EVIDENCE
→ REMOVE MATERIAL RESIDUE
→ REBUILD ONLY REQUIRED TRANSACTIONAL STATE THROUGH CANONICAL WRITERS
→ REPLAY FROM THE EARLIEST TRUSTWORTHY POINT
```

If the treatment changes a shared identity, contract, persistence shape, state-machine, routing or runtime assumption used earlier in the journey, replay from the earliest point whose evidence became stale; replay the complete journey when no trustworthy earlier checkpoint remains.

Continue until all materially participating surfaces observe the same canonical truth, required failure/recovery behavior is proven, affected evidence is current and no known material cross-role defect or residue remains.

## 4. Fast proportional verification

Normal development has one principle, not a matrix of modes:

```text
CHANGE
→ DETERMINE AFFECTED PROJECTS FROM GIT + CANONICAL PROJECT GRAPH
→ RUN REQUIRED TARGETS FOR THOSE PROJECTS
→ RUN ONLY CLAIM-SPECIFIC RUNTIME/JOURNEY PROOF
→ CONTINUE
```

Use the repository's real project/dependency graph. Do not build a parallel affected engine. A root/shared/toolchain change may legitimately affect many or all projects; a local change must not trigger unrelated projects.

`pnpm verify` is non-mutating exact-candidate static/workspace proof. It must be affected-aware and must not bootstrap dependencies or own Docker runtime lifecycle.

A green command proves only what it exercised. Runtime/user-facing behavior still requires real runtime evidence when that behavior is part of the claim.

During implementation use direct/affected checks as needed. Do not run a separate final full proof immediately before `pnpm safe:push`.

`pnpm safe:push` owns the single final local candidate verification for the exact branch delta, then performs fast-forward/first push safety and confirms the exact remote SHA. If the exact SHA is already remote, it is a no-op and must not repeat heavy proof.

CI is independent integration/promotion assurance. It may be broader when the integration claim is broader, but it must not duplicate setup or run unrelated heavyweight jobs by default.

### 4.1 Independent subagent orchestration

Use subagents for genuinely independent material evidence, implementation, review or proof lanes.

When two or more such lanes exist and delegation materially reduces context interference or execution cost without increasing integration risk, delegate proactively rather than serializing all work. There is no required subagent count and no delegation for ceremony.

On resource-constrained LOCAL_INTEGRATION hosts, parallelize independent read/reasoning lanes but serialize heavyweight local builds, exports, Docker/runtime proof, device/browser journeys and similar CPU/RAM-intensive work unless measured evidence proves concurrency reduces total cost without contention.

Every delegated lane must have an exact input state, one material question or deliverable, a bounded read/write scope and required evidence. Parallel mutation lanes require disjoint write sets.

The lead retains the objective, affected-cone and ownership decisions, cross-lane conflict resolution, final integration, Governance classification, consequential mutations, commit/push and closure census.

Subagents must not independently push, merge, repin Governance, reset/purge persistent state, expose secrets or declare closure.

Returned evidence is exact-state evidence. If its material inputs change before integration, invalidate and revalidate the affected result.

## 5. Canonical change and cutover

Choose the simplest complete durable treatment. `SMALLEST DIFF != SIMPLEST SYSTEM`.

When replacing a mechanism:

```text
ESTABLISH WINNER
→ MIGRATE MATERIAL PRODUCERS + CONSUMERS
→ MIGRATE AFFECTED CONTRACTS / TYPES / ROUTES / STATE
→ MIGRATE AFFECTED DATABASE / MIGRATIONS / CONFIG / RUNTIME
→ MIGRATE AFFECTED TESTS / GENERATED ARTIFACTS / CURRENT IMPLEMENTATION DOCS
→ DISABLE LOSING PATH
→ DELETE LOSING PATH / ALIASES / RESIDUE
→ VERIFY WINNER
→ PROVE LOSER ABSENT
```

A cutover is incomplete while any materially affected producer, consumer, contract, persistence path, runtime/config path, generated artifact, test or current implementation description still depends on the losing model.

Do not leave old/new paths in parallel. Do not keep unused scripts, wrappers, allowlists, suppressions, guards, aliases or compatibility layers for comfort.

Repository placement follows `REPOSITORY-STRUCTURE.md`. A structural split/rehome is justified only by a real current responsibility and must reduce whole-system complexity.

Do not force-push, blind-merge/cherry-pick, bypass interlocks, manufacture green by suppressing failures, or retry an ambiguous consequential mutation without reconciliation.

## 6. Claim-specific evidence

EVIDENCE IS VALID ONLY FOR THE EXACT STATE IT PROVES.

A material change to the candidate, semantic owner, contract/schema, persistence/runtime composition, Governance binding or mutable external fact invalidates the affected proof. Re-run only the proof made stale; never carry evidence forward by assumption.

Use the smallest adequate evidence producer:

```text
SOURCE/CONTRACT → source/config/contract inspection
DATABASE → schema/query/migration/readback
WEB JOURNEY → Playwright
MOBILE JOURNEY → Agent Device / Expo tooling as applicable
LOW-LEVEL ANDROID → ADB
RUNTIME OWNERSHIP → Compose/config + container/process/network readback
PERFORMANCE → measurement
MUTABLE EXTERNAL RULE → current primary official source
```

Best practice is not automatic authority. Adopt it only when it fits current BThwani constraints and improves the whole outcome.

For high-cost-to-reverse identities, persistent data shapes, ownership boundaries or public contracts, prove semantic sufficiency and a defensible evolution/cutover path without building speculative future machinery.

## 7. Closure

Before closure, perform a fresh adversarial re-census from the exact resulting state for materially affected consumers, stale evidence, shadow authority, partial cutover, lost meaning/data/identity, required failure/recovery behavior and unjustified residue.

Closure requires:

```text
AUTHORIZED OBJECTIVE = PROVEN
MATERIAL AFFECTED CONE = ACCOUNTED
EXPECTED OWNER/WRITER/READBACK = PROVEN
REQUIRED DATA/CONTRACT/RUNTIME/JOURNEYS = PROVEN
KNOWN MATERIAL DEFECTS = 0
KNOWN MATERIAL WEAKNESSES = 0
KNOWN MATERIAL REGRESSIONS = 0
KNOWN DUPLICATE OWNERSHIP = 0
UNPROVEN MATERIAL CLAIMS = 0
DECISION-CRITICAL UNKNOWNS = 0
KNOWN PARTIAL CUTOVERS = 0
KNOWN PARALLEL/SHADOW TRUTH = 0
KNOWN UNJUSTIFIED COMPLEXITY/RESIDUE = 0
INVALIDATED REQUIRED EVIDENCE = 0
GOVERNANCE_IMPACT = RESOLVED
PINNED_GOVERNANCE = EXACT_WHEN_MATERIALLY_REQUIRED
```

For a coherent verified unit:

```text
REVIEW DIFF
→ COMMIT
→ REPOSITORY-OWNED SAFE PUSH
→ CONFIRM EXACT REMOTE SHA
```

Commit/push does not authorize merge, promotion, release or external consequential effects.

Do not ask for "next" when the next action is safe, derivable and inside current authority. Stop only for a real authority/scope boundary, missing Product decision, unreconciled target movement, unavailable required credential/environment, material safety/irreversibility risk, or a decision-critical unknown that cannot presently be resolved.
