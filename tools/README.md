# Repository Tooling

DOCUMENT_CLASS: HUMAN_DEVELOPMENT_GUIDE
EXECUTION_AUTHORITY: NONE
PRODUCT_AUTHORITY: NONE
ARCHITECTURE_AUTHORITY: NONE
CURRENT_COMMAND_AUTHORITY: LIVE_PACKAGE_SCRIPTS_AND_TOOL_SOURCE

## Purpose

`tools/` contains genuinely cross-repository automation, inspection, generation and evidence helpers. It is not a Product, architecture, ownership, readiness or closure authority.

Durable assurance/verification rules are owned by the exact pinned `governance/policy/QUALITY.md`, while durable system/repository boundaries are owned by pinned Governance/Docs resolved through `knowledge.sources.json`.

## Placement rule

~~~text
SERVICE-SPECIFIC TOOL → owning service
APP-SPECIFIC TOOL     → owning app when its lifecycle controls it
CROSS-REPOSITORY TOOL → tools/
~~~

Do not move service/app-specific behavior into `tools/` merely for convenience.

## Public command boundary

Root `package.json` is the human/developer command surface, not an index of every repository executable.

`pnpm verify` is the canonical exact-local-candidate verification entrypoint. Knowledge, docs, repository and candidate evidence producers remain internal implementations invoked directly by CI or the verifier.

`pnpm safe:push` reruns `pnpm verify`, reconciles the current branch with the remote using fast-forward-only rules, pushes the same branch, and confirms the exact remote SHA.

~~~text
AGENTS.md      → repository agent law
Git            → repository state
pnpm verify    → exact local candidate proof
pnpm safe:push → push safety + remote SHA confirmation
GitHub CI      → independent exact-SHA confirmation
~~~

Pinned Governance/Docs materializes automatically when an internal consumer needs it. For explicit source inspection use:

~~~text
node tools/dev/knowledge-source.mjs
~~~

For source-derived knowledge exploration, invoke the implementation directly when needed:

~~~text
node tools/dev/query-knowledge.mjs list capabilities
node tools/dev/query-knowledge.mjs capability <CAPABILITY_ID>
node tools/dev/query-knowledge.mjs list journeys
node tools/dev/query-knowledge.mjs journey <J_ID>
node tools/dev/query-knowledge.mjs list owners
node tools/dev/query-knowledge.mjs owner <keyword-or-path>
node tools/dev/query-knowledge.mjs list references
node tools/dev/query-knowledge.mjs reference <keyword-or-class-or-path>
node tools/dev/query-knowledge.mjs list quality-dimensions
~~~

## Generated and derived outputs

A generated registry/map/catalog must identify its canonical inputs and be reproducible. Do not edit a derived artifact as a second source of truth.

## Adding a tool

Before adding a material tool/registry/manifest:

1. prove the concrete current consumer/problem;
2. identify the lifecycle owner;
3. check whether compiler/schema/database/test/runtime/generator already provides the invariant;
4. keep Product/business rules at canonical APIs/owners;
5. define deterministic inputs/outputs and failure behavior;
6. expose a public command only when a recurring human workflow needs one;
7. add CI only when the evidence is materially required;
8. define deletion/update ownership.

## Removing or replacing a tool

Account for package scripts, CI/workflows, Docs, `AGENTS.md` and callers. Remove obsolete wrappers, path filters, generated outputs and stale docs after cutover.

Green output proves only the tool's claim; it never certifies Product/architecture/closure by itself.
