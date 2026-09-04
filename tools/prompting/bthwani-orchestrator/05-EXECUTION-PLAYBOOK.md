# Execution Playbook

OWNER_ROLE: PROCEDURAL_EXECUTION_STATE_MACHINE
AUTHORITY_ASSIGNED_BY: 00-ORCHESTRATOR.md
SELF_CERTIFICATION: FORBIDDEN

## 1. Purpose

This file owns how the engine moves. It does not redefine Product, architecture, diagnosis, mutation or verification laws owned elsewhere.

## 2. Session entry

```text
PIN_CURRENT_HEAD
→ RECONSTRUCT_CURRENT_EXECUTION_STATE
→ IDENTIFY_LAST_PROVEN_CLOSED_UNIT
→ IDENTIFY_ACTIVE_OPEN_UNIT
→ INVALIDATE_STALE_EVIDENCE
→ FIND_RECOVERY_FRONTIER
→ DERIVE_NEXT_REQUIRED_ACTION
```

`NEW_CHAT != NEW_CAMPAIGN`, `NEW_CHAT != NEW_ROOT`, and `COMMIT != UNIT_CLOSURE`.

## 3. Runtime states

Exactly one active state before completion:

```text
RECOVERING
QUALIFYING_FOUNDATION
DISCOVERING
DIAGNOSING
SELECTING
BUILDING
REFOUNDING
MIGRATING
CUTTING_OVER
DELETING
PRUNING
VERIFYING
FALSIFYING
RECENSUS
LEGITIMATELY_BLOCKED
```

Idle/waiting is forbidden when the next authorized action is derivable.

## 4. Foundation qualification traversal

```text
FULL_MATERIAL_CENSUS
→ REQUIRED_TRUTH_RECONSTRUCTION
→ CURRENT_SHAPE_INDEPENDENT_CANONICAL_MODEL
→ SURVIVAL_AND_OWNERSHIP_CHALLENGE
→ SYSTEMIC_ROOT_CANDIDATE_UNIVERSE
→ RESOLVE_RANKING_RELEVANT_UNKNOWNS
→ QUALIFICATION_GATE
```

If the foundation is already canonical enough for safe capability work, do not manufacture demolition. Proceed to structural qualification/capability work.

If a dominant systemic root blocks safe downstream work, execute it before long capability closure.

### 4A. Foundation Construction traversal

When A0 proves required foundation substrate is missing/incomplete, execute Foundation Construction before semantic capability work:

```text
C0 AUTHORITY/TOPOLOGY CONSISTENCY
→ C1 REPOSITORY + WORKSPACE + TOOLCHAIN SUBSTRATE
→ C2 SERVICE PROCESS/RUNTIME SKELETONS
→ C3 CONTRACT/CLIENT/DATABASE/TESTING LANES WITHOUT BUSINESS SEMANTICS
→ C4 DEPLOYABLE HOST SHELLS + EXTERNAL IDENTITY PRESERVATION
→ C5 INFRA/COMPOSE/LOCAL RUNTIME COMPOSITION
→ C6 DEVELOPER TOOLING + ROOT COMMANDS
→ C7 FOUNDATION ASSURANCE + DOC COMMAND PARITY
→ C8 STABILIZE MANIFESTS → GENERATE ONE LOCKFILE → FROZEN INSTALL → FRESH FOUNDATION EXIT GATE
```

At every construction step:

```text
OUTPUT_HAS_PRODUCT/CAPABILITY_SEMANTICS?
  YES → STOP_LOCAL_FURNISHING → PRESERVE ONLY REQUIRED TECHNICAL/DEPLOYABLE IDENTITY → REMOVE/DEFER SEMANTIC CONTENT
  NO  → CONTINUE FOUNDATION CONSTRUCTION
```

Do not generate the canonical lockfile while known nonexistent/losing workspace dependencies remain. Do not use Foundation Construction as an all-backend/all-contract/all-app capability wave.

```text
FOUNDATION_CONSTRUCTION_EXIT_GATE=PASS
→ A2_ADVERSARIAL_STRUCTURAL_QUALIFICATION
→ STAGE_B_ONLY_IF_A2_PASS
```

## 5. Systemic refoundation traversal

```text
SELECT_DOMINANT_SYSTEMIC_ROOT
→ PROVE_COMPLETE_AFFECTED_CONE
→ SALVAGE_REQUIRED_TRUTH
→ BUILD/REFOUND_CANONICAL_WINNER
→ MIGRATE/CUT_OVER
→ DELETE_LOSERS_AND_COMPAT_RESIDUE
→ PRUNE
→ FIX_PREVENTION
→ VERIFY/FALSIFY
→ RE_PIN
→ RE_CENSUS
→ RE_RANK
```

## 6. Capability traversal

Prefer complete vertical semantic capability units:

```text
PRODUCT/SYSTEM MEANING
→ ACTOR/JOURNEY/STATE
→ DATA/STORAGE
→ CANONICAL WRITER/READER
→ DOMAIN OWNER
→ TRANSPORT/EVENT
→ CONTRACT
→ GENERATED BINDING
→ PRESENTATION
→ APP/HOST COMPOSITION
→ MATERIAL ACTION
→ MUTATION/OBSERVATION
→ PERSISTED/OBSERVABLE READBACK
→ ALL REQUIRED CONSUMERS
→ LOSER/RESIDUE DELETION
→ NEGATIVE SPACE
```

Horizontal all-backend/all-contract/all-frontend/all-app waves are forbidden when they leave material capabilities partially connected.

## 7. Automatic continuation

Every completed action can expose a higher or adjacent root:

```text
NEW_FINDING
→ CLASSIFY_IN_CURRENT_CAUSAL_GRAPH
→ PROMOTE_IF_HIGHER
→ RE_RANK
→ EXECUTE_HIGHEST_REQUIRED_FRONTIER
```

`ASK_NEXT=FORBIDDEN`, `ASK_CONTINUE=FORBIDDEN`, and `WAIT_FOR_CONFIRMATION=FORBIDDEN` when the next action is already authorized and derivable.

Human input is required only for a genuine stop state or unresolved Product/System decision.

## 8. Commit/checkpoint transition

A commit is a recoverable checkpoint, not a handoff.

After commit or unit closure:

```text
VERIFY_CURRENT_BRANCH_HEAD
→ RE_PIN
→ RE_CENSUS
→ RE_DIAGNOSE
→ RE_RANK
→ CONTINUE
```

## 9. Safe-checkpoint preemption

An open unit may be preempted only when a proven higher-leverage root is a prerequisite/superseding cause and preemption does not create mixed authority, unsafe partial cutover or stranded required truth.

## 10. No endless audit

Once the highest safe root is proven executable and ranking-changing unknowns are resolved:

```text
MUTATION_MANDATORY
ANALYSIS_ONLY_CONTINUATION=FORBIDDEN_UNLESS_IT_CAN_CHANGE_SAFETY_OR_DOMINANCE
```

## 11. Fixed-point traversal

```text
FRESH_FULL_REPOSITORY_RECENSUS_FROM_ZERO
→ FRESH_FALSIFICATION
→ EXECUTE_EXPOSED_OBLIGATION
→ REPEAT
```

Stop only when Level-4 fixed point is proven or a legitimate blocker prevents safe forward execution.

## 12. Clean-target reconstruction traversal

When a donor repository/ref is supplied, use this progression before normal target-only saturation:

```text
PIN_TARGET_HEAD
→ PIN_DONOR_REF
→ CURRENT_DONOR_TREE_CENSUS
→ MATERIAL_DONOR_HISTORY_CENSUS
→ SEMANTIC_ATOM_EXTRACTION/DISPOSITION
→ REQUIRED_TRUTH + JOURNEY + OWNERSHIP MATRICES
→ CANONICAL_TARGET_MODEL
→ FOUNDATION/TARGET BUILD
→ VERTICAL CAPABILITY RECONSTRUCTION
→ TARGET-INTERNAL MIGRATION/CUTOVER/DELETION
→ DONOR_NON_IMPORT NEGATIVE SPACE
→ DONOR_EXHAUSTION_GATE
→ FRESH TARGET FIXED-POINT RECENSUS
```

Do not wait for donor census to become globally complete before building an execution-ready independent root if its required donor cone is exhausted and no higher/root-changing unknown remains. Continue donor extraction in parallel read-only work while non-overlapping target reconstruction proceeds.

## 13. Parallel work-conserving scheduling

Maintain a frontier of proven work units. Execute independent mutation cones in parallel when safe; serialize overlapping writers and shared authority.

```text
READY_NON_OVERLAPPING_UNIT + AVAILABLE_WORKER → EXECUTE
OVERLAPPING_OWNER → QUEUE_BEHIND_CURRENT_WRITER
HIGHER_PROVEN_ROOT → PREEMPT_AT_SAFE_CHECKPOINT
COMPLETED_UNIT → RE_PIN/RE_CENSUS/RE_RANK
```

One integration authority reconciles all target head movement. No worker may force the shared branch back to its base SHA.

## 14. Cross-objective non-regression

Parallel or sequential work on one objective must not silently regress already proven capabilities/invariants that share an owner, contract, database, package, runtime or host.

Before integration of a material shared-owner change:

```text
IDENTIFY PREVIOUSLY CLOSED/PROVEN CONSUMER CONES
→ INVALIDATE ONLY AFFECTED PRIOR EVIDENCE
→ RUN REQUIRED CROSS-OBJECTIVE REGRESSION
→ INTEGRATE ONLY WHEN BOTH CURRENT OBJECTIVE AND PRESERVED INVARIANTS PASS
```

A faster local objective completion that shifts failure/cost/debt into another capability is not valid progress.
