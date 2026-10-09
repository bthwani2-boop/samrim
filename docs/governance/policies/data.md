# Data Policy

ARTIFACT_CLASS: DURABLE_CROSS_CUTTING_POLICY
SEMANTIC_OWNER: docs/governance/policies/data.md
EXECUTION_AUTHORITY: NONE
IMPLEMENTATION_STATE_AUTHORITY: NONE

- One durable fact has one canonical writer and one owning migration history.
- Schema and application changes cut over coherently; obsolete dual-write/shadow schemas require a proven bounded coexistence need.
- Migrations are deterministic, ordered, reviewable and fail closed on incompatible preconditions.
- Idempotency, ownership integrity and concurrency invariants belong in durable constraints where reliable.
- Any durable invariant that is reliably expressible at the persistence boundary is enforced there through the strongest appropriate mechanism, such as `NOT NULL`, `UNIQUE`, foreign keys, `CHECK`, transaction atomicity, isolation or locking. Application/UI validation is complementary and must not be the sole protection for persistent truth when the database can enforce the invariant reliably.
- Generated/derived/read-model state is rebuildable and never mutation authority.
- Collection reads that can materially grow are bounded by default rather than requiring clients to load an unbounded result merely to search, filter, sort, compare or act on it.
- Paged or incremental reads whose correctness depends on sequence use deterministic ordering, including a stable tie-breaker when needed so adjacent requests do not rely on an ambiguous order.
- Choose the simplest paging or incremental-read strategy whose correctness and cost remain fit for the expected volume, change rate and access pattern. No single paging mechanism is globally mandatory; a strategy that degrades materially beyond the expected operating envelope must be replaced by a bounded alternative that preserves canonical result semantics.
- Synthetic/non-production proof data is disposable environment state. It never becomes migration/bootstrap Product data, and test convenience alone never justifies durable test-only schema or parallel fact ownership. Prefer environment isolation to polluting domain models with test flags.
- Personal data is minimized, purpose-limited and exposed only to materially authorized consumers.
- Retention/deletion/anonymization obligations stay with the fact owner; no global shortcut destroys another owner's required retained truth.
- Material media state uses one canonical write or upload path, one storage owner and one durable reference model when BThwani owns that media lifecycle.
- Replacing or removing media preserves referential integrity and cleans superseded or orphaned media when no retention obligation requires preservation.
- Data policy owns media reference and storage lifecycle only. Provenance, licensing and visual use remain with the applicable Design or domain owner; domain-specific media requirements remain with the owning capability.
