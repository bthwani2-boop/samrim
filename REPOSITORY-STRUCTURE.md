# BThwani — Repository Placement and Ownership

STATUS: ACTIVE_FOR_PROGRESSIVE_DEVELOPMENT
IMPLEMENTATION_ADMISSION: PROGRESSIVE
ALL_CAPABILITIES_DEVELOPMENT: ENABLED
NEW_CAPABILITIES: ANALYZE_AND_IMPLEMENT_PROGRESSIVELY
PRODUCTION_ACTIVATION: BLOCKED
SEMANTIC_SCOPE: file placement and migration rules; not Product, agent authorization or runtime readiness.

## Canonical paths
| Path | Sole responsibility |
| --- | --- |
| `AGENTS.md` | agent conduct, authorization and proof |
| `REPOSITORY-STRUCTURE.md` | placement, naming and consumer-cutover law |
| `governance/` | **future canonical** durable Product/System/Policy decisions; currently NOT_READY in its README |
| `docs/REFOUNDATION-PLAN.md` | one temporary execution plan, conflicts, evidence and stage gates; never business policy |
| `docs/reference/` | preserved, explicitly nonbinding research, OSS, competitors, donor evidence and links when migrated |
| `.github/` | CI workflow wiring, PR and ownership routing, review-provider config |
| `.specify/` | existing Spec Kit constitution/templates/scripts and workflow integration when verified and admitted; does not become another policy root |
| `tools/governance/` | deterministic foundation/architecture checks and their tests, not another decision catalog |
| `tools/security/` | shared security scanners when actually needed |
| `tools/dev/` | genuinely repository-wide developer tooling |
| `package.json`, `pnpm-workspace.yaml`, `pnpm-lock.yaml` | exact donor-compatible pnpm Stage-4 presentation workspace with one reproducible lock; not service/financial code |
| `.node-version`, `.nvmrc`, `.go-version` | original branch-41 toolchain version pins, never upgraded without separate authorization |
| `tsconfig.base.json`, `biome.json`, `.editorconfig`, `.gitattributes`, `.gitignore` | shared foundational TypeScript, lint, UTF-8/LF and secret-exclusion rules; without copied legacy migrations |
| `README.md` | stage-bounded local onboarding, not an additional policy authority |
| `services/<owner>/` | only `identity`, `dsh`, `wlt`; minimal private TypeScript client-package tooling now, Go implementations/contracts/SQL later when admitted |
| `apps/<surface>/` | actual presentation hosts for Customer, Merchant, Captain, Operator |
| `packages/design-system/` | single authored brand and semantic color source plus generated browser semantic CSS; no React Native runtime or component primitives |
| `packages/tamagui-config/` | Expo renderer consuming the design theme source; also owns the minimal React Native appearance preference runtime, not a second palette |
| `tools/mobile/` | native Expo configuration and original-identity/version verifier; Metro itself uses Expo defaults |
| `patches/` | only source-approved Ant Design CSP patch, held at unchanged exact dependency version |
| `packages/<purpose>/` | any further justified multi-consumer domain-neutral packages only |
| `tests/` | integration proof spanning genuine owners; not duplicate unit tests |

## Capability-scoped source admission (2026-11-14)

The old Stage-4 scaffolding restriction is superseded for development: **all existing and newly proposed capabilities may be analyzed, specified and implemented progressively** without a separate prior admission vote or global governance cutover. The canonical Product owner records proposed additions as they are resolved during the affected journey, without creating a second registry. Real screens, owner-service Go, executable OpenAPI, typed clients and SQL are developed in the legal owner paths; the stage-aware guard must verify boundaries and reject actual defects rather than ban executable source. Closure still requires 100% of applicable verified acceptance criteria; **production activation alone remains blocked** pending separate authorization and evidence. Do not introduce a fourth business service, a second governance/capability registry, duplicate Store/Order/ledger engines or another source of design truth.

Spec Kit specs/ documents are derived implementation instructions, not business law or extra Product admission votes. New local database/media runtimes require isolated namespaces and synthetic owner-backed data; old Docker volumes, real users and payments must not be reused. Production activation requires its own evidence and authority.

## Service placement and client tooling slice (not domain implementation)
Only `services/identity/`, `services/dsh/` and `services/wlt/` are approved. Each has one owner README, a **private pinned pnpm package** (`package.json`) named `@bthwani/<owner>`, a `tsconfig.json` extending the root strict settings, and `clients/README.md` plus an intentionally empty `clients/index.ts` export marker. One root frozen `pnpm-lock.yaml` tracks all three importers. TypeScript typechecking verifies the scaffold; it does not prove usable API clients. Do not copy the donor runtime dependencies, export actual operations, add Nx `project.json` or a service-local cache/config engine before needed. Local `node_modules/` are pnpm-generated and ignored, never copied or versioned. Optional empty `clients/generated/`, `clients/go/`, `backend/` and `database/migrations/` remain untracked until real admitted content exists. The three owner-local `contracts/openapi/paths/` directories now contain only exact, nonfunctional reserved domain fragments.

**OpenAPI preparation:** each owner has exactly one `contracts/openapi/<owner>.openapi.yaml` OpenAPI 3.1 entrypoint declaring zero operations (`paths: {}`). A pinned census of the donor's 55 Identity, 385 DSH and 95 WLT paths justified **7 Identity, 21 DSH and 14 WLT** flat `paths/*.yaml` reservation groups, each literally `paths: {}`. The canonical source inventory and donor-to-owner cautions are at [OpenAPI donor census](docs/reference/OPENAPI-DONOR-CONTRACT-INVENTORY.md); the individual service READMEs describe grouping. They are labels, not separate APIs, executable endpoints, approval of old procedures or new engines. The original Foundation guard enforced exact empty placeholders; its progressive revision now admits scoped owner paths for development and reports contract/runtime validation as NOT_RUN until the actual implementation tests establish it. As real operations are implemented, validate them with a strict OpenAPI 3.1/YAML parser, `$ref` resolution, duplicate Path/Method/operationId checks, security/error/schema constraints and derived Go/TS client parity before closing the affected journey. No runtime/financial/semantic proof follows from the placeholders.

Each progressively developed client implementation is sourced from the service owner's contract, not another maintained DTO catalog. Add only evidenced exports, service-specific dependencies, and generators once source/consumers have been reviewed; generated artifacts are derived. Introduce Go modules, **executable** contracts, migrations, isolated Docker and domain logic progressively as the selected journey requires; do not prebuild unrelated infrastructure or mistake source presence for acceptance.

During progressively authorized development, each owner's `backend/` holds the Go implementation when needed for the current journey; `contracts/openapi/` one API entrypoint with domain-grouped paths; and `database/` reviewed fresh installation plus protected upgrade migrations. Preserve applied migration history; examine actual embed/load paths before adopting a physical SQL layout. The bounded company/Merchant employee-administration engine belongs within DSH, **not** as a fourth deployable HR service or a separate Merchant employee engine; Identity and WLT retain their exclusive identity/money truths. See [architecture](governance/architecture.md) and [employee governance](governance/hr.md).

## Transitional rule for this worktree
- The former `docs/governance/` directory is **absent from this candidate by explicit user decision**. Its content remains inspectable in original branch `41` and archived inputs; do not restore it to this worktree.
- `governance/` is the only **target** policy path. Its README advertises NOT_READY until all applicable decisions and 26 capability IDs are reconciled, rather than an unsafe partial authority switch.
- The foundation guard rejects reintroduction of `docs/governance/`. Translate surviving references directly to the owning new files as each decision is adopted. Keep historical provenance external to the candidate, not another active governance directory.
- Stage 4 introduced presentation shells and design packages. Later authorized service scaffolding adds private pinned client package manifests and empty typed entrypoints. Neither creates service behavior, live API clients, Go modules, SQL or Docker.

## Placement and simplification law
1. Put authored logic with the owner of **its changing responsibility**, not a historical screen, team, refoundation batch name or convenience folder.
2. Business records and mutations belong to their service owners; apps compose views and invoke contracts, they never become a second business writer.
3. Each exposed API and generated client has a recorded original source; derived files must be reproducible and are never hand-maintained as independent truth.
4. One Store ID and one DSH commerce engine serve Store relation variants. An owner-person and an owned Store must never be collapsed into one entity or identity.
5. Prefer explicit stable domain names. Avoid `shared`, `common`, `misc`, `legacy`, `new`, `v2`, dates in **live code names**, and old workflow vocabulary without justified semantics.
6. Before removing or relocating a file, trace all direct/dynamic consumers, database schema references, environment keys, routes, tests and external identity/URL contracts. Transfer unique behavior, change consumers, prove it, then remove the losing implementation.
7. No number-of-files target, mandatory 'clean' architecture folder ladder, or second configuration/permission/financial policy writer.
8. Preserve externally issued Expo app package/bundle IDs, EAS project identity, deep links, signing identities and historical financial/legal records until an independently approved migration proves safety.
9. A new general tool/package requires at least one established cross-owner consumer and a reason owner-local code is inadequate.
10. Reference/benchmark URLs retain original evidence status, publication date and usage caveats; never become copied product rules.

## Application admission rules before screen migration

- The existing top-level `apps/<surface>/app/` is the **only active route root** for Expo Router or Next App Router. Do not create a competing `src/app/`; a future route-root move is a single reviewed refactor with route/deep-link checks.
- `apps/customer`, `apps/merchant`, `apps/captain` are Expo **presentation hosts**; `apps/control-panel` is the Ant Design/Next **Operator** host. Internal folder names do not rename externally issued app slugs, Android/iOS IDs, EAS projects or public URL/deep-link contracts. Historical `app-partner` is the preserved Merchant mobile identity, not a fifth application.
- `src/features/<capability>/` is a **future private presentation unit**, not a business engine, API authority or permission to copy donor folders. No `features`, `bootstrap`, `shell` or `tests` directory is mandatory while empty; create one only when an approved consumer and test need it. Next may colocate small route-specific UI under its existing App Router conventions; avoid a forced four-app folder template.
- A UI surface may import its own modules and **public** workspace package exports. It must not import the private sources of another app, service client, or package using relative paths, `apps/` aliases or an internal `@bthwani/<owner>/clients|backend|database|contracts|src` path. Service API behavior comes later from approved owner contract exports, not code written inside the app.
- App package names (`@bthwani/customer`, `@bthwani/merchant`, `@bthwani/captain`, `@bthwani/control-panel`) are **not** shared-package contracts: one app may not import another app by its bare package name or subpath. Move truly shared functionality to a justified non-app owner package with a reviewed public export; do not bypass the import guard with computed imports.
- The foundation guard currently forbids `src/features` because feature migration is not yet admitted. At the first **separately approved** business feature, replace that blanket prohibition with feature-ownership and contract checks in one reviewed change; do not disable tests or fill directories with placeholders to make a tree look complete.
- Deterministic source import checks live under `tools/mobile/verify-application-boundaries.mjs`. The pinned TypeScript 7 lexical scanner checks static, re-export, literal dynamic and resolver imports, rejects nonliteral computed module calls, forbids cross-owner private paths and cross-renderer dependencies, and rejects new Stage-4 workspace owners or `src/app` route roots. Negative fixtures verify future feature-file ownership **without admitting** actual `src/features` directories. This remains a lexical guard, **not** full alias/computed-import dataflow tracing, cycle analysis, package-level builds, runtime authorization or route/contract E2E proof. The Stage-4 feature prohibition remains in `verify-app-foundations.mjs` until separately approved.

### Names which must not be conflated

- **Actor/Merchant** is an Identity-authenticated person or delegated role; **Store** is a DSH-owned business resource. A Merchant may operate multiple Stores. See `governance/identity.md` and `governance/stores.md` for Product semantics.
- **MARKETPLACE/DIRECT** is a Store relation; **COMMISSION/SUBSCRIPTION** is a WLT agreement model; **PLATFORM_MANAGED/STORE_MANAGED** is collection responsibility. These are independent dimensions, not parallel Store or Order implementations. Historical `BTHWANI_PARTNER/INDEPENDENT_STORE` values require an approved compatibility decision before mutation.
- **Clients package** means public, contract-derived callers. An exported empty `clients/index.ts` only prepares the TypeScript workspace; it is neither a usable SDK nor a running Go **backend**. OpenAPI `paths: {}` fragments are reserved labels, not active operations.
- **Fresh Baseline** installs a new isolated empty database; **migration** is an immutable applied upgrade history. They must not be conflated, renumbered or applied interchangeably. See `governance/safety.md`.
- **Foundation PASS**, **required GitHub check PASS**, **governance READY**, **native runtime PASS** and **production release approved** are independent gates. Main is the protected branch, 41 is donor history, and the Worktree is a directory; no branch change implicitly migrates databases or authorizes deployment.

## Structural closure
A slice is structurally accepted only when the winning path, every affected consumer, generated API, SQL/config reference and test is updated, the losing path is gone, and source/runtime proof is tied to the exact accepted revision. Otherwise report NOT_RUN, BLOCKED or REVIEW_BLOCKED; do not infer correctness from Git status alone.
