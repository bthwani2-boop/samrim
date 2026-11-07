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

## Admission of operator-editable policies

Every admitted feature change or review should consider whether it contains a **currently useful, operator-changeable commercial or operational decision**. Do not wait for a separate request to expose a genuine policy, but do not turn every constant, preference or business record into an operator setting. Classify the affected decision at the smallest useful scope:

- **ADD NOW:** there is a real recurring operational/business reason to change the value without a code release; an authorized operator can understand and safely control it; the rule has a clear canonical service owner, enforced server-side in the actual workflow, and a small bounded, validated set of options or values.
- **DEFER:** configurability might become useful, but current use, authorized scope, safe behavior or supporting capability is not yet established. Preserve a defensible evolution path without prebuilding a generic policy mechanism or an inactive switch.
- **DO NOT ADD:** the value is ordinary Store/customer/catalog/reference data, a personal or presentation preference, an internal implementation detail, or a non-negotiable security, privacy, authorization, accounting or data-integrity invariant. Keep it with the appropriate existing owner.

Before adding a policy, check whether an existing owner-backed policy or native management workflow already covers the decision, whether changing it has meaningful operational benefit, which actor may approve it, what Store/model or other scope it actually needs, and which prior orders, agreements, customer rights and safety conditions must remain unaffected. Prefer one default per real business scope; introduce per-Store exceptions or more granular scopes only with demonstrated need. The four or other navigation groups displayed by the Operator Policies workspace are presentation, not a fixed limit or new domain authority.

When **ADD NOW** is justified, extend the existing Operator Policies workspace rather than introducing a second policy engine, generic rule language or shadow database. The canonical owner provides the effective value, authorized and validated change, trustworthy readback, and proportionate version/audit/concurrency/recovery evidence. The UI explains the current setting and its effect with minimal fields and a clear save/retry path. Test the real consumer of that policy, including an unauthorized or invalid change and any material negative path; an editable control alone is not proof that the policy works.

**Policy does not grant capability or bypass protection.** A switch never enables unimplemented or unapproved publication, checkout, marketplace access, financial terms or paid services. Identity continues to own actor authority, DSH its Store/commerce/operational decisions, and WLT its financial agreements and ledger. Required reviews and approvals remain at their legal owners; historic Order and agreement facts cannot be rewritten by a later policy update. Administrative flexibility is not authority to remove those boundaries.

Keep the classification lightweight and proportional to the feature. Record the reason when it materially changes product behavior or accepted scope; do not create a parallel registry, mandatory ceremony or speculative policies merely to document the assessment.
