# BThwani Agent Routing

ARTIFACT_CLASS: DERIVED_AGENT_ROUTING
SEMANTIC_AUTHORITY: NONE
EXECUTION_AUTHORITY: NONE
CLOSURE_AUTHORITY: NONE

## Authority routing

~~~text
GOVERNANCE   = durable Product/System/architecture/policy meaning
SOURCE       = current executable implementation/configuration/runtime truth
ORCHESTRATOR = authorized scope/diagnosis/mutation/recovery/evidence/closure
DOCS         = human development/operations guidance
DONOR/OSS    = evidence/falsification input only
~~~

## Material-work entry

1. Pin the exact repository/ref/HEAD.
2. Read `governance/GOVERNANCE.md`.
3. Load only materially applicable semantic owners through source-derived lookup.
4. For repository mutation/refoundation/closure, read `tools/prompting/bthwani-orchestrator/00-ORCHESTRATOR.md` and only the modules it routes for the current state.
5. Resolve `PRODUCT_BREADTH` and the authorized outcome. `LEVEL_4` never activates future Product breadth.
6. Reconstruct current implementation only from executable source/history/runtime.
7. Execute the complete causal affected cone of the authorized outcome; structural work is pulled forward only when diagnosis proves it is a prerequisite.
8. Preserve one semantic owner, one material writer and one cross-boundary contract provenance.
9. Do not create empty future lanes, fake Product screens/APIs/tables, shadow models, compatibility authorities or speculative frameworks.
10. Verify the exact candidate and repeat the causal cycle until the authorized-scope fixed point or a legitimate blocker.

## Source-derived lookup

~~~text
pnpm knowledge:query -- list capabilities
pnpm knowledge:query -- capability <CAPABILITY_ID>
pnpm knowledge:query -- list journeys
pnpm knowledge:query -- journey <J_ID>
pnpm knowledge:query -- list owners
pnpm knowledge:query -- owner <keyword-or-path>
~~~

The query tool is derived from canonical sources and is never a parallel registry.

For clean-target reconstruction, load `tools/prompting/bthwani-orchestrator/profiles/clean-target-reconstruction.md` only when a donor is supplied.

## Conflict rule

This file never wins a conflict. Correct routing is:

~~~text
DURABLE MEANING CONFLICT → GOVERNANCE OWNER
CURRENT IMPLEMENTATION CONFLICT → SOURCE/RUNTIME
EXECUTION/CLOSURE CONFLICT → ORCHESTRATOR OWNER
HUMAN PROCEDURE CONFLICT → UPDATE DOCS
~~~
