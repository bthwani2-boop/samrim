# Mobile Development and EAS

DOCUMENT_CLASS: HUMAN_DEVELOPMENT_GUIDE
EXECUTION_AUTHORITY: NONE
PRODUCT_SEMANTIC_AUTHORITY: NONE
CURRENT_IMPLEMENTATION_AUTHORITY: NONE
CURRENT_MOBILE_COMMAND_TRUTH_SOURCE: package.json + tools/mobile/start-mobile-runtime.ps1 + app-owned mobile configuration
CURRENT_IMPLEMENTATION_TRUTH_SOURCE: LIVE_EXPO_EAS_APP_CONFIG_AND_BUILD_STATE

## Local mobile runtime

| App | Command | Metro port |
|---|---|---:|
| Client | `pnpm client` | 18101 |
| Partner | `pnpm partner` | 18102 |
| Captain | `pnpm captain` | 18103 |
| Field | `pnpm field` | 18104 |

Root commands delegate to repository-owned mobile launchers. Do not maintain a second Metro/bootstrap environment path.

Verify devices with `adb devices -l`. Configure exact `adb reverse` mappings only when required by the current runtime. Use `scrcpy` against the intended ADB serial for mirroring.

Prefer repository launcher cache/reset options over deleting arbitrary native/generated directories.

## Mobile configuration and security

Client-visible runtime configuration must be public-client safe. Server credentials, privileged tokens and provider secrets never enter `EXPO_PUBLIC_*` or a mobile bundle.

API endpoints come from active runtime configuration, not hardcoded screen logic.

Expo/EAS project identity, Android/iOS identifiers, schemes, runtime/update configuration and native plugins are deployable identity and must not change as incidental cleanup.

## EAS preparation lifecycle

Operate one application at a time unless current tooling explicitly supports broader operation.

The intended lifecycle is:

```text
INITIALIZE
→ PREFLIGHT
→ REMOTE BUILD
```

Always verify the exact registered command/arguments in current manifests before execution.

Initialization should be idempotent and isolate app-specific signing/provider identities. It may create/reuse approved development signing material, derive certificate fingerprints, reconcile package-specific Firebase/Maps-style provider configuration and stage only ignored local inputs required by Expo/EAS. It must not modify another app or commit credentials.

## Preflight and build

Before remote build verify applicable resolved Expo/EAS configuration, provider input/package identity, TypeScript, Expo Doctor, local export/prebuild checks and signing/native compatibility.

A preflight result belongs to the exact source/config/provider/signing inputs tested. Any material drift invalidates it.

Submit remote builds only after the current preflight contract passes. Cache clearing is troubleshooting, not correctness.

## Private/generated inputs

Provider configs, keystores, credentials, local environment manifests and temporary EAS request files remain ignored/private. Host-specific paths are operational state, not repository truth.

Each app remains isolated by package/application identity, Expo/EAS project identity, signing certificate and provider restrictions.

A successful remote build does not prove login, push, Maps or runtime API behavior. Release evidence records the exact source commit, app identity, build profile and remote build result.
