# Canonical Repository Topology Target

## 1. Top-level taxonomy

The final top-level structure must classify material code by real responsibility, not inherited importance labels.

Canonical target:

```text
<repository-root>/
├── apps/
│   ├── app-client/
│   ├── app-partner/
│   ├── app-captain/
│   ├── app-field/
│   └── control-panel/
│
├── services/
│   ├── dsh/
│   ├── wlt/
│   ├── identity/
│   ├── workforce/
│   ├── platform-control/     # only if independent control-plane service admission remains proven
│   └── <other-proven-peer-services>/
│
├── packages/
│   ├── design-system/
│   └── <only-proven-cohesive-reusable-technical-packages>/
│
├── contracts/
│   ├── protocol/
│   ├── catalog/
│   └── tests/
│
├── infra/
│   ├── local/
│   └── deployment/     # only when real deployment/IaC responsibility exists
│
├── governance/         # durable project/system/product/engineering meaning only
├── docs/               # human development/operations/reference guidance only
└── tools/              # automation, generation, inspection and evidence only
```

This is a semantic classification target, not permission to create empty placeholder directories or a closed universe of future services.

A peer service such as Notification or Search is admitted only when independent responsibility/lifecycle/persistence/API/runtime evidence proves it. Similar logic applies to Platform Control: current evidence makes it a strong service candidate, but inherited placement/name does not exempt it from service-admission proof.

## 2. Losing top-level ownership classes

`core/` and `shared/` are not canonical ownership classes.

```text
core/identity          → services/identity
core/workforce         → services/workforce
core/platform-control  → services/platform-control if service admission remains proven; otherwise rehome its required truth to actual owners
core/providers         → decompose according to targets/providers-and-integrations.md

shared/ui-kit          → salvage/refound into packages/design-system
shared/control-panel   → decompose to design-system, app host, or service capability owners
shared/data-runtime    → decompose by proven technical responsibility; do not rename as one generic package
shared/resilience      → replace/refound/absorb according to proven consumers and reliability needs
```

After full consumer cutover:

```text
core/   = ABSENT
shared/ = ABSENT
```

No aliases, compatibility directories, path reexports, workspace entries, Go `replace` directives, Docker paths, scripts, or CI filters may preserve those roots internally.

## 3. Deployable apps are direct workspace roots

When `apps/<app>/` contains only a `runtime/` child and that child is the actual Expo/Next workspace, `runtime` is a pass-through parent and must be removed.

Target:

```text
apps/app-client/
apps/app-partner/
apps/app-captain/
apps/app-field/
apps/control-panel/
```

Each deployable root directly owns its package manifest/build/runtime files.

Expected workspace pattern after cutover:

```yaml
packages:
  - "apps/*"
  - "services/*"
  - "packages/*"
  - "contracts"
```

Only retain a deeper runtime directory if future evidence proves the app root owns another independent sibling responsibility with a real lifecycle. A single-child wrapper is not a boundary.

Package names should identify the deployable, not the removed wrapper:

```text
@bthwani/app-client
@bthwani/app-partner
@bthwani/app-captain
@bthwani/app-field
@bthwani/control-panel
```

Deployable identity preservation requirements are owned by `targets/apps-and-composition.md`.

## 4. Service topology

A service is a bounded context/system authority with independent business/system responsibility, not merely a folder of shared functions.

Where materially applicable, prefer this conceptual shape:

```text
services/<service>/
├── backend/
│   ├── cmd/
│   └── internal/
│       ├── runtime/
│       ├── transport/
│       ├── integrations/
│       └── <semantic-capabilities>/
├── contracts/
├── clients/
├── frontend/          # only when the service owns reusable UI/presentation
├── database/
└── tests/testing/     # only where the responsibility is real
```

Do not mechanically manufacture every directory for every service.

`cmd/*` must stay thin process startup. `transport` must not become a business mega-domain. `integrations` translate external/peer boundaries and do not own remote domain truth.

## 5. Package topology

`packages/` is for reusable technical code only.

A package is admitted only when all are proven:

```text
MULTIPLE_REAL_CONSUMERS_OR_STRONG_INDEPENDENT_REUSE_REASON
ONE_COHESIVE_TECHNICAL_RESPONSIBILITY
NO_BUSINESS_TRUTH_AUTHORITY
NO_DEPLOYABLE_APP_OWNERSHIP
NO_SERVICE_STORAGE_AUTHORITY
STABLE_PUBLIC_API
CLEAR_DEPENDENCY_DIRECTION
```

`packages/` must not become the renamed `shared/` dumping ground.

Generic names such as `common`, `shared`, `core`, `client-runtime`, `query-runtime`, `platform`, `utils`, or `helpers` require heightened proof and are forbidden when they hide multiple responsibilities.

## 6. Public export/package/workspace law

Public package exports must express semantic ownership, not losing topology, page names or actor-shaped mega-libraries.

After a rehome/cutover, update the complete affected cone as applicable:

```text
package.json name/exports/dependencies/peerDependencies
project.json/Nx targets
tsconfig include/paths/project references
pnpm-workspace.yaml / lockfile
Go imports/modules/go.work/replace directives
Docker build contexts/compose paths
scripts/guards/generators
CI workflow path filters
EAS/Expo/Next build-root assumptions
```

`package.json` and `project.json` are not duplicates by definition; each survives only while its toolchain/workspace role remains real.

Do not preserve old paths through internal aliases/reexports merely to reduce migration effort.

## 7. Contracts topology

Service business contracts remain with their service.

Root `contracts/` owns only genuinely cross-service wire/protocol primitives, generated discovery/catalog outputs, and their verification tooling. It does not own business operations or become a gateway runtime.

See `targets/contracts-and-protocols.md`.

## 8. Infrastructure topology

`infra/` owns environment/deployment composition only.

It may own local compose, local data-plane provisioning, observability tooling, and real deployment/IaC wiring. It must not own business fixtures, service schemas, app config contracts, provider business semantics, or secret values.

See `targets/infra-and-runtime.md`.

## 9. Governance, documentation and tooling topology

These roots are canonical only when their authority boundaries remain strict:

```text
governance/
  → durable project/product/system/architecture/security/quality/delivery meaning
  !→ live execution state, runtime truth, API/DB duplication, campaign ledger

docs/
  → human onboarding/development/operations/reference guidance
  !→ Product Truth, business authority, contract authority, release approval

tools/
  → automation, generation, inspection, verification/evidence, local developer helpers
  !→ Product capability taxonomy, architecture ownership registry, mutable business truth
```

Service/app-specific tooling belongs with the service/app when its lifecycle and semantics are local to that owner. Only genuinely cross-repository tooling belongs under top-level `tools/`.

Governance, docs and tools refoundation is specialized by:

```text
targets/governance-knowledge-system.md
targets/documentation-and-runbooks.md
targets/tooling-assurance-and-automation.md
```

## 10. Naming law

Canonical names describe stable responsibility.

Presumed noncanonical as domain/package owners unless positively proven:

```text
core
shared
common
misc
legacy
old
new
final
v2/v3 without protocol/version meaning
home-discovery
account
settings
dashboard
workspace
hub
governance
truth
closure
finance
operations
administration
boundary
client-*
partner-*
captain-*
field-*
```

Actor, page, route, mechanism, lifecycle phase, or implementation technology must not masquerade as a business owner.

Canonical semantic IDs may use idiomatic language encodings without changing meaning, e.g. `promotion-funding` in TypeScript/OpenAPI and `promotionfunding` as an idiomatic Go package. Different language encoding does not create a second capability.

## 11. Topology exit gate

Repository topology cannot pass structural qualification while any known instance remains of:

```text
TOP_LEVEL_core_ROOT
TOP_LEVEL_shared_ROOT
PASS_THROUGH_apps/*/runtime_LAYER_WITHOUT_UNIQUE_ROLE
GENERIC_PROVIDER_GOD_SERVICE
UNPROVEN_PLATFORM_CONTROL_GOD_SERVICE
BUSINESS_TRUTH_IN_packages
BUSINESS_CONTRACT_AUTHORITY_IN_ROOT_contracts
BUSINESS_FIXTURES_OR_APP_CONFIG_OWNED_BY_infra
OLD_WORKSPACE_PATHS
OLD_PACKAGE_NAMES
OLD_GO_REPLACE_PATHS
OLD_DOCKER_PATHS
OLD_TSCONFIG/NX/CI_PATHS
INTERNAL_ALIASES_PRESERVING_LOSING_TOPOLOGY
GOVERNANCE_SELF_CERTIFYING_OR_STALE_OWNER_AUTHORITY
DOCS_DUPLICATING_PRODUCT/CONTRACT/DATA_TRUTH
TOOLS_MANUAL_ARCHITECTURE/OWNERSHIP_REGISTRIES
TOOLS_GUARDS_ENFORCING_LOSING_TOPOLOGY
```

Move/rename alone does not satisfy this gate. Required value must be re-owned, all consumers cut over, and losers deleted.
