# Scope, Authority, Exact-Head and Recovery Rules

OWNER_ROLE: BRANCH_SCOPE_EXACT_HEAD_RECOVERY_STOP_STATES
AUTHORITY_ASSIGNED_BY: 00-ORCHESTRATOR.md
SELF_CERTIFICATION: FORBIDDEN

## 1. Invocation branch law

```text
MUTABLE_AUTHORITY = INVOCATION_BRANCH
```

Only the repository/branch supplied by the current invocation is mutable unless explicit human authorization expands scope.

Cross-branch merge, rebase, autosync, blind cherry-pick of historical structure and force-push are forbidden by default. A normal fast-forward update of the invocation branch is allowed when the expected head is still current.

## 2. Live tree vs forensic history

```text
CURRENT_HEAD = CANONICAL_PRESENT
GIT_HISTORY = FORENSIC_PAST
```

The live tree is not an archive.

```text
DO_NOT_KEEP_OBSOLETE_MATERIAL_FOR_POSSIBLE_FUTURE_REFERENCE
DO_NOT_MOVE_LOSERS_TO_ARCHIVE_LEGACY_HISTORY_BACKUP_UNUSED
DO_NOT_PRESERVE_DEAD_CODE_FOR_EXPLANATION
```

If previously committed material is needed later, recover it through commit history, parent blobs, diffs and historical refs.

```text
GIT_HISTORY_IS_THE_ARCHIVE
CURRENT_HEAD_IS_NOT_AN_ARCHIVE
```

Historical branches and old commits are forensic only. They may recover required truth or explain past behavior; they never impose topology or preservation rights.

## 3. Exact-head discipline

Before every coherent mutation batch:

```text
RESOLVE_REMOTE_CURRENT_BRANCH
→ RECORD_EXPECTED_CURRENT_BRANCH_SHA
→ DIAGNOSE_AGAINST_THAT_SHA
```

Immediately before write:

```text
RESOLVE_ACTUAL_CURRENT_BRANCH_SHA
```

If the head moved unexpectedly:

```text
STOP_THE_PENDING_WRITE_ONLY
→ INSPECT_DELTA
→ INVALIDATE_AFFECTED_EVIDENCE
→ RECONSTRUCT_ACTIVE_UNIT_STATE
→ RE_PIN
→ CONTINUE_FROM_THE_CORRECT_FRONTIER
```

Head movement does not authorize campaign idleness or restart from zero.

## 4. All-tracked hostile accounting

```text
TRACKED_ARTIFACT_DEFAULT=ACCOUNT_REQUIRED
CURRENT_CONTAINER_DEFAULT=DOES_NOT_SURVIVE_UNLESS_PROVEN_CANONICAL
```

Every tracked line/symbol/file/directory/package/workspace/service/database object/migration/contract/generated artifact/runtime registration/config/workflow/tool/doc/governance artifact/test/fixture/dependency/top-level surface is in scope.

`NONMATERIAL` requires positive proof. `KEEP_PROVEN` requires positive proof.

A surviving container must prove as applicable:

```text
REQUIRED
SEMANTICS_CORRECT
UNIQUE_COHESIVE_RESPONSIBILITY
CANONICAL_OWNER
CANONICAL_WRITER_OR_DERIVED_ROLE
CANONICAL_LOCATION
CANONICAL_BOUNDARY
NON_DUPLICATIVE
NON_SHADOW
NO_BETTER_CONSOLIDATION
NO_OBSOLETE_COMPATIBILITY
REQUIRED_BY_CANONICAL_BASELINE
```

## 5. Known-garbage survival law

```text
KNOWN_GARBAGE_SURVIVAL=FORBIDDEN
KNOWN_LOSING_CONTAINER_SURVIVAL=FORBIDDEN
KNOWN_DEAD_ARTIFACT_SURVIVAL=FORBIDDEN
KNOWN_DEFERRED_STRUCTURAL_GARBAGE=FORBIDDEN
```

A proven loser may remain temporarily only when it is an active, explicit dependency of truth extraction, migration or safe cutover.

```text
LAST_REQUIRED_DEPENDENCY_ENDS
→ DELETE_LOSER_NOW
```

The following are not treatments:

```text
CLASSIFIED
MAPPED
CLUSTERED
ASSIGNED_TO_ROOT
RENAMED
MOVED
MERGED
DOCUMENTED
DEPRECATED
```

## 6. Stage-B deferral isolation law

Structural garbage cannot be sent to Stage B merely because it is local or inconvenient.

Stage-B deferral requires positive proof of all applicable isolation conditions:

```text
CONTAINER_AND_ANCESTORS_ARE_CANONICAL
NO_CROSS_ROOT_AUTHORITY
NO_SHARED_MUTABLE_WRITER
NO_SHARED_RUNTIME_EFFECT
NO_REPOSITORY_TOPOLOGY_EFFECT
NO_MIGRATION_EPOCH_EFFECT
NO_CONTRACT_GENERATED_LINEAGE_EFFECT
NO_VERIFICATION_CONTAMINATION
NO_HIGH_FAN_IN_COMPENSATION
NO_PARENT_PRE_ROOT_CATASTROPHE
NO_MATERIAL_ROOT_TAX
NO_STRUCTURAL_DEMOLITION_TARGET
```

Without this proof, the obligation remains A0/A1 structural work.

## 7. Continuous engagement authority

Once mutation execution begins, the campaign becomes continuously engaged.

```text
CAMPAIGN_ENGAGED=TRUE
```

It remains true until either:

```text
LEVEL_4_FIXED_POINT=PASS
```

or a legitimate stop state makes safe forward execution impossible.

The campaign may not voluntarily return to idle between commits, units or stages.

```text
COMMIT != PAUSE
COMMIT != HANDOFF
COMMIT != PERMISSION_TO_STOP
UNIT_CLOSED != CAMPAIGN_PAUSE
STAGE_TRANSITION != CAMPAIGN_PAUSE
CHECKPOINT != NATURAL_STOP
```

## 8. Legal runtime states — no idle state

Before final completion the campaign must be in exactly one actionable state:

```text
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
```

Forbidden pre-completion states:

```text
IDLE
WAITING_FOR_NEXT
PAUSED_AFTER_COMMIT
PAUSED_AFTER_UNIT
PAUSED_AFTER_STAGE
RECOMMENDATIONS_ONLY
READY_BUT_NOT_EXECUTING
ASKING_FOR_NEXT_INSTRUCTION_WHEN_DERIVABLE
```

## 9. Mandatory ephemeral execution control state

During execution, maintain an ephemeral control state sufficient to force the next action:

```text
EXACT_HEAD_SHA
CAMPAIGN_ENGAGED
CURRENT_STAGE
CURRENT_UNIT
UNIT_STATE
RECOVERY_FRONTIER
NEXT_REQUIRED_ACTION
CURRENT_BLOCKER_OR_NONE
VALID_EVIDENCE_STATE
```

This is not a durable campaign ledger and must not become a second authority.

If `CURRENT_BLOCKER_OR_NONE=NONE`, `NEXT_REQUIRED_ACTION` must be executed rather than merely reported.

## 10. Recovery and open-unit priority

Recovery reconstructs from:

```text
LIVE_REMOTE_CURRENT_BRANCH
+ COMMIT_GRAPH
+ MATERIAL_DIFFS
+ CURRENT_REACHABILITY
+ NONSTALE_EVIDENCE
```

An open unit is classified as:

```text
OPEN_CRITICAL
OPEN_SAFE_CHECKPOINT
```

`OPEN_CRITICAL` includes partial authority, data, runtime or consumer cutover and normally resumes first.

`OPEN_SAFE_CHECKPOINT` has no dangerous mixed-authority state and may be preempted by a proven safely executable dominant pre-root catastrophe.

A checkpoint exists only so execution can recover if forcibly interrupted.

## 11. Automatic continuation after unit closure

When a unit closes:

```text
RE_PIN_CURRENT_BRANCH
→ RE_CENSUS_INVALIDATED_CONE
→ RE_DIAGNOSE
→ RE_RANK
→ SELECT_NEXT_HIGHEST_EXECUTABLE_UNIT
→ EXECUTE_IMMEDIATELY
```

Do not wait for `NEXT`, `CONTINUE`, confirmation or another human prompt when the next action is derivable and authorized.

If a newly exposed causal obligation is higher, absorb or promote it under the current campaign graph and continue.

## 12. Stop states

Only these may stop mutation:

```text
UNRESOLVED_IRREVERSIBLE_DATA_RISK
UNRESOLVED_EXTERNAL_LIVE_CONSUMER_CONTRACT
UNKNOWN_CURRENT_CURRENT_BRANCH_HEAD_MOVEMENT_NOT_YET_RECONCILED
MISSING_REQUIRED_HUMAN_PRODUCT_DECISION
MISSING_REQUIRED_SECRET_CREDENTIAL_ENVIRONMENT
BLOCKED_UNKNOWN_THAT_CAN_CHANGE_CANONICAL_TARGET_OR_SAFE_CUTOVER
EXTERNAL_PROVIDER_BLOCKER_THAT_PREVENTS_REQUIRED_PROOF_OR_CUTOVER
```

Large deletion, many callers, extensive migration, unfamiliar structure, session length, token pressure, commit boundaries, unit boundaries or stage boundaries are not stop states.

## 13. Compliance failure is a live defect

If execution behavior violates this package, do not merely note the violation.

```text
ORCHESTRATOR_COMPLIANCE_FAILURE
→ STOP_THE_WRONG_LOCAL_ACTION
→ RECONSTRUCT_CORRECT_CONTROL_STATE
→ RETURN_TO_REQUIRED_FRONTIER
→ EXECUTE_THE_MISSING_REQUIRED_ACTION
```

Examples:

```text
PAUSED_WITH_NO_BLOCKER
MAPPED_BUT_UNTREATED_GARBAGE
SKIPPED_LOSER_DELETION
STOPPED_AFTER_COMMIT
STOPPED_AFTER_UNIT
WAITED_FOR_NEXT_WITH_DERIVABLE_WORK
PATCHED_INSIDE_PROVEN_INVALID_CONTAINER
SELECTED_LOWER_UNIT_WITHOUT_ANCESTOR_EXONERATION
```

The orchestrator is operational law, not advisory prose.

## 14. Single mutation authority

```text
ACTIVE_EXECUTION_SESSIONS=1
PARALLEL_MUTATING_SESSIONS=FORBIDDEN
PARALLEL_EXECUTION_AGENTS=FORBIDDEN
MAX_ACTIVE_OVERLAPPING_MATERIAL_MUTATION_UNITS=1
```

Wide read-only evidence collection may run in parallel when it cannot create competing mutation authority.

```text
ONE_ACTIVE_UNIT != SMALL_UNIT
CONTEXT_WINDOW != ARCHITECTURE_BOUNDARY
```
