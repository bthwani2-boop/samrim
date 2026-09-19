# Repository Tooling

DOCUMENT_CLASS: HUMAN_DEVELOPMENT_GUIDE
EXECUTION_AUTHORITY: NONE
PRODUCT_AUTHORITY: NONE
CURRENT_COMMAND_AUTHORITY: LIVE_PACKAGE_SCRIPTS_AND_TOOL_SOURCE

`tools/` contains cross-repository automation, inspection, generation and evidence. It is not Product or architecture authority.

## Placement

```text
SERVICE-SPECIFIC TOOL → owning service
APP-SPECIFIC TOOL     → owning app
CROSS-REPOSITORY TOOL → tools/
```

Do not add a repository-wide wrapper when a current owner or standard tool already solves the problem.

## Execution model

`pnpm verify` is the exact local affected-candidate static/workspace entrypoint. `pnpm safe:push` owns final candidate verification and exact remote SHA confirmation.

Local runtime has one executable owner:

```text
tools/dev/dev.ps1
```

`pnpm dev` remains the batch bootstrap for backend plus Metro/Control. Interactive development uses dedicated `pnpm client|partner|captain|field|control|scr` terminals so live logs remain visible. Mobile commands select one ADB transport only: USB while present, otherwise the cached TCP fallback. `pnpm scr` prepares TCP/IP while on USB without retaining a concurrent host TCP connection, then automatically reconnects and reapplies reverse mappings if USB disappears. Expo/Next package locations are resolved through Node rather than hard-coded pnpm node_modules paths. It never opens the mobile applications and never performs native builds.

Expo is local/offline, QR output is suppressed, TypeScript auto-setup is disabled, and Metro localhost stays IPv4-first because real-device proof showed the IPv6-only listener failure. Each mobile command disables Expo's automatic workspace-root server root so the four concurrent Metro instances remain app-scoped on Windows; Expo SDK 56+ on-demand filesystem resolution still keeps imported workspace packages inside the live Fast Refresh graph without manual watchFolders. Mobile apps are opened manually from the device and use development-client's most-recent launch behavior. `runtime:down` closes the local Metro/Control processes and scrcpy before stopping Compose, so the daily session leaves no hidden runtime residue. Targeted `pnpm client|partner|captain|field|control|scr` commands remain available but all route to this same owner; they are not parallel runtime implementations. If a previous targeted Expo/Next attempt leaves its port owned by a repository Node tree, the next targeted command terminates that owned tree before starting the new foreground instance; foreign listeners are never killed. There is one minimal local TCP endpoint cache owned by `tools/dev/dev.ps1` solely for automatic USB-loss recovery. There is no pairing flow, manual IP entry, nested pnpm runtime, second runtime script or intentional concurrent USB+TCP host connection.

## Tool admission

Before adding a tool, wrapper, registry, manifest, cache or guard: prove a current material problem, prefer an existing owner, keep one lifecycle owner, and delete the mechanism when its current benefit disappears.

Pinned Governance/Docs materializes on demand through `tools/dev/knowledge-source.mjs`.
