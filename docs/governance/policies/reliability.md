# Reliability Policy

ARTIFACT_CLASS: DURABLE_CROSS_CUTTING_POLICY
SEMANTIC_OWNER: docs/governance/policies/reliability.md
EXECUTION_AUTHORITY: NONE
IMPLEMENTATION_STATE_AUTHORITY: NONE

- Every material mutation defines retry/idempotency semantics.
- Unknown external or cross-service outcomes are reconciled before blind replay.
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
