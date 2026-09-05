# Verification — Evidence and Falsification

ARTIFACT_CLASS: ORCHESTRATOR_VERIFICATION_SUBMODULE
OWNER_ROLE: EVIDENCE_PROVENANCE_FALSIFICATION
AUTHORITY_ASSIGNED_BY: 04-VERIFY-REDIAGNOSE-CLOSE.md
PRODUCT_SEMANTIC_AUTHORITY: NONE
CURRENT_IMPLEMENTATION_AUTHORITY: NONE
SELF_CERTIFICATION: FORBIDDEN
LOAD_TRIGGER: WHEN_EVIDENCE_PROVENANCE_FALSIFICATION_RUNTIME_PROOF_OR_FAILURE_CLASSIFICATION_APPLIES

This submodule owns verification evidence quality, provenance, falsification and proof-limit rules only. It does not select Product scope, diagnose roots, mutate the repository or own terminal-state movement.

## 1. Evidence proves claims, not activity

```text
GREEN != CANONICAL
GREEN != CLOSED
ZERO_EXIT != FINDINGS_CLOSED
MAPPED != TREATED
CLASSIFIED != TREATED
CHECKPOINT != COMPLETION
COMMIT != CLOSURE
UNIT_CLOSED != CAMPAIGN_COMPLETE
STAGE_PASS != CAMPAIGN_COMPLETE
```

## 2. Exact-head evidence provenance

Every closure claim must be reconstructable with:

```text
EXACT_HEAD_SHA
CAMPAIGN_STAGE
UNIT_OR_CATASTROPHE_OR_ROOT
CLAIM
EVIDENCE_SOURCE
RESULT
WHAT_IT_PROVES
WHAT_IT_DOES_NOT_PROVE
FRESHNESS
INVALIDATION_TRIGGER
```

Head movement invalidates only affected evidence, then execution continues from the reconstructed frontier.

## 3. Finding terminality

Transitional states:

```text
FOUND
CLASSIFIED
CLUSTERED
ASSIGNED
MAPPED_TO_PRE_ROOT_CATASTROPHE
MAPPED_TO_STAGE_B_ROOT
```

Terminal states only:

```text
TREATED_AND_VERIFIED
FALSE_POSITIVE_PROVEN
AUTHORIZED_INTENTIONAL_CONDITION
DEFERRED_OUTSIDE_AUTHORIZED_PRODUCT_SCOPE
TOOL_LIMITATION_PROVEN
STALE_OR_SUPERSEDED_WITH_PROOF
N_A_PROVEN
LEGITIMATE_BLOCKER
```

```text
KNOWN_MAPPED_BUT_UNTREATED_FINDING > 0
=> RELEVANT_STAGE_GATE_FAILS
```

`DEFERRED_OUTSIDE_AUTHORIZED_PRODUCT_SCOPE` is terminal only for an `ACTIVE_SLICE` invocation and only for genuine future Product breadth. It cannot hide structural garbage, a prerequisite, affected regression, unsafe partial cutover, or required value in the active cone. It never satisfies a `FULL_TARGET` gate.

## 3A. Assurance asset classification

Every materially affected test, fixture, mock, snapshot, simulator mapping, helper and custom guard must be classified before closure:

```text
VALID_CANONICAL_SPEC → preserve/refound
OBSOLETE_BEHAVIOR → delete
DUPLICATE_COVERAGE → merge/delete
WRONG_LAYER_SPEC → rewrite/rehome
LOSING_TOPOLOGY_TEST → delete with loser
MISSING_PREVENTION → add smallest durable prevention proof
BROKEN_TEST_INFRA → repair/refound or prove/remove obsolete harness
```

A green obsolete test is not closure evidence.

## 4. Continuous-execution compliance gate

Before accepting any checkpoint, unit closure, stage transition or final completion, verify the campaign is not violating continuous-engagement law.

Required invariants before final completion:

```text
CAMPAIGN_ENGAGED=TRUE
NEXT_REQUIRED_ACTION_IS_DERIVED_OR_LEGITIMATELY_BLOCKED
NO_IDLE_STATE
NO_WAITING_FOR_NEXT
NO_PAUSE_AFTER_COMMIT
NO_PAUSE_AFTER_UNIT
NO_PAUSE_AFTER_STAGE
NO_RECOMMENDATIONS_ONLY_WHEN_EXECUTION_IS_READY
NO_DERIVABLE_AUTHORIZED_WORK_LEFT_UNEXECUTED_AT_A_STOP_POINT
```

If any fail:

```text
ORCHESTRATOR_COMPLIANCE_FAILURE
→ CHECKPOINT_NOT_TERMINAL
→ RECONSTRUCT_CONTROL_STATE
→ EXECUTE_NEXT_REQUIRED_ACTION
```

## 12. Falsification

Actively search for:

```text
OLD_AUTHORITY_REFERENCES
SECOND_WRITERS
DUPLICATE_SEMANTICS
SHADOW_CONFIG_CONTRACT_DTO_ENUM_MAPPING
MANUAL_GENERATED_MIRRORS
COMPAT_FORWARDER_REEXPORT_ALIAS_PATHS
EMPTY_MEANINGLESS_PARENTS
ORPHAN_SCREENS_APIS_BINDINGS_DATA
RETIRED_TOPOLOGY_IN_TESTS_FIXTURES_MOCKS
CI_GOVERNANCE_AGENT_TOOL_PARALLEL_AUTHORITIES
STALE_RUNTIME_REGISTRATION
STALE_CONFIG_ENV_FLAGS_SCRIPTS
UNUSED_DEPENDENCIES
HALF_MIGRATIONS
MISLEADING_NAMES_WRONG_OWNER_PATHS
HIGH_FAN_IN_COMPENSATORY_SUBTREES
ROOT_TAX_SURVIVAL
MATERIAL_UNBOUND_UI_ACTIONS
UI_SUCCESS_WITHOUT_CANONICAL_EFFECT
CANONICAL_EFFECT_WITHOUT_REQUIRED_SURFACE_READBACK
PAUSED_OR_IDLE_EXECUTION_WITH_DERIVABLE_WORK
```

## 13. Post-unit evidence refresh

After a material unit changes the candidate, refresh the verification-owned proof state:

```text
RE_PIN_CURRENT_HEAD
→ REFRESH_AFFECTED_CENSUS
→ INVALIDATE_AFFECTED_EVIDENCE
→ RE_RUN_APPLICABLE_NEGATIVE_SPACE/FALSIFICATION
→ EMIT_CURRENT_VERIFICATION_RESULT
```

Diagnosis/ranking of the refreshed candidate belongs to `02`; invocation of that diagnosis and subsequent movement belong to `05`.

## 16. Evidence acquisition and proof-limit gate

Every material closure claim must bind:

```text
CLAIM/CAPABILITY
→ REQUIRED_EVIDENCE
→ ACQUISITION_PATH
→ EXACT_CANDIDATE/ENVIRONMENT
→ PROOF_LIMIT
```

A green command proves only what it exercised. Missing acquisition capability, unavailable provider/runtime, or unverified external state must remain an explicit proof limit rather than being converted to PASS.

Verification is risk-proportional: start affected-first, then widen when shared owners, contracts, database/migrations, runtime, security, finance, multi-surface behavior or failed evidence requires it.

## 17. Runtime provenance and evidence invalidation

Runtime evidence is valid only when the tested process/container/app is proven to correspond to the claimed exact target candidate and configuration.

Record or reconstruct as applicable:

```text
TARGET_HEAD_SHA
ARTIFACT/IMAGE/PROCESS IDENTITY
CONFIG/ENV CLASS
DATABASE/MIGRATION STATE
PROVIDER/SIMULATOR MODE
DEVICE/APP BUILD IDENTITY WHEN MATERIAL
TIME/RECENCY
```

Any material head/config/runtime/database movement invalidates affected evidence. Re-run only the evidence whose proof cone became stale, then widen if the changed owner is shared.

## 18. Repository-platform truth

When closure depends on repository-host state, tracked YAML is not sufficient evidence. Inspect the live repository platform as applicable:

```text
BRANCH/RULESET PROTECTION
REQUIRED CHECKS
ACTUAL WORKFLOW RUN FOR EXACT CANDIDATE
PR BASE/HEAD/DIFF
REVIEW/APPROVAL PROVENANCE WHEN REQUIRED
MERGEABILITY
SECURITY ANALYSIS UPLOAD/RESULT STATE
```

Self-review is not independent review. Do not claim independent approval unless provenance proves it.

## 22. Failure classification and no-blind-rerun law

A failing CI/test/runtime/provider command is evidence to diagnose, not a command to repeat until green.

Classify the failure before rerun as far as evidence permits:

```text
DETERMINISTIC_CODE/CONTRACT/DATA DEFECT
CANDIDATE_OR_EVIDENCE_STALENESS
CONFIG/ENVIRONMENT MISMATCH
INFRA/RESOURCE/CAPACITY FAILURE
EXTERNAL_PROVIDER FAILURE
FLAKY/NONDETERMINISTIC TEST OR RACE
TOOLCHAIN/DEPENDENCY FAILURE
UNKNOWN_REQUIRING_DIAGNOSIS
```

A rerun is justified only when it can discriminate a transient/nondeterministic hypothesis, after the underlying condition changed, or after a fix. A passing retry does not erase an earlier failure unless the cause is classified and the closure claim remains valid for the exact candidate.

```text
BLIND_RERUN_UNTIL_GREEN = FORBIDDEN
FAILURE_SUPPRESSION/ALLOWLIST_TO_MANUFACTURE_GREEN = FORBIDDEN
PASS_AFTER_UNEXPLAINED_FAILURE != CLOSED
```

## 23. No documentation-only closure

Governance, Docs, plans, matrices and reports can define/record truth and evidence obligations; they cannot substitute for required implementation/data/runtime treatment.

```text
IMPLEMENTATION_ROOT_EXISTS + ONLY_DOC/GOVERNANCE/PLAN_CHANGED → NOT_CLOSED
MIGRATION_REQUIRED + ONLY_DOCUMENTED → NOT_CLOSED
RUNTIME/SECURITY/FINANCIAL_DEFECT + ONLY_REPORTED → NOT_CLOSED
```

A documentation-only change may close only a genuinely documentation-only objective after executable Product/System truth is proven unaffected and the corrected document does not create a parallel authority.
