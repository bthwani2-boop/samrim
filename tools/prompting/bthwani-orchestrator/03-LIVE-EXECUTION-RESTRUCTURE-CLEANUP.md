# Canonical Mutation, Cutover and Cleanup

OWNER_ROLE: CANONICAL_MUTATION_MIGRATION_CUTOVER_DELETION
AUTHORITY_ASSIGNED_BY: 00-ORCHESTRATOR.md
SELF_CERTIFICATION: FORBIDDEN
LOAD_TRIGGER: BEFORE_ANY_REPOSITORY_MUTATION

## 1. Mutation law

Mutate only a root selected by diagnosis and authorized by `01`.

The target of mutation is the final canonical owner/model, not a transitional patch architecture.

~~~text
DEFINE WINNER
→ BUILD/REFOUND WINNER
→ PRESERVE REQUIRED TRUTH/IDENTITY
→ MIGRATE
→ CUT OVER WRITERS/READERS/CONSUMERS
→ DELETE LOSERS
→ PRUNE RESIDUE
→ HAND OFF EXACT CANDIDATE TO VERIFICATION
~~~

## 2. Patch versus demolition

Patch only when current ownership/boundary/model remains canonical.

Demolish/refound when the current structure itself is the defect: wrong owner/bounded context, duplicate writer, shadow truth, no-longer-required compatibility layer, mega-container, speculative framework or irreducible compensation architecture.

Deletion size is not a reason to avoid the correct root.

## 3. Structural-substrate mutation

When `profiles/structural-substrate.md` is activated by diagnosis, build only substrate required by the current causal cone.

Do not create empty service, contract, client, database, migration, test or screen lanes as future readiness placeholders.

A container exists after this mutation only if it already owns a real required technical or semantic responsibility.

## 4. Required-truth preservation

Before destructive change enumerate the truth and external/deployable identity that must survive.

Preserve semantics, durable data, public compatibility obligations, package/bundle/app identity, signing/update relationships and live external references only when actually required.

Do not preserve donor topology, deprecated wrappers or stale abstractions as “safety”.

## 5. Data and external safety

For durable data or external side effects:

- use the canonical owner/writer;
- define deterministic migration/backfill/reconciliation;
- preserve idempotency and concurrency semantics;
- distinguish failed/rejected/pending/unknown;
- never blind-retry ambiguous external mutations;
- cut over writers before deleting old authority;
- verify canonical readback before destructive cleanup.

Financial mutations follow the Financial Model/WLT owners.

## 6. Contract/generated lineage

Change canonical contract source first. Regenerate deterministic outputs, migrate consumers and delete hand-maintained/shadow mirrors after cutover.

Compatibility survives only for a proven live coexistence window with explicit owner, consumers and removal condition.

## 7. Vertical mutation completeness

A semantic unit is mutation-complete only when every materially affected axis is connected:

~~~text
OWNER / DOMAIN
DATA / MIGRATION
CONTRACT / EVENT / CLIENT
RUNTIME / CONFIG / PROVIDER
REQUIRED SURFACES / CONSUMERS
SECURITY / PRIVACY / FINANCE
READBACK / RECOVERY
TEST / ASSURANCE
~~~

Do not hand off isolated backend/frontend/contract fragments as complete.

## 8. Eager loser deletion

Once no required truth, live compatibility, migration or cutover dependency remains:

~~~text
DELETE LOSING WRITER
DELETE LOSING READER/ADAPTER
DELETE OBSOLETE WRAPPER/ALIAS
DELETE DEAD TEST/FIXTURE/GUARD
DELETE EMPTY/MEANINGLESS PARENT
REMOVE WORKSPACE/CONFIG/MANIFEST REGISTRATION
~~~

Git history is the archive.

## 9. No garbage repackaging

Do not “clean” a defect by moving it to `legacy`, `archive`, `shared`, `common`, `core`, `utils` or a new wrapper.

A renamed shadow authority is still a shadow authority.

## 10. Newly exposed findings

If mutation exposes a fact that can change safety, canonical target or root dominance:

~~~text
STOP ONLY THE UNSAFE LOCAL WRITE
→ PRESERVE RECOVERABLE STATE
→ EMIT FINDING TO 02
~~~

Do not self-rank it here.

## 11. Recovery-safe checkpoints

A commit/checkpoint must not knowingly strand mixed writers, partial cutover, untracked migration state or required truth.

Checkpoint movement belongs to `05`; checkpoint existence does not imply closure.

## 12. Clean-target reconstruction

When using a donor, create target structures from current canonical owners and required truth; do not copy donor folders/packages/services wholesale.

Extract only material truth for the authorized scope, build canonical target, migrate/cut over target-internal authority, and leave donor topology outside the target unless independently justified.

## 13. Parallel mutation

Accept parallel units only after `01` proves non-overlap. Preserve exact base SHA and admitted cone; reconcile foreign deltas before integration.

Two concurrent units may not establish competing writers/owners for the same responsibility.

## 14. Minimum necessary complexity

Choose the smallest architecture that satisfies current required semantics, safety, operability and extension pressure.

Do not introduce generic frameworks, brokers, caches, registries, workflow engines, compatibility layers or abstractions without a proven current responsibility and lower total complexity.

## 15. Mutation handoff

When canonical mutation/cutover/cleanup is ready for proof emit:

~~~text
MUTATION_READY_FOR_VERIFICATION
~~~

`04` decides closure. This file never selects the next unit.
