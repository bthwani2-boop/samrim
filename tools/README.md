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

Docker owns only the shared backend/state runtime:

```text
pnpm runtime:up
pnpm runtime:doctor
pnpm runtime:status
```

The application development servers are host-owned and on demand:

```text
pnpm control
pnpm client
pnpm partner
pnpm captain
pnpm field
```

The mobile commands use the canonical device policy for device identity and backend reverse ports, then delegate Metro lifecycle and Android development-client launch directly to Expo CLI; they never create a Docker Metro path or a second Metro supervisor. On Windows they force Node localhost resolution to IPv4-first so Metro binds the same loopback family (`127.0.0.1`) that Expo publishes to Android through ADB reverse, without exposing Metro on LAN. The Control command owns the host Next.js dev process. No parallel Docker/host application mode is admitted.

## Tool admission

Before adding a tool, wrapper, registry, manifest, cache or guard: prove a current material problem, prefer an existing owner, keep one lifecycle owner, and delete the mechanism when its current benefit disappears.

Pinned Governance/Docs materializes on demand through `tools/dev/knowledge-source.mjs`.
