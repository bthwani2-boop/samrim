# BThwani — Repository Placement and Ownership

STATUS: ACTIVE_FOR_PROGRESSIVE_DEVELOPMENT
SEMANTIC_SCOPE: authored source placement, naming, dependency boundaries and consumer cutover.

This document owns repository placement. [AGENTS.md](AGENTS.md) owns execution authority and evidence. [The governance index](governance/README.md) routes Product and domain decisions to their sole owners; [architecture](governance/architecture.md) owns changing facts and business engines; [engineering](governance/engineering.md) owns acceptance, lifecycle and refoundation. Nothing in a directory name, scaffold, specification or passing placement check proves implementation or authorizes activation.

## Canonical paths

| Path | Responsibility |
| --- | --- |
| AGENTS.md | Execution, authorization, evidence and Git delivery |
| REPOSITORY-STRUCTURE.md | Placement and source dependency boundaries |
| governance/ | Only active durable semantic governance; historical cutover status belongs to its index |
| docs/README.md | Single documentation navigation index; no policy or status registry |
| docs/reference/ | Useful nonbinding references and unique historical evidence; do not duplicate plans, live configuration or journey acceptance dossiers |
| README.md | Current development onboarding and links to canonical operations |
| .github/ | Branch-independent CI, protected integration checks and PR configuration |
| .specify/ | Existing pinned Spec Kit scripts, templates and derived governance router |
| specs/ | Derived capability specifications, plans, tasks and evidence where useful; not another policy owner or admission gate |
| package.json, pnpm-workspace.yaml, pnpm-lock.yaml, nx.json | One pinned workspace dependency graph, native tasks and cache configuration |
| .node-version, .nvmrc, .go-version | Current executable runtime pins; no implicit version upgrade |
| tsconfig.base.json, biome.json, knip.jsonc, .editorconfig, .gitattributes, .gitignore | Shared type, lint, dependency discovery, source encoding and exclusion configuration |
| services/{identity,dsh,wlt}/ | Exactly three business-service owners |
| apps/{customer,merchant,captain,control-panel}/ | Exactly four actor presentation hosts; control-panel is Operator |
| packages/design-system/ | Authored brand and semantic color source, reproducible browser CSS projection; no second renderer |
| packages/tamagui-config/ | Expo rendering configuration and minimal native appearance controller consuming the semantic source |
| `packages/<purpose>/` | Additional domain-neutral public packages only for genuine multi-owner consumers |
| tools/dev/ | Repository-wide development lifecycle, source/contract/coverage/placement tooling and operations documentation |
| tools/mobile/ | Native Expo configuration and registered identity, renderer, route and platform-source verification |
| tools/security/ | Shared source-security checks and their regression fixtures |
| infra/ | One canonical environment-owned compose.yaml, configuration example and operating documentation |
| patches/ | Only source-approved, exact-version dependency patches referenced by the frozen pnpm graph, including Ant Design CSP and Picomatch security patches |
| tests/ | Genuine cross-owner or infrastructure integration proof; focused unit/feature tests stay with their existing owners |

Generated graph/index artifacts, build output, dependencies, coverage, local credentials and disposable evidence are not separately authored business truth. Keep them under the existing tool and ignore rules; do not add a second index, package registry, CI runner, policy root or source synchronization path. Archived donor material is read-only and cannot become an active parallel implementation.

## Service and contract placement

Only Identity, DSH and WLT are admitted. The [architecture owner](governance/architecture.md) defines their business boundaries, including DSH's bounded employees capability; no fourth HR, commerce or financial service. Each service has its existing owner README, private `@bthwani/<owner>` package, root-derived strict TypeScript configuration and a public contract-derived clients/index.ts export. The root frozen lock contains the actual owner importers. Owner source and tests, not prose STATUS markers, establish implementation.

| Area | Legal placement | Rejected drift |
| --- | --- | --- |
| Go command | `services/<owner>/backend/cmd/<owner>/*.go`, real owner-local go.mod, Dockerfile and Nx target as needed | Go files at backend root, another service's command, empty backend or duplicate service |
| Go domains | `backend/internal/<domain>/**/*.go`, meaningful lowercase Go package names | generic framework-layer quotas, internal/misc, legacy, partners, owner-crossing private source |
| Fresh SQL | `services/<owner>/database/schema/NN_domain.sql`; order and owner invariants belong to SQL-01 | SQL inside backend, unnamed/duplicate baselines, new experimental migration histories |
| Synthetic WLT commands | services/wlt/database/sandbox/NN_domain.sql | production financial commands hidden in fixtures, sandbox under another owner |
| OpenAPI | `contracts/openapi/<owner>.openapi.yaml` and flat `paths/<domain>.yaml` for actual cohesive executable operations | second entrypoint, contracts/openapi/path/, empty or unreferenced fragments, another maintained API catalog |
| Public client | clients/index.ts and owner-local contract-derived source and tests | app-authored duplicate DTO/SDK or cross-owner private imports |

Apply [API-01](governance/engineering.md#api-01--openapi-organization-and-semantic-equivalence-gate) and [SQL-01](governance/engineering.md#sql-01--safe-one-baseline-per-owner-fresh-bootstrap-protected-upgrades). The active baseline-first phase rejects new database/migrations/ files for all three owners; versioned retained-data upgrades require a separately approved epoch and aligned guard. Applied history, existing data and legal obligations remain protected. No baseline replay over retained data or copied losing migration loader. The [donor OpenAPI census](docs/reference/OPENAPI-DONOR-CONTRACT-INVENTORY.md) records historical coverage, not a reservation system, fixed operation count or executable source.

The owner OpenAPI entrypoint references every executable domain fragment. Keep the single source and regenerate derived operation manifests/clients; verify strict YAML/OpenAPI, reference resolution, unique path/method/operationId, security/error/schema constraints and actual backend-client parity. A client export or a generated manifest is not a runtime operation. Place owner tests beside the implementation and use existing integration tests for cross-owner behavior.

## Application and renderer boundaries

Use the [canonical surface and naming owner](governance/platform.md) for Customer/Merchant/Captain/Operator terminology, Store identity and protected external application identities. No new client/partner aliases, duplicate actor or Store engine. Retained external IDs, EAS projects, deep links, signing, historical legal/financial identifiers and compatibility mappings require the governing authorized consumer cutover, never a blind rename.

- Exactly one route root, `apps/<surface>/app/`, using Expo Router or Next App Router's actual conventions. Never a competing src/app/. Preserve route parameters, metadata, deep links, accessibility, authorization and failure states when moving a route. A simple route-local component is legal; a substantial presentation delegates to the existing named feature.
- Substantive presentation belongs in `src/features/<lowercase-kebab-capability>/`; do not create empty scaffolds or require four identical templates. Optional first-tier feature directories are screens/, components/, hooks/, queries/, mappers/, state/, tests/. Deeper meaningful names and files use lowercase-kebab-case with standard platform/test suffixes. No generic common/shared/misc/legacy/new/v2, nested feature root or copied donor partners directory.
- App-local reuse is justified by real consumers; src/components/ and src/providers/ are optional. Prefer feature locality until reuse is real. Avoid circular feature dependencies. Shared cross-app code belongs in a justified domain-neutral public package, never another app's source.
- Operator route composition remains in apps/control-panel/app/(workspace)/, with actual server-only transport under src/server/auth/, clients/ or transport/. Next app/api/ handlers exist only for genuine authenticated, same-origin, security or bounded integration needs, not one shadow handler for every owner operation. Expo does not import Operator server modules.
- An app may import its own code and declared public exports of approved workspace packages and owner clients. Bare app-package imports, app-to-app private paths, relative escapes, private service backend/database/contracts/clients subpaths, private renderer sources and computed-import bypasses are forbidden. Additional packages must have a meaningful purpose, private manifest, explicit public exports and at least two actual source-owner consumers. They cannot become another business or renderer owner.
- Brand roles are authored only in design-system, consumed by the existing Expo Tamagui configuration and Operator Ant Design projection. Renderer-native components stay with their renderer. Do not introduce a second palette, component engine or cross-renderer dependency. Expo configuration uses the existing native tooling and Metro defaults; external identity is checked from actual resolved manifests.

See [the application boundary guard](tools/mobile/verify-application-boundaries.mjs) for executable lexical/import and directory checks and [app identity verifier](tools/mobile/verify-app-identity.mjs) for registered identities. They check authored source including untracked files; they are not complete dependency-dataflow, cycle, native binary or runtime authorization proof.

## Dependency and runtime placement

Nx and pnpm own the actual project/task graph. Contract changes invalidate the corresponding backend and actual client/consumer targets; owner schema and WLT sandbox changes invalidate the owner backend. New authored paths must be included in affected routing. Next .next/types belongs only to Operator's typecheck. Use real base/head and uncached affected tests for acceptance; a cache hit or graph membership does not prove behavior.

Keep the single environment-owned [Compose definition](infra/compose.yaml) and independent owner Dockerfiles. Service, actor or feature changes do not justify additional environment replicas or Compose overlays. The [operations guide](tools/dev/README-Lenovo-Development.md) and [infrastructure guide](infra/README.md) describe the existing launcher, synchronization, tunnels, database isolation and provenance checks; [engineering governance](governance/engineering.md#local-development-data-lifecycle) owns the protected runtime/data lifecycle. Actual image/source parity, contracts, ACLs and durable readback are separate acceptance.

Synthetic bootstrap/seed source stays with the actual owner's commands/domain and test fixtures; WLT synthetic SQL remains in sandbox. Cross-owner integration stays in tests/. Do not create another generic fixture writer, seed system, schema loader, data store or deployment registry. Sensitive local state, external logs, backups, screenshots, coordination notes and reports are non-authoritative artifacts, not input to a serving build. Before deletion, verify exact target, consumers, retention, recovery, protection and authority.

## Placement and simplification law

Every authored component must have a concrete responsibility, owner, actual consumer, legal category and source contract. Reuse the correct owner before adding files. Use stable domain names, no vague or dated live-code folders, arbitrary file/line quotas or forced architecture ladders. A new repository-wide tool requires a proved shared responsibility that the existing native/owner mechanism cannot satisfy. Dependencies and patches must match the frozen graph and actual need; no speculative package, version upgrade, duplicate runner or security bypass.

Apply [mandatory removal and clean refoundation](governance/engineering.md#mandatory-removal-and-clean-refoundation) to every authorized remediation, even one finding. Inventory the complete affected foundation, direct/dynamic imports, package exports, URL/deep links, persisted keys, SQL embedding, contracts, generated outputs, settings and tests before writing. DELETE verified redundant, obsolete and unnecessary files; REFOUND every necessary defective file in full; KEEP only proven necessary sound files. Transfer required behavior and retained obligations first and verify all losing references are gone. No isolated error/line/function repair, renamed workaround, disabled duplicate, empty placeholder or deferred cleanup. A placement exception cannot override that law or authorize protected effects.

Any genuinely necessary placement exception belongs to its existing owner with exact paths, consumers, reason and review/removal condition. Prove legitimate and deliberately illegal cases at the existing guard; never introduce blanket ignores or a parallel policy checker. Source inventory aids semantic cohesion review, not automatic split/deletion. Knip and Graphify findings require actual consumer/source corroboration.

## Executable checks and structural acceptance

| Responsibility | Existing evidence owner |
| --- | --- |
| Workspace, Go/SQL/OpenAPI placement and toolchain | pnpm check:workspace, [workspace fixtures](tools/dev/verify-workspace.test.mjs), [service placement guard](tools/dev/check-service-placement.mjs) |
| App directory/import/public export and renderer boundaries | [application boundary guard](tools/mobile/verify-application-boundaries.mjs) and [fixtures](tools/mobile/verify-application-boundaries.test.mjs) |
| Owner contract and generated operation parity | pnpm check:contracts, [contract guard](tools/dev/check-openapi.mjs) and its fixtures |
| Dependency and authored-source investigation | pnpm knip:files, [source inventory](tools/dev/source-inventory.mjs) and [fixtures](tools/dev/source-inventory.test.mjs), mandatory local Graphify under AGENTS.md |
| Affected routing and test inclusion | [Nx impact fixtures](tools/dev/verify-nx-project-graph.test.mjs), pnpm check:test-inclusion and the existing source-test discovery |
| Real Go/SQL/restore and CI source proof | [CI](.github/workflows/ci.yml) and shared [security workflow](.github/workflows/security.yml) |

Existing native guards must catch new/untracked paths, illegal owners, linked roots and representative legitimate and rejected consumers. Reuse and strengthen the applicable owner guard, not another generic checker. Acceptance requires the exact winning source, complete consumer cutover, absence of losing paths, applicable contract/build/runtime and durable owner proof on the candidate. Follow [AGENTS.md](AGENTS.md) for immutable delivery and actual evidence statuses. Structural PASS, CI PASS, runtime provenance, complete journeys, governance cutover and production authorization are independent; no historical stage, spec count or source location substitutes for them.
