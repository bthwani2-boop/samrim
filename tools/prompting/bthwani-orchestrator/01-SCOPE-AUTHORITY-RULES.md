# Scope, Authority, Exact-Head and Recovery Rules

OWNER_ROLE: BRANCH_SCOPE_EXACT_HEAD_RECOVERY_STOP_STATES
AUTHORITY_ASSIGNED_BY: 00-ORCHESTRATOR.md
SELF_CERTIFICATION: FORBIDDEN
LOAD_TRIGGER: ENTRY_RESUME_SCOPE_AUTHORITY_BEFORE_BRANCH_OR_SCOPE_ACTION

## 1. Invocation branch law

```text
MUTABLE_AUTHORITY = INVOCATION_BRANCH
```

Only the repository/branch supplied by the current invocation is mutable unless explicit human authorization expands scope.

Cross-branch merge, rebase, autosync, blind cherry-pick of historical structure and force-push are forbidden by default. A normal fast-forward update of the invocation branch is allowed when the expected head is still current.

## 1A. Product-breadth authority

Execution breadth is supplied by invocation and is independent of `COMPLETION_LEVEL`.

```text
PRODUCT_BREADTH=ACTIVE_SLICE  # default when omitted
PRODUCT_BREADTH=FULL_TARGET   # explicit only

TARGET_PRODUCT_VISION != AUTHORIZED_PRODUCT_SCOPE
LEVEL_4 != AUTHORIZATION_TO_BUILD_ALL_FUTURE_FEATURES
```

For `ACTIVE_SLICE`, `ACTIVE_PRODUCT_SLICE` names the currently authorized semantic outcome/increment. The effective mutation scope may expand only to its real structural prerequisites, canonical owners/writers, affected data/contracts/runtime, required consumers/readbacks, security/financial invariants actually exercised, and regression repairs exposed by the change.

Unrelated future capabilities remain outside executable scope until explicitly activated. Their absence is not a blocker and must not be filled with speculative placeholders.

For `FULL_TARGET`, the complete current governed target is authorized and repository-wide fixed-point rules apply.

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
LEVEL_4_FIXED_POINT=PASS_FOR_AUTHORIZED_SCOPE
```

or a legitimate stop state makes safe forward execution impossible. A proven `ACTIVE_SLICE` fixed point is therefore a valid normal terminal state and does not authorize the next future Product slice.

The campaign may not voluntarily return to idle between commits, units or stages.

```text
COMMIT != PAUSE
COMMIT != HANDOFF
COMMIT != PERMISSION_TO_STOP
UNIT_CLOSED != CAMPAIGN_PAUSE
STAGE_TRANSITION != CAMPAIGN_PAUSE
CHECKPOINT != NATURAL_STOP
```

## 8. Runtime-state authorization boundary

`05-EXECUTION-PLAYBOOK.md` is the sole owner of the exact runtime-state vocabulary and no-idle movement state machine. This file does not maintain a second state list.

This owner decides only whether the current authorized scope may continue or whether a legitimate stop condition in §12 blocks safe forward execution. Any state emitted by `05` must remain inside the invocation's authorized Product scope and obey those stop conditions.


## 9. Mandatory ephemeral execution control state

During execution, maintain an ephemeral control state sufficient to force the next action:

```text
EXACT_HEAD_SHA
CAMPAIGN_ENGAGED
PRODUCT_BREADTH
ACTIVE_PRODUCT_SLICE
AUTHORIZED_PRODUCT_SCOPE
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

## 11. Continuation authorization after unit closure

When verification emits a closed-unit result, `05-EXECUTION-PLAYBOOK.md` owns the post-closure movement sequence. This file contributes only scope authorization:

```text
NEXT_FRONTIER_INSIDE_AUTHORIZED_PRODUCT_SCOPE → MAY_CONTINUE
CAUSAL_PREREQUISITE_OR_REGRESSION_INSIDE_AFFECTED_CONE → MAY_CONTINUE
ADJACENT_FUTURE_PRODUCT_SLICE → NOT_AUTHORIZED_BY_CONTINUATION
```

No human confirmation is required for derivable work already authorized by the invocation. Activating a new future Product slice still requires explicit authorization.


## 12. Stop states

Only these may stop mutation:

```text
UNRESOLVED_IRREVERSIBLE_DATA_RISK
UNRESOLVED_EXTERNAL_LIVE_CONSUMER_CONTRACT
UNKNOWN_CURRENT_BRANCH_HEAD_MOVEMENT_NOT_YET_RECONCILED
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

## 14. Maximum-safe parallel mutation authority

Parallelism is controlled by semantic mutation cones, not by a blanket single-agent prohibition.

```text
NON_OVERLAPPING_MUTATION_CONES → PARALLEL_ALLOWED
OVERLAPPING_AUTHORITY → SERIALIZE
SHARED_DB/CONTRACT/RUNTIME/EXPORT_OWNER → ONE_ACTIVE_WRITER
ONE_INTEGRATION_AUTHORITY_PER_TARGET_BRANCH
EACH_MUTATING_UNIT → EXACT_BASE_SHA
FOREIGN_DELTA → RECONCILE_BEFORE_WRITE_OR_INTEGRATION
BLIND_MERGE/BLIND_CHERRY_PICK/FORCE_UPDATE → FORBIDDEN
```

Read-only evidence collection may run at maximum safe parallelism. Mutating work may also run in parallel only when affected cones are proven non-overlapping and integration ownership is explicit.

```text
PARALLELISM_MUST_NOT_CREATE_SECOND_WRITERS
PARALLELISM_MUST_NOT_CREATE_PARTIAL_CUTOVER
PARALLELISM_MUST_NOT_INVALIDATE_UNRECONCILED_EVIDENCE
MAX_ACTIVE_OVERLAPPING_MATERIAL_MUTATION_UNITS=1
ONE_ACTIVE_UNIT != SMALL_UNIT
CONTEXT_WINDOW != ARCHITECTURE_BOUNDARY
```

## 15. Dual-repository authority for clean-target reconstruction

When a donor is supplied:

```text
TARGET_REPOSITORY/BRANCH = MUTATION_AUTHORITY
DONOR_REPOSITORY/REF = READ_ONLY_FORENSIC_AUTHORITY_ONLY
DONOR_WRITES = FORBIDDEN
TARGET_FORCE_PUSH = FORBIDDEN
TARGET_FAST_FORWARD_WRITE = ALLOWED_ONLY_FROM_EXPECTED_HEAD
```

Evidence precedence is class-specific: current human Product/System decisions and durable target Governance own intended meaning; executable target state owns current implementation truth; donor current/history provides candidate value and forensic evidence only.

The donor corpus must include material current-tree and historical evidence when history can contain truth removed by later simplification. A later donor commit does not automatically supersede an earlier semantic atom unless the replacement or rejection is proven.

## 16. Research, evidence acquisition and foreign-delta discipline

A material unknown must be classified before it can block or be ignored:

```text
DERIVABLE_FROM_TARGET
DERIVABLE_FROM_DONOR_CURRENT
DERIVABLE_FROM_DONOR_HISTORY
REQUIRES_EXTERNAL_TECHNICAL_RESEARCH
REQUIRES_HUMAN_PRODUCT_DECISION
```

External research may resolve technical/standard/provider facts but may not invent BThwani Product truth.

For every material proof claim record conceptually:

```text
CAPABILITY_OR_CLAIM
→ REQUIRED_EVIDENCE
→ ACQUISITION_PATH
→ PROOF_LIMIT
```

If target head moves, classify the foreign delta, invalidate only affected evidence, re-pin and continue. Never discard concurrent work merely to restore a previous expected head.

## 17. Objective and focus routing

The target vision remains project-wide, but mutation authority is bounded by the invocation's Product breadth. An active slice is not permission to ignore higher prerequisites or regressions, and full target vision is not permission to auto-expand an active slice.

```text
PROJECT_FRAME = FULL BTHWANI TARGET VISION
PRODUCT_BREADTH = ACTIVE_SLICE | FULL_TARGET
ACTIVE_PRODUCT_SLICE = CURRENT AUTHORIZED SEMANTIC INCREMENT WHEN PRODUCT_BREADTH=ACTIVE_SLICE
OBJECTIVE = CURRENT SEMANTIC OUTCOME / NEXT DERIVABLE ROOT INSIDE AUTHORIZED PRODUCT SCOPE
PRIMARY_FOCUS = LENS PRIORITY, NOT SCOPE EXCLUSION
EFFECTIVE_SCOPE = AUTHORIZED PRODUCT SLICE + COMPLETE AFFECTED CONE + REQUIRED HIGHER PREREQUISITES + REQUIRED CONSUMERS + AFFECTED PRIOR REGRESSION
```

`OBJECTIVE=AUTO/NEXT` means derive the next highest executable frontier **inside the current authorized Product scope** from current evidence. It never activates the next deferred Product capability by itself. A named objective may prioritize a capability/root but cannot exclude a higher prerequisite, shared writer, contract/data/runtime effect, required surface, security/financial invariant or regression cone that the authorized slice materially requires.

`PRIMARY_FOCUS=AUTO` loads every materially relevant focus owner. A named focus only orders diagnostic attention; it never permits skipping another affected focus.

## 18. Research mode routing

```text
RESEARCH=AUTO
→ derive from target/donor first
→ use external research only when a material technical/standard/provider fact cannot be resolved internally and external access is available

RESEARCH=INTERNAL_ONLY
→ target + donor current/history only
→ unresolved external technical fact remains explicit proof limit/blocker when material

RESEARCH=EXTERNAL_ALLOWED
→ external primary/official sources may be used for technical/standard/provider facts
```

External research cannot create BThwani Product truth, override a current human Product decision, or justify adopting a dependency/provider without the applicable target/governance gate.
