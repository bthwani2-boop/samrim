# بثواني — Stage 4 foundation (source-sparse, no commercial screens)

This worktree contains the *foundation shells* for Expo Customer, Merchant and Captain (Expo Router + Tamagui 3.3.1) and Next.js Operator (Next 16.4.3 + Ant Design 6.6.7). **No commercial business feature or service client** is activated. The original exact Expo/RN/React/Node/pnpm dependencies and app IDs are preserved. Original manifests are recorded in [the donor version snapshot](docs/reference/MOBILE-FOUNDATION-SOURCE-MANIFESTS.json).

Compiled brand roots and semantic light/dark roles belong only to `packages/design-system/src/brand/colors.ts` and `src/semantics/themes.ts`. `src/web/css-projection.ts` generates browser semantic variables; numeric layout, font sizing, radius, motion and overlay tokens are owned by Tamagui for Expo and Ant Design for Operator, rather than duplicated in the brand package. The minimal React Native SYSTEM/LIGHT/DARK appearance controller now lives at `packages/tamagui-config/src/appearance.tsx` and consumes the same semantic source. No second UI picker or Studio publisher was introduced.

## Validations

```powershell
pnpm install --offline --frozen-lockfile --ignore-scripts
pnpm run check
pnpm run check:toolchain # also verifies the globally installed Go version with GOTOOLCHAIN=local
pnpm run check:apps
pnpm --dir packages/design-system theme:check
```

After an Operator production build (`pnpm --dir apps/control-panel build`), run `node tools/dev/verify-operator-http.mjs` for a bounded loopback-only HTTP smoke of `/`, `/health`, `/lab` and 404: Arabic document RTL, non-indexing and the currently configured security headers. The CI presentation job runs the same smoke after building. This does **not** certify browser hydration, CSP nonce enforcement, authentication, service integration, or real operator data.

For the two **approved Expo Web SSR hosts only**, export Customer and Merchant with `pnpm --dir apps/customer exec expo export --platform web` and `pnpm --dir apps/merchant exec expo export --platform web`, then run `node tools/mobile/verify-expo-web-http.mjs`. It serves the exact built SSR output on disposable loopback ports and checks Arabic HTML direction, route content and 404 status, closing the server after each host. CI runs it after the Web exports. **Captain is Android/iOS-only at this stage:** a manually forced static Web export does not admit Captain Web or prove native Android/iOS behavior. Browser hydration, native builds, role authorization, CSP and business functionality require independent later evidence.

App configuration is built locally by `tools/mobile/define-bthwani-expo-app.cjs` and `apps/*/mobile.config.json`. The new Stage-4 secret root is `C:\BTHWANI-Secrets\samrim-refoundation-clean-20261112\env\mobile.env` (or an explicit `BTHWANI_SECRETS_ROOT`), **not the donor root**. A shell preview does not require Google Maps credentials. Set `BTHWANI_ENFORCE_NATIVE_KEYS=1` before any separately authorized Native Build; it will **fail closed** without the required keys. No credentials are checked into this repository.

**Run all preview servers from `D:\samrim-refoundation-clean-20261112` only.** Before launching, inspect each listening port, its owning PID and process command line. On the Bthwani Windows host on 2026-11-13, `28111/28112/28113/23010` were owned by existing SSH forwards to `bthwani-docker`, **not** this Worktree. Preserve those tunnels; do not mistake HTTP 200 on a forwarded port for a local app. An isolated local preview was instead observed at `38111` (Customer), `38112` (Merchant), `38113` (Captain Metro only) and `3300` (Operator Next). These are **observations, not reserved eternal ports**: always confirm current availability and source-directory ownership. Do not start duplicate servers, overwrite foreign listeners or use the donor `D:\samrim` as launch CWD.

On Windows with Node 24, `localhost` may resolve to IPv6 `::1` while USB `adb reverse` needs an IPv4 listener. In each **Expo launch session only**, set `$env:NODE_OPTIONS = '--dns-result-order=ipv4first'`, then run Expo with `--dev-client --localhost --port <verified-local-port>` from the corresponding app folder. Verify `127.0.0.1:<verified-local-port>/status` before linking an Android device. The currently installed development binaries may request their previous `28111/28112/28113` endpoints; map those **device-side** ports to the verified isolated host ports with individual `adb reverse tcp:<device-port> tcp:<local-port>` only when that matches the installed binary and authorized device. On this machine, the tested mapping was `28111→38111`, `28112→38112`, `28113→38113`. An unmatched-route deep link is not successful until the app reaches its actual `/` route. Do not change system-wide Node settings, bind Expo publicly, restart shared tunnels or infer that an Android smoke test approves a new native build.

Customer and Merchant deliberately omit the donor `package.json` `type: module`: SDK 58's exported SSR renderer is CommonJS and otherwise `expo serve` fails with HTTP 500 (`module is not defined`). The native package IDs and original pinned dependency versions remain unchanged. `tools/mobile/verify-app-foundations.mjs` guards this compatibility decision.

Customer and Merchant Expo Web now use SDK 58 server rendering with `useServerDocumentContext()` (`headNodes` and `bodyNodes`), Arabic `lang`/`dir`, and a rendered appearance fallback before hydration; the actual dev-server HTML was checked for Arabic content, metadata, scripts, and RTL, and browser interaction was checked. The canonical `expo-localization` plugin owns native RTL (`forcesRTL: true` with Arabic supported locales). Expo Router navigation uses the native locale direction without a hand-set `LocaleProvider`; screen-level `direction`, fixed `textAlign=left/right`, or runtime `forceRTL` calls are prohibited. The `tools/mobile/verify-rtl.mjs` guard and its negative tests run in `pnpm check` and the existing source-only CI. The Expo Web document boundary retains `lang="ar" dir="rtl"`. This static guard does not certify native back-swipe/transition direction, iOS, or future visual components; these still need live verification on an actual build. The foundation check also invokes canonical CSS-generation and source-authority guards.

Maps remain **NOT_RUN** as functional experiences: `react-native-maps` and optional Google Maps configuration are present, but no map screen, location permission journey, route, or tracking integration has been accepted. Next.js Ant Design uses the official SSR style registry and an enforced per-request CSP/nonce in its Next Proxy. The **production loopback HTTP/SSR smoke** passed on candidate `a0a4c79b` (GitHub CI job `132252778475`, step 10): four routes, Arabic SSR/RTL, actual enforced CSP header, unique script nonces, and rejection of attacker-supplied nonce headers. This proves the tested local HTTP boundary only; its current CSP intentionally still permits inline styles for Ant Design. Real interactive browser hydration under CSP, authenticated Operator flows and production security certification remain **NOT_RUN**. iOS and business integration are **NOT_RUN**.

Native identifiers, owner, EAS project IDs, app slugs, schemes and package permissions are preserved. `eas.json` contains **legacy `image: latest`** in preview/iOS profiles; reproducible remote builders are **BLOCKED/NOT_RUN** until images are reviewed without changing original dependencies. Existing Android development builds were used for Stage-4 UI smoke tests on Samsung. This validates rendering of preview shells on those installed binaries only; the current native configuration is **not** certified until a separately authorized native rebuild and device verification.

## Spec Kit CLI — current development workflow

Spec Kit is installed as the **agent-neutral** `none` integration, with pinned PowerShell scripts and a **derived** constitution router in `.specify/memory/constitution.md`. It is not a second policy root, does not register agent-specific slash commands, and does not authorize implementation. The local CLI version is `1.3.0`; the foundation verifier checks the tracked integration, version alignment and SHA-256 hashes of the official vendor scripts. A newer CLI release is **not** a reason to upgrade project tools or regenerate these vendor-managed files without a separate reviewed version change.

From the root of **this worktree** on Windows, the following commands are read-only and were checked on this machine:

```powershell
specify version
specify check
specify artifact list --json
specify workflow list
```

To resolve a proposed, **already authorized** change's paths without choosing a Git branch, changing the global active feature or creating files:

```powershell
$env:SPECIFY_INIT_DIR = (Get-Location).Path
$env:SPECIFY_FEATURE_DIRECTORY = 'specs/000-example-change'
$env:SPECIFY_FEATURE_NO_PERSIST = '1'
& .\.specify\scripts\powershell\check-prerequisites.ps1 -PathsOnly -Json
Remove-Item Env:\SPECIFY_FEATURE_DIRECTORY, Env:\SPECIFY_FEATURE_NO_PERSIST, Env:\SPECIFY_INIT_DIR -ErrorAction SilentlyContinue
```

`-PathsOnly` checks **path resolution only**; its JSON `BRANCH` field is the logical feature directory name, **not** a Git branch creation or switch. It neither creates a feature directory nor validates `spec.md`, `plan.md` or `tasks.md`. Use a real approved feature ID in place of the example, keep related specifications scoped to that change and derive their business meaning from the single owner in `governance/`. For later feature work, reconcile `spec.md` → `plan.md` → `tasks.md` against `AGENTS.md`, `REPOSITORY-STRUCTURE.md` and the owning API/UX policy before implementation. An installed `speckit` workflow definition is **not executable as an agent-driven feature pipeline** under the present `none` integration. Do not run `create-new-feature.ps1`, `specify init --here --force` or a workflow that may open a feature branch, overwrite managed files or execute an agent without explicit authorization and an inspected diff. The original branch `41` is a read-only donor.

The **Postman CLI** is also installed globally on Windows (`postman.cmd --version` → `1.83.0`). `postman.cmd status` confirms **no local workspace/resources binding or authenticated CLI session** in this worktree; this is distinct from a connected Postman ChatGPT app. The read-only `postman.cmd init --dry-run --json` would update the root `AGENTS.md` and add empty API folders plus another local copy of 18 Postman skills. Do not run that initialization blindly during the zero-operation scaffold stage: preserve the canonical agent law and initialize/associate owner-scoped API work only after real reviewed contracts and a conflict-free change are admitted. Do not run the old loopback DSH readiness collection against an unidentified process as a substitute for target runtime tests.

This validates *developer setup*, not governance cutover or customer/merchant/driver features. Missing API operations, persistence, risk proof, service integration and native/browser E2E tests remain `NOT_RUN`/blocked until their respective stages and owner approvals.

## Services placement only

`services/identity/`, `services/dsh/` and `services/wlt/` have Git-tracked owner READMEs and **private, pinned TypeScript client-package scaffolds**: `package.json`, `tsconfig.json`, `clients/README.md` and intentionally empty `clients/index.ts`. Run each package's `typecheck` once its pinned dependencies are available, or use the already-installed root TypeScript binary. Each service also has one **zero-operation OpenAPI 3.1 contract entrypoint**; the reserved `paths/*.yaml` structure now has **7 Identity + 21 DSH + 14 WLT** source-audited domain groups, all containing only `paths: {}` and none referenced by a root entrypoint. The [SHA-pinned donor census](docs/reference/OPENAPI-DONOR-CONTRACT-INVENTORY.md) records the original API structure and ownership exceptions. The current guard rejects added endpoints, `$ref` values or extra path files until an authorized contract implementation stage; it does not replace a full OpenAPI parser for real APIs. There are no real API operations, Go clients, service Go modules or SQL; generated clients and additional dependencies require actual reviewed contracts. `node_modules/` is installed by pnpm only, never copied from the donor. Nx `project.json` is intentionally deferred. The Foundation Guard rejects prematurely adding Go/SQL/executable OpenAPI operations, a fourth HR service or unauthorized client behavior; the employee capability belongs inside DSH. See [repository placement](REPOSITORY-STRUCTURE.md). Untracked empty directories are not portable Git content.

## Boundaries

`GOVERNANCE_CUTOVER: NOT_READY`; the human-approved target policy choices of 2026-11-13 still require semantic reconciliation and documented internal finance/security/migration/legal risk assurance before affected implementation is activated. An external consultant signature is not a prerequisite for recording those choices; missing technical and runtime proof remains `NOT_RUN` or `REVIEW_BLOCKED`. The worktree does not introduce Go services, financial logic, SQL, Docker or live Product screens. The user explicitly requires any *later* Docker infrastructure to be **new and isolated to this Worktree**, not the donor's old containers, volumes or database.

Use [the active governance readiness index](governance/README.md) and [the single execution plan](docs/REFOUNDATION-PLAN.md) for scope and evidence. Pass of static CI or typecheck alone does not demonstrate Android/iOS/browser runtime success.
