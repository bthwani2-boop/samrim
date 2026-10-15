# Data Policy

ARTIFACT_CLASS: DURABLE_CROSS_CUTTING_POLICY
SEMANTIC_OWNER: docs/governance/policies/data.md
EXECUTION_AUTHORITY: NONE
IMPLEMENTATION_STATE_AUTHORITY: NONE

- One durable fact has one canonical writer and one owning migration history.
- Text integrity is end-to-end: new or modified text sources and transport payloads use verified UTF-8, with decoding/transcoding of external legacy encodings at ingestion boundaries only. A byte-order mark is avoided for source files unless a consumer requires it (for example an Excel-compatible CSV export). Preserve Arabic Unicode and mixed-direction identifiers without double-decoding, guessing a replacement encoding, or substituting mojibake for real content; validate round trips across API, storage and display when materially affected. Encoding fixes must preserve original business facts and user data.
- Schema and application changes cut over coherently; obsolete dual-write/shadow schemas require a proven bounded coexistence need.
- For a migration affecting retained local, shared or production-like state, record the exact source/applied schema boundary, protect the target with a restorable restricted backup and rehearse the upgrade/restore on an isolated copy. Stop or coordinate incompatible writers, apply through the owning migration runner, then verify version, record identity, integrity and compatible service readback before resuming. A successful disposable migration test does not grant permission to reset, overwrite or mutate durable shared data.
- Migrations are deterministic, ordered, reviewable and fail closed on incompatible preconditions.
- Idempotency, ownership integrity and concurrency invariants belong in durable constraints where reliable.
- Any durable invariant that is reliably expressible at the persistence boundary is enforced there through the strongest appropriate mechanism, such as `NOT NULL`, `UNIQUE`, foreign keys, `CHECK`, transaction atomicity, isolation or locking. Application/UI validation is complementary and must not be the sole protection for persistent truth when the database can enforce the invariant reliably.
- Generated/derived/read-model state is rebuildable and never mutation authority.
- Collection reads that can materially grow are bounded by default rather than requiring clients to load an unbounded result merely to search, filter, sort, compare or act on it.
- Paged or incremental reads whose correctness depends on sequence use deterministic ordering, including a stable tie-breaker when needed so adjacent requests do not rely on an ambiguous order.
- Choose the simplest paging or incremental-read strategy whose correctness and cost remain fit for the expected volume, change rate and access pattern. No single paging mechanism is globally mandatory; a strategy that degrades materially beyond the expected operating envelope must be replaced by a bounded alternative that preserves canonical result semantics.
- Synthetic/non-production proof data is environment state, not Product truth. It is disposable only when its test ownership, isolation, lack of shared or durable dependencies, and authorized cleanup scope are verified. Preserve useful local development state and all unknown-origin records; test convenience alone never justifies durable test-only schema or parallel fact ownership. Prefer environment isolation to polluting domain models with test flags.
- Personal data is minimized, purpose-limited and exposed only to materially authorized consumers.
- Retention/deletion/anonymization obligations stay with the fact owner; no global shortcut destroys another owner's required retained truth.
- Material media state uses one canonical write or upload path, one storage owner and one durable reference model when BThwani owns that media lifecycle.
- Replacing or removing media preserves referential integrity and cleans superseded or orphaned media when no retention obligation requires preservation.
- Data policy owns media reference and storage lifecycle only. Provenance, licensing and visual use remain with the applicable Design or domain owner; domain-specific media requirements remain with the owning capability.
