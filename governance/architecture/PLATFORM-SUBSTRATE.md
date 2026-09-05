# Platform Substrate Architecture

ARTIFACT_CLASS: DURABLE_ARCHITECTURE_GOVERNANCE
SEMANTIC_OWNER: governance/architecture/PLATFORM-SUBSTRATE.md
EXECUTION_AUTHORITY: NONE
CLOSURE_AUTHORITY: NONE
IMPLEMENTATION_STATE_AUTHORITY: NONE

## Purpose

This owner defines only the durable **admission boundary for non-semantic platform substrate**. It does not define repository placement, service composition, data contracts, runtime configuration, Product capability behavior, campaign stages or current implementation state.

~~~text
PLATFORM_SUBSTRATE != PRODUCT CAPABILITY
PLATFORM_SUBSTRATE != EXECUTION STAGE
PLATFORM_SUBSTRATE != FUTURE PRODUCT PLACEHOLDER
~~~

## Admission law

A substrate element exists only when it serves a proven current technical responsibility or a causally required prerequisite of admitted Product/System work.

~~~text
REAL_CURRENT_RESPONSIBILITY
+ CLEAR OWNER
+ REAL CONSUMER OR REQUIRED PROOF
+ MINIMUM NECESSARY COMPLEXITY
= SUBSTRATE ADMISSIBLE
~~~

The following are not readiness evidence by themselves:

~~~text
EMPTY SERVICE DIRECTORY
EMPTY CONTRACT LANE
EMPTY CLIENT LANE
EMPTY DATABASE/MIGRATION LANE
EMPTY TEST LANE
PLACEHOLDER ROUTE/SCREEN
SPECULATIVE FRAMEWORK
~~~

~~~text
EMPTY_LANE_AS_READINESS_EVIDENCE = FORBIDDEN
REAL_RESPONSIBILITY_PRECEDES_CONTAINER = REQUIRED
~~~

## Typical substrate classes

When actually required, substrate may include:

- workspace/toolchain/build wiring;
- deployable-host shell/runtime identity;
- thin process startup and dependency-backed health/readiness;
- runtime/infra composition;
- configuration/secret binding mechanisms;
- migration tooling for a persistence owner that already exists;
- contract generation/validation for a real public contract;
- domain-neutral Design-System primitives required by real consumers;
- durable verification/guard mechanisms that prove a unique invariant.

This list does not pre-authorize any specific container or technology.

## Specialized owner routing

Detailed durable meaning remains exclusively with:

- `REPOSITORY-TOPOLOGY.md` — physical placement/container admission;
- `APP-SERVICE-COMPOSITION.md` — app-host versus service responsibility;
- `OWNERSHIP-AND-SOURCE-OF-TRUTH.md` — semantic owner/writer/readback;
- `DATA-CONTRACTS-AND-INTEGRATIONS.md` — data/contract/protocol boundaries;
- `RUNTIME-AND-CONFIGURATION.md` — runtime/configuration architecture;
- `../product/EXPERIENCE-AND-DESIGN.md` — experience/Design-System meaning;
- applicable `../policies/**` — behavioral engineering constraints.

This file must not restate those owners as a second rule source.

## Premature-complexity prohibition

Without a proven current responsibility, do not prebuild generic workflow/journey/permission/tenant engines, generic saga/outbox frameworks, brokers, caches, search clusters, service meshes, future navigation, domain component catalogs, business tables, APIs or state machines.

A mechanism is admitted only when current consumers, ownership, failure behavior and lower total complexity than the simpler alternative are proven.

## Conformance

A materially affected substrate element conforms when it is necessary, minimally implemented, correctly owned, nonduplicative and consistent with its specialized owners.

This file does not define a global substrate-completion gate. Unrelated future substrate is not required before Product work.
