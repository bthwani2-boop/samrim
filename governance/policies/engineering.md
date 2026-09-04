# BThwani Engineering Constitution

ARTIFACT_CLASS: DURABLE_ENGINEERING_POLICY
SEMANTIC_OWNER: governance/policies/engineering.md
EXECUTION_AUTHORITY: NONE
CLOSURE_AUTHORITY: NONE
IMPLEMENTATION_STATE_AUTHORITY: NONE

## Governing law

> **Correct cause, correct owner, correct layer, correct standard, minimum necessary complexity, complete vertical integrity, complete cutover, zero parallel truth, zero known material residue tied to the change.**

A change is not engineering-correct merely because it compiles, passes tests, makes a screen work, reduces a diff, or removes one symptom. It must preserve canonical ownership and invariants across every materially affected writer, reader, consumer, contract, data path and runtime boundary.

## Policy ownership

This file owns cross-cutting engineering law and routes specialized durable requirements to:

- `architecture-and-fullstack.md` — architecture, layer responsibility, dependencies, contracts/generated boundaries and full-stack integrity;
- `data-and-migrations.md` — schemas, constraints, migrations, backfills, seeds/fixtures and data cutovers;
- `frontend-and-client.md` — screens/controllers/adapters, local state/readback, mobile/client lifecycle and resource correctness;
- `runtime-reliability.md` — runtime/config/providers, observability, resilience, performance/capacity and recovery;
- `standards-and-quality.md` — context-appropriate Best Practice/standards adequacy and quality.

Security/privacy remains owned by `security.md`; delivery/promotion/release by `delivery.md`; Product/System semantics by `../product/**`.

## Universal engineering invariants

- Every durable fact and mutation has one authoritative owner and one canonical write path.
- Cross-domain access uses explicit contracts; no direct cross-service table mutation or copied business authority.
- Projections, caches, read models, mocks, local UI state and generated outputs remain subordinate and reconstructable.
- Correct defects at the highest authoritative owner that can actually remove the cause; do not patch descendants while an upstream owner remains wrong.
- Reusable logic belongs at the smallest stable owner with real multiple consumers; a `shared/common/utils` name never creates authority.
- Generated artifacts change through their canonical source/generator, then regenerate deterministically and verify affected consumers.
- Breaking ownership/contract/data changes require complete writer/reader/consumer migration, safe cutover and retirement of the superseded authority.
- Known obsolete compatibility, duplicate authority, stale aliases, dead fallback or half-migration tied to the change is not acceptable final residue.
- Task/process terminology, branch names, prompt concepts and verification mechanics must not leak into Product/runtime architecture.

## Complete impact rule

The materially affected set of a change includes every dependency or consumer whose correctness can change because of it. Physical app/service/file boundaries cannot truncate that set.

When a Product outcome crosses layers, correctness is proven vertically as applicable:

```text
Product/Journey
-> Surface
-> Controller/ViewModel
-> Contract Adapter/Generated Client
-> Canonical Contract
-> Auth/Authz
-> Backend/Application Boundary
-> Domain Owner
-> Persistence/Event/Provider Boundary
-> Schema/Constraints/Migration
-> Persisted/External Result
-> Canonical Readback
-> All affected Consumers/Surfaces
```

Only materially applicable links are required; each omitted link requires an actual non-applicability reason, not assumption.

## Verification law

Use the smallest evidence capable of falsifying the affected claim, then expand by risk. Static reachability is not semantic correctness; build success is not runtime proof; runtime success is not authorization/security/data-migration proof; tool green is not system correctness.

Do not create meta-guards, duplicate diagnostics or assurance bureaucracy when existing compiler/test/runtime/security capabilities can prove the same invariant more directly.

## Cleanup law

Prefer deletion/consolidation after proven cutover over indefinite compatibility. Before move/delete/merge, prove real consumers, generated/runtime dependencies, migration/data consequences and recovery. Git is history; active backup copies and task artifacts are not architecture.
