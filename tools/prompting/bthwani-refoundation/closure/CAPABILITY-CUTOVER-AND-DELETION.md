# Capability Cutover and Deletion

TEMPORARY_TARGET_SPECIALIZATION: YES
GENERAL_EXECUTION_AUTHORITY: tools/prompting/bthwani-orchestrator/03-LIVE-EXECUTION-RESTRUCTURE-CLEANUP.md

## Purpose

Specialize replacement/cutover inside the active repository. This file does not describe repository preparation or transfer.

## Replacement sequence

When an existing authority/path/data shape is replaced:

```text
SALVAGE_REQUIRED_TRUTH
→ ESTABLISH_CANONICAL_OWNER
→ BUILD/REFOUND WINNER
→ MIGRATE DATA/CONTRACTS/GENERATED OUTPUTS
→ MIGRATE WRITERS
→ MIGRATE READERS/CONSUMERS
→ CUT OVER ROUTES/EXPORTS/CONFIG/RUNTIME
→ DISABLE OLD WRITES
→ DELETE LOSER
→ REMOVE ALIASES/COMPATIBILITY
→ PRUNE PARENTS
→ VERIFY NEGATIVE SPACE
```

Move, rename, green build or partial connection is not cutover.

## Vertical capability closure

After structural enabling roots are qualified, prefer:

```text
PRODUCT MEANING
→ DATA/STORAGE
→ DOMAIN WRITER/READER
→ TRANSPORT/EVENT
→ CONTRACT
→ GENERATED BINDING
→ SERVICE PRESENTATION
→ APP HOST COMPOSITION
→ MATERIAL ACTION/MUTATION
→ PERSISTED/OBSERVABLE READBACK
→ ALL REQUIRED CONSUMERS
→ DELETE LOSERS
→ NEGATIVE SPACE
```

## Durable-data migration

When durable state changes owner/shape:

```text
PROVE_REQUIRED_DURABLE_TRUTH
→ DEFINE DETERMINISTIC TRANSFORM
→ BACKFILL/MIGRATE
→ VERIFY COUNTS/KEYS/CONSTRAINTS/INVARIANTS
→ CUT OVER WRITER
→ CUT OVER READERS
→ RECONCILE
→ DELETE OLD STORAGE AUTHORITY
→ PROVE READBACK
```

## Compatibility

Internal consumers under atomic repository control cut over together where feasible.

A compatibility layer for independently deployed/external consumers requires explicit owner, scope, real version combination, telemetry/migration condition and deletion trigger.

`COMPATIBILITY_JUST_IN_CASE = FORBIDDEN`.

## Deployable identity

Repository/path refactoring must not silently change established deployable identity. Preserve required Expo/EAS project identity, package/bundle identifiers, schemes, signing/update/hosting bindings and equivalent deployable identity unless an intentional migration explicitly changes them.

## Concurrency

Only one active writer may mutate an overlapping ownership/data/contract/cutover cone at a time. Head movement requires reconciliation before further writes.

## Deletion gate

```text
OLD_WRITERS=0
OLD_READERS/CONSUMERS=0
COMPATIBILITY_RESIDUE=0
STALE_EXPORTS/CONFIG/TEST/TOOL_RESIDUE=0
REQUIRED_VALUE_STRANDED=0
NEGATIVE_SPACE=PASS
```
