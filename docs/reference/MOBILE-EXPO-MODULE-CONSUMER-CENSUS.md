# Expo native-module and source-consumer census (Stage 4)

ARTIFACT_CLASS: NON_AUTHORITATIVE_IMPLEMENTATION_EVIDENCE
BUSINESS_POLICY_AUTHORITY: NONE
CANDIDATE_BRANCH: refoundation/clean-house-20261112
CANDIDATE_SHA_AT_CENSUS: ebb050024dba6950de7ad76c44c0753cef6f0942

## Reading the evidence

Read-only enumeration of exact Expo/@expo dependency declarations in the three application manifests, plus static ES import / re-export, CommonJS require and literal dynamic import specifiers in Git-tracked app source. Module subpaths were normalized to their parent package. Non-literal computed imports and config plugins are **not** counted. A package absent from current source imports is **not** safe to remove: native autolinking, generated app configuration, the Expo runtime and future admitted features may still need it.

| Surface | Exact pinned Expo / @expo dependencies | Packages referenced by literal imports | Not referenced by literal imports |
| --- | ---: | ---: | ---: |
| customer | 37 | 3 | 34 |
| merchant | 38 | 3 | 35 |
| captain | 33 | 3 | 30 |

## Source-backed dependency index

| Surface | Manifest dependency | Exact version pin | Git-tracked app import consumers |
| --- | --- | --- | --- |
| customer | `@expo/metro-runtime` | `58.0.15` | No literal import in sparse Stage-4 shell (retain pending usage/plugin review) |
| customer | `@expo/ui` | `58.0.23` | No literal import in sparse Stage-4 shell (retain pending usage/plugin review) |
| customer | `expo` | `58.0.19` | `apps/customer/metro.config.cjs` |
| customer | `expo-application` | `58.1.2` | No literal import in sparse Stage-4 shell (retain pending usage/plugin review) |
| customer | `expo-asset` | `58.0.18` | No literal import in sparse Stage-4 shell (retain pending usage/plugin review) |
| customer | `expo-audio` | `58.0.10` | No literal import in sparse Stage-4 shell (retain pending usage/plugin review) |
| customer | `expo-blur` | `58.0.5` | No literal import in sparse Stage-4 shell (retain pending usage/plugin review) |
| customer | `expo-calendar` | `58.0.6` | No literal import in sparse Stage-4 shell (retain pending usage/plugin review) |
| customer | `expo-clipboard` | `58.0.4` | No literal import in sparse Stage-4 shell (retain pending usage/plugin review) |
| customer | `expo-constants` | `58.0.13` | No literal import in sparse Stage-4 shell (retain pending usage/plugin review) |
| customer | `expo-contacts` | `58.0.9` | No literal import in sparse Stage-4 shell (retain pending usage/plugin review) |
| customer | `expo-crypto` | `58.0.7` | No literal import in sparse Stage-4 shell (retain pending usage/plugin review) |
| customer | `expo-dev-client` | `58.0.15` | No literal import in sparse Stage-4 shell (retain pending usage/plugin review) |
| customer | `expo-device` | `58.0.5` | No literal import in sparse Stage-4 shell (retain pending usage/plugin review) |
| customer | `expo-document-picker` | `58.0.4` | No literal import in sparse Stage-4 shell (retain pending usage/plugin review) |
| customer | `expo-file-system` | `58.0.11` | No literal import in sparse Stage-4 shell (retain pending usage/plugin review) |
| customer | `expo-font` | `58.0.10` | No literal import in sparse Stage-4 shell (retain pending usage/plugin review) |
| customer | `expo-haptics` | `58.0.7` | No literal import in sparse Stage-4 shell (retain pending usage/plugin review) |
| customer | `expo-image` | `58.0.17` | No literal import in sparse Stage-4 shell (retain pending usage/plugin review) |
| customer | `expo-image-manipulator` | `58.0.15` | No literal import in sparse Stage-4 shell (retain pending usage/plugin review) |
| customer | `expo-image-picker` | `58.0.10` | No literal import in sparse Stage-4 shell (retain pending usage/plugin review) |
| customer | `expo-linear-gradient` | `58.0.3` | No literal import in sparse Stage-4 shell (retain pending usage/plugin review) |
| customer | `expo-linking` | `58.0.14` | No literal import in sparse Stage-4 shell (retain pending usage/plugin review) |
| customer | `expo-localization` | `58.0.5` | No literal import in sparse Stage-4 shell (retain pending usage/plugin review) |
| customer | `expo-location` | `58.0.19` | No literal import in sparse Stage-4 shell (retain pending usage/plugin review) |
| customer | `expo-network` | `58.0.4` | No literal import in sparse Stage-4 shell (retain pending usage/plugin review) |
| customer | `expo-notifications` | `58.1.6` | No literal import in sparse Stage-4 shell (retain pending usage/plugin review) |
| customer | `expo-router` | `58.0.26` | `apps/customer/app/+html.tsx`, `apps/customer/app/_layout.tsx`, `apps/customer/app/health.tsx`, `apps/customer/app/index.tsx`, `apps/customer/app/lab.tsx`, `apps/customer/index.js` |
| customer | `expo-secure-store` | `58.0.2` | `apps/customer/app/_layout.tsx` |
| customer | `expo-sharing` | `58.0.20` | No literal import in sparse Stage-4 shell (retain pending usage/plugin review) |
| customer | `expo-splash-screen` | `58.0.11` | No literal import in sparse Stage-4 shell (retain pending usage/plugin review) |
| customer | `expo-status-bar` | `58.0.4` | No literal import in sparse Stage-4 shell (retain pending usage/plugin review) |
| customer | `expo-store-review` | `58.0.2` | No literal import in sparse Stage-4 shell (retain pending usage/plugin review) |
| customer | `expo-system-ui` | `58.0.6` | No literal import in sparse Stage-4 shell (retain pending usage/plugin review) |
| customer | `expo-updates` | `58.0.18` | No literal import in sparse Stage-4 shell (retain pending usage/plugin review) |
| customer | `expo-video` | `58.0.12` | No literal import in sparse Stage-4 shell (retain pending usage/plugin review) |
| customer | `expo-web-browser` | `58.0.6` | No literal import in sparse Stage-4 shell (retain pending usage/plugin review) |
| merchant | `@expo/metro-runtime` | `58.0.15` | No literal import in sparse Stage-4 shell (retain pending usage/plugin review) |
| merchant | `@expo/ui` | `58.0.23` | No literal import in sparse Stage-4 shell (retain pending usage/plugin review) |
| merchant | `expo` | `58.0.19` | `apps/merchant/metro.config.cjs` |
| merchant | `expo-application` | `58.1.2` | No literal import in sparse Stage-4 shell (retain pending usage/plugin review) |
| merchant | `expo-asset` | `58.0.18` | No literal import in sparse Stage-4 shell (retain pending usage/plugin review) |
| merchant | `expo-audio` | `58.0.10` | No literal import in sparse Stage-4 shell (retain pending usage/plugin review) |
| merchant | `expo-blur` | `58.0.5` | No literal import in sparse Stage-4 shell (retain pending usage/plugin review) |
| merchant | `expo-calendar` | `58.0.6` | No literal import in sparse Stage-4 shell (retain pending usage/plugin review) |
| merchant | `expo-camera` | `58.0.12` | No literal import in sparse Stage-4 shell (retain pending usage/plugin review) |
| merchant | `expo-clipboard` | `58.0.4` | No literal import in sparse Stage-4 shell (retain pending usage/plugin review) |
| merchant | `expo-constants` | `58.0.13` | No literal import in sparse Stage-4 shell (retain pending usage/plugin review) |
| merchant | `expo-contacts` | `58.0.9` | No literal import in sparse Stage-4 shell (retain pending usage/plugin review) |
| merchant | `expo-crypto` | `58.0.7` | No literal import in sparse Stage-4 shell (retain pending usage/plugin review) |
| merchant | `expo-dev-client` | `58.0.15` | No literal import in sparse Stage-4 shell (retain pending usage/plugin review) |
| merchant | `expo-device` | `58.0.5` | No literal import in sparse Stage-4 shell (retain pending usage/plugin review) |
| merchant | `expo-document-picker` | `58.0.4` | No literal import in sparse Stage-4 shell (retain pending usage/plugin review) |
| merchant | `expo-file-system` | `58.0.11` | No literal import in sparse Stage-4 shell (retain pending usage/plugin review) |
| merchant | `expo-font` | `58.0.10` | No literal import in sparse Stage-4 shell (retain pending usage/plugin review) |
| merchant | `expo-haptics` | `58.0.7` | No literal import in sparse Stage-4 shell (retain pending usage/plugin review) |
| merchant | `expo-image` | `58.0.17` | No literal import in sparse Stage-4 shell (retain pending usage/plugin review) |
| merchant | `expo-image-manipulator` | `58.0.15` | No literal import in sparse Stage-4 shell (retain pending usage/plugin review) |
| merchant | `expo-image-picker` | `58.0.10` | No literal import in sparse Stage-4 shell (retain pending usage/plugin review) |
| merchant | `expo-keep-awake` | `58.0.3` | No literal import in sparse Stage-4 shell (retain pending usage/plugin review) |
| merchant | `expo-linear-gradient` | `58.0.3` | No literal import in sparse Stage-4 shell (retain pending usage/plugin review) |
| merchant | `expo-linking` | `58.0.14` | No literal import in sparse Stage-4 shell (retain pending usage/plugin review) |
| merchant | `expo-localization` | `58.0.5` | No literal import in sparse Stage-4 shell (retain pending usage/plugin review) |
| merchant | `expo-network` | `58.0.4` | No literal import in sparse Stage-4 shell (retain pending usage/plugin review) |
| merchant | `expo-notifications` | `58.1.6` | No literal import in sparse Stage-4 shell (retain pending usage/plugin review) |
| merchant | `expo-print` | `58.0.7` | No literal import in sparse Stage-4 shell (retain pending usage/plugin review) |
| merchant | `expo-router` | `58.0.26` | `apps/merchant/app/+html.tsx`, `apps/merchant/app/_layout.tsx`, `apps/merchant/app/health.tsx`, `apps/merchant/app/index.tsx`, `apps/merchant/index.js` |
| merchant | `expo-secure-store` | `58.0.2` | `apps/merchant/app/_layout.tsx` |
| merchant | `expo-sharing` | `58.0.20` | No literal import in sparse Stage-4 shell (retain pending usage/plugin review) |
| merchant | `expo-splash-screen` | `58.0.11` | No literal import in sparse Stage-4 shell (retain pending usage/plugin review) |
| merchant | `expo-status-bar` | `58.0.4` | No literal import in sparse Stage-4 shell (retain pending usage/plugin review) |
| merchant | `expo-store-review` | `58.0.2` | No literal import in sparse Stage-4 shell (retain pending usage/plugin review) |
| merchant | `expo-system-ui` | `58.0.6` | No literal import in sparse Stage-4 shell (retain pending usage/plugin review) |
| merchant | `expo-updates` | `58.0.18` | No literal import in sparse Stage-4 shell (retain pending usage/plugin review) |
| merchant | `expo-video` | `58.0.12` | No literal import in sparse Stage-4 shell (retain pending usage/plugin review) |
| captain | `@expo/ui` | `58.0.23` | No literal import in sparse Stage-4 shell (retain pending usage/plugin review) |
| captain | `expo` | `58.0.19` | `apps/captain/metro.config.cjs` |
| captain | `expo-application` | `58.1.2` | No literal import in sparse Stage-4 shell (retain pending usage/plugin review) |
| captain | `expo-asset` | `58.0.18` | No literal import in sparse Stage-4 shell (retain pending usage/plugin review) |
| captain | `expo-audio` | `58.0.10` | No literal import in sparse Stage-4 shell (retain pending usage/plugin review) |
| captain | `expo-calendar` | `58.0.6` | No literal import in sparse Stage-4 shell (retain pending usage/plugin review) |
| captain | `expo-clipboard` | `58.0.4` | No literal import in sparse Stage-4 shell (retain pending usage/plugin review) |
| captain | `expo-constants` | `58.0.13` | No literal import in sparse Stage-4 shell (retain pending usage/plugin review) |
| captain | `expo-crypto` | `58.0.7` | No literal import in sparse Stage-4 shell (retain pending usage/plugin review) |
| captain | `expo-dev-client` | `58.0.15` | No literal import in sparse Stage-4 shell (retain pending usage/plugin review) |
| captain | `expo-device` | `58.0.5` | No literal import in sparse Stage-4 shell (retain pending usage/plugin review) |
| captain | `expo-document-picker` | `58.0.4` | No literal import in sparse Stage-4 shell (retain pending usage/plugin review) |
| captain | `expo-file-system` | `58.0.11` | No literal import in sparse Stage-4 shell (retain pending usage/plugin review) |
| captain | `expo-font` | `58.0.10` | No literal import in sparse Stage-4 shell (retain pending usage/plugin review) |
| captain | `expo-haptics` | `58.0.7` | No literal import in sparse Stage-4 shell (retain pending usage/plugin review) |
| captain | `expo-image` | `58.0.17` | No literal import in sparse Stage-4 shell (retain pending usage/plugin review) |
| captain | `expo-image-picker` | `58.0.10` | No literal import in sparse Stage-4 shell (retain pending usage/plugin review) |
| captain | `expo-keep-awake` | `58.0.3` | No literal import in sparse Stage-4 shell (retain pending usage/plugin review) |
| captain | `expo-linear-gradient` | `58.0.3` | No literal import in sparse Stage-4 shell (retain pending usage/plugin review) |
| captain | `expo-linking` | `58.0.14` | No literal import in sparse Stage-4 shell (retain pending usage/plugin review) |
| captain | `expo-localization` | `58.0.5` | No literal import in sparse Stage-4 shell (retain pending usage/plugin review) |
| captain | `expo-location` | `58.0.19` | No literal import in sparse Stage-4 shell (retain pending usage/plugin review) |
| captain | `expo-network` | `58.0.4` | No literal import in sparse Stage-4 shell (retain pending usage/plugin review) |
| captain | `expo-notifications` | `58.1.6` | No literal import in sparse Stage-4 shell (retain pending usage/plugin review) |
| captain | `expo-router` | `58.0.26` | `apps/captain/app/_layout.tsx`, `apps/captain/app/health.tsx`, `apps/captain/app/index.tsx`, `apps/captain/index.js` |
| captain | `expo-secure-store` | `58.0.2` | `apps/captain/app/_layout.tsx` |
| captain | `expo-splash-screen` | `58.0.11` | No literal import in sparse Stage-4 shell (retain pending usage/plugin review) |
| captain | `expo-status-bar` | `58.0.4` | No literal import in sparse Stage-4 shell (retain pending usage/plugin review) |
| captain | `expo-system-ui` | `58.0.6` | No literal import in sparse Stage-4 shell (retain pending usage/plugin review) |
| captain | `expo-task-manager` | `58.0.12` | No literal import in sparse Stage-4 shell (retain pending usage/plugin review) |
| captain | `expo-updates` | `58.0.18` | No literal import in sparse Stage-4 shell (retain pending usage/plugin review) |
| captain | `expo-video` | `58.0.12` | No literal import in sparse Stage-4 shell (retain pending usage/plugin review) |
| captain | `expo-web-browser` | `58.0.6` | No literal import in sparse Stage-4 shell (retain pending usage/plugin review) |

## Required validation before any package removal or Native feature admission

1. Reconcile original donor module usage, legal/licensing obligations, intended Product feature, true native plugin, permission and supported Expo SDK 58 platform scope. This source scan cannot identify reflective/native module loads.
2. Read resolved Expo config and the Android binary's merged manifest at the matching source revision; preserve original EAS owner/project, slug, Android/iOS bundle identities, runtime version and deep-link schemes. No EAS/OTA/native build was performed.
3. Test permissions, denial/revocation, background/foreground lifecycle, account isolation and data/asset privacy for camera, location, media, notifications, storage, contacts, audio and maps before admitting their associated features.
4. Keep device primitives in Expo/React Native; do not replace them with duplicate design-system components and do not remove dependencies solely to improve an empty-shell inventory.

STATUS: PINNED_MANIFEST_CENSUS_PASS; LITERAL_IMPORT_SCAN_PASS; COMPUTED_AND_NATIVE_CONSUMERS_NOT_RUN; MODULE_RUNTIME_NOT_RUN; FUTURE_FEATURE_ADMISSION_PENDING.
