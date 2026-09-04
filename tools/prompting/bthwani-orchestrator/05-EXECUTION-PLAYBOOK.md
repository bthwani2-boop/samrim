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
