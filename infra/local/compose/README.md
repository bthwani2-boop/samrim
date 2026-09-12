# Local runtime ownership

`tools/dev/runtime.ps1` is the single public owner of local runtime lifecycle, local environment reconciliation, backend/infra orchestration, and host application launch. Repository-root `pnpm` commands are the only public runtime entrypoints; app/package/Nx-local runtime aliases are intentionally absent.

## Canonical backend and infrastructure runtime

`infra/local/compose/compose.yaml` is the only local Docker topology and uses the single canonical Compose project `samrim-local`.

Docker owns the currently materialized server-side services and infrastructure:

- PostgreSQL/PostGIS
- Mailpit
- Identity migration + Identity API
- DSH migration + DSH API

Identity and DSH communicate with PostgreSQL and each other through Docker service DNS. PostgreSQL and Mailpit SMTP are not published to the Windows host because the canonical backend no longer consumes them through host ports. Only host consumers receive published ports.

Use only:

- `pnpm runtime:up`
- `pnpm runtime:down`
- `pnpm runtime:restart`
- `pnpm runtime:status`
- `pnpm runtime:logs`
- `pnpm runtime:doctor`
- `pnpm runtime:reset`
- `pnpm runtime:mobile-lan` (explicit, narrow Windows Administrator repair)
- `pnpm runtime:purge` (explicit destructive factory cleanup)

`runtime:reset` is a destructive local-data recovery operation scoped to the disposable PostgreSQL application state. It preserves the generated local `.env`, dependency/image caches, and Mobile LAN host infrastructure, removes canonical runtime containers and any proven non-canonical `samrim-*` Compose residue, then finishes with the runtime down. It does not require Administrator elevation.

`runtime:mobile-lan` is the only normal command that may mutate BThwani-owned Windows Mobile LAN artifacts. It reconciles one current Hotspot IP/interface, one exact Firewall rule, and the canonical Identity/DSH/Metro port proxies, then recreates Docker-owned Metro services so their public URLs use the current Hotspot address. Run it elevated only when Mobile LAN is missing or stale.

`runtime:purge` is an explicit factory cleanup. It removes all canonical Docker volumes, including dependency caches, and BThwani-owned Mobile LAN artifacts. It preserves the generated local `.env` and its local secret values.

There is no separate daily/integration Docker topology and no native Identity/DSH development launcher. Integration is a test class executed against the canonical topology, not a second runtime owner.

## Docker-owned application runtime and host-owned tooling

The Control Panel and all four Metro servers are Docker-owned and are launched only through `tools/dev/runtime.ps1`:

- `pnpm control`
- `pnpm client`
- `pnpm partner`
- `pnpm captain`
- `pnpm field`
- `pnpm scr`

Starting an application first ensures that the canonical Docker runtime is ready. ADB, scrcpy, browser tooling, and the physical Android device remain host/device-owned. Mobile app traffic uses Wi-Fi LAN; ADB reverse is not a runtime dependency. If the Hotspot is unavailable, Docker and browser runtime can still run, while the mobile command reports the precise LAN blocker.

## Local configuration

`infra/local/compose/.env.example` is the tracked canonical source for local runtime keys and non-secret values. The ignored `.env` is an exact projection reconciled directly by `tools/dev/runtime.ps1`.

Only explicitly declared generated secret keys may preserve an existing local value. Missing secrets are generated once. Unknown keys are removed rather than preserved as shadow configuration. Runtime reset does not rotate those local secrets.

Do not duplicate hosts, ports or origins in documentation. Read current values from executable configuration.
