# Mobile Development

DOCUMENT_CLASS: HUMAN_DEVELOPMENT_GUIDE
CURRENT_MOBILE_COMMAND_AUTHORITY: tools/mobile/mobile.ps1 and app runtime wrappers

## Applications and Metro ports

| App | Command | Metro port |
|---|---|---:|
| Client | `pnpm client` | 18101 |
| Partner | `pnpm partner` | 18102 |
| Captain | `pnpm captain` | 18103 |
| Field | `pnpm field` | 18104 |

Each root command delegates to the app runtime wrapper and shared mobile tooling. Do not launch a second hand-maintained Metro configuration with different environment semantics.

## Device workflow

Verify device visibility:

```powershell
adb devices -l
```

When repository/device networking requires reverse mappings:

```powershell
pnpm reverse
```

For screen mirroring, use `scrcpy` against the exact connected ADB serial.

## Cache/restart

The app runtime wrappers support governed cache clearing. Prefer the repository command/path over deleting arbitrary generated/native directories.

## Environment and APIs

Mobile runtime configuration must remain public-client safe. Server credentials, provider secrets and privileged service tokens never enter `EXPO_PUBLIC_*` or the mobile bundle.

All API endpoints must come from active runtime configuration rather than hardcoded screen logic. Exact host ports are executable configuration, not portable documentation authority.

## Native/build identity

Expo/EAS project identity, Android/iOS identifiers, schemes, runtime/update configuration and native plugins are deployable identity. Do not change them as incidental cleanup.

For EAS operations use `development/eas.md` and the repository `pnpm mobile:eas` wrapper.
