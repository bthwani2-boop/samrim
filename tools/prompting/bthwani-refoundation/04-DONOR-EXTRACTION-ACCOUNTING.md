# Donor Extraction and Zero-Loss Accounting Template

ARTIFACT_CLASS: TEMPORARY_EXECUTION_EVIDENCE_TEMPLATE
GENERAL_LAW_AUTHORITY: NONE
PRODUCT_AUTHORITY: NONE
PROGRESS_AUTHORITY: NONE
SELF_DELETE_AFTER_VERIFIED_CLOSURE: REQUIRED

## Purpose

Use this template only when BThwani is reconstructed into a clean target repository from a separate read-only donor repository/ref. It prevents semantic loss without making donor shape authoritative.

## Source set

Account for all materially applicable donor classes:

```text
CURRENT DONOR TREE
MATERIAL GIT HISTORY AND DIFFS
DELETED/SUPERSEDED GOVERNANCE
DELETED/SUPERSEDED DOCS/RUNBOOKS
PRIOR ORCHESTRATOR/EXECUTION LAWS
PRIOR PLANS/DIAGNOSES
PRODUCT-TRUTH REPRESENTATIONS
CODE/DB/MIGRATIONS/CONTRACTS/RUNTIME
TESTS/FIXTURES/MOCKS
TOOLS/CI/GUARDS/AGENT INSTRUCTIONS
```

## Semantic-atom disposition record

For each materially distinct atom record:

```text
ATOM_ID
SOURCE_PATH/COMMIT
SEMANTIC_CLASS
CLAIM/MEANING
EVIDENCE
CURRENT_TARGET_OWNER
DISPOSITION
TARGET_DESTINATION_OR_REASON
VERIFICATION
```

Allowed dispositions:

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

Forbidden: `IGNORED`, `UNKNOWN_AND_SKIPPED`, silent deletion, or copying merely because the donor contained it.

## Capability and journey disposition

Every donor capability/responsibility/journey candidate must be classified as one of:

```text
DURABLE_CAPABILITY
SUBCAPABILITY
POLICY
TECHNICAL_MECHANISM
PROJECTION/READ_MODEL
PART_OF_ANOTHER_CAPABILITY
DEAD_OR_INVALID
```

For survivors/reimplementations, account for owner, actors, outcome, states/transitions, actions, invariants, failures/recovery, security/finance, data, contract, surfaces, runtime and canonical readback.

## Active-slice donor-cone closure

For `PRODUCT_BREADTH=ACTIVE_SLICE`, exhaust the complete donor cone that can materially change the active slice, including relevant historical evidence.

```text
AUTHORIZED_SLICE_DONOR_CONE_ENUMERATED=PASS
UNINSPECTED_DONOR_HISTORY_MATERIAL_TO_ACTIVE_SLICE=0
UNACCOUNTED_REQUIRED_SEMANTIC_ATOMS_IN_ACTIVE_SLICE_CONE=0
UNMAPPED_REQUIRED_DATA/CONTRACT/RUNTIME/SECURITY/FINANCE/UX/TEST_VALUE_IN_CONE=0
DONOR_SHAPE_COPIED_WITHOUT_CANONICAL_PROOF=0
UNJUSTIFIED_DONOR_TRUTH_LOSS_IN_ACTIVE_SLICE_CONE=0
```

Global donor saturation is not required to close an independent active slice when no uninspected donor area can change its owner, semantics, interfaces, external identity, safety, or future-compatible canonical model.

## Repository-wide zero-loss closure

For explicit `PRODUCT_BREADTH=FULL_TARGET`:

```text
DONOR_MATERIAL_HISTORY_INSPECTION=PASS
UNACCOUNTED_MATERIAL_SEMANTIC_ATOMS=0
UNCLASSIFIED_DONOR_RESPONSIBILITIES=0
UNMAPPED_REQUIRED_DONOR_CAPABILITIES=0
UNMAPPED_REQUIRED_DONOR_JOURNEYS=0
UNMAPPED_REQUIRED_DONOR_DATA/CONTRACT/RUNTIME_TRUTH=0
UNMAPPED_REQUIRED_DONOR_SECURITY/FINANCIAL_TRUTH=0
UNMAPPED_REQUIRED_DONOR_UX/OPERATIONAL_TRUTH=0
UNMAPPED_REQUIRED_DONOR_GOVERNANCE/DOC/TOOL/TEST_VALUE=0
BTHWANI_DONOR_REQUIRED_VALUE_DISPOSITION=PASS
DONOR_SHAPE_COPIED_WITHOUT_CANONICAL_PROOF=0
```

This template is deleted only after verified repository-wide `FULL_TARGET` fixed point; Git history retains the campaign accounting.
