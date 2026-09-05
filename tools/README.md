# Repository Tooling

DOCUMENT_CLASS: HUMAN_DEVELOPMENT_GUIDE
EXECUTION_AUTHORITY: NONE
PRODUCT_AUTHORITY: NONE
ARCHITECTURE_AUTHORITY: NONE
CURRENT_COMMAND_AUTHORITY: LIVE_PACKAGE_SCRIPTS_AND_TOOL_SOURCE

## Purpose

tools/ contains genuinely cross-repository automation, inspection, generation and evidence helpers. It is not a Product, architecture, ownership, readiness or closure authority.

Durable rules are owned by governance/policies/tooling-and-assurance.md.

## Placement rule

~~~text
SERVICE-SPECIFIC TOOL → owning service
APP-SPECIFIC TOOL     → owning app when its lifecycle controls it
CROSS-REPOSITORY TOOL → tools/
~~~

Do not move service/app-specific behavior into tools/ merely for convenience.

## Current major areas

- tools/dev/ — repository development/verification/derivation helpers;
- tools/mobile/ — cross-app mobile development helpers only;
- tools/prompting/bthwani-orchestrator/ — execution/closure constitution and evidence templates.

Exact scripts/commands are discovered from package.json, workflow files and the live tool sources. This README does not freeze an inventory.

## Generated and derived outputs

A generated registry/map/catalog must identify its canonical inputs and be reproducible. Do not edit a derived artifact as a second source of truth.

Use source-derived knowledge queries where appropriate:

~~~text
pnpm knowledge:query -- list capabilities
pnpm knowledge:query -- capability <CAPABILITY_ID>
pnpm knowledge:query -- list journeys
pnpm knowledge:query -- journey <J_ID>
pnpm knowledge:query -- list owners
pnpm knowledge:query -- owner <keyword-or-path>

pnpm docs:verify:all
pnpm knowledge:verify:all
~~~

## Adding a tool

Before adding a material tool/guard/registry/manifest:

1. prove the concrete current consumer/problem;
2. identify the lifecycle owner;
3. check whether compiler/schema/database/test/runtime/generator already provides the invariant;
4. keep Product/business rules at canonical APIs/owners;
5. define deterministic inputs/outputs and failure behavior;
6. expose a discoverable canonical invocation path when cross-repository;
7. add CI only when the evidence is materially required;
8. define deletion/update ownership.

## Removing or replacing a tool

Account for package scripts, CI/workflows, docs, agent adapters and callers. Remove obsolete wrappers, path filters, allowlists, generated outputs and stale docs after cutover.

Green output proves only the tool's claim; it never certifies Product/architecture/closure by itself.
