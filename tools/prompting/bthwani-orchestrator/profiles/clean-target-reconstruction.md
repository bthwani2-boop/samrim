# Clean-Target Reconstruction Profile

ARTIFACT_CLASS: ORCHESTRATOR_EXECUTION_PROFILE
PROFILE_ROLE: CLEAN_TARGET_RECONSTRUCTION
AUTHORITY_ASSIGNED_BY: 00-ORCHESTRATOR.md
PRODUCT_SEMANTIC_AUTHORITY: NONE
CURRENT_IMPLEMENTATION_AUTHORITY: NONE
DONOR_MUTATION_AUTHORITY: NONE
SELF_CERTIFICATION: FORBIDDEN
LOAD_TRIGGER: MODE_CLEAN_TARGET_RECONSTRUCTION_WITH_DONOR

## 1. Model

~~~text
DONOR = READ-ONLY FORENSIC EVIDENCE
TARGET = ONLY MUTABLE CANONICAL CANDIDATE
DONOR SHAPE != TARGET TOPOLOGY
DONOR EXISTENCE != SURVIVAL RIGHT
REQUIRED DONOR VALUE != DONOR CONTAINER SURVIVAL
~~~

Target meaning/ownership comes from current Governance and explicit human decisions. Current target implementation truth comes from target source/runtime. Donor current state and material history are evidence only.

## 2. Direct-to-canonical reconstruction

For every material donor atom relevant to the authorized scope:

~~~text
IDENTIFY MATERIAL ATOM
→ PROVE WHETHER IT IS STILL REQUIRED
→ CLASSIFY ITS SEMANTIC TYPE
→ PROVE CURRENT TARGET OWNER
→ RECORD DISPOSITION
→ BUILD / REIMPLEMENT / REGENERATE DIRECTLY IN CANONICAL TARGET
→ VERIFY
~~~

Never recreate a known losing donor path merely to move it again.

~~~text
DONOR_PATH != TARGET_PATH_AUTHORITY
COPIED_BECAUSE_DONOR_HAD_IT = FORBIDDEN
UNKNOWN_AND_SKIPPED = FORBIDDEN
SILENT_REQUIRED_TRUTH_LOSS = FORBIDDEN
~~~

## 3. Donor evidence universe

Inspect only donor classes capable of changing the authorized result:

- current donor code/tree;
- material Git history, diffs, deletions and superseded implementations;
- old Product/Governance/Docs/runbooks when they can reveal still-required meaning;
- prior plans/diagnoses only as evidence, never current authority;
- database/schema/migrations/seeds/backfills;
- contracts/generators/generated clients;
- runtime/infra/configuration;
- tests/fixtures/mocks/snapshots;
- CI/guards/scripts/tools/agent instructions;
- security/privacy/financial/provider behavior;
- external/deployable identities, assets, licenses and registrations when material;
- known incidents/workarounds when they reveal still-required failure/recovery semantics.

For `ACTIVE_SLICE`, exhaust the **complete donor cone capable of changing that slice**, including relevant history. Do not expand Product breadth merely to inspect unrelated donor areas.

For explicit `FULL_TARGET`, repository-wide material donor disposition is required.

## 4. Semantic-atom accounting record

For each materially distinct donor atom record ephemeral evidence with at least:

~~~text
ATOM_ID
SOURCE_PATH / COMMIT / EVIDENCE
SEMANTIC_CLASS
CLAIM / MEANING
CURRENTLY_REQUIRED?
CURRENT_TARGET_OWNER
DISPOSITION
TARGET_DESTINATION_OR_REASON
VERIFICATION
~~~

Allowed dispositions:

~~~text
PRESERVE_AS_TRUTH
REFINE
MERGE
REHOME
REIMPLEMENT
REGENERATE
REFERENCE_ONLY
SUPERSEDE
REJECT_WITH_REASON
~~~

`REFERENCE_ONLY` means the item may remain useful as non-authoritative forensic/reference material but creates no target semantic or implementation authority.

Forbidden dispositions are silent deletion, `IGNORED`, `UNKNOWN_AND_SKIPPED`, or copying because the donor contained it.

## 5. Semantic classification

Every material donor responsibility/journey candidate is classified as exactly one of:

~~~text
DURABLE_CAPABILITY
SUBCAPABILITY_OF_NAMED_OWNER
DURABLE_POLICY
TECHNICAL_MECHANISM
DERIVED_PROJECTION_OR_READ_MODEL
PART_OF_ANOTHER_CAPABILITY
EXPLICIT_NON_GOAL
DEAD_OR_INVALID
~~~

This classification does not by itself authorize an independent service, package, table, route or runtime.

For surviving/reimplemented Product/System meaning, account for the applicable actor/outcome, states/transitions, actions, invariants, failure/recovery, security/privacy/finance, data, contract, surfaces, runtime and canonical readback.

## 6. Required-truth accounting before destructive work

Before deleting or structurally replacing donor-derived/current target value, account for all materially applicable:

~~~text
CAPABILITY / JOURNEY / ACTOR / SCOPE
CANONICAL OWNER / WRITER / READBACK
DURABLE DATA / HISTORY / MIGRATION / RECONCILIATION
CONTRACT / EVENT / GENERATED BINDING
RUNTIME / CONFIG / PROVIDER
SECURITY / PRIVACY / FINANCE
SURFACES / UX / FAILURE / UNKNOWN / RECOVERY
TEST / FIXTURE / MOCK / ASSURANCE
DOC / RUNBOOK / TOOLING VALUE
DEPLOYABLE / EXTERNAL IDENTITY
LICENSE / ASSET PROVENANCE WHEN MATERIAL
~~~

Use `../templates/candidate-proof-matrix.md` for the full affected-cone proof. This profile owns donor-specific accounting only.

The accounting is ephemeral execution evidence and must not become another permanent census/ledger source.

## 7. Service/container admission

A donor service/folder/module name does not prove a target service/container.

~~~text
SEMANTIC RESPONSIBILITY ADMITTED
!=
INDEPENDENT DEPLOYABLE SERVICE ADMITTED
~~~

This applies especially to control-plane, people/HR, notification/search, generic provider/integration, generic runtime/data and infrastructure-shaped donor boundaries.

Donor app-shaped service frontend trees are evidence sources, not target placement authority.

## 8. Durable data reconstruction

When donor data truth must survive:

~~~text
PROVE REQUIRED DURABLE TRUTH / HISTORY
→ PROVE TARGET DATA OWNER / SHAPE
→ DEFINE DETERMINISTIC TRANSFORM
→ MIGRATE / BACKFILL / RESEED ONLY AS GOVERNED
→ VERIFY COUNTS / KEYS / CONSTRAINTS / INVARIANTS
→ CUT OVER TARGET WRITER
→ CUT OVER READERS
→ RECONCILE
→ PROVE CANONICAL READBACK
→ DELETE TARGET LOSING STORAGE / WRITER
~~~

Donor schema or migration chronology is evidence, not automatic target schema authority.

Applied production truth, financial/audit history and externally observable identifiers receive heightened preservation evidence.

## 9. Contract and generated-value reconstruction

For required donor protocol/contract value:

~~~text
PROVE SEMANTIC OWNER
→ ESTABLISH CANONICAL EXECUTABLE CONTRACT SOURCE
→ VALIDATE / COMPOSE
→ REGENERATE DETERMINISTIC BINDINGS
→ CUT OVER CONSUMERS
→ PROVE RUNTIME / READBACK
→ DELETE MANUAL / SHADOW MIRRORS
~~~

Do not preserve actor-, surface-, lifecycle- or historical-file-shaped contract fragments as independent authorities when one stronger semantic owner can absorb them.

## 10. External/deployable identity

Preserve or intentionally migrate every materially required external identity before deleting the donor container that held its configuration, including as applicable:

- mobile package/bundle identifiers;
- Expo/EAS project/update/signing identity;
- URI/deep-link identity;
- store application records and upload/signing relationships;
- web hosting/build-root/base-path/domain identity;
- provider project/application/client/webhook/callback identity;
- database/queue/bucket/external integration bindings;
- observability project/release identity;
- public contract compatibility with proven external consumers.

~~~text
REPOSITORY_PATH_CHANGE != PERMISSION_TO_CHANGE_EXTERNAL_IDENTITY
~~~

Secret values themselves remain in approved secret mechanisms and are never copied into target Git as reconstruction evidence.

## 11. Supporting-value survival

A donor artifact may be deleted while some of its value survives elsewhere. Before deletion classify materially required:

~~~text
PRODUCT / SYSTEM MEANING
DATA / HISTORY
CONTRACT / GENERATED LINEAGE
SECURITY / PRIVACY / FINANCIAL INVARIANT
UX / ACCESSIBILITY / LOCALIZATION VALUE
TEST / FIXTURE / FAILURE SCENARIO
RUNBOOK / OPERATIONAL RECOVERY KNOWLEDGE
TOOL / GUARD / CI INVARIANT
EXTERNAL IDENTITY / ASSET / LICENSE VALUE
~~~

Preserve the value at its current canonical owner or as a non-authoritative reference when appropriate; never preserve a losing donor container just to retain explanation.

## 12. Active-slice zero-loss gate

For `PRODUCT_BREADTH=ACTIVE_SLICE`, donor reconstruction cannot close while any donor area/history capable of changing the active slice remains materially unaccounted:

~~~text
ACTIVE_SLICE_DONOR_CONE_ACCOUNTING=COMPLETE
UNINSPECTED_DONOR_HISTORY_MATERIAL_TO_ACTIVE_SLICE=0
UNACCOUNTED_REQUIRED_SEMANTIC_ATOMS_IN_ACTIVE_SLICE_CONE=0
UNMAPPED_REQUIRED_DATA_CONTRACT_RUNTIME_SECURITY_FINANCE_UX_TEST_VALUE_IN_CONE=0
UNMAPPED_REQUIRED_EXTERNAL_OR_DEPLOYABLE_IDENTITY_IN_CONE=0
DONOR_SHAPE_COPIED_WITHOUT_CANONICAL_PROOF=0
UNJUSTIFIED_DONOR_TRUTH_LOSS_IN_ACTIVE_SLICE_CONE=0
~~~

Global donor saturation is not required when no uninspected donor area can change the slice's owner, semantics, safety, external identity or future-compatible canonical model.

## 13. Full-target zero-loss gate

For explicit `PRODUCT_BREADTH=FULL_TARGET`:

~~~text
DONOR_MATERIAL_HISTORY_INSPECTION=PASS
UNACCOUNTED_MATERIAL_SEMANTIC_ATOMS=0
UNCLASSIFIED_DONOR_RESPONSIBILITIES=0
UNMAPPED_REQUIRED_DONOR_CAPABILITIES_OR_JOURNEYS=0
UNMAPPED_REQUIRED_DONOR_DATA_CONTRACT_RUNTIME_TRUTH=0
UNMAPPED_REQUIRED_DONOR_SECURITY_PRIVACY_FINANCIAL_TRUTH=0
UNMAPPED_REQUIRED_DONOR_UX_OPERATIONAL_TRUTH=0
UNMAPPED_REQUIRED_DONOR_GOVERNANCE_DOC_TOOL_TEST_VALUE=0
UNMAPPED_REQUIRED_DONOR_EXTERNAL_IDENTITY_OR_ASSET_VALUE=0
DONOR_SHAPE_COPIED_WITHOUT_CANONICAL_PROOF=0
BTHWANI_DONOR_REQUIRED_VALUE_DISPOSITION=PASS
~~~

This is semantic zero-loss, never donor-file parity.

## 14. Closure boundary

This profile never declares Product/repository completion. It emits donor-accounting evidence into the normal causal execution cycle.

Closure requires the applicable zero-loss gate plus the exact-candidate proof routed by `../04-VERIFY-REDIAGNOSE-CLOSE.md`.

After verified closure, ephemeral atom/census records may be discarded; Git history retains execution evidence where committed.
