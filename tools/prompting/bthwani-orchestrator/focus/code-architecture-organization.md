# Focus — Code, Architecture and Repository Organization

ARTIFACT_CLASS: ORCHESTRATOR_EXECUTION_FOCUS_LENS
LENS_ROLE: CODE_ARCHITECTURE_REPOSITORY_ORGANIZATION_APPLICATION
ROUTED_BY: 00-ORCHESTRATOR.md
DURABLE_SEMANTIC_AUTHORITY: NONE
CURRENT_IMPLEMENTATION_AUTHORITY: NONE
SELF_CERTIFICATION: FORBIDDEN

This lens applies and falsifies the current canonical architecture, topology and placement owners during execution. It never defines durable architecture itself.

## 1. Required routing

Before structural work load only the materially applicable owners:

- governance/architecture/REPOSITORY-TOPOLOGY.md
- governance/architecture/APP-SERVICE-COMPOSITION.md
- governance/architecture/OWNERSHIP-AND-SOURCE-OF-TRUTH.md
- governance/architecture/DATA-CONTRACTS-AND-INTEGRATIONS.md
- applicable governance/policies owners

Then inspect exact current source, workspace manifests, imports, routes and history.

## 2. Structural diagnosis

For every affected file, container, package, service or app surface answer:

~~~text
WHAT UNIQUE RESPONSIBILITY EXISTS?
WHO IS THE CANONICAL OWNER?
IS THIS THE CORRECT PATH/CONTAINER?
DO OTHER CONTAINERS IMPLEMENT THE SAME MATERIAL RESPONSIBILITY?
IS THIS CONTAINER STILL REACHABLE/CONSUMED?
CAN IT BE ABSORBED INTO A STRONGER OWNER WITHOUT LOSS?
WHAT IMPORT/EXPORT/ROUTE/MANIFEST/TEST/CONFIG EDGES KEEP IT ALIVE?
~~~

Cluster by material meaning, data flow, writer and readback — not filename similarity. Emit findings to 02-DIAGNOSE-ROOT-CAUSE.md; do not self-rank here.

## 3. Structural mutation application

When 03-LIVE-EXECUTION-RESTRUCTURE-CLEANUP.md mutates a structural root:

1. establish the final canonical owner and path;
2. migrate required implementation, data, contracts, tests, config and consumers;
3. cut over imports, routes, workspace and manifests;
4. delete losing implementations and compatibility holders once no live requirement remains;
5. prune empty or meaningless parents;
6. reconcile package, lockfile and config ownership;
7. hand the exact candidate to verification.

Historical tooling never justifies retaining losing topology; migrate or delete the dependent tooling.

## 4. File responsibility and complexity

Large files are a diagnosis signal, not an authority law. Split hand-maintained source when independently changing responsibilities, mutable-state owners, transaction boundaries, public interfaces or test seams are entangled.

Default escalation signal:

~~~text
HAND_MAINTAINED_SOURCE > 1000 LOGICAL LOC
→ REQUIRE COHESION JUSTIFICATION OR RESPONSIBILITY SPLIT
~~~

Generated files, atomic migrations and reference/data artifacts may legitimately differ. Never split only to satisfy a number.

## 5. Death test and negative space

After cutover search for stale imports/exports, duplicate routes/screens, wrong-owner containers, obsolete wrappers/aliases, compatibility-only files, duplicate DTO/contracts, dead tests/mocks, orphan package/config entries and generic shared/common/core refuge containers.

A loser that remains reachable is not deleted.

## 6. App/service/frontend application

Apply APP-SERVICE-COMPOSITION.md rather than restating it here:

- app hosts own deployable shell/composition and surface-specific presentation;
- services own business/system semantics, durable data and public contracts;
- domain-neutral reusable UI belongs only to the proven Design System/shared presentation owner;
- account/home/settings/dashboard/search remain composition concerns unless Governance admits another capability.

## 7. Parallel and integration safety

Consume overlap and parallel authorization from 01-SCOPE-AUTHORITY-RULES.md. Preserve exact base SHA and admitted cone. Reconcile foreign changes before integration. Never integrate two competing canonical winners for the same responsibility.

## 8. Verification handoff

Before sending the affected structural unit to 04 verification, account for:

~~~text
CANONICAL OWNER/PATH EXISTS
LOSING OWNER REACHABILITY = 0
IMPORT/EXPORT/ROUTE/MANIFEST EDGES POINT TO WINNER
WORKSPACE/PACKAGE/LOCKFILE/CONFIG IS CONSISTENT
NO EMPTY/GENERIC CONTAINER CREATED AS REFUGE
NO REQUIRED IMPLEMENTATION/TEST/CONFIG LOST
~~~

Closure belongs to verification; movement belongs to 05.
