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

The daily local path is intentionally small:

```text
pnpm runtime:up
pnpm control
pnpm client|partner|captain|field
pnpm scr
```

Ownership is narrow:

```text
Docker backend lifecycle → tools/dev/runtime.ps1
Android USB + ADB reverse → tools/dev/device-policy.psm1
Mobile launch/reuse → tools/dev/open-mobile-apps.ps1
Control launch/reuse → tools/dev/run-control.ps1
Device mirroring → tools/dev/scrcpy.ps1
Metro lifecycle → Expo CLI
Control dev server → Next.js
```

`runtime:doctor` is explicit diagnostics and is never part of app startup. Mobile development is USB-only; Wi-Fi ADB bootstrap/failover is not part of the canonical daily runtime. Expo TypeScript auto-setup is disabled because TypeScript is repository-owned; Expo Autolinking remains enabled. Windows Metro localhost remains IPv4-first because real-device proof showed that an IPv6-only `::1` listener is incompatible with Expo's Android `127.0.0.1` URL.

A healthy Metro is reused. A stale Metro proven to belong to the same app may be removed before a canonical cold start. A foreign port owner fails closed. Control reuses its healthy canonical endpoint and otherwise starts Next directly.

## Tool admission

Before adding a tool, wrapper, registry, manifest, cache or guard: prove a current material problem, prefer an existing owner, keep one lifecycle owner, and delete the mechanism when its current benefit disappears.

Pinned Governance/Docs materializes on demand through `tools/dev/knowledge-source.mjs`.
