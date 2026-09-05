# Diagnosis, Required-Truth Reconstruction and Causal Root Selection

OWNER_ROLE: FORENSIC_CENSUS_REQUIRED_TRUTH_ROOT_DIAGNOSIS
AUTHORITY_ASSIGNED_BY: 00-ORCHESTRATOR.md
SELF_CERTIFICATION: FORBIDDEN
LOAD_TRIGGER: BEFORE_DIAGNOSIS_OR_ROOT_SELECTION

## 1. Diagnosis starts repository-wide and evidence-first

Do not begin from the first bug, first failed check, first file or easiest surface.

Begin from the exact pinned current head and enumerate the material tracked system:

```text
TRACKED_TREE
TOP_LEVEL_SURFACES
WORKSPACES_PACKAGES_MANIFESTS
DEPENDENCY_GRAPH_LOCKFILE
DOMAINS_SERVICES_SHARED_CORE
FILES_SYMBOLS_EXPORTS_ENTRYPOINTS
IMPORT_EXPORT_REEXPORT_ALIAS_GRAPH
DATABASE_SCHEMA_MIGRATIONS_SEEDS_BACKFILLS
API_CONTRACT_GENERATED_LINEAGE
RUNTIME_CONFIG_ENV_INFRA_REGISTRATIONS
FRONTEND_SHARED_STATE_NAVIGATION
TEST_FIXTURE_MOCK_SNAPSHOT_OWNERSHIP
CI_ASSURANCE_SUPPRESSIONS
TOOLS_DOCS_GOVERNANCE_AGENTS
LEGACY_COMPAT_BRIDGE_ALIAS_WRAPPER_LAYERS
DEAD_ORPHANED_STALE_UNOWNED_MATERIAL
PARALLEL_SHADOW_TRUTH
LARGE_HIGH_FAN_IN_SUBTREES
```

Sampling cannot satisfy A0.

## 2. Required truth before current shape

Extract only what must survive:

```text
PRODUCT_INTENT
ACTORS_AUTHORIZATION
DOMAIN_SEMANTICS
PERSISTED_DATA_MEANING
SECURITY_FINANCIAL_INVARIANTS
EXTERNAL_CONTRACTS
USER_JOURNEYS
REQUIRED_INTEGRATIONS
OBSERVABLE_RUNTIME_BEHAVIOR
REQUIRED_OPERATIONAL_ASSURANCE_CLAIMS
```

Then build a current-shape-independent canonical model before accepting current containers as canonical solely because they exist:

```text
REQUIRED_TRUTH
→ REQUIRED_DOMAINS
→ REQUIRED_OWNERS_WRITERS
→ REQUIRED_STORAGE
→ REQUIRED_CONTRACT_AUTHORITIES
→ REQUIRED_RUNTIME_AUTHORITIES
→ REQUIRED_PRODUCT_SURFACES
→ MINIMUM_NECESSARY_CANONICAL_CONTAINER_SET
```

Current topology is evidence, never a design constraint.

## 2A. Authorized-scope filter

Repository-wide diagnosis may discover the complete target and structural risks, but discovery does not equal mutation authorization.

A semantic Product/System candidate is executable during `PRODUCT_BREADTH=ACTIVE_SLICE` only when it is one of:

```text
THE_ACTIVE_PRODUCT_SLICE ITSELF
A REAL STRUCTURAL/OWNERSHIP PREREQUISITE THAT BLOCKS THE SLICE
A SHARED DATA/CONTRACT/RUNTIME/SECURITY/FINANCIAL OWNER THE SLICE ACTUALLY EXERCISES
A REQUIRED CONSUMER/READBACK OF THE SLICE
A REGRESSION DEFECT CAUSED OR EXPOSED BY THE SLICE
A LOSER/COMPATIBILITY RESIDUE INSIDE THE SLICE'S AFFECTED CONE
```

A future target capability that is merely adjacent, desirable, or described in Governance is classified as:

```text
DEFERRED_OUTSIDE_AUTHORIZED_PRODUCT_SCOPE
```

until explicitly activated. That classification is not allowed to hide structural garbage, an unsafe partial cutover, a prerequisite, or a regression inside the active cone.

```text
DISCOVERED_FUTURE_PRODUCT_BREADTH != EXECUTABLE_FRONTIER
KNOWN_STRUCTURAL_GARBAGE != VALID_PRODUCT_DEFERRAL
```

## 3. Complete tracked accounting

Every tracked artifact receives a current status. `NONMATERIAL` requires proof.

High-level dispositions:

```text
KEEP_PROVEN
PRESERVE_AND_REWIRE
REFOUND
MIGRATE_VALUE_THEN_DELETE
DELETE
BLOCKED_UNKNOWN
```

Container verdicts:

```text
CANONICAL_COHESIVE_CONTAINER
MIXED_RESPONSIBILITY
DUPLICATE_RESPONSIBILITY
WRONG_OWNER
WRONG_PATH_OR_BOUNDARY
PASS_THROUGH_ONLY
COMPATIBILITY_ONLY
HISTORICAL_COMPENSATION
SHADOW_PARALLEL_AUTHORITY
DEAD_ORPHANED
WHOLE_SUBTREE_REFOUND_CANDIDATE
UNCLASSIFIED
```

`UNCLASSIFIED` and `BLOCKED_UNKNOWN` are non-terminal.

## 4. Finding lifecycle is not treatment

Raw findings may be discovered, clustered and mapped for causality, but these are transitional only:

```text
FOUND
CLASSIFIED
CLUSTERED
ASSIGNED
MAPPED_TO_PRE_ROOT_CATASTROPHE
MAPPED_TO_STAGE_B_ROOT
```

They do not prove resolution.

Terminal outcomes only:

```text
TREATED_AND_VERIFIED
FALSE_POSITIVE_PROVEN
AUTHORIZED_INTENTIONAL_CONDITION
TOOL_LIMITATION_PROVEN
STALE_OR_SUPERSEDED_WITH_PROOF
N_A_PROVEN
LEGITIMATE_BLOCKER
```

```text
MAPPED != TREATED
KNOWN_MAPPED_BUT_UNTREATED > 0 => RELEVANT_GATE_OPEN
```

## 5. Parent death and structural escalation

For every suspect artifact, diagnose upward:

```text
SYMBOL
→ FILE
→ DIRECTORY
→ PACKAGE_OR_WORKSPACE
→ SERVICE_OR_BOUNDARY
→ DOMAIN
→ TOP_LEVEL_SURFACE
→ REPOSITORY_TOPOLOGY
```

The diagnosis must identify the highest causally correct demolition/refoundation target, not merely the first broken descendant.

A used loser remains a loser: migrate required consumers, then delete it.

## 6. Pre-root baseline catastrophe universe

`PRE_ROOT_BASELINE_CATASTROPHE` includes any proven condition whose early refoundation is required to make the baseline worth building upon, including:

```text
CROSS_ROOT_SYSTEMIC_CATASTROPHE
FOUNDATIONAL_REPOSITORY_TOPOLOGY_CATASTROPHE
WORKSPACE_PACKAGE_DEPENDENCY_CATASTROPHE
SHARED_CORE_COMMON_AUTHORITY_CATASTROPHE
DATABASE_OWNERSHIP_OR_MIGRATION_EPOCH_CATASTROPHE
CONTRACT_GENERATED_LINEAGE_CATASTROPHE
RUNTIME_CONFIG_INFRA_AUTHORITY_CATASTROPHE
ASSURANCE_CONTROL_PLANE_CATASTROPHE
GOVERNANCE_AGENT_TOOL_AUTHORITY_CATASTROPHE
MASSIVELY_INVALID_DOMAIN_SERVICE_PACKAGE_DIRECTORY_SURFACE
LARGE_OBSOLETE_COMPENSATORY_SUBTREE
PARALLEL_SHADOW_TRUTH_ARCHITECTURE
LEGACY_COMPATIBILITY_BRIDGE_ARCHITECTURE
OTHER_HIGH_STRUCTURAL_YIELD_FOUNDATIONAL_UNIT
```

A catastrophe need not cross many roots when the container itself is a large invalid baseline structure.

## 7. ROOT_TAX and STRUCTURAL_YIELD

```text
ROOT_TAX =
EXTRA MIGRATION + COMPATIBILITY + DIAGNOSIS + VERIFICATION + PARALLEL_AUTHORITY + CLEANUP
THAT SURVIVING SHARED OR FOUNDATIONAL DEBT WOULD FORCE INTO FUTURE ROOTS
```

```text
STRUCTURAL_YIELD =
HOW MUCH PROVEN WRONG STRUCTURE AND WRONG RESPONSIBILITY DISAPPEAR
WHEN THE UNIT CLOSES CORRECTLY
```

Signals include:

```text
LOSING_AUTHORITIES_COLLAPSED
LOSING_WRITERS_REMOVED
FILES_ABSORBED_OR_DELETED
DIRECTORIES_REMOVED
PACKAGES_WORKSPACES_REMOVED
SERVICES_BOUNDARIES_REFOUNDED
WRAPPERS_ALIASES_REEXPORTS_REMOVED
LEGACY_COMPATIBILITY_REMOVED
FUTURE_ROOTS_SIMPLIFIED
DIAGNOSIS_VERIFICATION_CONTAMINATION_REMOVED
```

## 8. Dominance ranking

Before A1 mutation, build a serious top-candidate set and compare candidates by:

```text
TRUTH_DATA_SECURITY_FINANCIAL_RISK
FOUNDATIONAL_BLOCKING_POWER
CROSS_ROOT_BLOCKING_POWER
AUTHORITY_COLLAPSE
ROOT_TAX_REMOVAL
STRUCTURAL_YIELD
FUTURE_COMPLEXITY_REDUCTION
DIAGNOSIS_VERIFICATION_DECONTAMINATION
SAFE_COMPLETE_EXECUTABILITY
```

Safety is a gate, not a preference for smaller work.

Required proof:

```text
TOP_CANDIDATE_SET
SELECTED_DOMINANT_CANDIDATE
SERIOUS_ALTERNATIVES_COMPARED
WHY_SELECTED_OUTRANKS_ALTERNATIVES
RANKING_RELEVANT_UNKNOWNS=0
```

```text
FIRST_PROVEN_CATASTROPHE != FIRST_EXECUTED_CATASTROPHE
```

## 9. Deferral falsification

Two forms of deferral must never be conflated.

```text
EXPLICIT_FUTURE_PRODUCT_BREADTH_OUTSIDE_AUTHORIZED_SCOPE = VALID
KNOWN_STRUCTURAL_GARBAGE_OR_UNSAFE_PARTIAL_CUTOVER = INVALID
```

A candidate mapped to Stage B must prove under `01` that its container and all materially relevant ancestors are canonical and that no structural demolition/refoundation obligation remains **when that candidate is inside the authorized Product scope or is a prerequisite of it**.

A future target capability may remain deferred without implementation when it is outside the authorized Product scope and no part of its absence creates a defect in the active cone.

If a supposed Product deferral actually hides a structural prerequisite, duplicate owner/writer, compatibility bridge, unsafe migration state, or regression required by the active slice, promote that obligation to A0/A1/current-scope work.

## 9A. Discovery order is not execution order

The first severe defect/catastrophe discovered is only a candidate. Root selection remains causal and comparative.

~~~text
FIRST_CATASTROPHE_FOUND != FIRST_EXECUTED_CATASTROPHE
FIRST_FAILED_CHECK != HIGHEST_ROOT
FIRST_FILE_INSPECTED != EXECUTION_UNIT
~~~

Do not execute a lower discovered defect before proving that no higher prerequisite/superseding root dominates it.

## 10. Source-of-Defect / Source-of-Fix execution gate

Before material mutation establish:

```text
UNIT_ID
UNIT_STAGE
ROOT_OR_CATASTROPHE_ID
ACTUAL_SOURCE_OF_DEFECT
REQUIRED_SOURCE_OF_FIX
CAUSAL_PROOF
CANONICAL_TARGET
CANONICAL_OWNER_WRITER_BOUNDARY
VALUE_TO_PRESERVE
LOSING_AUTHORITIES_CONTAINERS
COMPLETE_AFFECTED_CONE
WRITERS_READERS_CONSUMERS
DATA_CONTRACT_RUNTIME_IMPACT
MIGRATION_BACKFILL_RECONCILIATION
CUTOVER
DELETION_PRUNING
ADMISSION_PREVENTION
VERIFICATION_FALSIFICATION
VALID_BLOCKERS
```

If a higher Source-of-Fix is proven, descendant patching is forbidden.

## 11. Continuous causal frontier

Diagnosis must always derive the next executable frontier; it must not end as a report when execution is authorized.

```text
CAUSAL_FRONTIER =
THE HIGHEST CURRENT PROVEN AUTHORIZED EXECUTABLE OBLIGATION
THAT ADVANCES THE CURRENT AUTHORIZED PRODUCT SCOPE TOWARD ITS FIXED POINT
```

After every material mutation or closure:

```text
REFRESH_INVALIDATED_EVIDENCE
→ REFRESH_STRUCTURAL_AND_SEMANTIC_GRAPHS
→ ABSORB_NEWLY_EXPOSED_CAUSES
→ RE_RANK
→ DERIVE_NEXT_REQUIRED_ACTION
```

If no legitimate blocker exists and the derived action lies inside the authorized Product scope or its proven prerequisite/regression cone, the action is executable, not advisory. An unactivated future capability is not a derivable action.

```text
DIAGNOSIS_WITH_EXECUTABLE_FRONTIER
+ NO_BLOCKER
=> EXECUTION_REQUIRED
```

## 12. No disconnected-task interpretation

The campaign graph is continuous.

```text
UNIT != INDEPENDENT_TASK
COMMIT != NEW_OBJECTIVE
NEW_FINDING != NEW_SESSION_BOUNDARY
```

New findings are absorbed into the current catastrophe/root graph, causally ranked, and executed in order without waiting for a separate human `NEXT`.

## 13. Git history is forensic recovery, not live preservation

A loser does not remain in the live tree because future analysis might need it.

Previously committed historical shape is recoverable through Git history. Therefore:

```text
FUTURE_FORENSIC_INTEREST != PRESERVATION_RIGHT
```

Preserve required truth in canonical structure; preserve historical shape in history only.

## 14. Donor semantic-atom census

In clean-target reconstruction, diagnosis must exhaust the donor evidence cone material to the currently authorized Product scope, including relevant history that can contain removed Product/System/UX/data/security/financial/operational/engineering value. Repository-wide donor exhaustion remains mandatory for the explicit `FULL_TARGET` fixed point, not for closing an independent active slice whose material donor cone is exhausted and whose scope-changing unknowns are zero.

A semantic atom is one materially distinct requirement, invariant, ownership rule, state/transition, failure/recovery rule, UX requirement, security/financial constraint, evidence rule or operating procedure. Wording duplication is not a second atom.

Each material atom receives exactly one disposition:

```text
PRESERVE_AS_TRUTH | REFINE | MERGE | REHOME | REIMPLEMENT | REGENERATE | REFERENCE_ONLY | SUPERSEDE | REJECT_WITH_REASON
```

No material atom may disappear because its source file was deleted, simplified, renamed or superseded structurally.

## 15. Journey Matrix and complete operational trace

For every material capability/root, reconstruct the applicable matrix across:

```text
ACTOR × JOURNEY × SURFACE × OWNER × STATE × ACTION × DATA × CONTRACT × RUNTIME × FAILURE × READBACK
```

Required diagnostic directions include forward, reverse, temporal, cross-surface, cross-owner, negative-space, invariant, counterfactual, experimental and adversarial reasoning.

## 16. Findings Ledger

Every material finding stays addressable until terminal disposition:

```text
FINDING_ID
CLAIM
EVIDENCE
SOURCE_OF_DEFECT
IMPACTED_CONE
ROOT_CANDIDATE
FALSIFICATION_ATTEMPT
STATUS = OPEN | MERGED_INTO_ROOT | REJECTED_WITH_EVIDENCE | CLOSED_BY_VERIFIED_TREATMENT
```

`MAPPED`, `CLASSIFIED` and `KNOWN` are not terminal states.

## 17. Decision taxonomy

Unknowns are divided into:

```text
TECHNICAL_FACT_DERIVABLE
DONOR_HISTORY_FACT_DERIVABLE
EXTERNAL_STANDARD_OR_PROVIDER_FACT_RESEARCHABLE
PRODUCT_DECISION_REQUIRED
IRREVERSIBLE_RISK_DECISION_REQUIRED
```

Ask a human only for a true Product/System or irreversible-risk decision. Continue all independent derivable work.

## 18. Canonical Target Model gate

Before material reconstruction, define a target model independent of inherited donor/current names:

```text
REQUIRED_OUTCOME
CANONICAL_OWNER
CANONICAL_WRITER
STORAGE_CLASS
CONTRACT/EVENT_OWNER
REQUIRED_CONSUMERS
SURFACE_COMPOSITION
FAILURE/RECOVERY
SECURITY/FINANCIAL_INVARIANTS
RUNTIME/CONFIG
MIGRATION_OR_REIMPLEMENTATION_PATH
LOSER_NON_IMPORT/DELETION_PATH
```

A clean path or green build without this target model is insufficient for high-impact restructuring.

## 19. Patch-loop breaker

Repeated descendant repair is evidence of an upstream root until falsified.

```text
REPEATED_LOCAL_FIXES
OR GROWING_WRAPPERS/ALIASES/COMPATIBILITY
OR REPEATED_CROSS_SURFACE_DRIFT
→ STOP_DESCENDANT_PATCHING
→ RE_DIAGNOSE_ANCESTOR_OWNER/BOUNDARY/CONTRACT/DATA/RUNTIME
→ PROMOTE_HIGHER_ROOT_WHEN_PROVEN
```
