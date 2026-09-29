# BThwani / Samrim Repository Structure and Placement Contract

ARTIFACT_CLASS: REPOSITORY_LOCAL_PLACEMENT_CONTRACT
PLACEMENT_CONTRACT_AUTHORITY: DELEGATED_BY_AGENTS_MD
PRODUCT_SEMANTIC_AUTHORITY: NONE
DURABLE_ARCHITECTURE_AUTHORITY: NONE
CURRENT_IMPLEMENTATION_INVENTORY_AUTHORITY: NONE

## 0. Purpose and authority boundary

This file answers one question only:

> Where does an already-admitted implementation responsibility belong inside Samrim, and how is a structural move completed without parallel placement?

It does not admit Product capabilities, services, packages, schemas, contracts or durable architecture. `AGENTS.md` owns repository execution/safety law. Pinned Governance owns durable Product/System/Policy meaning. Exact source/project graph/config/runtime owns current implementation inventory.

```text
NEED / ADMISSION / DURABLE OWNER
→ CURRENT AUTHORITY + PINNED GOVERNANCE

WHERE ADMITTED IMPLEMENTATION LIVES
→ REPOSITORY-STRUCTURE.md

WHAT EXISTS RIGHT NOW
→ SOURCE / PROJECT GRAPH / CONFIG / RUNTIME
```

Current app/service/package members are discovered from the exact project graph/source and are deliberately not enumerated here.

## 1. Placement laws

1. Do not pre-create future architecture. A path is notation, never admission.
2. One responsibility has one placement owner. Extend the winner or perform one atomic rehome; do not keep old/new trees in parallel.
3. Generic ownership buckets such as `shared`, `common`, `core`, `utils`, `helpers` and `misc` are forbidden unless an independently proven cohesive technical responsibility earns a specific owner/name.
4. Placement follows pinned System/Data/Delivery ownership laws. Route trees remain composition; services own their bounded implementation; reusable packages remain domain-neutral technical reuse.
5. A move is complete only after consumers/imports/build/runtime/tests/tooling are cut over and the losing path is deleted.
6. Repository cleanup must not silently change externally registered deployable identity.
7. Generated artifacts remain derived and live with their owning artifact kind; authored and generated authorities must not coexist for the same source of truth.
8. The one owning migration history required by pinned Data policy must have one repository location per service. Starting a second migration tree is forbidden.

## 2. Top-level placement grammar

```text
samrim/
├── apps/       deployable presentation/composition hosts
├── services/   bounded executable service owners
├── packages/   proven reusable domain-neutral technical libraries
├── contracts/  OPTIONAL genuinely cross-service protocol/generated catalog material
├── infra/      environment/deployment composition
├── tools/      repository-wide development/verification/build tooling
└── .github/    repository-platform policy and CI integration
```

Forbidden top-level ownership roots include `core/`, `shared/`, `common/`, `platform/`, `frontend/` and `backend/`.

This is a placement grammar, not current inventory.

## 3. Applications: `apps/<host>/`

A deployable presentation/composition host lives under `apps/<host>/`.

For Expo/Next hosts, use exactly one router root:

```text
apps/<host>/app/
OR
apps/<host>/src/app/
```

Never both.

Non-route host responsibilities use cohesive app-local owners such as `src/features/<workflow>/`, `src/bootstrap/`, `src/shell/`, `src/session/`, `src/native/<responsibility>/` or `src/server/<technical-responsibility>/` only when real content requires them.

Do not create generic app buckets such as `src/shared`, `src/common`, `src/utils` or `src/helpers`.

Under Continuous Native Generation, app-root `android/` and `ios/` are generated/untracked by default. Durable native changes belong in app config, config plugins or Expo modules unless an explicit architecture decision admits authored native projects.

## 4. Services: `services/<owner>/`

An admitted bounded service implementation lives under `services/<owner>/`.

Conditional lanes include:

```text
backend/cmd/<process>/
backend/internal/<semantic-capability>/
backend/internal/transport/<protocol>/
backend/internal/integrations/<dependency>/
backend/internal/storage/<technology>/
backend/internal/security/
backend/internal/runtime/
contracts/
clients/
database/migrations/
tests/
tools/
```

Create only lanes with real responsibility. Empty template topology is forbidden.

### Contracts and public clients

Service-owned authored API/event material lives under `services/<owner>/contracts/`; public consumer code lives under `services/<owner>/clients/`.

A service has at most one authored canonical OpenAPI entrypoint, either flat or modular, never both.

Generated clients/bindings remain derived artifacts with deterministic provenance and are tracked only when a real generator/verifier/release/consumer requires them.

### Migrations

The canonical target for a newly established or fully refounded service-owned SQL migration history is:

```text
services/<owner>/database/migrations/
```

If an existing executable owner still has one proven canonical history elsewhere, continue that single history or perform one dedicated cutover before using the target above. Never run two active migration histories for one owner.

## 5. Reusable packages: `packages/<technical-owner>/`

A package is admitted only for proven reusable technical responsibility with multiple real consumers and no deployable-host, business-fact, service-persistence or migration authority.

Forbidden generic package owners include:

```text
packages/shared
packages/common
packages/core
packages/utils
packages/domain
packages/business-rules
```

## 6. Root contracts and infrastructure

Root `contracts/` is absent by default. If present, it contains only genuinely cross-service protocol material or generated/non-authoritative catalog/discovery artifacts with real consumers. Service-owned operations stay under the owning service.

`infra/` owns environment/deployment composition only. Local composition, when present, belongs under `infra/local/compose/`. Infrastructure must not own service migrations/schema, Product fixtures, business contracts, domain policy, app identity manifests or secret values.

## 7. Repository tooling and task evidence

Repository-wide automation, verification, bootstrap and development tooling belongs under `tools/`; owner-specific tooling stays with the owning app/service/package.

A tool may inspect, generate, automate or prove; it never becomes Product/System/closure authority.

Saved competitor observations live as non-authoritative revalidate-at-use evidence in `governance-and-docs/docs/reference/competitors/`. Machine-local screenshots remain in the ignored `local-photos/` subtree. Do not keep a parallel competitor cache in Samrim.

User-requested external quality-audit snapshots may be retained as dated, non-authoritative evidence under `tools/sonar-audit/`. They must identify their source snapshot, carry no implementation or policy authority, and be revalidated before reuse.

Task authorization, branch/order instructions, checkpoint cadence and promotion constraints belong to current user/task authority outside durable tracked repository content; do not retain a task-trigger Markdown file merely to carry execution instructions. If task text reveals a durable rule, normalize it to the one canonical `AGENTS.md` or Governance owner and delete the temporary carrier. The user-directed `tools/BTHWANI_FULL_PLATFORM_CLOSURE_MATRIX.md` is the sole admitted retained task-evidence exception: it grants no semantic/execution/implementation authority and must be revalidated against exact live state before use. Do not create another tracked task trigger, closure matrix or Product/journey inventory beside it.

## 8. Tests, dependencies and cutover

Tests follow the behavior owner. Repository-wide verification belongs in `tools/` only when genuinely repository-wide.

Allowed dependency direction is placement-derived from pinned ownership:

```text
APP → SERVICE PUBLIC CLIENT / CONTRACT → PROVEN TECHNICAL PACKAGE
SERVICE → OWN INTERNALS / OTHER SERVICE PUBLIC BOUNDARY / TECHNICAL PACKAGE
PACKAGE → DOMAIN-NEUTRAL TECHNICAL DEPENDENCIES
INFRA → COMPOSES DEPLOYABLES / ENVIRONMENT
```

Forbidden placement/dependency direction includes service→app, app→service private internals/database, service A→service B private internals/database, package→app private code, package→service private internals and infra→business semantic ownership.

A structural cutover that can create two authorities is atomic:

```text
CENSUS OWNER + PRODUCERS + CONSUMERS + BUILD/RUNTIME/TEST REFERENCES
→ CREATE/SELECT TARGET OWNER
→ MOVE/REFINE REQUIRED VALUE
→ CUT OVER CONSUMERS / CONTRACTS / GENERATION / RUNTIME / TESTS
→ VERIFY EXACT CANDIDATE
→ DELETE LOSING PATH / ALIASES / SHADOWS
→ FRESH RESIDUE CENSUS
```

Compatibility aliases require a proven coexistence need and explicit deletion trigger.

## 9. Verification contract

`pnpm verify` is the stable public local verification entrypoint.

It selects current structural/hygiene/dependency/project-graph checks from the exact candidate. Internal verifier filenames are implementation detail, not permanent documentation inventory.

Run runtime/journey proof only when a structural change materially affects behavior, contracts, persistence, deployable identity, runtime or users. Structural verifiers prove observable placement invariants; they do not replace ownership reasoning.

```text
PROVE THE RESPONSIBILITY FIRST.
PLACE IT AT ONE CANONICAL OWNER.
DISCOVER CURRENT INVENTORY FROM SOURCE / PROJECT GRAPH.
CREATE ONLY WHAT CURRENT WORK NEEDS.
NEVER GROW A SECOND TREE FOR THE SAME MEANING.
```
