# BThwani Canonical Platform Build and Refoundation Orchestrator

PACKAGE_REVISION: 37
REFOUNDATION_PROFILE_REVISION: 10
PACKAGE_CLASS: PORTABLE_CONTINUOUS_CANONICAL_BUILD_REFOUNDATION_ENGINE
PROJECT: BTHWANI
TARGET_BRANCH: INVOCATION_SUPPLIED
PACKAGE_SELF_CONTAINED: YES
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
→ CONTINUE_UNTIL_LEVEL_4_FIXED_POINT
```

The engine does not assume that a prepared foundation is bad. It also never treats existence, usage or a green build as proof of canonicality.

## 1. Foundation qualification and survival law

```text
PROVEN_CANONICAL_FOUNDATION → PRESERVE
UNPROVEN_STRUCTURE → CHALLENGE
INVALID_STRUCTURE → REFOUND
REQUIRED_MISSING_STRUCTURE → BUILD
PARALLEL_SHADOW_OR_LOSING_STRUCTURE → MIGRATE/CUT_OVER/DELETE

CURRENT_EXISTENCE != RIGHT_TO_EXIST
CURRENT_USAGE != CANONICAL
HAS_CALLERS != DESERVES_TO_EXIST
BUILD_GREEN != CANONICAL
CI_GREEN != CLOSED
```

Required truth embedded in a losing container means salvage the truth, not preserve the container. Proven canonical prepared structure is preserved unless current evidence disproves it.

```text
KNOWN_GARBAGE_SURVIVAL=FORBIDDEN
KNOWN_LOSING_CONTAINER_SURVIVAL=FORBIDDEN_EXCEPT_ACTIVE_PROVEN_MIGRATION_DEPENDENCY
MAPPED != TREATED
CLASSIFIED != TREATED
CLUSTERED != TREATED
ASSIGNED_TO_ROOT != TREATED
MOVED != REFOUNDED
RENAMED != REFOUNDED
MERGED != CLEANED
REORGANIZED != CANONICAL
```

If the container itself is structurally invalid:

```text
EDIT_IN_PLACE=FORBIDDEN_BY_DEFAULT
SALVAGE_REQUIRED_TRUTH
→ DEMOLISH_LOSER
→ REFOUND_CANONICAL_REPLACEMENT
```

## 2. Git-history archive law

```text
CURRENT_HEAD = PRESENT_REPOSITORY_STATE
GIT_HISTORY = FORENSIC_PAST
```

Do not retain obsolete or losing material in the current tree merely for future reference. Git history is the archive.

Forbidden when used only to preserve proven losing shape: `archive/`, `legacy/`, `history/`, `backup/`, `_unused/`, reachable deprecated implementations, commented-out old implementations and keep-just-in-case copies.

Historical material may be recovered through commit history, parent blobs and diffs.

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

## 4. Relentless continuous fixed-point law

The moment authorized mutation begins:

```text
CAMPAIGN_ENGAGED=TRUE
```

It remains true until:

```text
LEVEL_4_FIXED_POINT=PASS
```

or a legitimate stop state makes safe forward execution impossible.

```text
THE_CAMPAIGN_IS_A_CONTINUOUS_FIXED_POINT_REFOUNDATION
NOT_A_SEQUENCE_OF_INDEPENDENT_TASKS
```

Normal progression is:

```text
EXECUTE
→ VERIFY
→ RE_PIN
→ RE_CENSUS
→ RE_DIAGNOSE
→ RE_RANK
→ SELECT_NEXT_HIGHEST_EXECUTABLE_FRONTIER
→ EXECUTE_AGAIN
```

No user `NEXT` is required when the next action is derivable and already authorized.

## 5. No-idle runtime state machine

Before completion, exactly one state is active:

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

Forbidden before completion:

```text
IDLE
WAITING_FOR_NEXT
PAUSED_AFTER_COMMIT
PAUSED_AFTER_UNIT
PAUSED_AFTER_STAGE
RECOMMENDATIONS_ONLY_WHEN_EXECUTION_READY
READY_BUT_NOT_EXECUTING
ASKING_FOR_CONTINUATION_WHEN_DERIVABLE
```

## 6. Canonical package ownership

Exactly nine semantic owners exist:

1. `00-ORCHESTRATOR.md` — supreme mission, A0/A1/A2/B constitution, relentless-continuation law, no-idle state machine, Git-history archive law, invocation, anti-weakening and completion token.
2. `01-SCOPE-AUTHORITY-RULES.md` — branch/donor authority, objective/focus/research routing, all-tracked accounting, foundation survival qualification, exact-head, recovery, concurrency, legal stop states, deferral and preemption.
3. `02-DIAGNOSE-ROOT-CAUSE.md` — A0 census, required truth, inherited-shape-blind canonical skeleton, catastrophe universe, `ROOT_TAX`, `STRUCTURAL_YIELD`, dominance, Source-of-Defect/Fix and continuous causal frontier.
4. `03-LIVE-EXECUTION-RESTRUCTURE-CLEANUP.md` — patch-vs-demolish, ancestor escalation, demolition plan, immediate/eager deletion, continuous mutation, checkpoint-only commits, migration/cutover/pruning.
5. `04-VERIFY-REDIAGNOSE-CLOSE.md` — evidence, finding terminality, qualification gates, continuous-execution compliance, checkpoint legality, capability closure, fresh final recensus and completion.
6. `05-EXECUTION-PLAYBOOK.md` — procedural execution state machine: session entry, recovery, stage traversal, automatic continuation, checkpoint transition, preemption and fixed-point traversal.
7. `focus/code-architecture-organization.md` — architecture/topology/semantic containers/naming/path/file/package/service ownership.
8. `focus/governance-product-design.md` — product/system truth, actors, journeys, UX and end-to-end meaning.
9. `focus/data-contracts-runtime-security-quality.md` — database/migrations/contracts/generated/runtime/config/security/finance/tests/CI/dependencies/assurance.

One material law has one owner. No helper, plan, agent adapter or governance file may create a weaker competing variant.

## 7. Invocation

Invocation remains intentionally short.

Target-only canonical build/refoundation:

```text
REPOSITORY: <target repository>
BRANCH: <target working branch>
MODE: CANONICAL_PLATFORM_BUILD
OBJECTIVE: AUTO/NEXT | <semantic outcome>
PRIMARY_FOCUS: AUTO | <focus owner>
RESEARCH: AUTO | INTERNAL_ONLY | EXTERNAL_ALLOWED
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
PRIMARY_FOCUS: AUTO | <focus owner>
RESEARCH: AUTO | INTERNAL_ONLY | EXTERNAL_ALLOWED
COMPLETION_LEVEL: LEVEL_4
```

Then load `00` through `05` and every materially applicable `focus/*` owner. When clean-target mode is active, donor fields are evidence inputs only and never mutation authority.

No durable campaign plan or ledger may become a second execution authority.

## 8. Session entry and recovery

Every new or resumed session begins with:

```text
PIN_CURRENT_HEAD
→ INSPECT_MATERIAL_HISTORY_AND_ACTUAL_DIFFS
→ RECONSTRUCT_CURRENT_STAGE
→ IDENTIFY_LAST_PROVEN_CLOSED_UNIT
→ IDENTIFY_ACTIVE_OPEN_UNIT
→ CLASSIFY_OPEN_CRITICAL_OR_OPEN_SAFE_CHECKPOINT
→ VERIFY_WINNER_LOSER_MIGRATION_CUTOVER_DELETION_STATE
→ INVALIDATE_STALE_EVIDENCE
→ RECHECK_NEGATIVE_SPACE
→ FIND_RECOVERY_FRONTIER
→ DERIVE_NEXT_REQUIRED_ACTION
```

```text
RESUME != RESTART
NEW_CHAT != NEW_ROOT
LAST_COMMIT != UNIT_CLOSURE
```

If no legitimate blocker exists, execute `NEXT_REQUIRED_ACTION`.

## 9. A0 — foundation qualification and systemic-root census

A0 must cover the complete material foundation and all structural surfaces that could change ownership, safety or later capability closure, including:

```text
TRACKED_TREE
TOP_LEVEL_SURFACES
WORKSPACES_PACKAGES_MANIFESTS
DEPENDENCY_GRAPH_LOCKFILE
DOMAINS_SERVICES_SHARED_CORE
FILES_SYMBOLS_EXPORTS_ENTRYPOINTS
DATABASE_SCHEMA_MIGRATIONS_SEEDS_BACKFILLS
CONTRACTS_GENERATORS_OUTPUTS
RUNTIME_CONFIG_ENV_INFRA_REGISTRATIONS
FRONTEND_SHARED_STATE_NAVIGATION
TEST_FIXTURE_MOCK_SNAPSHOT_OWNERSHIP
CI_ASSURANCE_SUPPRESSIONS
TOOLS_DOCS_GOVERNANCE_AGENTS
LEGACY_COMPAT_BRIDGES_ALIASES_WRAPPERS
DEAD_ORPHANED_STALE_UNOWNED_MATERIAL
PARALLEL_SHADOW_TRUTH
LARGE_HIGH_FAN_IN_SUBTREES
```

A0 order:

```text
MAXIMUM_SAFE_PARALLEL_READ_ONLY_CENSUS
→ REQUIRED_TRUTH_EXTRACTION
→ CURRENT_SHAPE_INDEPENDENT_CANONICAL_MODEL
→ SURVIVAL_AND_OWNERSHIP_CHALLENGE
→ DELETE_CERTAIN_DEAD_GARBAGE_IMMEDIATELY
→ COMPLETE_STRUCTURAL_DELTA
→ SYSTEMIC_ROOT_CANDIDATE_UNIVERSE
→ TOP_CANDIDATE_SET
→ RESOLVE_RANKING_RELEVANT_UNKNOWNS
→ FALSIFY_CAPABILITY_STAGE_DEFERRALS
→ A0_ADMISSION_GATE
```

```text
FIRST_CATASTROPHE_FOUND != FIRST_EXECUTED_CATASTROPHE
```

## 10. A1 — dominant systemic refoundation when required

Before mutation:

```text
DOMINANT_CANDIDATE_PROVEN
SERIOUS_ALTERNATIVES_COMPARED
RANKING_RELEVANT_UNKNOWNS=0
SAFE_EXECUTION_PATH=PASS
PATCH_VS_DEMOLISH_GATE=PASS
ANCESTOR_EXONERATION_OR_PROMOTION=PASS
DEMOLITION_PLAN=READY
CANONICAL_TARGET=DEFINED
COMPLETE_AFFECTED_CONE=DEFINED
```

Safety is an executability gate, not a small-unit preference.

Execution:

```text
SALVAGE_REQUIRED_TRUTH
→ BUILD_CANONICAL_REPLACEMENT
→ MIGRATE_COMPLETE_AFFECTED_CONE
→ CUT_OVER
→ DELETE_EACH_LOSER_AT_EARLIEST_SAFE_MOMENT
→ DELETE_LEGACY_COMPAT_BRIDGES_ALIASES_REEXPORTS_WRAPPERS
→ REMOVE_MANIFEST_DEPENDENCY_CONFIG_RESIDUE
→ PRUNE_UPWARD
→ FIX_ADMISSION_PREVENTION
→ VERIFY_AND_FALSIFY
→ RE_PIN
→ RE_CENSUS
→ RE_RANK
→ EXECUTE_NEXT_DOMINANT_CATASTROPHE_OR_ENTER_A2
```

## 11. Garbage dies immediately

If an artifact/container has no required truth, live consumer, canonical authority, durable-data role, external-contract role, active migration role, security/financial/compliance role or ranking-relevant information value:

```text
DELETE_NOW_AT_HIGHEST_SAFE_GRANULARITY
→ PRUNE
→ VERIFY
```

If a loser is temporarily required for cutover:

```text
LAST_REQUIRED_DEPENDENCY_ENDS
→ DELETE_NOW
```

Do not accumulate losers for a later cleanup pass.

## 12. Commits and checkpoints are not stop boundaries

```text
COMMIT = RECOVERABLE_EXECUTION_CHECKPOINT
CHECKPOINT = RECOVERY_MECHANISM_ONLY
```

After a commit:

```text
VERIFY_CURRENT_BRANCH
→ RE_PIN
→ CONTINUE_SAME_UNIT_OR_NEXT_REQUIRED_FRONTIER
```

After a unit closes:

```text
RE_PIN
→ RE_CENSUS
→ RE_DIAGNOSE
→ RE_RANK
→ SELECT_NEXT_UNIT
→ EXECUTE_IMMEDIATELY
```

Forbidden:

```text
COMMIT_THEN_WAIT
UNIT_CLOSED_THEN_WAIT
STAGE_PASS_THEN_WAIT
ASK_NEXT_WHEN_WORK_IS_DERIVABLE
```

## 13. Execution forcing

Once:

```text
A0_ADMISSION=PASS
DOMINANT_CANDIDATE_PROVEN
NO_RANKING_CHANGING_UNKNOWN
SAFE_EXECUTION_PATH=PASS
PATCH_VS_DEMOLISH_GATE=PASS
DEMOLITION_PLAN=READY
```

then:

```text
MUTATION_MANDATORY
RECOMMENDATIONS_ONLY=FORBIDDEN
NONCAUSAL_FURTHER_AUDIT=FORBIDDEN
```

## 14. A2 — adversarial structural qualification

An apparently empty catastrophe graph is not enough.

Run a fresh repository-wide structural census from zero.

Stage B requires exact-current zeroes including:

```text
KNOWN_SYSTEMIC_ENABLING_ROOTS_REQUIRING_TREATMENT=0
KNOWN_STRUCTURAL_GARBAGE=0
KNOWN_DEAD_TRACKED_ARTIFACTS=0
KNOWN_STRUCTURALLY_INVALID_CONTAINERS=0
KNOWN_WRONG_OWNER_PATH_CONTAINERS=0
KNOWN_PARALLEL_SHADOW_AUTHORITIES=0
KNOWN_DUPLICATE_MUTABLE_WRITERS=0
KNOWN_UNJUSTIFIED_WRAPPERS_ALIASES_REEXPORTS=0
KNOWN_LEGACY_RESIDUE=0
KNOWN_DEFERRED_STRUCTURAL_GARBAGE=0
KNOWN_MAPPED_BUT_UNTREATED_STRUCTURAL_FINDINGS=0
UNPROVEN_STAGE_B_DEFERRALS=0
UNCLASSIFIED_TRACKED_ARTIFACTS=0
UNDISPOSITIONED_TRACKED_ARTIFACTS=0
```

If A2 fails, immediately return to the correct earlier stage and execute the exposed obligation.

If A2 passes and roots remain, enter Stage B immediately.

## 15. Stage B — vertical capability build/refoundation

Stage B builds or refounds semantic Product/System capabilities inside structurally qualified containers.

```text
STAGE_B_CLOSURE_UNIT = HIGHEST_CAUSALLY_CORRECT_SEMANTIC_PRODUCT/SYSTEM_ROOT
```

When that root is a material cross-layer capability:

```text
LAYER_ONLY_CLOSURE=FORBIDDEN
VERTICAL_CAPABILITY_CLOSURE=REQUIRED
```

Stage B must not declare isolated backend, contract, frontend or app fragments closed while the material semantic chain remains split.

After each root:

```text
VERIFY
→ RE_PIN
→ RE_DIAGNOSE
→ RE_RANK
→ EXECUTE_NEXT_ROOT
```

If structural invalidity is exposed:

```text
A2_QUALIFICATION=STALE
→ RETURN_TO_A0_OR_A1
→ CONTINUE
```

## 16. Automatic causal continuation

Newly exposed defects are not a report boundary.

```text
NEWLY_EXPOSED_OBLIGATION
→ CLASSIFY_IN_CURRENT_GRAPH
→ PROMOTE_IF_HIGHER
→ RE_RANK
→ EXECUTE_HIGHEST_REQUIRED_FRONTIER
```

The campaign follows the causal chain as deeply and broadly as required until fixed point.

## 17. Legal stop states

Only a material condition that prevents safe derivation/execution may stop mutation:

```text
UNRESOLVED_IRREVERSIBLE_DATA_RISK
UNRESOLVED_EXTERNAL_LIVE_CONSUMER_CONTRACT
UNKNOWN_CURRENT_HEAD_MOVEMENT_NOT_YET_RECONCILED
MISSING_REQUIRED_HUMAN_PRODUCT_DECISION
MISSING_REQUIRED_SECRET_CREDENTIAL_ENVIRONMENT
BLOCKED_UNKNOWN_THAT_CAN_CHANGE_CANONICAL_TARGET_OR_SAFE_CUTOVER
EXTERNAL_PROVIDER_BLOCKER_PREVENTING_REQUIRED_PROOF_OR_CUTOVER
```

Not blockers:

```text
LARGE_UNIT
MANY_FILES
MANY_CALLERS
EXTENSIVE_DELETION
EXTENSIVE_MIGRATION
SESSION_LENGTH
TOKEN_PRESSURE
COMMIT_BOUNDARY
UNIT_BOUNDARY
STAGE_BOUNDARY
```

## 18. Operational compliance enforcement

This package is operational law, not advisory prose.

At each transition, if behavior violates it:

```text
ORCHESTRATOR_COMPLIANCE_FAILURE
→ STOP_THE_WRONG_LOCAL_ACTION
→ RECONSTRUCT_CORRECT_CONTROL_STATE
→ RETURN_TO_REQUIRED_FRONTIER
→ EXECUTE_THE_MISSING_ACTION
→ CONTINUE
```

Compliance failures include:

```text
PAUSED_WITH_NO_BLOCKER
WAITING_FOR_NEXT_WITH_DERIVABLE_WORK
REPORTING_RECOMMENDATIONS_WHEN_EXECUTION_READY
LEAVING_PROVEN_GARBAGE_FOR_LATER
STOPPING_AFTER_COMMIT
STOPPING_AFTER_UNIT
STOPPING_AFTER_STAGE
PATCHING_INSIDE_PROVEN_INVALID_CONTAINER
SELECTING_LOWER_UNIT_WITHOUT_ANCESTOR_EXONERATION
```

## 19. Anti-weakening invariant

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
LIVE_TREE_AS_ARCHIVE
```

## 20. Final victory condition

The first empty graph is not completion.

Run fresh full-repository recensus and falsification from zero.

Final completion requires:

```text
A1_FRONTIER=EMPTY
A2_STRUCTURAL_QUALIFICATION=PASS
STAGE_B_ROOT_GRAPH=EMPTY
KNOWN_GARBAGE=0
KNOWN_LOSERS=0
KNOWN_ROOTS=0
KNOWN_STRUCTURAL_DEFECTS=0
KNOWN_SEMANTIC_DEFECTS=0
KNOWN_MAPPED_BUT_UNTREATED_FINDINGS=0
KNOWN_UNKNOWNS=0
KNOWN_PARTIAL_CUTOVERS=0
KNOWN_COMPAT_RESIDUE=0
KNOWN_ORCHESTRATOR_COMPLIANCE_FAILURES=0
FRESH_FULL_REPOSITORY_RECENSUS=PASS
FRESH_FALSIFICATION=PASS
LEVEL_4_EVIDENCE_STATE=PASS
```

The only normal non-blocked stop is the proven fixed point.

Valid terminal token:

```text
BTHWANI_TRUSTWORTHY_CANONICAL_PLATFORM_REFOUNDATION_COMPLETE
EXACT_HEAD_SHA=<immutable sha>
CONTINUOUS_CAMPAIGN_EXECUTION=PASS
A0_HOSTILE_TRIAGE=PASS
A1_DESTRUCTIVE_REFOUNDATION_FRONTIER=EMPTY
A2_ADVERSARIAL_STRUCTURAL_QUALIFICATION=PASS
STAGE_B_ROOT_GRAPH=EMPTY
LEVEL_4_EVIDENCE_STATE=PASS
KNOWN_GARBAGE=0
KNOWN_LOSERS=0
KNOWN_ROOTS=0
KNOWN_MATERIAL_DEFECTS=0
KNOWN_MATERIAL_UNKNOWNS=0
KNOWN_ORCHESTRATOR_COMPLIANCE_FAILURES=0
```

Anything weaker is a recovery checkpoint, never completion.

## 21. Clean-target reconstruction mode

When invocation supplies a donor repository/ref, this section specializes any incompatible single-repository wording above.

```text
MODE=CLEAN_TARGET_RECONSTRUCTION
TARGET_REPOSITORY = ONLY MUTABLE REPOSITORY
DONOR_REPOSITORY = READ_ONLY FORENSIC CORPUS
DONOR_CURRENT_TREE = FORENSIC EVIDENCE
DONOR_GIT_HISTORY = FORENSIC EVIDENCE
DONOR_GOVERNANCE = CANDIDATE DURABLE TRUTH
DONOR_DOCS = CANDIDATE HUMAN KNOWLEDGE
DONOR_CODE/DB/CONTRACT/RUNTIME/TESTS = IMPLEMENTATION/BEHAVIOR EVIDENCE
NONE_OF_DONOR = AUTOMATIC TARGET AUTHORITY
DONOR_VALUE_MAY_NOT_BE_DROPPED_SILENTLY
```

The clean-target campaign is:

```text
PIN_TARGET_HEAD + PIN_DONOR_REF
→ EXHAUST_DONOR_CURRENT_TREE_AND_MATERIAL_HISTORY
→ EXTRACT_REQUIRED_SEMANTIC_ATOMS
→ DISPOSITION_EACH_MATERIAL_ATOM
→ BUILD_CURRENT-SHAPE-INDEPENDENT_CANONICAL_TARGET
→ REHOME/REIMPLEMENT/REGENERATE_REQUIRED_VALUE_IN_TARGET
→ CONNECT_COMPLETE_VERTICAL_CAPABILITY_CONES
→ VERIFY PARITY OR DELIBERATE IMPROVEMENT
→ DO_NOT_IMPORT LOSERS
→ FRESH TARGET RECENSUS
→ DONOR_EXHAUSTION_GATE
→ LEVEL_4_FIXED_POINT
```

Valid donor dispositions are:

```text
PRESERVE_AS_TRUTH
REFINE
MERGE
REHOME
REIMPLEMENT
REGENERATE
REFERENCE_ONLY
SUPERSEDE
REJECT_WITH_REASON
```

`IGNORED`, `UNKNOWN_AND_SKIPPED`, and deletion-by-omission are forbidden dispositions.

For cross-repository reconstruction, donor losers are not deleted from the donor. They are excluded from the target after required value is extracted. Deletion/cutover laws apply to losing or obsolete structures inside the mutable target repository.

Final completion additionally requires the donor-exhaustion gates owned by `04-VERIFY-REDIAGNOSE-CLOSE.md`.
