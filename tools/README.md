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

Local runtime has deliberately split ownership:

```text
tools/dev/dev.ps1              → backend lifecycle + ADB/scrcpy only
apps/*/package.json scripts.dev → each surface's direct foreground development process
tools/dev/start-surface.mjs     → shared env loader + direct Expo/Next exec
```

The fastest path is package-local: run `pnpm dev` inside `apps/app-client`, `apps/app-partner`, `apps/app-captain`, `apps/app-field`, or `apps/control-panel`. Root `pnpm client|partner|captain|field|control` commands are convenience aliases that enter the matching package directory. No targeted surface command routes through `dev.ps1`, and `dev.ps1` no longer owns Metro/Next ports, process reuse, stale-process cleanup or foreground surface startup.

Mobile Expo remains local/offline, app-scoped, IPv4-first and development-client based. Fast Refresh continues through the package-local Metro process. `pnpm scr` separately owns device transport and reverse mappings: USB is preferred, TCP/IP is fallback only, and no intentional concurrent USB+TCP host connection is retained. `runtime:down` remains the explicit complete-session cleanup boundary.

## Tool admission

Before adding a tool, wrapper, registry, manifest, cache or guard: prove a current material problem, prefer an existing owner, keep one lifecycle owner, and delete the mechanism when its current benefit disappears.

Pinned Governance/Docs materializes on demand through `tools/dev/knowledge-source.mjs`.
