# BThwani Agent Routing

ARTIFACT_CLASS: DERIVED_AGENT_ROUTING
SEMANTIC_AUTHORITY: NONE
EXECUTION_AUTHORITY: NONE
CLOSURE_AUTHORITY: NONE

This file is a compact routing adapter for coding agents. It must never restate or weaken durable Product/System meaning, execution law, or current implementation truth.

## Authority routing

```text
GOVERNANCE   = durable Product/System/architecture/policy meaning
ORCHESTRATOR = authorized execution, mutation, recovery, verification and closure
DOCS         = human development/operations guidance
SOURCE       = current executable implementation/configuration/runtime truth
DONOR/OSS    = evidence and falsification input, never BThwani authority
```

## Selective knowledge loading

Use source-derived queries instead of loading large catalogs when only one semantic unit is needed:

~~~text
pnpm knowledge:query -- list capabilities
pnpm knowledge:query -- capability IDENTITY_ACTIVATION_SESSIONS
pnpm knowledge:query -- list journeys
pnpm knowledge:query -- journey J1
pnpm knowledge:query -- list owners
pnpm knowledge:query -- owner financial
~~~

The command prints the canonical source section at runtime and stores no parallel registry. For CLEAN_TARGET_RECONSTRUCTION, load tools/prompting/bthwani-orchestrator/profiles/clean-target-reconstruction.md after the Orchestrator routes it.

## Mandatory entry sequence for material repository work

1. Pin the exact repository and current working ref/HEAD supplied by the task.
2. Read `governance/GOVERNANCE.md` and only the materially applicable semantic owners.
3. For mutation/refoundation/closure work, load `tools/prompting/bthwani-orchestrator/00-ORCHESTRATOR.md` and the modules it explicitly routes to.
4. Determine `PRODUCT_BREADTH` and `ACTIVE_PRODUCT_SLICE`; never infer `FULL_TARGET` from `LEVEL_4`.
5. Reconstruct current state from live source/history/runtime evidence. Do not use documentation, plans, memory, donor topology, or folder names as implementation authority.
6. Execute only the complete affected/prerequisite/regression cone of the authorized scope. Future target capability breadth is deferred unless explicitly activated.
7. Preserve one semantic owner, one material writer, and one executable cross-boundary contract provenance.
8. Where a user-facing feature appears does not change its business owner: surface-specific feature UI belongs to the consuming app host by default; domain-neutral reusable UI belongs to the Design System.
9. Never create fake Product screens, placeholder business APIs/tables, temporary shadow models, compatibility authorities, or speculative frameworks merely to make future scope appear complete.
10. A green static check is evidence only. Claim closure only through the applicable exact-candidate Orchestrator gates.

## Conflict rule

If this adapter conflicts with Governance, executable source, or the canonical Orchestrator within their respective authority classes, this adapter is stale and must be corrected. It never wins a conflict.

## Scope-specific adapters

Add nested `AGENTS.md` files only when a subtree has stable, unique routing information that cannot be expressed more accurately by its canonical owner. Nested adapters remain routing-only and must not duplicate Product or execution law.
