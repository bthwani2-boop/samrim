# Execution Playbook

OWNER_ROLE: PROCEDURAL_EXECUTION_STATE_MACHINE
AUTHORITY_ASSIGNED_BY: 00-ORCHESTRATOR.md
SELF_CERTIFICATION: FORBIDDEN
LOAD_TRIGGER: WHEN_MULTI_STEP_CAMPAIGN_STATE_RECOVERY_OR_AUTOMATIC_CONTINUATION_APPLIES

## 1. Purpose

This file owns how the engine moves. It does not redefine Product, architecture, diagnosis, mutation or verification laws owned elsewhere.

## 1A. No-idle campaign movement

When authorized executable work exists, the engine has no idle/recommendation-only state.

~~~text
RECOVERING
DISCOVERING
DIAGNOSING
SELECTING
DEMOLISHING
REFOUNDING
MIGRATING
CUTTING_OVER
DELETING
PRUNING
VERIFYING
FALSIFYING
RECENSUS
LEGITIMATELY_BLOCKED
~~~

Forbidden while executable authorized work remains:

~~~text
IDLE
WAITING_FOR_NEXT
PAUSED_AFTER_COMMIT
PAUSED_AFTER_UNIT
PAUSED_AFTER_STAGE
RECOMMENDATIONS_ONLY_WHEN_EXECUTION_READY
ASKING_FOR_CONTINUATION_WHEN_DERIVABLE
~~~

A proven active-slice Level-4 fixed point is a normal terminal state; it is not idle and does not authorize future Product breadth.

## 2. Session entry

```text
PIN_CURRENT_HEAD
→ RECONSTRUCT_CURRENT_EXECUTION_STATE
→ RECONSTRUCT_AUTHORIZED_PRODUCT_SCOPE
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

## 6. Capability / explicit vertical-increment traversal

Prefer the smallest **explicitly authorized vertical semantic unit** that is causally correct. It may be a full capability or a named Product increment, but never a horizontal fragment.

```text
PRODUCT/SYSTEM MEANING + AUTHORIZED INCREMENT BOUNDARY
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

Horizontal all-backend/all-contract/all-frontend/all-app waves are forbidden when they leave the authorized semantic increment partially connected.

```text
EXPLICIT_VERTICAL_INCREMENT_WITH_COMPLETE_OWNER/DATA/CONTRACT/RUNTIME/READBACK=ALLOWED
ACCIDENTAL_PARTIAL_CAPABILITY_IMPLEMENTATION=FORBIDDEN
FULL_CAPABILITY_CLOSED_CLAIM_FROM_INCREMENT=FORBIDDEN
```

## 7. Automatic continuation

Every completed action can expose a higher or adjacent root:

```text
NEW_FINDING
→ CLASSIFY_IN_CURRENT_CAUSAL_GRAPH
→ PROMOTE_IF_HIGHER
→ RE_RANK
→ EXECUTE_HIGHEST_REQUIRED_FRONTIER
```

`ASK_NEXT=FORBIDDEN`, `ASK_CONTINUE=FORBIDDEN`, and `WAIT_FOR_CONFIRMATION=FORBIDDEN` when the next action is already authorized and derivable **inside the current Product scope**.

A deferred future capability is not already authorized. When no executable work remains in the current authorized scope, verify its Level-4 fixed point and terminate that invocation normally rather than activating new Product breadth.

Human input is required only for a genuine stop state, unresolved Product/System decision, or deliberate authorization of a new Product slice after the current one is complete.

## 8. Commit/checkpoint transition

A commit is a recoverable checkpoint, not a handoff.

After commit or unit closure:

```text
VERIFY_CURRENT_BRANCH_HEAD
→ RE_PIN
→ RE_CENSUS
→ RE_DIAGNOSE
→ RE_RANK
→ CONTINUE_IF_AUTHORIZED_WORK_REMAINS
→ OTHERWISE_VERIFY_AUTHORIZED_SCOPE_FIXED_POINT
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

For `ACTIVE_SLICE`:

```text
FRESH_AUTHORIZED_SCOPE_AND_AFFECTED_CONE_RECENSUS_FROM_ZERO
→ FRESH_FALSIFICATION
→ EXECUTE_EXPOSED_AUTHORIZED_OBLIGATION
→ REPEAT
```

For explicitly authorized `FULL_TARGET`:

```text
FRESH_FULL_REPOSITORY_RECENSUS_FROM_ZERO
→ FRESH_FALSIFICATION
→ EXECUTE_EXPOSED_OBLIGATION
→ REPEAT
```

Stop normally when the Level-4 fixed point for the authorized scope is proven, or earlier only when a legitimate blocker prevents safe forward execution.

## 12. Clean-target reconstruction traversal

When a donor repository/ref is supplied, use this progression before normal target-only saturation:

```text
PIN_TARGET_HEAD
→ PIN_DONOR_REF
→ RECONSTRUCT_AUTHORIZED_PRODUCT_SCOPE
→ CURRENT_DONOR_CONE_CENSUS_FOR_AUTHORIZED_SCOPE
→ MATERIAL_DONOR_HISTORY_CENSUS_FOR_AUTHORIZED_SCOPE
→ SEMANTIC_ATOM_EXTRACTION/DISPOSITION_FOR_SCOPE
→ REQUIRED_TRUTH + JOURNEY + OWNERSHIP MATRICES_FOR_SCOPE
→ CANONICAL_TARGET_MODEL
→ FOUNDATION/TARGET BUILD
→ AUTHORIZED_VERTICAL_RECONSTRUCTION
→ TARGET-INTERNAL MIGRATION/CUTOVER/DELETION
→ DONOR_NON_IMPORT NEGATIVE SPACE
→ AUTHORIZED_SCOPE_DONOR_CONE_GATE
→ FRESH AUTHORIZED-SCOPE FIXED-POINT RECENSUS
```

Do not wait for donor census to become globally complete before building or closing an execution-ready independent active slice if its required donor cone is exhausted and no higher/scope-changing unknown remains. Repository-wide donor exhaustion is reserved for `FULL_TARGET` completion. Read-only donor extraction may continue in parallel without expanding target mutation authority.

## 13. Parallel work-conserving scheduling

Maintain a frontier of proven **authorized** work units. Execute independent mutation cones in parallel when safe; serialize overlapping writers and shared authority. Future target slices outside current Product-breadth authority are not placed on the executable frontier.

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
