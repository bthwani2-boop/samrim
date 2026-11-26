# بثواني — Development workspace

The current canonical checkout is on Surface at D:\samrim. Read [AGENTS.md](AGENTS.md), [repository ownership](REPOSITORY-STRUCTURE.md) and [the governance index](governance/README.md) before engineering changes. The four presentation hosts are Customer, Merchant, Captain and Operator; Identity, DSH and WLT are the only business-service owners. Source presence is not proof of implementation, security, runtime or production acceptance.

## Daily development

Use PowerShell 7 on Surface from the authorized checkout. Follow [the canonical Surface-to-Lenovo operations guide](tools/dev/README-Lenovo-Development.md) for app processes, sync, SSH, Docker, Android, current ports, provenance and recovery.

    pnpm dev
    pnpm dev apps open
    pnpm dev apps status
    pnpm dev apps verify

The default launch reuses existing servers/tasks and checks their readiness; it does not replace owner containers or mutate data. Use pnpm dev up only within the existing authorized isolated environment, and do not create parallel watchers, tunnels, Metro or Next servers. The operations guide owns the precise lifecycle and protection conditions.

## Pinned toolchain and verification

The executable version pins belong to .node-version, .nvmrc, .go-version, package.json and the frozen pnpm lock. The [donor toolchain inventory](https://github.com/bthwani2-boop/samrim/blob/1a50fce55cc0eacca61152ac86b5621f344c92db/docs/reference/TOOLCHAIN-SOURCE-VERSIONS.md) is historical provenance, not another pin table. Do not upgrade toolchains, packages or global PATH without authority.

    node -p 'process.execPath + " " + process.version'
    node tools/dev/verify-workspace.mjs --require-exact-toolchain
    pnpm install --frozen-lockfile --ignore-scripts
    pnpm check
    pnpm check:coverage
    pnpm exec nx show projects

pnpm check is the fast structural/static admission command; it does not run the source test suite. Run the affected owner tests during development and pnpm check:coverage for the full automatically discovered source suite. Use the focused check:security and check:test-inclusion commands only when investigating those owners, not as a second full test route. The same check:contracts command validates all three owner contracts and deterministic generated operation parity locally and in CI. For an exact locked installation already present in the pnpm store, add --offline. If an authorized Windows command runner prepends its own Node, select the actual pinned installed executable for that process only; for example, after verifying C:\Program Files\nodejs contains the pin:

    $env:Path = 'C:\Program Files\nodejs;' + $env:Path

Do not change the provider executable, global PATH or pin to hide a mismatch. The source-only workspace guard runs without installed dependencies, validates configuration and matching lock importer pins, and does not certify a real frozen install, app, database or cache execution. Its strict mode checks the active Node and installed pinned Go offline. CI's native frozen install and actual owner checks establish separate evidence.

## Applications and design

The design system owns authored brand/semantic colors and generated CSS; Tamagui renders Expo and owns the minimal React Native appearance runtime. Operator uses Ant Design. Keep platform-specific component primitives with their renderer and never introduce another palette.

Customer/Merchant support Expo Web SSR and native Android/iOS; Captain's approved host is native Android/iOS. Operator is the Next.js web host. Native IDs, schemes, EAS project IDs, owner and permission configuration remain protected. Use the actual registered manifests and app identity verifier. The [donor manifest inventory](https://github.com/bthwani2-boop/samrim/blob/1a50fce55cc0eacca61152ac86b5621f344c92db/docs/reference/MOBILE-FOUNDATION-SOURCE-MANIFESTS.json) is historical provenance. Customer/Merchant deliberately omit type: module because the Expo SSR renderer is CommonJS. Expo localization and the Web document boundary own Arabic RTL; avoid screen-level direction overrides.

    pnpm check:design
    pnpm check:apps:source
    pnpm --dir apps/customer exec expo export --platform web
    pnpm --dir apps/merchant exec expo export --platform web
    node tools/mobile/verify-expo-web-http.mjs
    pnpm --dir apps/control-panel build
    node tools/dev/verify-operator-http.mjs

The export/HTTP commands prove only their actual local build and loopback scope, not browser hydration, native binaries, authorization, payments or complete journeys. Test the actual affected Chrome and Samsung surfaces. Expo config reads mobile keys from explicitly provided variables or authorized BTHWANI_SECRETS_ROOT\env\mobile.env; never infer a donor secrets path. Use BTHWANI_ENFORCE_NATIVE_KEYS=1 for a separately authorized Native Build. Do not start EAS/cloud builds, signing, production deployments or change protected config without the required authorization.

## Spec Kit and Graphify

AGENTS.md owns the mandatory native CLI and local graph evidence on repository engineering. Spec Kit's .specify integration is agent-neutral none; its constitution is a derived router to current governance, not a second policy owner.

    specify version
    specify check
    node tools/dev/graphify-local.mjs status
    node tools/dev/graphify-local.mjs query "task-relevant source and consumers"
    node tools/dev/graphify-local.mjs coverage <affected-paths>

Reuse applicable existing specs. To inspect the paths of an existing authorized feature directory without changing the branch or active feature:

    $env:SPECIFY_FEATURE_DIRECTORY = 'specs/<actual-feature>'
    $env:SPECIFY_FEATURE_NO_PERSIST = '1'
    & .\.specify\scripts\powershell\check-prerequisites.ps1 -PathsOnly -Json
    Remove-Item Env:\SPECIFY_FEATURE_DIRECTORY, Env:\SPECIFY_FEATURE_NO_PERSIST

The native setup-plan.ps1 and setup-tasks.ps1 may be used for genuinely necessary authorized spec artifacts; inspect the current workflow first. Do not invoke branch-creating modes, specify init or agent dispatch in the none integration. CLI presence or path resolution alone does not prove a specification or implementation. Graphify uses the existing Surface runner and watcher; a stale index is INVALIDATED, not permission to replace its owner or force refresh. Use the [reference index](docs/README.md) for historical evidence.

## Nx, dependencies and CI

Nx reads the actual pnpm projects and targets; do not introduce another task registry. Use actual comparison commits for affected runs and --skip-nx-cache for acceptance evidence. Typecheck and design cache inputs include pinned tools and the lock.

The dedicated Nx Cloud configuration in nx.json is distinct from the archived donor workspace. It is not proof that remote cache is available or that an invocation is local-only. Do not embed tokens, change provider configuration, enable paid runners or incur costs without authority. Use process-local NX_NO_CLOUD=true for explicitly local-only runs; development CI uses that setting. Do not cache sensitive output.

CI runs once for a pull request to main and independently for the integrated main push. Development branch pushes do not trigger CI: run native Nx affected and owner checks locally. Use GitHub native rerun for an existing CI run; use local full verification for a branch without a PR. The scheduled dependency audit has its own schedule-only workflow and uses the native locked-graph advisory check without installing dependencies or caching packages. The call-only Go workflow remains part of the required CI. See [engineering governance](governance/engineering.md) for acceptance, runtime boundaries and baseline-first SQL. Verify required checks on the exact published SHA; do not infer production readiness or a closed business journey from CI alone.
