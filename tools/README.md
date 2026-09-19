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

Ownership is minimal:

```text
Mobile + Control launch/reuse → tools/dev/local.ps1
Docker backend lifecycle      → Docker Compose directly
Device mirroring              → scrcpy directly
Metro lifecycle               → Expo CLI
Control dev server            → Next.js
```

The host helper does not own Docker or scrcpy. Warm app launches reuse the healthy Metro/Next process; cold launches invoke the installed Expo/Next Node binaries directly without nested pnpm. Expo startup is local/offline and suppresses QR output. Android uses ADB directly with no repository-owned device discovery or serial state. Windows Metro localhost remains IPv4-first because real-device proof showed the IPv6-only listener failure.

## Tool admission

Before adding a tool, wrapper, registry, manifest, cache or guard: prove a current material problem, prefer an existing owner, keep one lifecycle owner, and delete the mechanism when its current benefit disappears.

Pinned Governance/Docs materializes on demand through `tools/dev/knowledge-source.mjs`.
