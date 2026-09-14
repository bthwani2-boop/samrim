# BThwani / Samrim Repository Structure and Placement Contract

ARTIFACT_CLASS: REPOSITORY_LOCAL_PLACEMENT_CONTRACT
PLACEMENT_CONTRACT_AUTHORITY: DELEGATED_BY_AGENTS_MD
PRODUCT_SEMANTIC_AUTHORITY: NONE
DURABLE_ARCHITECTURE_AUTHORITY: NONE
CURRENT_IMPLEMENTATION_INVENTORY_AUTHORITY: NONE

## 0. Purpose and authority boundary

This file is the mandatory repository-local placement contract for Samrim. It answers **where an already-admitted artifact belongs and how structural cutovers must occur**. It does not decide whether a Product capability, service, package, route, abstraction, dependency or persistent artifact should exist.

`AGENTS.md` remains the sole repository agent-law owner. Pinned Governance owns durable Product/System/architecture meaning within its fact-specific authority. Exact source/config/runtime/database/readback remains the authority for what currently exists. This file must not become a second Product model, capability registry or current-state inventory.

~~~text
NEED / ADMISSION / OWNER
→ AGENTS.md + CURRENT OBJECTIVE + APPLICABLE EVIDENCE

DURABLE RESPONSIBILITY TAXONOMY
→ PINNED GOVERNANCE

WHERE ADMITTED CODE / CONFIG / TEST / CONTRACT LIVES
→ REPOSITORY-STRUCTURE.md

WHAT EXISTS RIGHT NOW
→ EXACT REPOSITORY SOURCE / CONFIG / RUNTIME
~~~

If this file conflicts with proven current reality or a defensible owner/boundary, diagnose the conflict. Do not create a parallel tree to satisfy stale text. Correct this contract in the same coherent change when the placement rule itself is proven wrong.

## 1. Non-negotiable placement laws

1. **No empty future architecture.** Placeholder paths in this document are notation, not permission to create directories. Materialize a directory only when real tracked content needs that owner now.
2. **No parallel placement.** If one semantic responsibility already exists at a non-target path, either extend that current owner or perform one complete rehome. Never create a second target-path copy while the old owner survives.
3. **No generic ownership buckets.** `shared`, `common`, `core`, `utils`, `helpers`, `platform`, `misc` and similar containers are noncanonical unless a cohesive responsibility is proven and named directly.
4. **Routes do not own business truth.** App routes/pages/screens compose presentation and call canonical public service boundaries.
5. **Services do not own deployable app trees.** `services/<service>/frontend`, app-shaped service subtrees and service→app dependencies are forbidden.
6. **Packages are technical reuse only.** A package requires multiple real consumers, one cohesive technical responsibility, no business truth, no service storage authority and lower total complexity than local ownership.
7. **One service owns one migration history per owned database.** Never split migration histories across two active locations.
8. **Generated artifacts have one provenance.** Generated DTOs/types/operations are derived from the owning executable contract and are never hand-maintained as a competing source.
9. **Move is not cutover.** Structural rehome includes imports/consumers/build/runtime/tests/tooling/verification, deletion of the losing path and exact-candidate proof.
10. **Deployable identity is preserved during path cleanup.** Expo/EAS project IDs, bundle/package IDs, schemes, update identity and equivalent external identities do not change merely because repository layout changes.

### 1.1 Structural maturity and decomposition trigger

Repository topology is both **demand-created** and **demand-maintained**. A material extension must be evaluated against the resulting cohesion and whole-system complexity, not only against whether it can be placed in the current file or directory. File size, line count, and endpoint count are signals only; they are not architecture authority.

~~~text
NO NEED YET
→ DO NOT PRE-SCAFFOLD

REAL RESPONSIBILITY + CURRENT OWNER REMAINS COHESIVE
→ EXTEND

REAL RESPONSIBILITY + CURRENT OWNER NO LONGER COHESIVE
→ STRUCTURAL CUTOVER IS PART OF THE CURRENT CHANGE

FUTURE NEED
→ DO NOT SCAFFOLD
~~~

Do not pre-scaffold future modules, and do not keep deepening a losing monolith merely because it still compiles or validates. When the modular form is simpler for a real current responsibility, the cutover is a prerequisite of the current change. `PREMATURE_STRUCTURE` and `LATE_STRUCTURE` are defects; `TIMELY_STRUCTURE` is canonical.

Re-evaluation is mandatory before materially extending an existing owner when an independent semantic capability is added, unrelated capability groups share a source without semantic cohesion, a change spans distant unrelated sections, generation/validation/testing/review becomes materially broader than the changed capability, paths/schemas/configuration/handlers accumulate without cohesive grouping, the current simple form costs more than a modular form, or the owner has already exceeded cohesive scope.

The structural verifier may enforce only observable invariants: one authored contract authority, no parallel State A/State B, a canonical entrypoint whenever a modular tree exists, and no empty tracked structural residue when it can be checked reliably. It must not encode arbitrary size or endpoint thresholds.

## 2. Placement decision procedure

Before creating or moving any material artifact, resolve this sequence:

~~~text
CURRENT USER / BUSINESS OUTCOME
→ CANONICAL SEMANTIC OWNER
→ APP HOST | SERVICE | PROVEN TECHNICAL PACKAGE | INFRA | TOOL
→ DOES THE SAME RESPONSIBILITY ALREADY EXIST?
   YES → EXTEND CURRENT OWNER OR COMPLETE ONE ATOMIC REHOME
   NO  → CHOOSE THE CANONICAL LANE BELOW
→ MATERIALIZE ONLY REQUIRED FILES
→ CONNECT REAL CONSUMERS
→ VERIFY STRUCTURE + BEHAVIOR + READBACK AS APPLICABLE
~~~

A target path is not evidence that the underlying responsibility is admitted.

## 3. Canonical top-level taxonomy

~~~text
samrim/
├── apps/                 deployable presentation/composition hosts
├── services/             bounded-context/service owners
├── packages/             proven reusable technical libraries
├── infra/                environment/deployment composition
├── tools/                cross-repository automation/inspection/development tooling
├── .github/              repository-platform policy and CI integration
├── .claude/              Claude Code project-host configuration only
├── .gemini/              Gemini CLI project-host configuration only
└── contracts/            OPTIONAL; cross-service protocol/catalog material only after explicit need
~~~

The following are forbidden as top-level ownership roots:

~~~text
core/
shared/
common/
platform/
frontend/
backend/
~~~

Durable Governance and human Docs live in the separately pinned `governance-and-docs` repository; do not recreate competing `governance/` or `docs/` authorities inside Samrim.

Root files are limited to repository-wide substrate, policy adapters and manifests such as `AGENTS.md`, `REPOSITORY-STRUCTURE.md`, `README.md`, `CONTRIBUTING.md`, `SECURITY.md`, `knowledge.sources.json`, workspace/toolchain manifests, lockfiles and repository configuration. A new root file requires repository-wide responsibility; local responsibility stays with its owner.

### 3.1 Agent host configuration roots

`.claude/` and `.gemini/` are admitted only because the active development hosts require repository-local project configuration for deterministic routing/enforcement. They are **host configuration**, not Product, architecture, implementation, Governance, verification-result or agent-law owners.

~~~text
.claude/settings.json    Claude Code project hook/config wiring only
.gemini/settings.json    Gemini CLI project context/hook/config wiring only
~~~

No additional tracked file may appear under either root without a proven current host requirement and a same-change update to this placement contract and structural verifier. Host configuration must route to the root `AGENTS.md` and repository-owned tooling; it must not duplicate semantic law. Codex uses the root `AGENTS.md` and its native sandbox/approval boundary and therefore has no repository `.codex/` scaffold unless a future official, current requirement proves one necessary.

## 4. Deployable application hosts: `apps/`

Canonical deployable hosts are direct roots:

~~~text
apps/app-client/
apps/app-partner/
apps/app-captain/
apps/app-field/
apps/control-panel/
~~~

Apps own routing, navigation, shell, session/bootstrap binding, deep links, app-specific presentation/composition, native/OS adapters, assets, deployable configuration and host-local error/observability integration. They do **not** own the durable Identity/DSH/WLT facts they render.

### 4.1 Mobile host structure

Preferred greenfield or fully refounded Expo host shape:

~~~text
apps/<mobile-host>/
├── src/
│   ├── app/                         Expo Router only
│   │   ├── _layout.tsx
│   │   ├── index.tsx
│   │   ├── (<route-group>)/         only when real routes require it
│   │   └── <route>.tsx
│   ├── features/
│   │   └── <semantic-feature>/      surface-specific presentation/composition
│   │       ├── <screen-or-gate>.tsx
│   │       ├── <controller>.ts      only when orchestration exists
│   │       ├── <presentation>.ts    only when presentation mapping exists
│   │       ├── <state>.ts           only when host-local state exists
│   │       └── components/          only when feature-local components exist
│   ├── bootstrap/                   only real app/session bootstrap
│   ├── shell/                       only real host shell/navigation composition
│   └── native/                      only OS/native adapters used from JS/TS app code
├── plugins/                         OPTIONAL app-specific Expo config plugins
├── modules/                         OPTIONAL app-local Expo Modules API modules
├── assets/
├── app.config.ts
├── mobile.config.json
├── eas.json
├── fingerprint.config.js
├── index.js
├── metro.config.cjs
├── babel.config.<ext>               OPTIONAL only when current tooling requires customization
├── package.json
├── project.json
└── tsconfig.json
~~~

Every optional lane above is absent until a real dependency or native responsibility requires it. Installing an Expo package does not create a same-named repository folder.

#### Expo router-root atomicity

An existing host may currently use root `app/`. That is a valid current execution shape until a dedicated complete cutover is performed.

~~~text
VALID STATE A: apps/<host>/app/ + apps/<host>/src/<non-route-code>
VALID STATE B: apps/<host>/src/app/ + apps/<host>/src/<non-route-code>
FORBIDDEN:     apps/<host>/app/ AND apps/<host>/src/app/ in parallel
~~~

For an existing root-`app/` host, new route files remain in that active router root until an atomic router-root cutover. Non-route feature code belongs under `src/`. A structural preference never justifies two router roots.

#### Mobile feature placement

Use `src/features/<semantic-feature>/` for surface-specific Product presentation. The feature name describes the user-facing workflow/responsibility, not an arbitrary page name and not a claim of domain ownership.

Examples of valid placement **when the capability is actually admitted**:

~~~text
src/features/store-publication/
src/features/order-tracking/
src/features/dispatch-offers/
~~~

Do not pre-create `catalog`, `orders`, `payments`, `support`, `analytics`, `notifications` or any other future feature because it exists in a target capability catalog.

If the same bounded-context interaction semantics are later proven identical across multiple real deployable hosts, reusable presentation may move to `services/<owner>/clients/presentation/` only after the service composition criteria are proven. Do not create a generic UI package to make domain UI look shared.

#### Expo packages, config plugins, local modules and native projects

Expo libraries are implementation dependencies, not repository ownership classes. Place their use by responsibility:

~~~text
EXPO ROUTING / NAVIGATION            → active Expo Router root (`app/` or `src/app/`)
SURFACE PRODUCT PRESENTATION         → `src/features/<semantic-feature>/`
APP STARTUP / SESSION BINDING        → `src/bootstrap/`
HOST SHELL / NAVIGATION COMPOSITION  → `src/shell/`
JS/TS NATIVE-OS ADAPTER              → `src/native/<responsibility>/`
APP CONFIG / PLUGIN REGISTRATION     → `app.config.ts`
APP-SPECIFIC LOCAL CONFIG PLUGIN     → `plugins/`
APP-LOCAL NATIVE EXPO MODULE         → `modules/<module>/`
CROSS-MOBILE BUILD/CONFIG TOOLING    → `tools/mobile/` when repository-wide and tooling-only
PROVEN MULTI-APP NATIVE LIBRARY      → `packages/<cohesive-module>/` after package admission
~~~

A third-party Expo package that ships its own config plugin remains in package dependencies and is referenced from `app.config.ts`; do not copy that plugin into the repository. Create `apps/<host>/plugins/` only for BThwani app-specific native configuration that cannot be expressed by ordinary app config or an installed package plugin.

Local Config Plugin rules:

- plugin files describe native build/config transformation only; they never own Product/business/authentication truth;
- conventionally name the exported plugin `with<Responsibility>`;
- JavaScript/CommonJS is valid; TypeScript local plugins are valid only when the app config/toolchain explicitly provides TypeScript evaluation (for example the required `tsx` parser binding);
- register the plugin through `app.config.ts` and prove resolved Expo config/prebuild behavior when material;
- a plugin used as cohesive repository-wide build/config tooling across multiple mobile hosts may live under `tools/mobile/` instead of being duplicated per app, provided it remains tooling-only and has no deployable/runtime business authority.

An app-local Expo Modules API module belongs under:

~~~text
apps/<mobile-host>/modules/<module>/
├── android/                         native Android source only when supported
├── ios/                             native iOS source only when supported
├── src/                             JavaScript/TypeScript module API when applicable
├── expo-module.config.json          Expo module registration/configuration
└── index.ts                         module public entrypoint
~~~

`modules/<module>/android` and `modules/<module>/ios` are **module source**, not generated application projects, and may be tracked when that local module is real. Do not confuse them with app-root `android/` and `ios/`.

If the same native module becomes a real cohesive dependency of multiple deployable apps, do not maintain copied local modules. Reassess it for a standalone technical package under `packages/<cohesive-module>/`, with its own public boundary and lifecycle, only after the normal package-admission requirements are proven.

Under the current Continuous Native Generation model, app-root native projects are generated outputs:

~~~text
apps/<mobile-host>/android/           UNTRACKED BY DEFAULT
apps/<mobile-host>/ios/               UNTRACKED BY DEFAULT
~~~

Native changes that must survive regeneration belong in app config, a config plugin, or an Expo module as appropriate. Intentionally making app-root native projects canonical/tracked is a separate architecture/runtime decision that must be explicitly justified and must update this contract and structural verifiers in the same change; generated CNG roots must never silently become source authority.

`babel.config.*` and other package-specific host config files are conditional. Add them only when the installed toolchain or a proven customization requires them; do not create boilerplate configuration for hypothetical future packages.

### 4.2 Control Panel structure

Preferred greenfield or fully refounded Next.js host shape:

~~~text
apps/control-panel/
├── src/
│   ├── app/                         Next.js routing only
│   │   ├── layout.tsx
│   │   ├── page.tsx
│   │   ├── globals.css
│   │   ├── (public)/                only real public routes
│   │   ├── (workspace)/             only real Operator workflows
│   │   └── api/                     thin browser-facing route handlers
│   ├── features/
│   │   └── <operator-workflow>/
│   │       ├── <panel>.tsx
│   │       ├── <controller>.ts       only when orchestration exists
│   │       └── components/           only feature-local components
│   ├── shell/                       workspace shell/navigation only
│   ├── session/                     browser/session binding only
│   └── server/
│       ├── identity/                 server-side Identity public-client adaptation
│       ├── dsh/                      server-side DSH public-client adaptation
│       ├── wlt/                      only after a real WLT consumer exists
│       └── security/                 host-specific browser security such as CSRF
├── public/                           only real static public assets
├── tests/                            host integration/e2e tests when present
├── next.config.<ext>
├── proxy.ts                          only when required
├── playwright.config.ts              only when required
├── package.json
├── project.json
└── tsconfig.json
~~~

#### Next router-root atomicity

As with Expo, an existing Control Panel may currently use root `app/`.

~~~text
VALID STATE A: apps/control-panel/app/ + non-route code outside that route tree
VALID STATE B: apps/control-panel/src/app/ + apps/control-panel/src/<non-route-code>
FORBIDDEN:     apps/control-panel/app/ AND apps/control-panel/src/app/ in parallel
~~~

A router-root migration is one structural cutover, not incremental duplication.

#### Control Panel ownership

`control-panel` is a trusted Operator **host**, not a business domain. Its route group or navigation section never becomes the owner of the fact it displays or mutates.

~~~text
Operator intent
→ thin route/feature composition
→ server adapter / service public client
→ Identity | DSH | WLT canonical owner
→ canonical readback
~~~

Generic new `lib/`, `utils/`, `helpers/`, `shared/` or `components/` dumping grounds are forbidden. Use the concrete owner (`features/<workflow>`, `server/<service>`, `shell`, `session`, `server/security`). If the same responsibility already exists in a legacy/current non-target path, obey the no-parallel-placement law: extend it or rehome it completely.

## 5. Services: `services/`

A service root exists only after its semantic responsibility and executable lifecycle/API/storage boundary are justified. Do not create a service because a screen, actor, vendor, table or implementation mechanism exists.

Current durable service families are Identity, DSH and WLT; physical directories are materialized only when current executable implementation requires them. A future peer service requires explicit admission evidence before `services/<future-service>/` is created.

Default service placement template:

~~~text
services/<owner>/
├── backend/
│   ├── cmd/
│   │   └── <process>/
│   │       └── main.go
│   ├── internal/
│   │   ├── <capability>/             domain/application policy
│   │   ├── transport/
│   │   │   └── http/                 HTTP decode/context/validate/call/encode
│   │   ├── integrations/
│   │   │   └── <dependency>/         service/provider adapters
│   │   ├── storage/
│   │   │   └── postgres/             repository/storage mechanics
│   │   ├── security/                 owner-local security mechanics when real
│   │   ├── contract/                 generated backend contract bindings when needed
│   │   └── runtime/                  process composition/readiness/config binding
│   ├── Dockerfile
│   ├── go.mod
│   └── go.sum
├── contracts/                        executable owner contract source/artifacts only as real
├── clients/                          public consumer boundary
│   ├── generated/                    deterministic contract-derived consumer code
│   ├── client.ts                     handwritten transport/client behavior when needed
│   ├── mobile.ts                     only real mobile adaptation
│   ├── go/                           only real Go consumer support
│   └── presentation/                 only proven same-workflow multi-host reuse
├── database/
│   └── migrations/                   canonical target migration history
├── tests/                            owner-level contract/integration/journey tests
├── tools/                            service-specific generation/verification only
├── README.md
├── package.json
├── project.json
└── tsconfig.json                     only when TS client/tooling needs it
~~~

Every lane above is conditional. A template lane with no real files must not be created.

### 5.1 Service internal capability placement

Business/domain behavior belongs in `backend/internal/<capability>/`. Technical entrypoints and mechanisms do not become mega-modules that absorb unrelated business rules.

~~~text
cmd/<process>       startup/composition only
transport/http      protocol adaptation only
integrations        external service/provider adaptation only
storage/postgres    persistence mechanics only
runtime             process wiring/config/readiness only
<capability>        domain/application decisions and invariants
~~~

Use semantic capability names. Do not partition one service by app/actor surface (`client`, `partner`, `captain`, `field`, `control-panel`) merely because multiple surfaces consume it.

### 5.2 Contracts and public clients

Service business API/event meaning stays under `services/<owner>/contracts/`. Public generated/handwritten consumer code stays under `services/<owner>/clients/`.

Contract topology is **demand-created, not pre-scaffolded**. An HTTP service may begin with one canonical authored OpenAPI document and remain that way while it is cohesive:

~~~text
VALID OPENAPI STATE A — SIMPLE SOURCE
services/<owner>/contracts/
└── <owner>.openapi.yaml
~~~

When real contract size, semantic cohesion or tooling needs justify modularization, perform one atomic source cutover to:

~~~text
VALID OPENAPI STATE B — MODULAR SOURCE
services/<owner>/contracts/
├── openapi/
│   ├── <owner>.openapi.yaml          canonical authored entrypoint
│   ├── paths/                        only real path groups, grouped by cohesive capability
│   ├── schemas/                      only real cohesive schema groups
│   └── components/                   only truly shared contract primitives
└── generated/                        only when a real generated contract artifact is required
    └── <owner>.openapi.bundle.yaml   deterministic bundle; never authored truth
~~~

State A and State B are alternatives, not simultaneous source trees. A service must have at most one authored canonical OpenAPI entrypoint. Never keep `contracts/<owner>.openapi.yaml` and `contracts/openapi/<owner>.openapi.yaml` as parallel authored authorities.

`paths/`, `schemas/`, `components/` and `generated/` are absent until real tracked content needs them. Do not create an empty modular tree merely because the service may grow later.

Partition modular OpenAPI by semantic cohesion, not by consuming surface and not mechanically one file per endpoint or one file per DTO. A capability-cohesive file may contain multiple related operations or schemas while that remains the simplest readable ownership. If one capability later becomes materially large, split that capability further only when the split reduces real complexity.

The canonical flow is:

~~~text
AUTHORED CONTRACT SOURCE
→ VALIDATE
→ OPTIONAL DETERMINISTIC BUNDLE
→ GENERATE DETERMINISTIC CONSUMER/BACKEND ARTIFACTS
→ PUBLIC CLIENT
→ CONSUMERS
~~~

When a bundle is required, it belongs at `services/<owner>/contracts/generated/<owner>.openapi.bundle.yaml`. It is derived from the one canonical authored entrypoint, must never be hand-edited, and must never become a second contract authority. Persist/track the bundle only when a current verifier, generator, release/publishing workflow or real consumer requires a repository-stable artifact; otherwise treat it as generated build output.

Generated contract artifacts and generated consumer code are different ownership lanes:

~~~text
contracts/generated/                  generated contract artifacts such as a bundled OpenAPI document
clients/generated/                    generated consumer code/types/operations
backend/internal/contract/            generated backend bindings when the backend requires them
~~~

Do not duplicate request/response/status/action registries manually in apps or another service when they can derive from the owner contract. Do not partition service contracts into `client`, `partner`, `captain`, `field` or `control-panel` source trees merely because those surfaces consume the API.

A flat→modular or modular→flat contract source move is a structural cutover: update `$ref` paths, validators, generators, backend bindings, client generation, tests, documentation/tooling and structural verification as applicable, prove the exact candidate, then delete the losing source path. Compatibility copies are forbidden unless a real external coexistence requirement proves them necessary and provides an explicit deletion trigger.

### 5.3 Database and migration placement

The canonical target for a service-owned SQL migration history is:

~~~text
services/<owner>/database/migrations/
~~~

However, migration history is atomic. If an existing executable service currently has its canonical migration history elsewhere, **do not start a second history** under `database/migrations/`. Continue the current canonical history or perform one dedicated complete migration-lane cutover that updates the migration runner, verification, packaging/runtime references and consumers before deleting the losing location.

Applied migration files remain immutable according to the adopted migration mechanism.

### 5.4 Service presentation reuse

`services/<owner>/clients/presentation/` is conditional, not a service frontend. It is allowed only when multiple real hosts consume the same bounded-context interaction semantics and the module owns no route tree, navigation shell, deployable identity, persistence, authorization decision or hidden business state machine.

~~~text
services/<owner>/frontend/             FORBIDDEN
services/<owner>/app-client/           FORBIDDEN
services/<owner>/app-partner/          FORBIDDEN
services/<owner>/app-captain/          FORBIDDEN
services/<owner>/app-field/            FORBIDDEN
services/<owner>/control-panel/        FORBIDDEN
~~~

### 5.5 WLT placement

WLT has no special repository-topology exception. When authoritative Product/System evidence admits executable WLT responsibility, its artifacts follow the same canonical service placement rules in this section. The existence of WLT in the durable service-family taxonomy does **not** authorize creating `services/wlt/` or any child lane before real executable content needs it.

When an admitted WLT capability exists, place artifacts by responsibility:

~~~text
financial domain/application policy    → services/wlt/backend/internal/<semantic-capability>/
HTTP protocol adaptation               → services/wlt/backend/internal/transport/http/
external financial/provider adapter    → services/wlt/backend/internal/integrations/<dependency>/
PostgreSQL mechanics                    → services/wlt/backend/internal/storage/postgres/
process/config/readiness                → services/wlt/backend/internal/runtime/
service-owned OpenAPI/contracts         → services/wlt/contracts/ using §5.2
public consumer boundary                → services/wlt/clients/
service-owned SQL history               → services/wlt/database/migrations/
~~~

Named future WLT capability lanes such as wallet, ledger, payment, refund, settlement, payout or reconciliation remain absent until a current admitted responsibility actually requires them. Do not materialize those directories as a roadmap or capability catalog.

A commerce or delivery workflow originating in DSH does not justify placing admitted WLT implementation inside DSH. Cross-service use follows the normal public contract/client dependency direction; neither service may reach into the other's private internals or database. This is a placement/dependency rule only; the semantic decision that a responsibility is WLT-owned must come from the applicable authoritative evidence, not from this file.

## 6. Reusable technical packages: `packages/`

`packages/` is not a renamed `shared/` root. Admit a package only when all are proven:

~~~text
MULTIPLE_REAL_CONSUMERS
+ ONE COHESIVE TECHNICAL RESPONSIBILITY
+ NO BUSINESS/AUTHENTICATION/FINANCIAL TRUTH
+ NO DEPLOYABLE HOST OWNERSHIP
+ NO SERVICE DATABASE/MIGRATION AUTHORITY
+ LESS TOTAL COMPLEXITY THAN LOCAL OWNERSHIP
~~~

The canonical existing technical owner is the Design System:

~~~text
packages/design-system/
├── src/
│   ├── tokens/                       visual/directional design tokens
│   ├── theme/                        theme derivation/adaptation
│   ├── native/                       only proven reusable native primitives
│   └── web/                          only proven reusable web primitives
├── theme.css                         generated/derived web theme when applicable
├── package.json
├── project.json
└── tsconfig.json
~~~

Do not create `native/`, `web/`, component families or another package until real consumers prove reuse. Prefer sharing design semantics/tokens before forcing cross-platform component sharing.

Forbidden package patterns include:

~~~text
packages/shared/
packages/common/
packages/core/
packages/utils/
packages/domain/
packages/business-rules/
~~~

## 7. Root `contracts/` is conditional

Root `contracts/` is **absent by default**. Service-owned business operations never belong there.

It may be admitted only for a stable, genuinely cross-service wire/protocol primitive or a generated/non-authoritative discovery catalog with real consumers. When admitted, allowed responsibility lanes are:

~~~text
contracts/protocol/
contracts/generated/
contracts/catalog/
~~~

A root contract must never become a gateway runtime, business owner or duplicate service API source.

## 8. Infrastructure: `infra/`

`infra/` owns environment/deployment composition only.

Current local integration placement:

~~~text
infra/local/compose/
├── compose.yaml
└── .env.example
~~~

Future deployment/IaC material belongs under `infra/` only when a real deployment responsibility exists. Infrastructure must not own service migrations/schema, Product fixtures, business contracts, domain policy, app identity manifests or secret values.

## 9. Repository tooling: `tools/`

Cross-repository tooling lives under `tools/`; owner-specific tooling stays with the owning app/service.

Canonical current lanes:

~~~text
tools/dev/       repository/local-runtime/bootstrap/verification/knowledge tooling
tools/mobile/    cross-mobile-host configuration/build/development tooling
~~~

Do not create a new tool lane merely to categorize a small number of scripts. Split `tools/dev/` only after a cohesive responsibility and enough real tooling prove that the split reduces total complexity.

A tool may inspect, generate, automate or produce evidence. It must not become Product/architecture/readiness/closure authority.

## 10. Tests and generated artifacts

Testing follows the owner of the behavior:

~~~text
Go unit tests                    colocated as *_test.go with the owning Go package
service contract/integration     services/<owner>/tests/
app unit/component               colocated with the owning feature when that is clearest
app host integration/e2e         apps/<host>/tests/
cross-repository verification    tools/dev/ only when genuinely repository-wide
~~~

Do not create a root `tests/` dumping ground without a separately admitted repository-wide test workspace.

Generated artifacts must have explicit deterministic provenance and must live with the kind of artifact they are. Generated public consumer code belongs under `services/<owner>/clients/generated/`. A generated service-contract bundle, when currently required, belongs under `services/<owner>/contracts/generated/`. Generated backend contract bindings belong under `services/<owner>/backend/internal/contract/` when required. None of these generated lanes is an authored semantic authority.

Build outputs (`dist`, `build`, `.next`, `.expo`, coverage, generated native projects, non-persisted contract bundles) remain untracked unless a separate explicit rule admits a specific artifact.

## 11. Dependency direction

Allowed dependency direction:

~~~text
APP HOST
→ SERVICE PUBLIC CLIENT / CONTRACT
→ PROVEN TECHNICAL PACKAGE

SERVICE
→ ITS OWN INTERNALS
→ ANOTHER SERVICE'S PUBLIC CLIENT / CONTRACT WHEN REQUIRED
→ PROVEN TECHNICAL PACKAGE WHEN DOMAIN-NEUTRAL

PACKAGE
→ DOMAIN-NEUTRAL TECHNICAL DEPENDENCIES

INFRA
→ COMPOSES DEPLOYABLES / ENVIRONMENT
~~~

Forbidden direction:

~~~text
SERVICE → APP
PACKAGE → APP PRIVATE CODE
PACKAGE → SERVICE PRIVATE INTERNAL
APP → SERVICE PRIVATE INTERNAL / DATABASE
SERVICE A → SERVICE B PRIVATE INTERNAL / DATABASE
INFRA → BUSINESS SEMANTIC OWNER
~~~

## 12. Naming law

Names describe cohesive responsibility, not accidental mechanism or future ambition.

- TypeScript/route/feature directories: lower-case kebab-case where a directory name is needed.
- Go package directories: idiomatic lower-case names; use a concise semantic responsibility rather than generic buckets.
- Capability folders name the stable business responsibility being implemented, not the consuming actor or page.
- App feature names may describe a surface workflow (`store-publication`, `order-tracking`) because they own presentation of that workflow; the service remains the truth owner.
- `Home`, `Account`, `Settings`, aggregate `Search` and similar route/navigation concepts remain composition/information architecture unless independent domain ownership is proven.

## 13. Structural cutover law

Structural changes that can create two authorities are atomic at the responsibility boundary. This includes at least:

~~~text
root app/ ↔ src/app/ router migration
legacy feature path ↔ src/features/<feature>/ rehome
control-panel generic lib/components ↔ concrete src owner rehome
service migration-history relocation
flat OpenAPI source ↔ modular OpenAPI source
contract/generated-client relocation
local code ↔ extracted package
service/app boundary correction
~~~

Required cutover sequence:

~~~text
CENSUS OWNER + CONSUMERS + BUILD/RUNTIME/TEST REFERENCES
→ CREATE TARGET OWNER
→ MOVE/REFINE REQUIRED VALUE
→ CUT OVER IMPORTS / ROUTES / GENERATION / RUNTIME / TESTS
→ VERIFY EXACT CANDIDATE
→ DELETE LOSING PATH / ALIASES / SHADOWS
→ RE-CENSUS FOR RESIDUE
~~~

Do not use compatibility aliases merely to make a structural migration easier unless a real deployable coexistence requirement proves them necessary and gives them an explicit deletion trigger.

## 14. Forbidden placement examples

The following are noncanonical unless an explicit rule above proves otherwise:

~~~text
apps/<host>/runtime/
apps/<host>/src/shared/
apps/<host>/src/common/
apps/<host>/src/utils/
apps/<host>/src/helpers/
apps/<host>/app/ + apps/<host>/src/app/ simultaneously
apps/<mobile-host>/android/            tracked app-root CNG output without explicit architecture change
apps/<mobile-host>/ios/                tracked app-root CNG output without explicit architecture change
apps/control-panel/lib/NEW_GENERIC_BUCKET
apps/control-panel/app/components/NEW_BUSINESS_FEATURE
services/<owner>/frontend/
services/<owner>/<app-name>/
services/<owner>/shared/
services/<owner>/common/
services/<owner>/core/
services/<owner>/contracts/<owner>.openapi.yaml + services/<owner>/contracts/openapi/<owner>.openapi.yaml simultaneously
packages/shared/
packages/common/
packages/core/
packages/utils/
infra/**/migrations/
infra/**/business-contracts/
contracts/<business-service-api>
core/
shared/
~~~

An existing non-target path is not permission to deepen the pattern. Apply the no-parallel-placement and atomic-cutover laws.

## 15. Verification contract

Any structural change must be proven from the exact candidate with the repository-owned checks that cover it. At minimum, when applicable:

~~~text
pnpm repository:verify-structure
pnpm repository:verify-hygiene
pnpm nx:verify-tags
pnpm workspace:verify
git diff --check
~~~

Run broader candidate/runtime/journey proof when the structure change affects behavior, runtime, contracts, deployable identity or consumers. A documentation-only claim never overrides a failing executable structural verifier.

The structural verifiers are an executable subset of this contract, not a replacement for ownership reasoning. If a valid structural change requires a verifier change, update the verifier in the same coherent commit and prove both the old defect is removed and the new rule is not over-broad.

## 16. Compact canonical blueprint

This is a placement map, not a directory-creation checklist:

~~~text
samrim/
├── AGENTS.md
├── REPOSITORY-STRUCTURE.md
├── knowledge.sources.json
├── <repository-wide manifests/config>
├── .claude/               host configuration only; settings.json
├── .gemini/               host configuration only; settings.json
│
├── apps/
│   ├── app-client/       ┐
│   ├── app-partner/      │ mobile-host rule: exactly one router root + src feature ownership
│   ├── app-captain/      │ conditional plugins/modules/native adapters only when proven
│   ├── app-field/        ┘
│   └── control-panel/      exactly one Next router root + feature/server/shell/session ownership
│
├── services/
│   ├── identity/           backend + conditional contracts/clients/database/tests only as real
│   ├── dsh/                backend + conditional contracts/clients/database/tests only as real
│   ├── wlt/                same service topology; absent until executable WLT implementation is admitted
│   └── <future-service>/   materialize only after explicit service admission
│
├── packages/
│   └── design-system/      reusable domain-neutral visual system
│
├── contracts/              optional; absent until genuine cross-service protocol/catalog need
├── infra/
│   └── local/compose/
└── tools/
    ├── dev/
    └── mobile/
~~~

The governing implementation rule is simple:

~~~text
PROVE THE RESPONSIBILITY FIRST.
PLACE IT AT ONE CANONICAL OWNER.
CREATE ONLY WHAT THE CURRENT JOURNEY NEEDS.
NEVER GROW A SECOND TREE FOR THE SAME MEANING.
~~~
