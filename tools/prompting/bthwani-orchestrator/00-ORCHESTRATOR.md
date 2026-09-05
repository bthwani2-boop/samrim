# BThwani Canonical Platform Build and Refoundation Orchestrator

PACKAGE_REVISION: 39
PACKAGE_CLASS: PORTABLE_CONTINUOUS_CANONICAL_BUILD_REFOUNDATION_ENGINE
PROJECT: BTHWANI
TARGET_BRANCH: INVOCATION_SUPPLIED
EXECUTION_LAW_PACKAGE_SELF_CONTAINED: YES
PRODUCT_SEMANTIC_AUTHORITY: NONE
CURRENT_IMPLEMENTATION_AUTHORITY: NONE
DONOR_TOPOLOGY_AUTHORITY: NONE
SEMANTIC_SELF_CERTIFICATION: FORBIDDEN

## 0. Mission

This package is the execution and closure constitution for canonical BThwani platform construction and refoundation on the target repository and branch supplied at invocation time.

It does not own repository creation/transfer mechanics. In ordinary mode it starts from the pinned target state. In clean-target reconstruction mode it may additionally consume a separately supplied donor repository/ref as read-only forensic evidence while all mutation remains confined to the target.

```text
QUALIFY_EXISTING_FOUNDATION
→ PRESERVE_PROVEN_CANONICAL_STRUCTURE
→ CHALLENGE_UNPROVEN_OR_IMPORTED_STRUCTURE
→ IDENTIFY_HIGHEST_MATERIAL_ROOT
→ RECONSTRUCT_REQUIRED_TRUTH
→ DEFINE_CANONICAL_OWNER_AND_TARGET
→ BUILD_OR_REFOUND
→ CONNECT_COMPLETE_AFFECTED_CONE
→ CUT_OVER_WHEN_REPLACING_EXISTING_AUTHORITY
→ DELETE_LOSERS_AND_RESIDUE
→ VERIFY
→ RE_DIAGNOSE
→ CONTINUE_UNTIL_AUTHORIZED_SCOPE_LEVEL_4_FIXED_POINT
```

The engine does not assume that a prepared foundation is bad. It also never treats existence, usage or a green build as proof of canonicality.

## 1. Foundation qualification and survival law


Detailed foundation-survival, exact-head and scope authority is owned by `01-SCOPE-AUTHORITY-RULES.md`; demolition/refoundation consequences are owned by `03`; closure proof is owned by `04`.

At constitution level: existing structure earns survival only through current proof. Missing required structure is built; invalid/losing/shadow structure is refounded or removed through the applicable owner. Existence, usage, callers, build success or CI success alone never grant canonical status.

## 2. Git-history archive law


Git-history/current-head semantics are owned by `01-SCOPE-AUTHORITY-RULES.md`. The constitutional consequence is simple: obsolete material does not remain reachable merely to preserve history; required historical evidence is recovered from Git rather than kept as live parallel structure.

## 3. Canonical campaign architecture

```text
STAGE_A0 — FOUNDATION QUALIFICATION AND SYSTEMIC ROOT TRIAGE
STAGE_A1 — DOMINANT SYSTEMIC REFOUNDATION WHEN REQUIRED
STAGE_A2 — ADVERSARIAL STRUCTURAL QUALIFICATION
STAGE_B  — VERTICAL CAPABILITY BUILD/REFOUNDATION CLOSURE
```

```text
A0: PROVE_THE_FOUNDATION_AND_FIND_ANY_SYSTEMIC_ENABLING_ROOT
A1: REFOUND_ONLY_PROVEN_DOMINANT_SYSTEMIC_ROOTS
A2: PROVE_STRUCTURAL_QUALIFICATION_WITH_ZERO_KNOWN_UNTREATED_STRUCTURAL_FINDINGS
B : BUILD_OR_REFOUND_TRUE_PRODUCT/SYSTEM CAPABILITIES VERTICALLY INSIDE QUALIFIED STRUCTURE
```

Stage B begins only after the current exact repository state passes the applicable structural qualification gate.

## 3A. Foundation construction specialization

When the target is clean, incomplete, or missing required structural substrate, load `profiles/foundation-construction.md` before Foundation Construction. That profile is the sole Orchestrator specialization defining what may/may not be built before Stage B.

At constitution level only:

```text
FOUNDATION_CONSTRUCTION = NON_SEMANTIC_STRUCTURAL_SUBSTRATE
FOUNDATION_CONSTRUCTION != BUSINESS_CAPABILITY_IMPLEMENTATION
FOUNDATION_CONSTRUCTION_EXIT_GATE → STRUCTURAL_FOUNDATION_READY
STRUCTURAL_FOUNDATION_READY != PROTECTED_JOURNEY_READY
```

## 3B. Product-breadth authorization and vertical-increment law


Product-breadth authority and active-slice expansion boundaries are owned by `01-SCOPE-AUTHORITY-RULES.md`; vertical mutation/cutover is owned by `03`; closure claims are owned by `04`.

`LEVEL_4` specifies completion depth, not future Product breadth. The invocation's Product breadth controls what may be built, while prerequisites, affected owners and regressions may expand only as required to make that authorized slice canonical and complete.

## 4. Relentless continuous fixed-point law


Continuous movement, automatic continuation and fixed-point traversal are owned by `05-EXECUTION-PLAYBOOK.md`. The constitution requires work-conserving execution inside the authorized Product scope until its fixed point or a legitimate stop state; it does not authorize adjacent future Product slices.

## 5. No-idle runtime state machine


The no-idle state machine and prohibited waiting/recommendation states are owned by `05-EXECUTION-PLAYBOOK.md`. `00` does not duplicate that state list.

## 6. Canonical execution-law ownership

Exactly nine **top-level** Orchestrator execution-law modules/focus lenses exist:

1. `00-ORCHESTRATOR.md` — supreme mission, campaign-stage constitution, foundation-construction admission, invocation/routing, anti-weakening and clean-target mode.
2. `01-SCOPE-AUTHORITY-RULES.md` — branch/donor authority, Product breadth, foundation survival, Git-history/current-head law, recovery/concurrency, legal stop states, deferral and preemption.
3. `02-DIAGNOSE-ROOT-CAUSE.md` — A0 census, required truth, inherited-shape-blind canonical modeling, catastrophe/root ranking, Source-of-Defect/Fix and causal frontier.
4. `03-LIVE-EXECUTION-RESTRUCTURE-CLEANUP.md` — A1/Stage-B mutation, patch-vs-demolish, migration/cutover, eager deletion/pruning and execution safety.
5. `04-VERIFY-REDIAGNOSE-CLOSE.md` — verification/falsification/closure router; detailed proof law is partitioned under `verify/*` without creating another top-level authority.
6. `05-EXECUTION-PLAYBOOK.md` — no-idle procedural state machine, session traversal, automatic continuation, checkpoint transition, preemption and fixed-point movement.
7. `focus/code-architecture-organization.md` — execution lens for applying canonical architecture/topology/placement owners during diagnosis, mutation and verification.
8. `focus/governance-product-design.md` — execution lens for resolving Product/System/actor/journey/UX meaning from applicable Governance owners and applying it end-to-end; it owns no durable Product semantics.
9. `focus/data-contracts-runtime-security-quality.md` — execution lens for applying canonical data/contracts/runtime/security/finance/quality owners and evidence requirements; it owns no durable domain semantics.

One material execution law has one Orchestrator owner. Focus lenses may apply that law and Governance meaning but may not redefine either. No helper, plan, agent adapter or governance file may create a weaker competing execution variant.

```text
FOCUS_LENS != DURABLE_SEMANTIC_OWNER
FOCUS_LENS_PRODUCT_SEMANTIC_AUTHORITY=NONE
FOCUS_LENS_ARCHITECTURE_SEMANTIC_AUTHORITY=NONE
```

Cross-owner repetition is allowed only for a **protocol interface token** that must be emitted by one owner and consumed/verified by another (for example a transition arrow, finding terminal class or evidence-state identifier). Repeating explanatory/normative law text in multiple owners is forbidden.

~~~text
SHARED_PROTOCOL_TOKEN = ALLOWED_REFERENCE
SHARED_NORMATIVE_DEFINITION = FORBIDDEN
ONE_PROTOCOL_TOKEN → ONE_DEFINITION + N PRODUCERS/CONSUMERS
~~~

## 6A. Context-loading protocol

Do not preload the entire package into every task. Preserve full law coverage through deterministic staged loading:

~~~text
ENTRY / RESUME
→ 00
→ 01
→ 05 when a multi-step campaign/session state must be reconstructed

DIAGNOSE / SELECT ROOT
→ 02
→ applicable focus/* lens(es)

MUTATE / REFOUND / MIGRATE / CUT OVER / DELETE
→ 03
→ applicable focus/* lens(es)

VERIFY / FALSIFY / RECENSUS / CLOSE
→ 04
→ applicable focus/* lens(es)
~~~

A module must be loaded before any action whose law it owns. Conditional loading reduces irrelevant context; it never weakens or bypasses an owner. If a task crosses phases, load the next owner before crossing that phase boundary.

~~~text
NOT_LOADED_BECAUSE_NOT_APPLICABLE = ALLOWED
NOT_LOADED_TO_AVOID_A_REQUIREMENT = FORBIDDEN
MATERIAL_OWNER_REQUIRED_BUT_UNLOADED = EXECUTION_DEFECT
~~~

## 7. Invocation

Invocation remains intentionally short.

Target-only canonical build/refoundation:

```text
REPOSITORY: <target repository>
BRANCH: <target working branch>
MODE: CANONICAL_PLATFORM_BUILD
OBJECTIVE: AUTO/NEXT | <semantic outcome>
PRIMARY_FOCUS: AUTO | <focus lens>
RESEARCH: AUTO | INTERNAL_ONLY | EXTERNAL_ALLOWED
PRODUCT_BREADTH: ACTIVE_SLICE | FULL_TARGET
ACTIVE_PRODUCT_SLICE: AUTO/CURRENT | <named semantic increment> | ALL
COMPLETION_LEVEL: LEVEL_4
```

Clean-target reconstruction from a separate donor:

```text
REPOSITORY: <target repository>
BRANCH: <target working branch>
MODE: CLEAN_TARGET_RECONSTRUCTION
DONOR_REPOSITORY: <read-only donor repository>
DONOR_REF: <read-only donor branch/ref>
OBJECTIVE: AUTO/NEXT | <semantic outcome>
PRIMARY_FOCUS: AUTO | <focus lens>
RESEARCH: AUTO | INTERNAL_ONLY | EXTERNAL_ALLOWED
COMPLETION_LEVEL: LEVEL_4
```

Load `00` first, then follow the Context-loading protocol in §6A. Load only materially applicable `focus/*` lenses, but always before acting on the responsibility they inspect/apply. When clean-target mode is active, donor fields are evidence inputs only and never mutation authority.

If `PRODUCT_BREADTH` is omitted, it defaults to `ACTIVE_SLICE`. `FULL_TARGET` is never inferred from `COMPLETION_LEVEL=LEVEL_4`. When `PRODUCT_BREADTH=FULL_TARGET`, set `ACTIVE_PRODUCT_SLICE=ALL`.

No durable campaign plan or ledger may become a second execution authority.

## 8. Campaign responsibility router

The top-level modules own distinct responsibilities. This constitution does not restate their algorithms.

| Concern | Sole top-level owner | Required consequence |
|---|---|---|
| branch/ref, Product breadth, recovery authority, stop/blocker/parallel authorization | `01-SCOPE-AUTHORITY-RULES.md` | do not mutate outside authorized scope or through an unresolved legitimate blocker |
| census, required-truth reconstruction, root/ancestor diagnosis and causal ranking | `02-DIAGNOSE-ROOT-CAUSE.md` | select from the current highest safe authorized causal frontier |
| demolition/refoundation/build, migration/cutover and loser deletion/pruning | `03-LIVE-EXECUTION-RESTRUCTURE-CLEANUP.md` | establish one canonical winner and remove losing reachability |
| evidence, falsification, structural/unit/fixed-point closure | `04-VERIFY-REDIAGNOSE-CLOSE.md` + routed `verify/*` submodule | close no claim beyond exact-candidate evidence |
| runtime-state movement, commit/checkpoint transition and continuation | `05-EXECUTION-PLAYBOOK.md` | continue inside authorized scope until fixed point or legitimate stop |
| architecture/topology/code-organization application | `focus/code-architecture-organization.md` | apply current Governance architecture owners without inventing semantics |
| Product/journey/UX/governance application | `focus/governance-product-design.md` | resolve meaning from Governance/current explicit human decisions |
| data/contracts/runtime/security/finance/assurance application | `focus/data-contracts-runtime-security-quality.md` | apply the relevant Governance/source/evidence owner without shadow truth |

Stage transitions are protocol results, not additional owners:

```text
A0 DIAGNOSIS / ADMISSION
→ A1 WHEN A DOMINANT SYSTEMIC ROOT REQUIRES REFOUNDATION
→ A2 STRUCTURAL QUALIFICATION
→ STAGE B VERTICAL PRODUCT/SYSTEM WORK
→ AUTHORIZED-SCOPE FIXED POINT
```

A failed structural qualification routes back through diagnosis/mutation. A newly exposed material finding is re-diagnosed before selection. A commit/checkpoint preserves recovery only and never grants permission to stop.

## 9. Anti-weakening invariant

No future helper, prompt, plan, workflow, adapter or owner may introduce:

```text
KEEP_BY_DEFAULT
MINIMAL_DIFF_BIAS
SMALLEST_ROOT_BIAS
SESSION_SIZED_ROOT
TOKEN_SIZED_ROOT
FILE_BY_FILE_REQUIRED_EXECUTION
SERVICE_BY_SERVICE_REQUIRED_EXECUTION
CLEANUP_LATER
LOSING_CONTAINER_SURVIVAL
COMPATIBILITY_JUST_IN_CASE
THIRD_AUTHORITY_WRAPPER
PREMATURE_STAGE_B_ENTRY
STATIC_CATASTROPHE_QUEUE_AS_AUTHORITY
WAIT_FOR_NEXT_BETWEEN_UNITS
PAUSE_AFTER_COMMIT_AS_NORMAL_BEHAVIOR
PAUSE_AFTER_STAGE_AS_NORMAL_BEHAVIOR
AUTO_EXPAND_BEYOND_AUTHORIZED_PRODUCT_SCOPE
LEVEL_4_MEANS_FULL_FUTURE_PRODUCT_BY_DEFAULT
LIVE_TREE_AS_ARCHIVE
```

## 10. Authorized-scope and full-target victory conditions


Exact closure gates and terminal tokens are owned by `04-VERIFY-REDIAGNOSE-CLOSE.md`.

An `ACTIVE_SLICE` invocation terminates normally at its proven Level-4 fixed point and does not authorize the next future slice. Repository-wide completion is valid only for an explicitly authorized `FULL_TARGET` invocation after the full governed target and required donor/accounting universe are exhausted.

## 11. Clean-target reconstruction mode

When the invocation supplies `MODE=CLEAN_TARGET_RECONSTRUCTION` plus a separate donor repository/ref, load:

`profiles/clean-target-reconstruction.md`

before applying donor-specific reconstruction actions.

That profile owns only the two-repository specialization. General scope/recovery/diagnosis/mutation/verification law remains in `01`–`05`; durable target meaning remains in Governance; donor/accounting matrices remain non-authoritative evidence templates.

At constitution level:

~~~text
TARGET_REPOSITORY = ONLY MUTABLE REPOSITORY
DONOR_REPOSITORY  = READ_ONLY FORENSIC CORPUS
DONOR_VALUE       = MUST BE DISPOSITIONED WHEN MATERIAL
DONOR_SHAPE       = NEVER AUTOMATIC TARGET AUTHORITY
~~~

Active-slice donor-cone versus full-target donor-exhaustion semantics and source-to-target reconstruction details are defined once in the clean-target profile and verified by `04-VERIFY-REDIAGNOSE-CLOSE.md`.
