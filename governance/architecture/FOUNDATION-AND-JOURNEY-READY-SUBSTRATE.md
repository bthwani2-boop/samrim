# Foundation and Journey-Ready Platform Substrate

ARTIFACT_CLASS: DURABLE_ARCHITECTURE_GOVERNANCE
SEMANTIC_OWNER: governance/architecture/FOUNDATION-AND-JOURNEY-READY-SUBSTRATE.md
EXECUTION_AUTHORITY: NONE
CLOSURE_AUTHORITY: NONE
IMPLEMENTATION_STATE_AUTHORITY: NONE

## Purpose

This owner defines the durable technical meaning of a BThwani platform substrate that is ready to receive real vertical Product journeys without another repository/authentication/configuration/data/contract/build-system refoundation.

It does not select the next Product slice and does not claim that the substrate currently exists. Exact implementation and closure are proven from source/runtime/evidence under the Orchestrator.

~~~text
FOUNDATION_READY
!=
BUSINESS_JOURNEY_COMPLETE

JOURNEY_READY
=
NEXT_REAL_JOURNEY_CAN_ADD_ITS_OWN_DOMAIN/DATA/CONTRACT/UI/TEST WORK
WITHOUT_REFOUNDING_THE_TECHNICAL_HOUSE
~~~

## 1. Repository and ownership substrate

The repository has one durable topology/ownership model as defined by the canonical architecture owners.

Required consequences:

- deployable applications live as application hosts rather than service-owned app-shaped trees;
- services own bounded business/system truth, persistence and public contract/client lineage;
- reusable packages exist only for proven reusable responsibility;
- no generic `shared`, `core`, `common`, provider, people/workforce, permission, tenant or framework bucket earns authority by name;
- dependency direction is enforceable rather than advisory;
- duplicate writers, shadow owners and compatibility authorities are absent from the admitted substrate.

Repository topology itself remains owned by `REPOSITORY-TOPOLOGY.md`; this file owns only the cross-cutting Journey-Ready consequence.

## 2. Deployable host substrate

Every admitted deployable host can receive a real feature slice without authentication/navigation/bootstrap refoundation.

For mobile hosts, the durable minimum is:

~~~text
app root/layout
→ authentication route/group
→ authenticated application route/group
→ neutral authenticated landing/shell
→ app-owned feature composition point
~~~

For Control Panel:

~~~text
root layout
→ authentication boundary
→ authenticated operator shell
→ app-owned feature composition point
~~~

A host may be technically ready while business-deferred. Empty/fake Product tabs, routes or screens are forbidden merely to make future breadth look implemented.

Session restore, signed-out routing, authenticated routing, logout convergence, runtime configuration, error boundaries and production-like build identity are host responsibilities. Business/financial truth remains with its canonical service owner.

## 3. Identity prerequisite

When materially required by later protected journeys, the canonical Identity actor/role/session foundation is independently closed before Journey-Ready admission.

Journey-Ready must not depend on:

- duplicate role-shaped humans;
- client-authored actor/context authority;
- role self-grant through authentication;
- cross-role revocation;
- service-caller identity from an untrusted header;
- local/surface authentication truth;
- compatibility authentication paths that are intended to survive indefinitely.

Identity capability semantics remain owned by `product/CAPABILITIES.md` and Security policy.

## 4. Data-owner substrate

Each service that owns durable state has an explicit database/schema ownership boundary and an independently attributable runtime identity.

Where several logical databases share one PostgreSQL server, server sharing does not weaken logical ownership:

~~~text
IDENTITY_DB_CREDENTIALS → IDENTITY_DB_ONLY
DSH_DB_CREDENTIALS      → DSH_DB_ONLY
WLT_DB_CREDENTIALS      → WLT_DB_ONLY
~~~

Cross-service direct private database access is forbidden. Cross-owner interaction occurs through an admitted public contract/protocol.

Readiness for a data-owning service reflects required dependency readiness, not merely process liveness.

## 5. Migration substrate

Durable schema evolution is performed by one standard, reproducible migration mechanism per data owner, with ordered provenance and fresh-database proof.

Required lifecycle:

~~~text
DEV/CI
→ explicit migrate/bootstrap action
→ deterministic ordered migrations
→ application/runtime verification

PRODUCTION
→ controlled migration phase
→ attributable result
→ compatible service rollout
~~~

Application startup must not silently perform arbitrary production schema mutation merely for convenience.

Placeholder/empty business migrations and speculative future business tables are not Journey-Ready substrate.

## 6. Contract and generated-client substrate

Every cross-boundary business/service protocol has one canonical executable provenance.

A service contract may generate typed clients/models/bindings, but generated artifacts remain derived and reproducible:

~~~text
ONE_CONTRACT_PROVENANCE
→ DETERMINISTIC_GENERATION
→ PUBLIC_CLIENT/BINDING
→ DRIFT_CHECK
~~~

Manual cross-boundary DTO mirrors are forbidden when the canonical contract can generate the required binding.

A root contract area, if present, owns only genuinely cross-service protocol primitives or generated discovery catalogs; it does not absorb service business operations.

No fake Product endpoint is created merely to prove that a contract directory exists.

## 7. Minimal service runtime chassis

A service entering Journey-Ready has only the generic technical chassis that real consumers require, such as materially applicable:

- configuration validation;
- health/liveness;
- dependency-backed readiness;
- request/correlation identity;
- structured error envelope;
- bounded HTTP/server timeouts;
- graceful shutdown;
- structured logging;
- observability instrumentation seam;
- authenticated service-to-service boundary where required.

This does not authorize an internal mega-framework. Repetition is extracted only after real reuse justifies the abstraction.

## 8. Runtime configuration and secrets

Runtime/service/app endpoints and public configuration have explicit owners and environment classes. Features do not invent direct hard-coded service URLs or secret access.

Secret values remain outside client bundles and ordinary tracked configuration. Development convenience cannot create a production fallback, alternate business rule or hidden provider authority.

Provider simulators/sandboxes are explicit development/test adapters and never canonical Product truth.

## 9. Design and experience substrate

Before broad business-screen development, BThwani has a small canonical experience foundation sufficient for real journeys:

- semantic color/spacing/typography/direction/motion roles;
- Arabic/RTL foundation and platform-appropriate LTR handling;
- accessibility baseline;
- domain-neutral text/button/input/surface/status/loading/empty/error/offline/dialog primitives only as real consumers require;
- semantic icon abstraction where shared;
- known asset/font/icon provenance.

Do not prebuild domain cards, dashboards or a complete component catalog before active journeys prove those responsibilities.

Durable experience meaning remains owned by `product/EXPERIENCE-AND-DESIGN.md`.

## 10. Dependency and module-boundary enforcement

Journey-Ready dependency direction is machine-enforceable where practical.

At minimum the architecture must prevent or detect:

~~~text
APP → APP PRIVATE DEPENDENCY
SERVICE → APP
APP → SERVICE PRIVATE IMPLEMENTATION
SERVICE_A → SERVICE_B PRIVATE IMPLEMENTATION
CROSS_SERVICE_PRIVATE_DATABASE_ACCESS
UNADMITTED_GENERIC_PACKAGE_AUTHORITY
~~~

Public service clients/contracts and explicitly admitted reusable packages are the allowed integration direction.

## 11. Production-like build proof

Every deployable host/service in the admitted substrate can be built in a production-like mode sufficient to prove its real dependency/configuration/package graph.

Typecheck alone is not a deployable-build claim.

Applicable proof includes:

- mobile production bundle/export or equivalent release-mode bundle;
- Control Panel production build;
- Go build/test/vet or equivalent service qualification;
- runtime composition/configuration proof;
- exact-candidate dependency/toolchain reproducibility.

A successful development server does not substitute for production-like build evidence.

## 12. Assurance substrate

Journey-Ready includes evidence mechanisms capable of falsifying its structural claims:

- repository/ownership boundary checks;
- generated-contract drift checks;
- migration/fresh-database checks;
- dependency/module-boundary checks;
- runtime readiness checks;
- security/session boundary checks;
- docs-command parity where docs describe executable operations;
- build/bundle checks;
- RTL/accessibility foundation evidence where applicable.

Assurance tools are evidence producers only and may not become Product/architecture/closure authorities.

## 13. Premature-complexity prohibition

Journey-Ready explicitly excludes speculative business furnishing.

Without a real authorized Product slice, do not create:

~~~text
GENERIC_RUNTIME_FEATURE_REGISTRY
GENERIC_JOURNEY_ENGINE
GENERIC_WORKFLOW_ENGINE
GENERIC_PERMISSION_FRAMEWORK
GENERIC_TENANT_FRAMEWORK
GENERIC_SAGA_FRAMEWORK
GENERIC_OUTBOX_FRAMEWORK
SERVICE_MESH
MESSAGE_BROKER
CACHE_CLUSTER
SEARCH_ENGINE
EMPTY_BUSINESS_ROUTES
EMPTY_BUSINESS_TABLES
EMPTY_BUSINESS_SCREENS
PREMATURE_NAVIGATION_TABS
~~~

Any such mechanism requires its own proven current need, owner, consumers, failure model and lower total complexity than the simpler alternative.

## 14. Journey-Ready admission semantics

The substrate is semantically ready only when all materially applicable foundation obligations are proven on one exact candidate and no known substrate defect requires reopening foundational architecture for the next admitted journey.

At minimum, applicable evidence must establish:

~~~text
CANONICAL_REPOSITORY/OWNERSHIP = PASS
IDENTITY_PREREQUISITE          = PASS_IF_REQUIRED
DEPLOYABLE_HOST_SHELLS         = PASS
DATA_OWNER_ISOLATION           = PASS
DEPENDENCY_BACKED_READINESS    = PASS
STANDARD_MIGRATION_LINEAGE     = PASS
CANONICAL_CONTRACT_GENERATION  = PASS
RUNTIME_CONFIGURATION          = PASS
DESIGN/RTL/A11Y_FOUNDATION     = PASS
DEPENDENCY_BOUNDARIES          = PASS
PRODUCTION_LIKE_BUILDS         = PASS
PREMATURE_BUSINESS_FURNISHING  = 0
KNOWN_FOUNDATION_DEFECTS       = 0
KNOWN_FOUNDATION_CONTRADICTIONS= 0
~~~

The Orchestrator owns how those claims are tested and closed.

## 15. Product admission boundary

Passing Journey-Ready means the technical house is ready; it does not select the next Product capability.

~~~text
JOURNEY_READY_PASS
→ BUSINESS_JOURNEY_ADMISSION_MAY_OPEN

JOURNEY_READY_PASS
!= NEXT_PRODUCT_SLICE_AUTHORIZED
~~~

A new Product slice is still bounded by current human/Product authorization and the active-slice laws.
