# BThwani — Repository Placement and Ownership

STATUS: ACTIVE_FOR_PROGRESSIVE_DEVELOPMENT
SEMANTIC_SCOPE: authored source placement, naming, dependency boundaries and consumer cutover.

This file owns repository placement, not business policy, execution permission or acceptance. Follow [AGENTS.md](AGENTS.md) for execution, the [governance index](governance/README.md) for decision owners, [architecture](governance/architecture.md) for service ownership and [engineering](governance/engineering.md) for lifecycle and acceptance.

## Canonical paths

| Path | Responsibility |
| --- | --- |
| AGENTS.md | Repository execution entry and routing to authoritative owners |
| REPOSITORY-STRUCTURE.md | Repository placement and dependency boundaries |
| governance/ | Single active durable semantic governance; its index owns governance cutover |
| README.md | Current development onboarding and operations navigation |
| docs/README.md | Single documentation navigation index |
| docs/reference/ | Nonbinding research and unique historical evidence; engineering-references.md is the canonical external reference catalog |
| .agents/skills/speckit-*/SKILL.md | Official Spec Kit Codex skills managed by its installed integration |
| .specify/ | Official Spec Kit managed assets, configuration and derived project constitution |
| specs/ | Project-owned derived specifications, plans, tasks and applicable evidence |
| .github/ | Native CI, security and integration configuration |
| package.json, pnpm-workspace.yaml, pnpm-lock.yaml, nx.json | Single workspace dependency and native task graph |
| .node-version, .nvmrc, .go-version | Executable runtime pins |
| tsconfig.base.json, biome.json, knip.jsonc, .editorconfig, .gitattributes, .gitignore | Shared type, lint, dependency discovery, encoding and exclusion configuration |
| services/{identity,dsh,wlt}/ | Three canonical business-service source owners |
| apps/{customer,merchant,captain,control-panel}/ | Four actor presentation hosts; control-panel is Operator |
| packages/design-system/ | Authored brand and semantic color source with reproducible browser CSS projection |
| packages/tamagui-config/ | Expo renderer configuration and minimal native appearance controller consuming brand semantics |
| packages/<purpose>/ | Domain-neutral public source with actual multi-owner consumers |
| tools/dev/ | Shared development lifecycle and source/contract/coverage/placement tools, operations documentation |
| tools/mobile/ | Native configuration, registered identities, renderer, route and platform-source verification |
| tools/security/ | Shared source-security checks and regression fixtures |
| infra/ | Environment-owned compose.yaml, configuration example and operating documentation |
| patches/ | Necessary exact-version dependency patches referenced by the frozen pnpm graph, including current Ant Design CSP and Picomatch security patches |
| tests/ | Cross-owner or infrastructure integration proof; focused tests remain with their implementation owners |

Keep official Spec Kit managed assets at their original paths and update only through authorized official releases. The project constitution and specifications do not become another policy root. Engine methodology belongs to the published Engineering Core, not a duplicate local skill hierarchy. See [execution entry](AGENTS.md) for actual mandatory Spec Kit and Graphify invocation and official update boundaries.

Generated graph/index artifacts, build outputs, dependencies, coverage, credentials and disposable evidence follow their existing tool/ignore rules. They are not separately authored business facts. Do not add parallel indexes, registries, runners, governance roots or synchronization paths. Archived donor source is read-only, not an active implementation.

## Service and contract placement

The three service boundaries, including bounded DSH employee administration, belong to [architecture](governance/architecture.md). No fourth HR, commerce or finance service. Each owner retains its README, private @bthwani/<owner> package, root-derived strict TypeScript configuration, actual frozen-lock importer and public contract-derived clients/index.ts export.

| Area | Legal placement | Rejected drift |
| --- | --- | --- |
| Go entry | services/<owner>/backend/cmd/<owner>/*.go; owner-local go.mod, Dockerfile and Nx target as needed | Go at backend root, foreign service command, empty backend or duplicate service |
| Go domains | backend/internal/<domain>/**/*.go; meaningful lowercase package names | generic framework-layer quotas, misc, legacy, partners, private owner-crossing source |
| Fresh SQL | services/<owner>/database/schema/NN_domain.sql | backend SQL, unnamed/duplicate baselines, experimental migration histories |
| Synthetic WLT SQL | services/wlt/database/sandbox/NN_domain.sql | production financial commands hidden in fixtures, another owner's sandbox |
| OpenAPI | contracts/openapi/<owner>.openapi.yaml; flat paths/<domain>.yaml for cohesive operations | second entrypoint/catalog, path/ directory, unreferenced or unjustified empty fragments |
| Public client | clients/index.ts with owner-local contract-derived source and tests | app-authored duplicate DTO/SDK or cross-owner private imports |

[API-01](governance/engineering.md#api-01--openapi-organization-and-semantic-equivalence-gate) governs contract semantics and generated parity. Reference each executable domain fragment from its sole entrypoint, regenerate derived clients/manifests, and preserve strict schema, references, unique path/method/operationId, security/error contracts and actual backend/client parity. The [donor OpenAPI inventory](docs/reference/OPENAPI-DONOR-CONTRACT-INVENTORY.md) is historical provenance, not an operation quota or executable source. Place owner tests alongside the responsibility and cross-owner proof in tests/.

[SQL-01](governance/engineering.md#sql-01--safe-one-baseline-per-owner-fresh-bootstrap-protected-upgrades) governs baseline-first and protected upgrades. New database/migrations/ files are not admitted in the current phase. Versioned retained-data upgrades need the authorized migration epoch and aligned guard; preserve applied history, existing data and legal obligations. Fresh baseline is not retained-data replay.

## Application and renderer boundaries

Follow [platform](governance/platform.md) for Customer/Merchant/Captain/Operator, Store and protected external identities. No new client/partner aliases or duplicate actor/Store engine. Changes to external IDs, EAS, deep links, signing and historical financial/legal identifiers require authorized consumer transition.

- Each app uses one app/ route root with actual Expo Router or Next App Router conventions, never src/app/. Preserve route parameters, metadata, links, accessibility, authorization and error states. A simple route-local component is legal; substantial presentation belongs to its feature.
- Feature source is src/features/<lowercase-kebab-capability>/ with meaningful lowercase-kebab-case files/directories and standard platform/test suffixes. Optional first tiers: screens/, components/, hooks/, queries/, mappers/, state/, tests/. No empty scaffolds, forced identical structures, nested feature roots or generic common/shared/misc/legacy/new/v2/partners buckets.
- App-local src/components/ and src/providers/ are optional, justified by reuse. Prefer feature locality; avoid feature cycles. Actual cross-app reuse belongs to a domain-neutral package with a private manifest, explicit public exports and at least two actual source-owner consumers.
- Operator route composition is apps/control-panel/app/(workspace)/; server-only transport belongs to src/server/auth/, clients/ or transport/. Next app/api/ handlers require genuine authenticated same-origin, security or bounded integration needs. No shadow proxy for every owner API or Expo import of Operator server source.
- Apps import their own code and approved public package/owner client exports only. No bare app-package imports, app-to-app private paths, relative escapes, private backend/database/contracts/clients subpaths, private renderer imports or computed-import bypasses. Shared packages do not become business engines.
- Brand roles originate in design-system; Expo consumes through tamagui-config, Operator through Ant Design projection. Renderer-native components remain local; no second palette or component engine. Native Expo/Metro tooling remains the owner of resolved configuration.

Use existing [application boundaries](tools/mobile/verify-application-boundaries.mjs) and [registered app identity](tools/mobile/verify-app-identity.mjs) checks. Their lexical and directory coverage includes untracked authored source but is not complete dynamic dependency, binary or runtime authorization proof.

## Dependency and runtime placement

pnpm and Nx own the workspace task graph. Contract changes invalidate actual owner backend and client consumers; owner schema and WLT sandbox changes invalidate that backend. New paths must be included in affected routing. Next .next/types belongs to Operator typecheck. Evidence uses verified base/head, affected targets and required direct tests; cache or graph membership is not behavioral proof.

Keep one [environment Compose definition](infra/compose.yaml), with separate owner Dockerfiles. No environment replicas or overlays merely because a role, service or feature changes. [Development operations](tools/dev/README-Lenovo-Development.md) and [infrastructure](infra/README.md) document the existing launcher, sync, tunnels, database isolation and provenance. [Data lifecycle](governance/engineering.md#local-development-data-lifecycle) owns protected state and runtime requirements.

Place synthetic bootstrap/seed and fixtures at the actual owner commands/domain; WLT sandbox SQL remains separate. Cross-owner tests live in tests/. No duplicate fixture writer, seed system, schema loader, store or deployment registry. Local sensitive state, logs, backups, screenshots and coordination artifacts are not build inputs or policy. Before removing them, respect actual retention, recovery, consumers and authority.

## Placement and simplification law

Every authored component needs a distinct responsibility, valid placement, actual consumer and source contract. Prefer existing native or owner capabilities; no arbitrary file/line quotas, forced architecture layers, speculative package or duplicate runner. Dependency additions and patches must match actual necessity and frozen versions. A placement exception requires its existing owner, exact paths, consumer evidence, reason and removal/review condition; no blanket ignore or second policy checker.

All authorized remediation follows the single [mandatory removal and clean refoundation law](governance/engineering.md#mandatory-removal-and-clean-refoundation), including complete affected-file disposition, consumer transition, elimination of superseded paths, protected state and recurrence proof. A placement exception cannot override that law. Graphify and Knip findings inform investigation; neither alone authorizes deletion. Source inventory supports cohesion review, not automatic file splitting.

## Executable checks and structural acceptance

| Responsibility | Existing evidence owner |
| --- | --- |
| Workspace, toolchain, Go/SQL/OpenAPI placement | pnpm check:workspace; [workspace tests](tools/dev/verify-workspace.test.mjs); [service guard](tools/dev/check-service-placement.mjs) |
| App/import/export/renderer boundaries | [application guard](tools/mobile/verify-application-boundaries.mjs); [fixtures](tools/mobile/verify-application-boundaries.test.mjs) |
| Owner contracts and generated parity | pnpm check:contracts; [contract guard](tools/dev/check-openapi.mjs) |
| Dependency and source analysis | pnpm knip:files; [source inventory](tools/dev/source-inventory.mjs); [fixtures](tools/dev/source-inventory.test.mjs); mandatory local Graphify |
| Affected routing and test inclusion | [Nx impact tests](tools/dev/verify-nx-project-graph.test.mjs); pnpm check:test-inclusion and existing test discovery |
| Actual Go/SQL/restore and source integration | [CI](.github/workflows/ci.yml); [security](.github/workflows/security.yml) |

Existing guards must cover authored/untracked paths, illegal owners, linked roots and valid/rejected consumers. Use and strengthen the owner guard for a proven gap, never a parallel checker. Placement acceptance covers actual source, winning contracts, consumer cutover and removal of losing paths. Runtime, journey, governance cutover and production acceptance are separate under the engineering owner; no scaffold, source location, spec count or structural PASS proves them.
