# بثواني — Stage 4 foundation (source-sparse, no commercial screens)

This worktree contains the *foundation shells* for Expo Customer, Merchant and Captain (Expo Router + Tamagui 3.3.1) and Next.js Operator (Next 16.4.3 + Ant Design 6.6.7). **No commercial business feature or service client** is activated. The original exact Expo/RN/React/Node/pnpm dependencies and app IDs are preserved. Original manifests are recorded in [the donor version snapshot](docs/reference/MOBILE-FOUNDATION-SOURCE-MANIFESTS.json).

Compiled brand roots and semantic light/dark roles belong only to `packages/design-system/src/brand/colors.ts` and `src/semantics/themes.ts`. `src/web/css-projection.ts` generates browser semantic variables; numeric layout, font sizing, radius, motion and overlay tokens are owned by Tamagui for Expo and Ant Design for Operator, rather than duplicated in the brand package. The minimal React Native SYSTEM/LIGHT/DARK appearance controller now lives at `packages/tamagui-config/src/appearance.tsx` and consumes the same semantic source. No second UI picker or Studio publisher was introduced.

## Validations

```powershell
pnpm install --offline --frozen-lockfile --ignore-scripts
pnpm run check
pnpm run check:toolchain
pnpm run check:apps
pnpm --dir packages/design-system theme:check
```

App configuration is built locally by `tools/mobile/define-bthwani-expo-app.cjs` and `apps/*/mobile.config.json`. The new Stage-4 secret root is `C:\BTHWANI-Secrets\samrim-refoundation-clean-20261112\env\mobile.env` (or an explicit `BTHWANI_SECRETS_ROOT`), **not the donor root**. A shell preview does not require Google Maps credentials. Set `BTHWANI_ENFORCE_NATIVE_KEYS=1` before any separately authorized Native Build; it will **fail closed** without the required keys. No credentials are checked into this repository.

For isolation from the existing Surface SSH tunnels `18101/18102/18103/13000`, independent *local Surface preview ports* are `28111` (Customer Web + Metro), `28112` (Merchant Web + Metro), `28113` (Captain Metro only), and `23010` (Operator). These are not claims that the prior Lenovo runtime ports `18111/18112/18113/13010` already serve this Worktree.

On Windows with Node 24, `localhost` may resolve to IPv6 `::1` while USB `adb reverse` needs an IPv4 listener. In the **Expo launch PowerShell session only**, set `$env:NODE_OPTIONS = '--dns-result-order=ipv4first'` before starting Metro with `--localhost`. Verify `127.0.0.1:28111/28112/28113` is listening, then run `adb reverse tcp:28111 tcp:28111` (and likewise for `28112` and `28113`). The locally installed development builds were smoke-tested with the three new Expo shells on Samsung; an unmatched-route deep link is not successful until the app reaches its actual `/` route. Do not change system-wide Node settings, bind Expo publicly, or infer that an Android smoke test approves a new native build.

Customer and Merchant deliberately omit the donor `package.json` `type: module`: SDK 58's exported SSR renderer is CommonJS and otherwise `expo serve` fails with HTTP 500 (`module is not defined`). The native package IDs and original pinned dependency versions remain unchanged. `tools/mobile/verify-app-foundations.mjs` guards this compatibility decision.

Customer and Merchant Expo Web now use SDK 58 server rendering with `useServerDocumentContext()` (`headNodes` and `bodyNodes`), Arabic `lang`/`dir`, and a rendered appearance fallback before hydration; the actual dev-server HTML was checked for Arabic content, metadata, scripts, and RTL, and browser interaction was checked. The canonical `expo-localization` plugin owns native RTL (`forcesRTL: true` with Arabic supported locales). Expo Router navigation uses the native locale direction without a hand-set `LocaleProvider`; screen-level `direction`, fixed `textAlign=left/right`, or runtime `forceRTL` calls are prohibited. The `tools/mobile/verify-rtl.mjs` guard and its negative tests run in `pnpm check` and the existing source-only CI. The Expo Web document boundary retains `lang="ar" dir="rtl"`. This static guard does not certify native back-swipe/transition direction, iOS, or future visual components; these still need live verification on an actual build. The foundation check also invokes canonical CSS-generation and source-authority guards.

Maps remain **NOT_RUN** as functional experiences: `react-native-maps` and optional Google Maps configuration are present, but no map screen, location permission journey, route, or tracking integration has been accepted. Next.js Ant Design uses the official SSR style registry, but an enforced real CSP/nonce integration remains **NOT_RUN**; preserving a donor CSP patch is not proof of production compatibility. iOS and business integration are **NOT_RUN**.

Native identifiers, owner, EAS project IDs, app slugs, schemes and package permissions are preserved. `eas.json` contains **legacy `image: latest`** in preview/iOS profiles; reproducible remote builders are **BLOCKED/NOT_RUN** until images are reviewed without changing original dependencies. Existing Android development builds were used for Stage-4 UI smoke tests on Samsung. This validates rendering of preview shells on those installed binaries only; the current native configuration is **not** certified until a separately authorized native rebuild and device verification.

## Boundaries

`GOVERNANCE_CUTOVER: NOT_READY`; mandatory independent finance/security/migration/legal review remains pending. The worktree does not introduce Go services, financial logic, SQL, Docker or live Product screens. The user explicitly requires any *later* Docker infrastructure to be **new and isolated to this Worktree**, not the donor's old containers, volumes or database.

Use [the active governance readiness index](governance/README.md) and [the single execution plan](docs/REFOUNDATION-PLAN.md) for scope and evidence. Pass of static CI or typecheck alone does not demonstrate Android/iOS/browser runtime success.
