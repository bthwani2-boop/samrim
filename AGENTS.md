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

## 3. Repository and runtime execution

Docker is the sole LOCAL_INTEGRATION runtime owner for PostgreSQL, Mailpit, Identity, DSH, Control Panel and all four Metro servers. Host-native or parallel launch paths for those components are forbidden. Android application execution and device tooling remain device/host owned as appropriate.

The human full-stack lifecycle is intentionally simple:

```text
pnpm runtime:up      → start the complete canonical Docker stack
pnpm runtime:doctor  → read/validate the complete canonical Docker stack
pnpm runtime:status  → read the complete canonical Docker stack
```

These commands remain full-stack commands. `runtime:up` starts and reconciles the complete stack without rebuilding existing images by default; on a fresh machine Compose may build a missing image. When baked backend source changes, use explicit service rebuild before the runtime proof that needs the new binary. Task-specific surface/service paths must not rebuild unrelated images.

A task-specific runtime proof may exercise only the services/surfaces causally required by its claim. Verification must not start, stop, rebuild or restore the complete runtime merely to manufacture a generic green result.

Setup is not verification. Dependency installation/materialization belongs to bootstrap/setup and must not be repeated inside normal candidate proof when inputs are already ready.

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

## 5. Canonical change and cutover

Choose the simplest complete durable treatment. `SMALLEST DIFF != SIMPLEST SYSTEM`.

When replacing a mechanism:

```text
ESTABLISH WINNER
→ MIGRATE REQUIRED CALLERS/CONSUMERS
→ DISABLE LOSING PATH
→ DELETE LOSING PATH/ALIASES/RESIDUE
→ VERIFY WINNER
```

Do not leave old/new paths in parallel. Do not keep unused scripts, wrappers, allowlists, suppressions, guards, aliases or compatibility layers for comfort.

Repository placement follows `REPOSITORY-STRUCTURE.md`. A structural split/rehome is justified only by a real current responsibility and must reduce whole-system complexity.

Do not force-push, blind-merge/cherry-pick, bypass interlocks, manufacture green by suppressing failures, or retry an ambiguous consequential mutation without reconciliation.

## 6. Claim-specific evidence

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
KNOWN MATERIAL REGRESSIONS = 0
DECISION-CRITICAL UNKNOWNS = 0
KNOWN PARTIAL CUTOVERS = 0
KNOWN PARALLEL/SHADOW TRUTH = 0
KNOWN UNJUSTIFIED COMPLEXITY/RESIDUE = 0
INVALIDATED REQUIRED EVIDENCE = 0
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
