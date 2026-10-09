# Change and Delivery Policy

ARTIFACT_CLASS: DURABLE_CROSS_CUTTING_POLICY
SEMANTIC_OWNER: docs/governance/policies/delivery.md
EXECUTION_AUTHORITY: NONE
IMPLEMENTATION_STATE_AUTHORITY: NONE

- Current user/business outcome drives work order; do not exhaust one surface/domain backlog.
- When materially refounding or extending a technology/tool/platform boundary, evaluate current stable primary-source capabilities that can delete meaningful custom complexity or risk; do not upgrade solely for recency and do not retain an older mechanism solely from inertia.
- Implement the smallest coherent cross-surface vertical slice that proves the earliest unresolved shared boundary, across every materially affected surface and owner. Use end-to-end journeys for integration proof, not as a parallel execution backlog.
- Core-first does not mean speculative foundation first.
- Preserve changeability, not speculative machinery: future capability or scaffolding is not implemented without current need, while materially costly-to-reverse current identities, boundaries, persistent data shapes and external contracts require explicit reversibility/evolution-cost classification and a defensible migration/extension/cutover path for evidence-backed evolution risks.
- Readiness precedes mutation when a decision-critical unknown can change owner, migration, safety or proof.
- A cutover includes all material consumers, migrations/contracts/config/tests/verifiers and deletion of losing paths.
- Temporary compatibility exists only for a proven current coexistence need and must have one owner, known consumers, a bounded lifetime or exit condition, and a deletion trigger. It must not become a second truth/writer or permanent default. Without those conditions, delete it rather than preserve it "just in case".
- Smallest diff is not the goal; simplest complete canonical system is.
- Structural/refoundation cleanup preserves externally registered deployable identity such as app package/bundle IDs, Expo/EAS project identity, URI/deep-link schemes, signing relationships and provider app/client bindings unless changing that identity is itself explicitly authorized.
- A candidate closes only from exact-state evidence with zero known material defect in its authorized cone.
- Current increment closure proves the admitted current outcome; it does not imply capability exhaustion, a permanently final domain model or permanent rejection of future Product breadth that has not yet been examined or admitted.
- Repository mutation authority never implies build distribution, store submission, release, staging or Production authority.
