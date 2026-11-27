# بثواني — Development workspace

BThwani is under progressive development. [AGENTS.md](AGENTS.md) is the execution entry, [repository structure](REPOSITORY-STRUCTURE.md) owns placement, and [governance](governance/README.md) routes authoritative decisions. Identity, DSH and WLT own business services; Customer, Merchant, Captain and Operator are their presentation hosts. Source presence does not certify runtime, journey or production acceptance.

## Daily development

Use PowerShell 7 from the authorized Surface checkout. The [Surface-to-Lenovo operations guide](tools/dev/README-Lenovo-Development.md) owns the current device, sync, tunnel, Docker, Android, port and recovery instructions.

    pnpm dev
    pnpm dev apps open
    pnpm dev apps status
    pnpm dev apps verify

The default launch reuses existing servers and verifies readiness without replacing owner containers or mutating data. Use the guide for separately admitted lifecycle operations, including `pnpm dev up`; do not start duplicate watchers, tunnels, Metro or Next servers.

## Pinned toolchain and verification

Runtime pins belong to .node-version, .nvmrc, .go-version, package.json and the frozen pnpm lock. Check the actual executable and use the existing tasks:

    node -p 'process.execPath + " " + process.version'
    node tools/dev/verify-workspace.mjs --require-exact-toolchain
    pnpm install --frozen-lockfile --ignore-scripts
    pnpm check
    pnpm check:coverage
    pnpm exec nx show projects

`pnpm check` performs structural/static admission, not the full source test suite. Run affected owner tests and use `pnpm check:coverage` for the automatically discovered source suite. `pnpm check:contracts` verifies the three owner contracts and generated operation parity. The focused `check:security` and `check:test-inclusion` commands address their respective owners. Use --offline only for a verified complete frozen installation from the local store. A strict workspace check does not prove a real install, app, database or cache execution.

If the Windows runner prepends its own Node, select the verified pinned installed executable for that process only; for example, when the official pin is installed under Program Files:

    $env:Path = 'C:\Program Files\nodejs;' + $env:Path

Do not change global PATH, provider executables or runtime pins to conceal a mismatch. The [donor toolchain inventory](https://github.com/bthwani2-boop/samrim/blob/1a50fce55cc0eacca61152ac86b5621f344c92db/docs/reference/TOOLCHAIN-SOURCE-VERSIONS.md) records history, not current pins.

## Applications and design

The [repository structure](REPOSITORY-STRUCTURE.md) owns renderer and application placement. The design system owns brand/semantic colors; Expo uses Tamagui and Operator uses Ant Design. Customer/Merchant use Expo Web SSR and native Android/iOS; Captain uses native Android/iOS; Operator uses Next.js Web. Customer/Merchant intentionally omit type: module for the CommonJS SSR renderer. Expo localization and Web document boundaries own Arabic RTL.

    pnpm check:design
    pnpm check:apps:source
    pnpm check:lint
    pnpm --dir apps/customer exec expo export --platform web
    pnpm --dir apps/merchant exec expo export --platform web
    node tools/mobile/verify-expo-web-http.mjs
    pnpm --dir apps/control-panel build
    node tools/dev/verify-operator-http.mjs

These commands prove only their actual build/loopback scope, not browser hydration, native binaries or owner journeys. Test affected Chrome and Android surfaces directly. Use the actual registered manifests and app identity verifier. Registered identities, EAS configuration and signing are governed by [platform](governance/platform.md) and [engineering](governance/engineering.md). The [donor manifest inventory](https://github.com/bthwani2-boop/samrim/blob/1a50fce55cc0eacca61152ac86b5621f344c92db/docs/reference/MOBILE-FOUNDATION-SOURCE-MANIFESTS.json) is historical provenance.

Expo configuration obtains mobile keys from explicitly provided variables or the authorized BTHWANI_SECRETS_ROOT\env\mobile.env source. Use BTHWANI_ENFORCE_NATIVE_KEYS=1 for a separately authorized native build. Do not infer donor secrets or initiate signing, EAS or release effects without authorization.

## Native Spec Kit and applicable Graphify

Follow [AGENTS.md](AGENTS.md#6-mandatory-evidence-and-acceptance) for the authoritative tool applicability and evidence contract. Native Spec Kit is required for every repository engineering task. Verify the live official Codex integration, preserve managed assets and use the project constitution as a router, not another governance authority.

    specify version
    specify check
    specify integration status

Use relevant existing specifications under specs/. For an authorized existing feature, resolve its paths through the native script without persisting feature selection or changing branches:

    $env:SPECIFY_FEATURE_DIRECTORY = 'specs/<actual-feature>'
    $env:SPECIFY_FEATURE_NO_PERSIST = '1'
    & .\.specify\scripts\powershell\check-prerequisites.ps1 -PathsOnly -Json
    Remove-Item Env:\SPECIFY_FEATURE_DIRECTORY, Env:\SPECIFY_FEATURE_NO_PERSIST

Use native setup-plan.ps1 and setup-tasks.ps1 only where derived artifacts are needed. Do not initialize, create a branch or dispatch another agent without applicable authority. Preserve authorized public-safe project specifications in Git; exclude generated workflow state and secrets, not the whole specs/ directory. CLI readiness and path resolution do not establish SDD completion.

When the actual engineering scope requires graph-assisted relationship or dependency evidence, use the existing local Surface runner:

    node tools/dev/graphify-local.mjs status
    node tools/dev/graphify-local.mjs query "task-relevant source and consumers"
    node tools/dev/graphify-local.mjs coverage <supported-affected-paths>

Use the existing watcher; never refresh from a read-only query or add a second scheduler, Git hook or CI gate. INVALIDATED graph evidence can support diagnosis, not acceptance. If Graphify is not needed, record the concrete scope reason and actual direct native source/owner evidence under AGENTS.md rather than executing a ritual or declaring a graph PASS. See the [reference catalog](docs/reference/engineering-references.md) for applicable official sources and the [documentation index](docs/README.md) for history.

## Nx, dependencies and CI

Nx and pnpm own the workspace graph. Use real comparison commits for affected checks and --skip-nx-cache for acceptance evidence. The typecheck and design inputs include runtime pins and the lock. The Nx Cloud configuration is distinct from the donor workspace; do not infer remote-cache availability or local-only execution. Use process-local NX_NO_CLOUD=true for local checks and disable result caching for acceptance; do not cache sensitive output or enable paid runners without authorization.

The [CI workflow](.github/workflows/ci.yml), [security workflow](.github/workflows/security.yml) and actual GitHub rulesets own check routing. [Engineering law](governance/engineering.md#testability-observability-and-release-proof) defines required exact-candidate coverage, failure handling and security evidence. Sonar consumes successful compatible coverage producers; protected fast-guard and Sonar contexts remain in force. Skipped AI review is not proof. CI does not establish device, release or production readiness.
