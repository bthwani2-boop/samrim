# Security, Data and Reliability

ARTIFACT_CLASS: DURABLE_GOVERNANCE
SEMANTIC_OWNER: docs/governance/safety.md
EXECUTION_AUTHORITY: NONE
IMPLEMENTATION_STATE_AUTHORITY: NONE

## Security Policy

- Authenticate acting humans/services from trusted proof, never caller-authored identity values.
- Authorize every protected object/action at the canonical owner using actor plus object/business scope.
- Client input never grants role, Store ownership or service authority.
- Fail closed on missing or invalid trusted context.
- Public authentication/recovery avoids unnecessary account/role enumeration.
- Credentials, tokens, recovery material and secrets are purpose-bound, protected, rotated or revoked when compromised and never logged.
- Each service's database runtime identity has only the privileges needed for its owned data and operations, even when services share one database server. Runtime identities must not have superuser or schema-administration rights; migration/administration authority is separate. Any bounded cross-owner access requires an explicit justified contract, and isolation is proved by permitted-operation success and denied cross-owner access.
- Security-sensitive challenges define expiry, attempts, replay/single-use and throttling behavior.
- Sensitive data and precise location are minimized and redacted by actor need.
- Operator access follows `IDENTITY_ACTIVATION_SESSIONS`; no weaker parallel path.
- Negative authorization tests cover cross-actor, cross-Store and cross-Captain boundaries.

## Data Policy

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

## Reliability Policy

- Every material mutation defines retry/idempotency semantics.
- Unknown external or cross-service outcomes are reconciled before blind replay.
- A cross-owner transition that affects authorization or release of money may be described as complete only when its required owner acknowledgments and persisted eligibility are proved. If an owner is unavailable, expose the incomplete/degraded outcome and prevent unsafe dependent financial execution until current eligibility can be revalidated; a partial write, a missing retry or an immutable historical snapshot is not success evidence.
- Concurrency-sensitive ownership, assignment, custody and terminal transitions fail deterministically rather than forking truth.
- A multi-record mutation that cannot remain safely bounded as one synchronous operation is represented as an identifiable operation whose scope, progress and outcome can be resumed or reconciled from canonical state. Partial completion or per-record failure must not masquerade as atomic success.
- Timeouts are decisions only when the owning capability defines their durable consequence.
- Offline/degraded UI never fabricates canonical success.
- No silent fallback may switch canonical owner, writer, truth source or success semantics. A degraded or alternate path is allowed only when explicitly bounded by the owning capability and must remain observable as degraded/alternate behavior rather than masquerading as canonical success.
- Material boundary failures are machine-classifiable through stable categories/codes suitable for control flow and reconciliation; human-readable text is secondary and must not be parsed as the authoritative failure contract.
- Restart/resume reconstructs from canonical owner state.
- Readiness/health distinguishes configured, available, degraded and unknown where material.
- Observability preserves correlation and cause without logging secrets or unnecessary personal data.
- Recovery proves final owner readback.
