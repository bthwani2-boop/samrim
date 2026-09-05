# Platform Substrate Architecture

ARTIFACT_CLASS: DURABLE_ARCHITECTURE_GOVERNANCE
SEMANTIC_OWNER: governance/architecture/PLATFORM-SUBSTRATE.md
EXECUTION_AUTHORITY: NONE
CLOSURE_AUTHORITY: NONE
IMPLEMENTATION_STATE_AUTHORITY: NONE

## Purpose

This owner defines durable cross-cutting technical substrate properties that make BThwani maintainable and able to host admitted Product/System capabilities without repeated platform-wide reconstruction.

It does **not** define execution stages, campaign ordering, readiness gates, current implementation status or the next Product slice.

```text
PLATFORM_SUBSTRATE != EXECUTION_STAGE
PLATFORM_SUBSTRATE != PRODUCT_CAPABILITY
PLATFORM_SUBSTRATE != CURRENT_IMPLEMENTATION_STATE
PLATFORM_SUBSTRATE != PERMISSION_TO_PREBUILD_FUTURE_PRODUCT
```

## 1. Repository and ownership substrate

Repository shape must express real responsibility:

- deployable apps are app hosts/composition surfaces;
- services own admitted business/system semantics, durable data and public contract/client lineage;
- reusable packages exist only for proven reusable technical responsibility;
- generic `shared`, `common`, `core`, provider-, actor- or mechanism-named containers do not gain authority by name;
- dependency direction follows the dedicated architecture owners;
- duplicate writers, shadow owners and compatibility authorities are not durable substrate.

Repository placement remains owned by `REPOSITORY-TOPOLOGY.md`; app/service composition by `APP-SERVICE-COMPOSITION.md`; semantic owner/writer/readback by `OWNERSHIP-AND-SOURCE-OF-TRUTH.md`.

## 2. Deployable-host substrate

Every admitted deployable host preserves stable deployable identity and has only the shell/runtime/composition mechanisms required by actual consumers.

A host may exist before some business journeys are implemented, but this does not authorize fake Product screens, tabs, routes or placeholder business state.

Host responsibilities may include, when actually required by the surface:

- bootstrap and runtime configuration;
- authenticated/signed-out shell transitions according to current Identity contracts;
- navigation/deep-link composition;
- error boundaries and lifecycle handling;
- build/update identity;
- platform/native adapters.

Business and financial truth remain with canonical service owners.

## 3. Service substrate

A service container is admitted only when its responsibility is already justified. Do not create empty contract/database/client/test lanes merely because a template suggests them.

For an admitted service, materially required technical responsibilities may include:

- thin process startup/composition;
- validated configuration;
- health/liveness and dependency-backed readiness;
- graceful shutdown;
- bounded server/client timeouts;
- request/correlation identity;
- structured errors/logging;
- authenticated service-to-service boundary when required;
- executable contract/data/migration/test lanes **only when the service actually needs them**.

```text
EMPTY_LANE_AS_READINESS_EVIDENCE = FORBIDDEN
GENERIC_INTERNAL_MEGA_FRAMEWORK = FORBIDDEN
REAL_RESPONSIBILITY_PRECEDES_CONTAINER = REQUIRED
```

## 4. Durable-data substrate

Each durable-data owner has an explicit storage ownership boundary and independently attributable credentials/runtime identity where applicable.

Several logical databases may share one database server in development without sharing ownership.

Cross-service private database access is forbidden. Cross-owner interaction occurs through admitted public contracts/protocols.

Schema evolution uses one reproducible migration authority per data owner when persistence exists. Do not create placeholder business migrations or speculative tables.

## 5. Contract and generated lineage

Every admitted cross-boundary protocol has one canonical executable provenance.

```text
ONE CANONICAL CONTRACT SOURCE
→ DETERMINISTIC VALIDATION/GENERATION WHEN USED
→ PUBLIC CLIENT/BINDING
→ DRIFT DETECTION
```

Generated artifacts are derived. Manual cross-boundary mirrors are noncanonical when the authoritative contract can generate or directly represent the required binding.

Do not create fake endpoints/events merely to populate a contract directory.

## 6. Runtime, configuration and secrets

Runtime endpoints, environment bindings, public configuration and secrets have explicit classes and owners. Features do not hardcode infrastructure/provider addresses or read privileged secrets directly.

Secrets remain outside client bundles and ordinary tracked configuration. Development convenience does not create production fallbacks or alternate business rules.

Provider simulators/sandboxes are explicit adapters and never Product truth.

Exact runtime behavior remains owned by `RUNTIME-AND-CONFIGURATION.md` and the applicable policies/source.

## 7. Dependency and workspace substrate

Dependency direction and workspace/project discovery should be machine-checkable where practical.

The substrate must prevent or expose invalid edges such as:

```text
APP → ANOTHER APP PRIVATE IMPLEMENTATION
SERVICE → APP IMPLEMENTATION
APP → SERVICE PRIVATE IMPLEMENTATION
SERVICE_A → SERVICE_B PRIVATE IMPLEMENTATION
CROSS_SERVICE_PRIVATE_DATABASE_ACCESS
UNADMITTED_GENERIC_PACKAGE AUTHORITY
```

Public service clients/contracts and explicitly admitted technical packages are the valid cross-boundary mechanisms.

Dependency/toolchain pins must be reproducible from executable manifests and lockfiles; documentation does not own versions.

## 8. Experience substrate

Durable experience semantics are owned by `../product/EXPERIENCE-AND-DESIGN.md`.

The platform substrate provides only reusable domain-neutral experience mechanisms actually required by real consumers, such as tokens/primitives/accessibility/RTL foundations. It does not authorize prebuilding domain cards, dashboards, complete component catalogs or future navigation.

## 9. Production-like buildability

Every admitted deployable must have a production-like build path sufficient to prove its real dependency/configuration/package graph.

A development server or typecheck alone is not equivalent to deployable build evidence.

Exact build commands/toolchain come from current executable source and delivery policy.

## 10. Assurance substrate

The repository should contain the smallest durable evidence mechanisms capable of falsifying important structural claims, such as applicable ownership/dependency, contract drift, migration, runtime-readiness, security-boundary, documentation parity and build checks.

Assurance tooling remains evidence infrastructure only. A custom guard must not duplicate a stronger compiler/schema/test/runtime mechanism.

## 11. Premature-complexity prohibition

The substrate does not pre-admit speculative infrastructure or Product mechanisms.

Without a proven current responsibility, do not create:

```text
GENERIC_FEATURE/JOURNEY/WORKFLOW/PERMISSION/TENANT FRAMEWORKS
GENERIC_SAGA/OUTBOX FRAMEWORKS
SERVICE MESH / MESSAGE BROKER / CACHE CLUSTER / SEARCH ENGINE
EMPTY BUSINESS ROUTES / TABLES / SCREENS / CONTRACT LANES
PREMATURE NAVIGATION OR DOMAIN COMPONENT CATALOGS
```

Any such mechanism must independently prove current consumers, ownership, failure model and lower total complexity than the simpler alternative.

## 12. Conformance semantics

A candidate conforms to this architecture when every materially applicable substrate responsibility is owned, necessary, minimally implemented, nonduplicative and compatible with current Product/architecture/policy owners.

This file does not define a global substrate-completion gate. The Orchestrator may verify structural prerequisites whenever they are causally required by the authorized work; unrelated future substrate does not need to be prebuilt.
