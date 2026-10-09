# Quality Policy

ARTIFACT_CLASS: DURABLE_CROSS_CUTTING_POLICY
SEMANTIC_OWNER: docs/governance/policies/quality.md
EXECUTION_AUTHORITY: NONE
IMPLEMENTATION_STATE_AUTHORITY: NONE

Quality is the correctness of the approved outcome for its intended actors and materially affected use, not a score, tool count or universal checklist.

- A mock, screenshot, isolated HTTP response or passing component test proves only the seam it exercises. A connected outcome requires the materially affected handoffs to reach canonical owner readback.
- Where available, expected results for a material claim come from an applicable contract, invariant or canonical readback independent of the implementation decision being tested. Higher-consequence claims need relevant negative, authorization, failure, concurrency or recovery evidence.
- Synthetic proof state is isolated and created through canonical owner operations. Reuse valid state when safe. Direct persistence mutation is limited to persistence, fault or recovery claims; synthetic state never becomes Product truth.
- Performance and capacity claims use a representative end-to-end workload and realistic bounded data. Do not infer scale from toy fixtures or impose one threshold on unrelated resources.
- User-facing correctness includes rendered behavior and materially applicable interaction, recovery, RTL, responsive and accessibility needs. The Experience and Design policies own those durable semantics; AGENTS.md owns agent execution.
