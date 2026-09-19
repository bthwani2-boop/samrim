# BThwani / Samrim Repository Structure and Placement Contract

ARTIFACT_CLASS: REPOSITORY_LOCAL_PLACEMENT_CONTRACT
PLACEMENT_CONTRACT_AUTHORITY: DELEGATED_BY_AGENTS_MD
PRODUCT_SEMANTIC_AUTHORITY: NONE
DURABLE_ARCHITECTURE_AUTHORITY: NONE
CURRENT_IMPLEMENTATION_INVENTORY_AUTHORITY: NONE

## 0. Purpose and authority boundary

This file owns one question only:

> Where does an already-admitted implementation responsibility belong inside Samrim, and how is a structural cutover completed without parallel ownership?

It does not decide whether a Product capability, bounded owner, app, service, package, route, dependency, schema or persistent artifact should exist.

`AGENTS.md` is the repository execution-law owner. Pinned Governance owns durable BThwani Product/System/Policy meaning. Exact source/config/project graph/runtime/database/readback owns current implementation inventory.

```text
NEED / ADMISSION / DURABLE OWNER
→ CURRENT OBJECTIVE + PINNED GOVERNANCE + APPLICABLE EVIDENCE

WHERE ADMITTED IMPLEMENTATION LIVES
→ REPOSITORY-STRUCTURE.md

WHAT EXISTS RIGHT NOW
→ EXACT SOURCE / PROJECT GRAPH / CONFIG / RUNTIME
```

This contract must never become a second Product model, service registry, app inventory, migration inventory or historical refactor ledger.

If a placement rule conflicts with a proven current owner/boundary, correct this contract in the same coherent change; never create a second tree merely to satisfy stale text.

## 1. Non-negotiable placement laws

1. **No empty future architecture.** A path shown here is notation, never permission to pre-create it.
2. **No parallel placement.** Extend the current owner or perform one complete rehome; never maintain old and target copies for the same responsibility.
3. **No generic ownership buckets.** `shared`, `common`, `core`, `utils`, `helpers`, `misc` and equivalent catch-alls are noncanonical unless a cohesive technical responsibility is independently proven and named.
4. **Routes/pages/screens do not own business truth.** They compose presentation and call canonical public boundaries.
5. **Services do not own deployable app trees.**
6. **Packages are technical reuse only.** They require multiple real consumers, one cohesive technical responsibility, no business/storage authority and lower total complexity than local ownership.
7. **One service-owned database has one active migration history.**
8. **Generated artifacts have one deterministic provenance and never become authored authority.**
9. **Move is not cutover.** Rehome includes consumers/imports/build/runtime/tests/tooling/verification and deletion of the losing path.
10. **Repository cleanup does not silently change deployable/external identity.**

## 2. Structural maturity and decomposition

Repository topology is demand-created and demand-maintained.

```text
NO CURRENT RESPONSIBILITY
→ DO NOT PRE-SCAFFOLD

CURRENT RESPONSIBILITY + OWNER REMAINS COHESIVE
→ EXTEND

CURRENT RESPONSIBILITY + OWNER LOST COHESION
→ STRUCTURAL CUTOVER NOW

FUTURE POSSIBILITY
→ DO NOT SCAFFOLD
```

File size, line count and endpoint count are signals only. Split when a real current responsibility, boundary or complexity reduction proves the split; do not keep deepening a losing monolith merely because it still builds.

`PREMATURE_STRUCTURE` and `LATE_STRUCTURE` are both defects.

## 3. Placement decision procedure

Before creating or moving a material artifact:

```text
CURRENT OUTCOME
→ CANONICAL SEMANTIC OWNER
→ APP HOST | SERVICE | TECHNICAL PACKAGE | INFRA | TOOL
→ DOES THIS RESPONSIBILITY ALREADY EXIST?
   YES → EXTEND OR COMPLETE ONE ATOMIC REHOME
   NO  → PLACE IN THE CANONICAL LANE
→ MATERIALIZE ONLY REQUIRED FILES
→ CONNECT REAL CONSUMERS
→ VERIFY STRUCTURE + BEHAVIOR + READBACK AS APPLICABLE
```

A target path never proves that the responsibility itself is admitted.

## 4. Top-level taxonomy

```text
samrim/
├── apps/       deployable presentation/composition hosts
├── services/   bounded executable service owners
├── packages/   proven reusable domain-neutral technical libraries
├── infra/      environment/deployment composition
├── tools/      repository-wide development/verification/build tooling
├── .github/    repository-platform policy and CI integration
└── contracts/  OPTIONAL cross-service protocol/generated catalog material only
```

Forbidden top-level ownership roots include:

```text
core/
shared/
common/
platform/
frontend/
backend/
```

Repository-wide root files are limited to repository policy/contracts, manifests and configuration. A new root file requires repository-wide responsibility.

Current app/service/package members are discovered from the exact project graph/source and are deliberately not enumerated here.

## 5. Deployable application hosts: `apps/`

Every deployable presentation/composition host lives at:

```text
apps/<host>/
```

Apps own routing, shell/navigation, session/bootstrap binding, deep links, app-specific presentation/composition, native/OS adapters, assets, deployable configuration and host-local observability/error integration. They do not own durable service/business facts.

### 5.1 Expo / React Native hosts

A mobile host may use either root `app/` or `src/app/` as its Expo Router root, never both.

```text
VALID A: apps/<host>/app/
VALID B: apps/<host>/src/app/
FORBIDDEN: both router roots in parallel
```

Non-route app implementation belongs under cohesive `src/` owners such as:

```text
src/features/<semantic-workflow>/
src/bootstrap/
src/shell/
src/native/<responsibility>/
```

These lanes exist only when real content requires them. Do not create `src/shared`, `src/common`, `src/utils` or `src/helpers` dumping grounds.

App-specific config plugins belong under `plugins/` only when ordinary app config or an installed package plugin cannot own the native configuration. App-local Expo modules belong under `modules/<module>/` only when real native module source exists.

Under Continuous Native Generation, app-root `android/` and `ios/` are generated/untracked by default. Durable native changes belong in app config, config plugins or Expo modules unless an explicit architecture decision makes native projects authored source.

### 5.2 Next.js hosts

A Next.js host likewise has exactly one router root:

```text
VALID A: apps/<host>/app/
VALID B: apps/<host>/src/app/
FORBIDDEN: both router roots in parallel
```

Routing stays in the router tree. Non-route host responsibilities belong in concrete owners such as:

```text
src/features/<workflow>/
src/shell/
src/session/
src/server/<service-or-security-responsibility>/
```

Do not create generic `lib`, `shared`, `common`, `utils`, `helpers` or global component dumping grounds as substitute owners.

A browser/server host remains a host, never the business domain owner of facts it displays or mutates.

## 6. Services: `services/`

A bounded executable service lives at:

```text
services/<owner>/
```

The service name/owner must already be admitted by authoritative BThwani meaning or current authorized work; this file does not admit service families.

Conditional placement:

```text
services/<owner>/
├── backend/
│   ├── cmd/<process>/main.go
│   └── internal/
│       ├── <semantic-capability>/
│       ├── transport/<protocol>/
│       ├── integrations/<dependency>/
│       ├── storage/<technology>/
│       ├── security/
│       ├── contract/
│       └── runtime/
├── contracts/
├── clients/
│   ├── generated/
│   └── presentation/
├── database/migrations/
├── tests/
└── tools/
```

Every lane is conditional. Empty template topology is forbidden.

Technical entrypoints stay technical:

```text
cmd/<process>       → startup/composition
transport/*         → protocol adaptation
integrations/*      → external dependency adaptation
storage/*           → persistence mechanics
runtime             → process/config/readiness wiring
<semantic-capability> → domain/application decisions
```

Do not partition service internals by consuming app/actor merely because multiple surfaces use the service.

### 6.1 Contracts and public clients

Service-owned API/event meaning lives under `services/<owner>/contracts/`. Public consumer code lives under `services/<owner>/clients/`.

A service has at most one authored canonical OpenAPI entrypoint.

```text
SIMPLE
services/<owner>/contracts/<owner>.openapi.yaml

OR, AFTER A PROVEN MODULAR CUTOVER

MODULAR
services/<owner>/contracts/openapi/<owner>.openapi.yaml
services/<owner>/contracts/openapi/paths/
services/<owner>/contracts/openapi/schemas/
services/<owner>/contracts/openapi/components/
```

Simple and modular authored entrypoints may not coexist.

Generated bundles, generated clients and generated backend bindings remain derived artifacts with deterministic provenance and are created/tracked only when a real generator/verifier/release/consumer requires them.

### 6.2 Migration placement

The canonical target for a newly established or fully refounded service-owned SQL migration history is:

```text
services/<owner>/database/migrations/
```

Migration history is atomic. If an existing executable owner still has one proven canonical history elsewhere, do not start a second history; continue that single history or perform one dedicated migration-lane cutover first.

Applied migrations remain immutable according to the active migration mechanism.

### 6.3 Cross-host presentation reuse

`services/<owner>/clients/presentation/` is allowed only for proven identical bounded-context interaction semantics reused by multiple real hosts. It must own no route tree, host shell, deployable identity, persistence, authorization decision or hidden business state machine.

Service-owned deployable app/frontend trees are forbidden.

## 7. Reusable technical packages: `packages/`

A package is admitted only when all are proven:

```text
MULTIPLE REAL CONSUMERS
+ ONE COHESIVE TECHNICAL RESPONSIBILITY
+ DOMAIN-NEUTRAL
+ NO DEPLOYABLE HOST OWNERSHIP
+ NO SERVICE STORAGE/MIGRATION AUTHORITY
+ LESS TOTAL COMPLEXITY THAN LOCAL OWNERSHIP
```

A reusable visual Design System, when admitted, is a technical package; its current package name and current members are discovered from the project graph/source rather than enumerated here.

Forbidden generic package ownership includes `packages/shared`, `packages/common`, `packages/core`, `packages/utils`, `packages/domain` and `packages/business-rules`.

## 8. Root `contracts/`

Root `contracts/` is absent by default.

It may contain only genuinely cross-service protocol material or generated/non-authoritative discovery/catalog artifacts with real consumers. Service-owned business operations remain under the owning service contract tree.

A root contract never becomes a gateway runtime, business owner or duplicate service API source.

## 9. Infrastructure: `infra/`

`infra/` owns environment/deployment composition only.

Local integration composition, when present, belongs under:

```text
infra/local/compose/
```

Infrastructure must not own service migrations/schema, Product fixtures, business contracts, domain policy, app identity manifests or secret values.

Future deployment/IaC lanes are created only when a real deployment responsibility exists.

## 10. Repository tooling: `tools/`

Repository-wide automation, inspection, bootstrap, verification and development tooling belongs under `tools/`. Owner-specific tooling stays with the owning app/service/package.

Use cohesive lanes only when enough real tooling proves them. Do not create a new tool subtree merely to categorize a few scripts.

A tool may inspect, generate, automate or prove; it never becomes Product/System/closure authority.

## 11. Tests and generated artifacts

Tests follow the owner of behavior:

```text
Go package tests              → colocated *_test.go
service integration/contract  → services/<owner>/tests/ when a separate lane is justified
app host integration/e2e      → apps/<host>/tests/ when present
feature/unit/component        → colocated with the owning feature when clearest
repository-wide verification  → tools/ only when genuinely repository-wide
```

Do not create a root test dumping ground without an independently admitted repository-wide test workspace.

Generated artifacts live with the artifact kind they derive and have one deterministic provenance. Build outputs remain untracked unless a separate current rule explicitly requires a repository-stable generated artifact.

## 12. Dependency direction

Allowed:

```text
APP HOST
→ SERVICE PUBLIC CLIENT / CONTRACT
→ PROVEN TECHNICAL PACKAGE

SERVICE
→ ITS OWN INTERNALS
→ ANOTHER SERVICE PUBLIC CLIENT / CONTRACT WHEN REQUIRED
→ DOMAIN-NEUTRAL TECHNICAL PACKAGE

PACKAGE
→ DOMAIN-NEUTRAL TECHNICAL DEPENDENCIES

INFRA
→ COMPOSES DEPLOYABLES / ENVIRONMENT
```

Forbidden:

```text
SERVICE → APP
PACKAGE → APP PRIVATE CODE
PACKAGE → SERVICE PRIVATE INTERNAL
APP → SERVICE PRIVATE INTERNAL / DATABASE
SERVICE A → SERVICE B PRIVATE INTERNAL / DATABASE
INFRA → BUSINESS SEMANTIC OWNER
```

## 13. Naming law

Names describe cohesive responsibility, not accidental mechanism, actor consumption or future ambition.

- TypeScript/route/feature directories use lower-case kebab-case where a directory is needed.
- Go packages use concise idiomatic lower-case semantic names.
- Service capability folders name stable responsibilities, not consuming surfaces.
- App features may name the user-facing workflow they present without becoming the business owner.
- Route/navigation labels remain composition unless independent durable ownership is proven.

## 14. Structural cutover law

A structural change that can create two authorities is atomic at the responsibility boundary.

```text
CENSUS OWNER + PRODUCERS + CONSUMERS + BUILD/RUNTIME/TEST REFERENCES
→ CREATE TARGET OWNER
→ MOVE/REFINE REQUIRED VALUE
→ CUT OVER IMPORTS / ROUTES / CONTRACTS / GENERATION / RUNTIME / TESTS
→ VERIFY EXACT CANDIDATE
→ DELETE LOSING PATH / ALIASES / SHADOWS
→ FRESH RESIDUE CENSUS
```

This applies to router-root moves, feature rehomes, migration-history relocation, flat↔modular contract source changes, generated-client relocation, local↔package extraction and app/service boundary correction.

Compatibility aliases require a proven coexistence need and explicit deletion trigger.

## 15. Forbidden placement patterns

Unless a preceding rule explicitly proves otherwise:

```text
apps/<host>/runtime/
apps/<host>/src/shared/
apps/<host>/src/common/
apps/<host>/src/utils/
apps/<host>/src/helpers/
apps/<host>/app/ + apps/<host>/src/app/
apps/<host>/android/ or ios/ as tracked CNG output without explicit architecture change
services/<owner>/frontend/
services/<owner>/<deployable-host>/
services/<owner>/shared/
services/<owner>/common/
services/<owner>/core/
parallel simple + modular authored OpenAPI entrypoints
packages/shared/
packages/common/
packages/core/
packages/utils/
packages/domain/
packages/business-rules/
infra/**/migrations/
infra/**/business-contracts/
core/
shared/
common/
```

An existing non-target path never authorizes deepening a losing pattern.

## 16. Verification contract

A structural change is proven from the exact candidate by the repository-owned verification path.

`pnpm verify` is the stable public local verification entrypoint. It selects current structural/hygiene/dependency/project-graph checks from the exact candidate. Internal verifier filenames are implementation detail and are not duplicated here as a permanent command inventory.

Run broader runtime/journey proof only when the structural change materially affects behavior, contracts, persistence, deployable identity, runtime or users.

Structural verifiers prove observable placement invariants; they do not replace ownership reasoning. If a valid placement change requires a verifier change, update both in the same coherent unit and prove that the verifier is neither stale nor over-broad.

## 17. Compact canonical blueprint

This is a placement grammar, not current inventory:

```text
samrim/
├── AGENTS.md
├── REPOSITORY-STRUCTURE.md
├── knowledge.sources.json
├── <repository-wide manifests/config>
├── apps/<deployable-host>/
├── services/<admitted-owner>/
├── packages/<proven-technical-owner>/
├── contracts/                  OPTIONAL
├── infra/<environment-or-deployment-composition>/
└── tools/<cohesive-repository-tooling-lane>/
```

```text
PROVE THE RESPONSIBILITY FIRST.
PLACE IT AT ONE CANONICAL OWNER.
DISCOVER CURRENT INVENTORY FROM SOURCE / PROJECT GRAPH.
CREATE ONLY WHAT CURRENT WORK NEEDS.
NEVER GROW A SECOND TREE FOR THE SAME MEANING.
```
