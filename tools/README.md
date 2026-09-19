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

`pnpm dev` is the daily bootstrap. It reuses live backend ports instead of rerunning Compose/migrations, repairs only missing ADB reverse mappings, starts only missing Metro/Next processes, ensures scrcpy, measures each phase and returns. Targeted `pnpm client|partner|captain|field|control|scr|runtime:*` aliases route to the same file.

Expo is local/offline, QR output is suppressed, TypeScript auto-setup is disabled, and Metro localhost stays IPv4-first because real-device proof showed the IPv6-only listener failure. There is no Wi-Fi ADB fallback, serial registry, nested pnpm runtime, custom Metro supervisor or second runtime script.

## Tool admission

Before adding a tool, wrapper, registry, manifest, cache or guard: prove a current material problem, prefer an existing owner, keep one lifecycle owner, and delete the mechanism when its current benefit disappears.

Pinned Governance/Docs materializes on demand through `tools/dev/knowledge-source.mjs`.
