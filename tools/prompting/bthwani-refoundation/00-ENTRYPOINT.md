# BThwani Canonical Target Package — Entrypoint

PACKAGE_REVISION: 7
PACKAGE_CLASS: PORTABLE_BTHWANI_TARGET_SPECIALIZATION
COMPLETION_TARGET: LEVEL_4_FIXED_POINT
TEMPORARY_ARTIFACT: YES
PROGRESS_LEDGER: FORBIDDEN
SELF_DELETE_AFTER_VERIFIED_CLOSURE: REQUIRED

## 0. Authority

This package defines what BThwani must converge to. It does not describe repository preparation/transfer and does not own execution state.

The sole execution/closure constitution is `tools/prompting/bthwani-orchestrator/00-ORCHESTRATOR.md` plus its required owners.

```text
ORCHESTRATOR_00..05 + APPLICABLE focus/*
> THIS TARGET PACKAGE
> CURRENT IMPLEMENTATION SHAPE
```

If a general law is stronger here than in its durable orchestrator owner, promote the durable owner and keep only the BThwani-specific consequence here.

## 1. Mission

Define the canonical target for:

```text
DEPLOYABLE HOSTS          → apps/
BOUNDED CONTEXTS/SERVICES → services/
REUSABLE TECHNICAL CODE   → packages/
CROSS-SERVICE WIRE LAW    → contracts/
ENVIRONMENT/DEPLOYMENT    → infra/
DURABLE PROJECT MEANING   → governance/
HUMAN GUIDANCE/RUNBOOKS   → docs/
AUTOMATION/EVIDENCE       → tools/
```

The target preserves required Product/System/UX/data/security/financial/operational truth while rejecting duplicate owners, shadow writers, generic buckets, stale compatibility and accidental topology.

## 2. Mandatory load order

1. Load orchestrator `00` through `05` and materially applicable `focus/*`.
2. Load this entrypoint.
3. Load `01-CANONICAL-REPOSITORY-TOPOLOGY.md`.
4. Load `02-TARGET-BOUNDARY-MAP.md`.
5. Load `03-REQUIRED-TRUTH-CENSUS.md`.
6. Load every materially applicable `targets/*.md`.
7. Load `closure/CAPABILITY-CUTOVER-AND-DELETION.md` when replacing any current authority/path/data/contract.
8. Load `closure/TARGET-FIXED-POINT.md` for structural/capability/final qualification.

## 3. Foundational roles

- `01-CANONICAL-REPOSITORY-TOPOLOGY.md` — BThwani repository taxonomy and structural target.
- `02-TARGET-BOUNDARY-MAP.md` — BThwani-specific owner/dependency/boundary consequences.
- `03-REQUIRED-TRUTH-CENSUS.md` — exhaustive anti-forgetting evidence template; not a law owner.
- `closure/CAPABILITY-CUTOVER-AND-DELETION.md` — BThwani replacement/cutover specialization inside the active repository.
- `closure/TARGET-FIXED-POINT.md` — exhaustive BThwani target gates.

## 4. Target modules

The target modules cover apps/composition, DSH/WLT, Identity/Workforce, Platform Control, external integrations, design system/packages, contracts/protocols, infra/runtime, governance knowledge, docs/runbooks and tooling/assurance.

Each module specializes target decisions only; general diagnosis/execution/verification law remains in the orchestrator owners.

## 5. Exact-state and recovery law

This package contains target decisions, not current-state snapshots.

At every execution session:

```text
PIN_CURRENT_HEAD
→ RECONSTRUCT_CURRENT_STAGE/UNIT
→ VERIFY_CURRENT_WINNER/LOSER/CUTOVER_STATE
→ INVALIDATE_STALE_EVIDENCE
→ RECHECK_NEGATIVE_SPACE
→ FIND_RECOVERY_FRONTIER
→ DERIVE_NEXT_REQUIRED_ACTION
```

## 6. Completeness law

Before changing package structure or deleting/merging a module:

```text
CENSUS_MATERIAL_LAWS_AND_TARGET_DECISIONS
→ MAP_EACH_TO_ONE_OWNER/MODULE
→ PROVE_NO_MATERIAL_DECISION_DROPPED
→ PROVE_NO_CONFLICTING_DUPLICATE_CREATED
→ ONLY_THEN_DELETE/MERGE/REHOME
```

Representation cleanup is never permission to drop still-valid Product/System meaning.

## 7. External reference loading

External reference material under `docs/reference/**` is conditional:

```text
MATERIAL_UNKNOWN
OR DESIGN_GAP
OR FAILURE_MODE_GAP
OR ADOPTION_DECISION
→ LOAD_ONLY_RELEVANT_REFERENCE

OTHERWISE
→ DO_NOT_LOAD
```

Reference selection never grants authority or adoption rights.

## 8. Package lifetime

After repository-wide Level-4 fixed point and after no execution/tool consumer depends on this package, delete the entire package and prove zero references. Git history is the archive.
