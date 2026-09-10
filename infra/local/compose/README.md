# Local runtime ownership

`tools/dev/runtime.ps1` is the single public owner of local runtime lifecycle. Repository-root `pnpm` commands are the only public runtime entrypoints; app/package/Nx-local runtime aliases are intentionally absent.

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

`runtime:reset` is a destructive local-data recovery operation scoped to Samrim Docker resources. It preserves the generated local `.env` and its local secret values, removes canonical disposable runtime state and any proven non-canonical Samrim Compose residue, then finishes with the runtime down.

There is no separate DAILY_DEV/FULL_INTEGRATION Docker topology and no native Identity/DSH development launcher. Integration is a test class executed against the canonical topology, not a second runtime owner.

## Host-owned applications

The Control Panel and mobile applications remain host-owned and are launched only through `tools/dev/runtime.ps1`:

- `pnpm control`
- `pnpm client`
- `pnpm partner`
- `pnpm captain`
- `pnpm field`
- `pnpm scr`

Starting a host application first ensures that the canonical Docker backend is ready. Expo/Metro, ADB, scrcpy, Maestro and browser/device tooling remain on the host.

## Local configuration

`infra/local/compose/.env.example` is the tracked canonical source for local runtime keys and non-secret values. The ignored `.env` is an exact projection maintained by `tools/dev/ensure-local-env.ps1`.

Only explicitly declared generated secret keys may preserve an existing local value. Missing secrets are generated once. Unknown keys are removed rather than preserved as shadow configuration. Runtime reset does not rotate those local secrets.

Do not duplicate hosts, ports or origins in documentation. Read current values from executable configuration.
