# Continuous Build, Refoundation, Cutover and Cleanup

OWNER_ROLE: DEMOLITION_REFOUNDATION_MIGRATION_CUTOVER_DELETION
AUTHORITY_ASSIGNED_BY: 00-ORCHESTRATOR.md
SELF_CERTIFICATION: FORBIDDEN
LOAD_TRIGGER: BEFORE_MUTATION_REFOUNDATION_MIGRATION_CUTOVER_OR_DELETION

## 1. Execution law

```text
ROOT_CORRECTNESS > DIFF_SIZE
CANONICAL_BOUNDARY > CURRENT_BOUNDARY
COMPLETE_CUTOVER > COMPATIBILITY_LAYER
DELETE_LOSER > KEEP_IN_SYNC
REFOUNDATION > PATCH_STACK
DEMOLITION_OF_INVALID_CONTAINER > IN_PLACE_BEAUTIFICATION
DOMINANT_BASELINE_REFOUNDATION > LOWER_CONVENIENT_WORK
CONTINUOUS_CLOSURE > DISCONNECTED_TASK_EXECUTION
```

Once a safe executable frontier is selected, execute through its complete causal cone.

## 2. Invalid-container presumption

When the container itself is proven structurally invalid:

```text
EDIT_IN_PLACE=FORBIDDEN_BY_DEFAULT
REFOUND=REQUIRED
```

Invalidity includes as applicable:

```text
WRONG_OWNER
WRONG_PATH_OR_BOUNDARY
DUPLICATE_RESPONSIBILITY
MIXED_RESPONSIBILITY_WITH_NO_CANONICAL_BOUNDARY
PASS_THROUGH_ONLY
COMPATIBILITY_ONLY
HISTORICAL_COMPENSATION
SHADOW_OR_PARALLEL_AUTHORITY
LARGE_OBSOLETE_SUBTREE
PREDOMINANTLY_NONCANONICAL_SURFACE
BAD_PACKAGE_WORKSPACE_TOPOLOGY
BAD_SERVICE_DOMAIN_BOUNDARY
BAD_SHARED_CORE_COMMON_AUTHORITY
BAD_MIGRATION_EPOCH
BAD_CONTRACT_GENERATED_LINEAGE
BAD_RUNTIME_CONFIG_INFRA_AUTHORITY
BAD_ASSURANCE_CONTROL_PLANE
```

Mandatory treatment:

```text
SALVAGE_REQUIRED_TRUTH
→ DESIGN_CANONICAL_REPLACEMENT_FROM_FIRST_PRINCIPLES
→ BUILD_MINIMUM_NECESSARY_CANONICAL_CONTAINER_SET
→ MIGRATE_REQUIRED_VALUE_DATA_CONTRACTS_CONSUMERS
→ CUT_OVER
→ DELETE_LOSER_AT_HIGHEST_SAFE_GRANULARITY
→ DELETE_DESCENDANT_RESIDUE
→ PRUNE_PARENTS
→ VERIFY_ZERO_OLD_REACHABILITY
```

## 3. Patch-vs-Demolish Gate

Before nontrivial write inside inherited structure prove whether the source of defect is:

```text
LOCAL_SEMANTIC_DETAIL
FILE
DIRECTORY
PACKAGE_OR_WORKSPACE
SERVICE_OR_BOUNDARY
DOMAIN
TOP_LEVEL_SURFACE
REPOSITORY_TOPOLOGY
```

Patch is allowed only if:

```text
PATCH_WILL_NOT_PRESERVE_INVALID_CONTAINER
PATCH_WILL_NOT_CREATE_WRAPPER_ALIAS_REEXPORT_KEEP_IN_SYNC_DEBT
PATCH_WILL_NOT_MOVE_GARBAGE_WITHOUT_ELIMINATING_RESPONSIBILITY
PATCH_WILL_NOT_LEAVE_HIGHER_DEMOLITION_TARGET_ALIVE
```

Otherwise:

```text
PATCH=FORBIDDEN
ESCALATE_GRANULARITY
DEMOLISH_AND_REFOUND
```

## 4. Ancestor exoneration

Before a low-granularity treatment, challenge all plausible ancestors:

```text
WHY_NOT_FILE
WHY_NOT_DIRECTORY
WHY_NOT_PACKAGE_OR_WORKSPACE
WHY_NOT_SERVICE_OR_BOUNDARY
WHY_NOT_DOMAIN
WHY_NOT_TOP_LEVEL_SURFACE
WHY_NOT_REPOSITORY_TOPOLOGY
```

Proceed lower only when higher candidates are positively exonerated, causally unrelated, or unsafe for a proven reason.

## 5. Demolition plan before A1 mutation

Declare expected losing structure before mutation:

```text
EXPECTED_LOSING_AUTHORITIES
EXPECTED_LOSING_WRITERS
EXPECTED_LOSING_FILES
EXPECTED_LOSING_DIRECTORIES
EXPECTED_LOSING_PACKAGES_WORKSPACES
EXPECTED_LOSING_SERVICES_BOUNDARIES
EXPECTED_LOSING_SUBTREES_SURFACES
EXPECTED_COMPAT_BRIDGE_WRAPPER_ALIAS_REEXPORT_REMOVAL
EXPECTED_MANIFEST_DEPENDENCY_CONFIG_RESIDUE_REMOVAL
EXPECTED_PARENT_PRUNING
```

A structural catastrophe with no expected demolition target is a diagnosis failure unless there is positive proof that no losing structure exists.

## 6. Certain-dead garbage dies immediately

During any stage, if an artifact/container has:

```text
NO_REQUIRED_TRUTH
NO_LIVE_CONSUMER
NO_CANONICAL_AUTHORITY_ROLE
NO_DURABLE_DATA_ROLE
NO_EXTERNAL_CONTRACT_ROLE
NO_ACTIVE_MIGRATION_CUTOVER_ROLE
NO_SECURITY_FINANCIAL_COMPLIANCE_ROLE
NO_RANKING_RELEVANT_INFORMATION_VALUE
```

then:

```text
DELETE_NOW_AT_HIGHEST_SAFE_GRANULARITY
→ SEARCH_REFERENCES
→ PRUNE_PARENTS
→ VERIFY_AFFECTED_CONE
```

Do not preserve it until a later cleanup wave.

## 7. Eager loser deletion

A loser may survive only while an explicit required dependency remains.

```text
LOSER_REQUIRED_FOR_TRUTH_EXTRACTION_OR_CUTOVER
→ TEMPORARY_SURVIVAL_ALLOWED
```

The moment the last required dependency ends:

```text
DELETE_LOSER_NOW
→ DELETE_OLD_ALIAS_REEXPORT_ROUTE_CONFIG_TEST_RESIDUE
→ REMOVE_MANIFEST_DEPENDENCY_LOCKFILE_RESIDUE
→ PRUNE_UPWARD
```

No garbage accumulation queue is allowed.

## 8. No garbage repackaging

Forbidden:

```text
MULTIPLE_BAD_FILES_TO_NEW_BIG_BAD_FILE
MULTIPLE_LOSERS_TO_NEW_SHARED_DUMP
MOVE_GARBAGE_TO_NEW_DIRECTORY_WITHOUT_RESPONSIBILITY_ELIMINATION
RENAME_GARBAGE_AS_CLEANUP
WRAP_OLD_AUTHORITY_WITH_NEW_API
ARCHIVE_OLD_TREE
KEEP_DEPRECATED_REACHABLE_COPY
```

```text
MERGE != CLEANUP
MOVE != CLEANUP
RENAME != CLEANUP
REORGANIZE != REFOUNDATION
```

They count only when canonical responsibility is established and the losing responsibility disappears.

## 9. Continuous execution loop inside a unit

Once a unit is active:

```text
SALVAGE_REQUIRED_TRUTH
→ ESTABLISH_CANONICAL_OWNER_WRITER_BOUNDARY
→ BUILD_CANONICAL_REPLACEMENT
→ MIGRATE_DATA_CONTRACTS_GENERATED_LINEAGE
→ MIGRATE_WRITERS
→ MIGRATE_READERS_CONSUMERS
→ CUT_OVER_RUNTIME_ROUTES_CONFIG_NAVIGATION
→ DISABLE_OLD_WRITES
→ DELETE_LOSERS_EAGERLY
→ REMOVE_COMPAT_BRIDGES_ALIASES_WRAPPERS
→ PRUNE_UPWARD
→ FIX_ADMISSION_PREVENTION
→ VERIFY_AND_FALSIFY
```

Do not stop after any intermediate step when the next step is safely derivable.

## 10. Mutation checkpoint boundary

A commit created during mutation is a coherent recovery checkpoint only. This owner ensures the mutation state is recoverable and does not knowingly strand an unsafe partial authority/cutover. Post-commit movement, re-pin, re-census and continuation are owned by `05-EXECUTION-PLAYBOOK.md`.


## 11. Mutation-owner terminal interface

This file never declares semantic unit closure or selects the next unit. When the canonical mutation/cutover/cleanup work for the active unit is ready for proof, it emits only:

```text
MUTATION_READY_FOR_VERIFICATION
→ 04-VERIFY-REDIAGNOSE-CLOSE.md
```

If verification closes the unit, `05-EXECUTION-PLAYBOOK.md` owns all continuation mechanics.


## 12. Recovery-safe mutation handoff

Checkpoint transition law is owned by `05`. During mutation, this owner must only ensure that any emitted checkpoint is recoverable and does not knowingly strand unsafe mixed writers, partial cutover, untracked migration state or required truth.


## 13. Newly exposed finding interface

Mutation may expose a condition that changes safety, the canonical target or the affected cone. Do not self-rank that finding here.

```text
NEW_MATERIAL_FINDING
→ STOP_ONLY_THE_UNSAFE_LOCAL_MUTATION_IF_REQUIRED
→ EMIT_FINDING_WITH_CURRENT_MUTATION_STATE
→ 02-DIAGNOSE-ROOT-CAUSE.md
```

`05` owns movement after diagnosis.


## 14. Durable data and external safety

Aggressive structural deletion never authorizes blind loss of durable truth.

Before persisted or externally observable cutover prove as applicable:

```text
SOURCE_SEMANTICS
TARGET_SEMANTICS
TRANSFORMATION
BACKFILL_RECONCILIATION
ROLL_FORWARD_STRATEGY
CUTOVER_ORDER
READBACK
FINANCIAL_SECURITY_INVARIANTS
EXTERNAL_CONSUMER_COMPATIBILITY_IF_UNAVOIDABLE
```

Preserve required truth first, then delete the loser at the earliest safe moment.

## 15. Generated lineage

```text
ONE_CANONICAL_SOURCE
→ ONE_REPRODUCIBLE_GENERATION_TOOLCHAIN
→ JUSTIFIED_GENERATED_OUTPUT_SET
→ ZERO_MANUAL_MIRRORS
→ ZERO_STALE_GENERATED_TREES
```

Fix source/generator/schema, regenerate, migrate consumers, delete stale outputs.

## 16. Vertical mutation completeness

When a material Product/System capability crosses layers, the execution unit is the complete semantic chain for the **authorized capability or explicit vertical increment** at the highest causally correct root, not an isolated implementation layer.

```text
EXPLICIT_VERTICAL_INCREMENT_WITH_COMPLETE_INTEGRITY=ALLOWED
ACCIDENTAL_PARTIAL_IMPLEMENTATION=FORBIDDEN
```

```text
PRODUCT/SYSTEM MEANING
→ ACTOR/JOURNEY/STATE
→ CANONICAL DATA/STORAGE
→ CANONICAL WRITER/READER
→ DOMAIN/SYSTEM OWNER
→ TRANSPORT/EVENT
→ CONTRACT
→ GENERATED BINDING
→ FRONTEND/PRESENTATION
→ APP/HOST COMPOSITION
→ USER/SYSTEM ACTION
→ MUTATION/OBSERVATION
→ PERSISTED/OBSERVABLE READBACK
→ ALL MATERIAL SURFACE CONSUMERS
→ LOSER DELETION
→ NEGATIVE SPACE
```

```text
BACKEND_ONLY_MUTATION != VERTICAL_MUTATION_COMPLETE
CONTRACT_ONLY_MUTATION != VERTICAL_MUTATION_COMPLETE
FRONTEND_ONLY_MUTATION != VERTICAL_MUTATION_COMPLETE
APP_ONLY_MUTATION != VERTICAL_MUTATION_COMPLETE
```

Do not hand off a layer fragment as mutation-complete while the material vertical chain remains split. A partially connected replacement is `OPEN_CRITICAL`; `04` alone decides closure.

This vertical law does not prohibit a Stage-A layer-wide refoundation when a cross-cutting structural layer is itself the proven highest-yield systemic root.

## 17. Same-unit supporting-residue cleanup

When the current root fix makes a supporting artifact obsolete, treat that residue inside the same execution unit:

```text
OBSOLETE_TEST
OBSOLETE_FIXTURE/MOCK/SNAPSHOT
OBSOLETE_GUARD
OBSOLETE_WORKFLOW
OBSOLETE_SCRIPT
OBSOLETE_ALLOWLIST/SUPPRESSION
OBSOLETE_ALIAS/WRAPPER
OBSOLETE_EVIDENCE_HELPER
→ DELETE_OR_REFOUND_IN_THE_SAME_EXECUTION_UNIT
```

```text
DO_NOT_CREATE_A_FUTURE_CLEANUP_CAMPAIGN_FOR_RESIDUE_CREATED_BY_THE_CURRENT_FIX
```

## 18. Mutation compliance correction

When `04` reports an execution-law defect specifically in mutation behavior, correct only the mutation-owned defect here: stop the wrong local write, restore the canonical writer/cutover/deletion discipline and emit the corrected candidate back to verification. Scope recovery and movement remain with `01` and `05`.


## 19. Clean-target donor reconstruction execution

For donor→target reconstruction, the unit sequence is:

```text
EXTRACT_REQUIRED_DONOR_VALUE
→ DEFINE_TARGET_OWNER
→ BUILD/REIMPLEMENT/REGENERATE_IN_TARGET
→ MIGRATE_TARGET-INTERNAL_CONSUMERS WHEN PRESENT
→ VERIFY_PARITY_OR_DELIBERATE_IMPROVEMENT
→ DO_NOT_IMPORT_DONOR_LOSERS
→ DELETE_TARGET LOSERS/RESIDUE AT EARLIEST SAFE MOMENT
→ NEGATIVE_SPACE
```

Never mutate or clean the donor as part of target reconstruction. Donor history remains external forensic evidence.

## 20. Parallel-mutation interface

Parallel authorization, overlap classification and one-integration-authority rules are owned by `01-SCOPE-AUTHORITY-RULES.md`. This mutation owner accepts only a parallel unit that `01` has classified safe.

For such a unit, preserve its exact base SHA, mutate only its admitted cone, reconcile foreign deltas before integration and return one coherent mutation result. This section does not redefine parallelism policy.


## 21. Donor versus target deletion law

```text
DONOR_LOSER → DO_NOT_IMPORT
TARGET_LOSER → MIGRATE/CUT_OVER/DELETE
REQUIRED_DONOR_TRUTH_IN_LOSER → EXTRACT_BEFORE_NON_IMPORT
```

A donor container never earns target survival merely because required truth was found inside it.

## 22. Minimum necessary complexity

Root-correct reconstruction must not replace one bad topology with a more elaborate control plane.

```text
NEW ABSTRACTION/WRAPPER/PACKAGE/SERVICE/REGISTRY/ROUTER/GUARD
→ PROVE UNIQUE RESPONSIBILITY OR UNIQUE ASSURANCE VALUE
→ PROVE EXISTING OWNER/COMPILER/SCHEMA/TEST/RUNTIME CANNOT OWN IT BETTER
→ PROVE CONSUMER/TRIGGER/MAINTENANCE OWNER
→ PROVE NET COMPLEXITY DOES NOT INCREASE WITHOUT MATERIAL VALUE
```

Prefer deletion, direct ownership, generated lineage and existing language/platform guarantees over hand-maintained indirection. Temporary migration/control artifacts require an explicit retirement condition and must disappear after their function ends.
