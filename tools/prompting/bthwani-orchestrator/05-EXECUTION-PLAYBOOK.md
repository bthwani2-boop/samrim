# Execution State and Movement

OWNER_ROLE: PROCEDURAL_EXECUTION_STATE_MACHINE
AUTHORITY_ASSIGNED_BY: 00-ORCHESTRATOR.md
SELF_CERTIFICATION: FORBIDDEN
LOAD_TRIGGER: ENTRY_RECOVERY_MOVEMENT_CONTINUATION

## 1. Purpose

Own only runtime movement. Product meaning, scope, diagnosis, mutation and verification remain elsewhere.

## 2. Session entry / recovery

~~~text
PIN CURRENT HEAD
→ RECOVER AUTHORIZED SCOPE
→ RECOVER OPEN UNIT / CHECKPOINT
→ INVALIDATE STALE EVIDENCE
→ DERIVE RECOVERY FRONTIER
→ EXECUTE NEXT DERIVABLE ACTION
~~~

`NEW_CHAT != NEW_CAMPAIGN`; `COMMIT != UNIT_CLOSURE`.

## 3. Canonical runtime states

Exactly one state applies before terminal completion:

~~~text
RECOVERING
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
~~~

There is no `QUALIFYING_FOUNDATION`, A0/A1/A2 or Stage-B state.

## 4. Root execution movement

~~~text
02 EMITS HIGHEST SAFE AUTHORIZED ROOT
→ SELECTING
→ 03 EXECUTES MUTATION / CUTOVER / CLEANUP
→ VERIFYING
→ 04 EMITS VERIFICATION RESULT
→ RECENSUS
→ 02 REBUILDS CAUSAL FRONTIER
→ CONTINUE OR VERIFY AUTHORIZED-SCOPE FIXED POINT
~~~

If the selected root is a structural prerequisite, load `profiles/structural-substrate.md`; it remains the same cycle, not another stage machine.

## 5. Automatic continuation

~~~text
NEW MATERIAL FINDING
→ INCORPORATE INTO CAUSAL GRAPH
→ RE-DIAGNOSE / RE-RANK
→ EXECUTE HIGHEST REQUIRED AUTHORIZED ROOT
~~~

Do not ask for “next” or “continue” when the next action is already derivable and authorized.

An adjacent future Product slice is not authorized by continuation.

## 6. Commit/checkpoint transition

After commit or unit closure:

~~~text
VERIFY CURRENT HEAD
→ RE-PIN
→ REFRESH AFFECTED CENSUS
→ RE-DIAGNOSE
→ CONTINUE IF AUTHORIZED WORK REMAINS
→ OTHERWISE VERIFY AUTHORIZED-SCOPE FIXED POINT
~~~

## 7. Safe preemption

Preempt an open unit only for a proven higher prerequisite/superseding cause and only when no unsafe mixed authority, partial cutover or stranded required truth is created.

## 8. No endless analysis

Once a highest safe root is executable and ranking-changing unknowns are resolved:

~~~text
MUTATION REQUIRED
ANALYSIS-ONLY CONTINUATION FOR THE SAME ROOT = FORBIDDEN
~~~

## 9. Fixed-point traversal

For `ACTIVE_SLICE`:

~~~text
FRESH AFFECTED-CONE RECENSUS
→ FALSIFY OUTCOME / OWNER / READBACK / NEGATIVE SPACE
→ EXECUTE EXPOSED REQUIRED OBLIGATION
→ REPEAT
~~~

For explicit `FULL_TARGET`, apply the same cycle repository-wide.

Stop when the authorized-scope Level-4 fixed point is proven or a legitimate blocker prevents safe progress.

## 10. Clean-target reconstruction movement

When donor evidence is configured:

~~~text
PIN TARGET + DONOR REF
→ RESOLVE AUTHORIZED SCOPE
→ EXTRACT ONLY MATERIAL DONOR/HISTORY TRUTH FOR THAT SCOPE
→ BUILD CANONICAL TARGET
→ VERIFY / RECENSUS
→ CONTINUE NORMAL CAUSAL CYCLE
~~~

Repository-wide donor exhaustion is required only for explicit `FULL_TARGET`.

## 11. Parallel scheduling

Ask `01` for the safe parallel set. Schedule independent mutation cones. If a shared premise changes, return affected units to recovery/reconciliation before further mutation.

## 12. Cross-objective non-regression

When a shared owner/contract/database/package/runtime/host changes, invalidate only materially affected prior evidence and reprove affected previously closed outcomes before integration.

Local speed that shifts failure/debt into another required capability is not valid progress.
