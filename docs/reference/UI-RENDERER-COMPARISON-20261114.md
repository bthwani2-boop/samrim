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

## 2026-11-14 — Real Android 16 follow-up (after the source-only spike)

TEST_CLASS: PHYSICAL_ANDROID_DEVELOPMENT_CLIENT_SMOKE
DEV_CLIENT: com.bthwani.client 0.3.1 (pre-existing debuggable installation dated 2026-11-06)
DEVICE: Samsung SM-S9280, Android 16, authorized USB ADB device (unique device identifier deliberately excluded)
SOURCE_START_SHA: 6156ee6ae400acb34c06937d0e2808ce50eae526
SERVER: local offline Metro port 18312 with test-owned `adb reverse tcp:18312 tcp:18312`, no native rebuild, no APK install, no app data reset
DEEP_LINKS: `client:///lab?renderer=tamagui`, `client:///lab?renderer=universal`
EVIDENCE: captured physical-device UIAutomator trees plus test-window screenshots in the out-of-repository session coordination evidence directory
DECISION: STILL INVESTIGATE

### Observed defect and bounded correction

1. Initial actual Android launch failed with React Native error `Text strings must be rendered within a <Text> component`, originating at `apps/customer/app/index.tsx:17`. A literal separator was a direct View descendant between two `Link` elements. Removing that raw separator fixed the native-only exception; the Customer foundation screen then appeared and both lab links were present in UIAutomator readback. The previous TypeScript/web build **had not detected** this defect.
2. Tamagui route displayed Arabic mixed-direction text, input, choices, switch, Dialog and Sheet. Android input `tama76` was reflected in the on-screen summary; switch toggled to `مفعّلة`, option changed to `الخيار الثاني`, Dialog displayed, and its close control dismissed the dialog. Tamagui Sheet rendered title/text/close control **in Android UIAutomator**; its close action succeeded **once the keyboard was hidden**.
3. Expo UI Universal route displayed Arabic mixed-direction text, actual `android.widget.EditText` input, choice, switch, modal and BottomSheet. Android input `native42` appeared in the native field and on-screen state; switch toggled; the second Picker option updated summary; the React Native Modal opened and its close control dismissed it. Android system Back dismissed the original sheet.
4. **First Expo BottomSheet composition issue:** React Native `View` / `Pressable` inside the installed Universal `BottomSheet` was visibly rendered in a screenshot but its title/text/button **were missing from Android UIAutomator tree**, and two direct taps on the pictured close area did not dismiss it. The absence from this tree is **not proof** of TalkBack failure, but is a material accessibility/interaction risk for that composition.
5. **Corrected Expo BottomSheet composition:** The same existing `BottomSheet` now renders installed `@expo/ui` Universal `Column`, `Text`, `Button` directly, with canonical token-backed colors. Physical Android UIAutomator then exposed its title, description and close button; tapping the close button dismissed the sheet. No additional renderer, wrapper, dependency, native build or hidden state store was introduced.
6. Input focus/keyboard: the Samsung keyboard remained open during the Tamagui form sequence and obscured a lower sheet action. Hiding the keyboard allowed the Tamagui Sheet close control to work. Both fixture open actions now request `Keyboard.dismiss()` before showing non-input overlays; this is a narrow usability mitigation, **not** evidence that keyboard overlap/resize is solved on every device. During a later input-key test Android navigation moved outside the app to the phone's Galaxy AI settings. No settings or account data were changed; testing of that branch stopped without dismissing or accepting any external prompt.

### Physical-device evidence verdict

| Case | Tamagui | Expo UI Universal | Caveat |
| --- | --- | --- | --- |
| Load on existing Android 16 development client | PASS | PASS | Existing debug binary, not a clean native install |
| Arabic/mixed text and form visible | PASS | PASS | Only one high-end Samsung; not budget devices |
| Native input value reflected in on-screen state | PASS | PASS | ASCII text via ADB; Arabic IME typing specifically NOT_RUN |
| Toggle and two-option select update state | PASS | PASS | Synthetic fixture only |
| Dialog/Modal visible and dismissible | PASS | PASS | Focus restoration/keyboard overlap NOT_RUN |
| Sheet visible and system/explicit dismissal | PASS (after hiding keyboard) | PASS (after native-child correction) | Specific composition choices, not full library certification |
| Sheet content exposed in Android UIAutomator tree | PASS | PASS after correction | TalkBack reading order NOT_RUN |
| Return-key/keyboard/gesture combinations | PARTIAL | PARTIAL | Phone left the app unexpectedly during later input test; no unsupported PASS |
| Device FPS, startup latency, RAM, APK delta | NOT_RUN | NOT_RUN | Development server and screenshots cannot establish performance |
| iOS real render/VoiceOver | NOT_RUN | NOT_RUN | No iOS device was used |

**Comparison constraints:** Existing native device tests establish that both renderers can function on *this one device*. They do not justify choosing a global mobile renderer, replacing the already-admitted Tamagui implementation, adding a second theme authority, claiming accessibility conformance, or marking `GOVERNANCE_CUTOVER: READY`. iOS, low-end Android, keyboard/focus, reduced motion, visual-token parity and repeatable profile-mode benchmarks remain acceptance evidence for the renderer choice. The earlier table marked Android runtime NOT_RUN as of the source-only commit; this dated addendum updates that historical state, without rewriting the earlier evidence.

### Validation after the Android-derived repairs

- `pnpm --dir apps/customer run typecheck`: **PASS**; targeted `pnpm exec biome check` for the three edited Customer files: **PASS**; root `pnpm run check`: **PASS** (exit 0, including foundation and typechecking). The documented Stage-4 foundation guard continues to report **171 PASS / 0 FAIL / 2 Windows-specific SKIP**.
- `pnpm --dir apps/customer exec expo export --platform android`: **PASS**, current JS-only Android production export yields a **4.3 MB Hermes bundle**. This is **not** an APK rebuild, native binary upgrade or cold-start performance measurement.
- `pnpm --dir apps/customer exec expo export --platform web`: **PASS**, server-side + client bundles emitted. This is **not** an interactive Chrome/Web accessibility PASS.
- Metro server at port 18312 was stopped and the port was verified closed; `adb reverse tcp:18312` was removed; only session-owned device temporary UI/screenshot files were cleaned. Existing `com.bthwani.client` installation and application data were preserved. scrcpy/device user settings were not changed.
- **Important:** a keyboard-close callback on an opener does not solve a button physically obscured by the keyboard. Android keyboard/scroll/IME test remains **PARTIAL**, not a resolved production UX policy. Do not infer a framework winner or automatic keyboard avoidance from this fixture.
