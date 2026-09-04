# Data, Database, Migration, Backfill, and Seed Policy

ARTIFACT_CLASS: DURABLE_DATA_POLICY
SEMANTIC_OWNER: governance/policies/data-and-migrations.md
EXECUTION_AUTHORITY: NONE
CLOSURE_AUTHORITY: NONE
IMPLEMENTATION_STATE_AUTHORITY: NONE

## Data authority

Every durable data fact has one canonical owning domain/service and one governed mutation path. Another service may consume a contract-permitted projection/reference but must not directly mutate the owner's tables or recreate the owner's business calculations as independent truth.

Each service/database authority owns one migration history. Applied migration identity/order/checksum is immutable; corrections use explicit forward-safe migrations rather than rewriting history for cleanliness.

## Database responsibility

Use the database to encode durable integrity close to the data when appropriate:

- primary/foreign keys and ownership references;
- uniqueness and exclusion constraints;
- check constraints for durable data invariants;
- transaction boundaries and atomic mutation invariants;
- indexes matching materially required access paths;
- version/concurrency state where optimistic/pessimistic control requires it;
- outbox/event persistence when atomic state+event publication is required.

Do not move mutable Product workflow policy into opaque database logic merely because it can be expressed in SQL. Database constraints protect durable invariants; domain/application owners decide governed behavior.

## Migration law

For persistent changes prove as applicable:

`fresh install | representative upgrade | ordering | compatibility | constraints | indexes | existing data shape | backfill | idempotency | concurrency | batching | restart | readback | destructive-change safety | recovery/forward-fix`.

Risky ownership/schema transitions prefer:

```text
expand
-> migrate/backfill
-> reconcile
-> switch canonical writers
-> switch readers/consumers
-> prove canonical readback
-> zero superseded authoritative writer
-> contract/remove obsolete schema/path
```

A one-step destructive replacement is allowed only when evidence proves there is no material compatibility/data/recovery risk.

## Persisted authority migration

When truth ownership moves:

```text
current owner
-> target owner/schema
-> forward migration
-> backfill
-> reconciliation
-> bounded compatibility only if required
-> switch writers
-> switch readers/consumers
-> canonical readback
-> zero old authoritative writer
-> cleanup/deletion
```

Filesystem/code cutover without persisted data and consumer cutover is a half-migration.

## Backfill and reconciliation

Backfills are production/data evolution operations, not business runtime. They must define source authority, selection scope, deterministic transformation, idempotency/restart behavior, batching/locking where needed, observability, reconciliation and completion criteria.

Financial/audit/business-critical records are reconciled by their canonical owner. Deleting inconsistent rows is not reconciliation unless the durable Product/data policy explicitly proves deletion is the correct disposition.

## Seeds and fixtures

```text
SEED != PRODUCT TRUTH
SEED != MIGRATION
SEED != BACKFILL
SEED != PRODUCTION REPAIR
```

Seeds/fixtures exist for deterministic local/CI/test setup, representative states and journey verification. They must be clearly non-production, reproducible and subordinate to the same contracts/invariants as real state. They must not hide missing migrations, create production prerequisites, fabricate business authority or become a runtime fallback.

Production-derived data is not ordinary seed material. If exceptionally used for diagnosis, it must be authorized, minimized/sanitized, protected, time-bounded and removed after purpose.

## Idempotency and concurrency

For duplicate/retry/concurrent mutation risk, define the canonical identity, payload-consistency rule, legal replay result, lock/version/constraint boundary and recovery behavior. A retry with the same identity but materially different payload must not silently represent a second command.

Correctness must hold under concurrent writers, process restart and partial failure where materially applicable; a passing sequential happy-path test is insufficient evidence.

## Destructive changes and retention

Before deletion/narrowing prove all remaining readers/writers, legal/audit/financial retention, archival or reconciliation needs, rollback/forward-recovery implications and rollout compatibility. Deletion follows cutover evidence, not preference for a cleaner schema.

## Recovery

For durable-data risk, backup configuration alone is not proof. Establish the applicable restore/PITR/rebuild claim, migration/backfill recovery behavior and representative recovery evidence when operational correctness depends on it. Numeric RPO/RTO values require an authorized operational requirement; do not invent them.

## Closure

Data closure requires consistent owner/schema/constraints/migration history, correct backfill/reconciliation, canonical readback, migrated consumers, zero superseded authoritative writer and no material duplicate/orphan/drift residue tied to the root.
