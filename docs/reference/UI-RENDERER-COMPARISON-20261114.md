# Expo UI Universal versus Tamagui — source-backed renderer spike (2026-11-14)

ARTIFACT_CLASS: NON_AUTHORITATIVE_ENGINEERING_EXPERIMENT
DECISION_AUTHORITY: NONE
SCOPE: Customer Stage-4 presentation fixtures only; not Product, API, WLT, SQL, native app release or Studio
CANDIDATE_BRANCH: refoundation/clean-house-20261112
BASE_SHA_AT_START: 8732402f1da654c1b101a505579c9919028bac90
RENDERER_DECISION: INVESTIGATE — NO WINNER DECLARED

## The two actually comparable sources

- Existing Tamagui fixture: `apps/customer/app/lab.tsx` renders Arabic mixed-direction text, input, two-option picker, toggle, Dialog and Sheet, with existing `useMobileAppearance` and the canonical semantic colors.
- Isolated Expo UI fixture: `apps/customer/renderer-lab.tsx`, reachable through `/lab?renderer=universal`, renders the same **classes** of interactions: Arabic/mixed-direction text, input, same two-option picker, toggle, modal and half-height sheet. Uses `@expo/ui` Universal `Host`, `Column`, `TextInput`, `Picker`, `Switch`, `Button`, `BottomSheet`, and React Native `Modal` because the installed Universal API has no general Dialog.
- Both fixtures read the **same** `@bthwani/tamagui-config/appearance` and BThwani semantic theme. Expo UI's `seedColor` comes from the canonical `theme.actionBackground` but generates platform-specific control colors: **visual-role parity needs manual inspection**. This is deliberately not a second authoring palette.
- No new route, dependency, state manager or business engine. Only the existing `/lab` route is used, with a query parameter. The normal product and root navigation are unchanged except a lab link.

## Version-specific evidence and cautions

- Inspected installed `apps/customer/node_modules/@expo/ui/package.json`: version **58.0.23**. Official [Universal Host docs](https://docs.expo.dev/versions/v58.0.0/sdk/ui/universal/host/) describe `Host`, `layoutDirection`, `colorScheme`, `seedColor` and platform/native differences. Verified the locally installed `build/universal/` types for these components before authoring.
- React Native components inside a native Universal `Host` change rendering context; avoid unmeasured nesting and duplicating all regular UI controls under two engines.
- Modal focus restoration, screen-reader order, physical back gesture, keyboard overlap, reduced motion, light/dark contrast and Android/iOS native transitions **are not proven by the TypeScript typecheck**.
- Customer `web.output: server` means actual SSR and asset-serving behavior must be checked separately from Metro bundling.
- No UI-library version upgrades were performed; the latest public documentation may describe APIs not present in pinned 58.0.23.

## Objective evidence on this candidate (read-only tests of synthetic fixture)

| Evidence | Result | What it proves / does not prove |
| --- | --- | --- |
| `pnpm --dir apps/customer run typecheck` | PASS | Both fixture components typecheck under the app's pinned versions; not Android runtime |
| `pnpm --dir apps/customer exec expo export --platform android` | PASS | Release-mode Android JS bundle emitted (4.3 MB HBC); **not** a native APK, memory/FPS metric or interactive device PASS |
| `pnpm --dir apps/customer exec expo export --platform web` | PASS | Expo server/web bundles emitted, including `/lab` route |
| Temporary local `expo serve --port 18281` HTTP checks | PASS for server response only | GET `/lab` 200 with Tamagui marker, GET `/lab?renderer=universal` 200 with Expo UI marker, GET `/` 200. These do **not** prove hydration, focus, clicks, keyboard, access permissions or native behavior |
| Android device presence (`adb devices -l`) | CONNECTED | Physical SM_S9280 visible, but app bundle was **not** installed or run against this commit |
| Actual device UI / screenshots / performance | NOT_RUN | Do not claim a winner |
| iOS native and assistive technology | NOT_RUN | Not present in this execution |
| Operator Ant Design SSR/CSP real browser | NOT_RUN | Separate P0 acceptance track |

## Fair final comparison — not yet performed

Use identical release/profileable builds, content, semantic tokens, device/network and data set; execute Tamagui and Expo UI on Android budget/mid-range, web Chrome and iOS where available. Run Arabic typing, first/second picker option, toggle, Dialog/Modal focus recovery, BottomSheet gesture/back, dark/light, font-scale, offline/unknown-outcome UI, and 10x route switches; capture FPS/jank, memory, interaction latency, APK delta, accessibility tree and time/code complexity.

Prerequisite acceptance failures (RTL, user-visible duplicate data, inaccessible dismissal, private-state leak) disqualify a renderer regardless of aggregate speed. If both fulfill the requirements and performance is effectively equivalent, prefer the one that requires fewer native bridges, custom fallbacks and maintenance steps. Keep current Tamagui as *provisional existing fixture*, not a final technology decision.

## Related governance and execution boundaries

`governance/experience.md` owns design policy and its currently described renderer is a draft; only the Product owner may ratify a final renderer once comparative evidence exists. `docs/REFOUNDATION-PLAN.md` is temporary sequencing; this document preserves **evidence only**, never a second mutable design-system/architecture authority. `governance/README.md` remains `GOVERNANCE_CUTOVER: NOT_READY` until its own acceptance conditions pass. No new service, SQL, Go, fee, privilege, EAS/OTA build, deployment, Push or PR follows from this spike.

## Post-build final checks on this local candidate

- `pnpm run check` **PASS** (exit 0). Foundation **171 PASS / 0 FAIL / 2 Windows-specific SKIP**; application boundary/RTL/security checks, design-token parity and app/Operator/clients TypeScript checks all passed. This is a foundation validation, **not** an implemented Store/Order/Wallet acceptance.
- Targeted `pnpm exec biome check apps/customer/renderer-lab.tsx apps/customer/app/lab.tsx apps/customer/app/index.tsx` **PASS** after import sorting; `pnpm --dir apps/customer run typecheck` **PASS**; `git diff --check` **PASS**.
- Final Expo web production export **PASS** after routing through existing `/lab`; final generated `lab` chunk approximately **73 KB** because both renderers are imported in the *same experimental route*. This **cannot** be used as a fair separate-library bundle-size comparison.
- Local production server `expo serve --port 18281` served three HTTP 200 responses: `/`, `/lab` (Tamagui marker only), and `/lab?renderer=universal` (Expo UI marker only). The owned test server was terminated and verified stopped by a subsequent HTTP connection failure.
- No Android UI was installed/launched and no iOS/Web interactive browser benchmark was executed. Responsive/keyboard/gesture/contrast/focus/memory/frame-time results remain `NOT_RUN`; current renderer is **not** selected as winner.
