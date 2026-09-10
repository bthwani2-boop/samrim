# Local runtime ownership

`tools/dev/runtime.ps1` is the single canonical owner of local runtime lifecycle. Repository-root `pnpm` commands are the only public runtime entrypoints; app/package/Nx-local runtime aliases are intentionally absent.

## DAILY_DEV

`compose.yaml` is the only interactive Docker substrate and owns PostgreSQL/PostGIS plus Mailpit only. Identity, DSH, Control Panel, mobile Metro/Expo, ADB and scrcpy are host-owned through `tools/dev/runtime.ps1`.

Use only:

- `pnpm runtime:daily:up`
- `pnpm runtime:daily:down`
- `pnpm runtime:status`
- `pnpm identity`
- `pnpm dsh`
- `pnpm control`
- `pnpm client`
- `pnpm partner`
- `pnpm captain`
- `pnpm field`
- `pnpm scr`

Starting any DAILY_DEV host component reconciles the canonical local environment, removes any leftover ephemeral FULL_INTEGRATION project/state, ensures PostgreSQL and Mailpit are ready, and then starts exactly the requested host component. `runtime:daily:down` removes DAILY_DEV containers while preserving its named PostgreSQL data volume.

## FULL_INTEGRATION

`compose.integration.yaml` is a separate ephemeral proof appliance with project identity `samrim-integration` and an integration-only PostgreSQL volume. It is not a development runtime and does not share DAILY_DEV database state.

The only public entrypoint is `pnpm runtime:integration:close`. It owns transition from DAILY_DEV, clean reset, build, start, readiness, verification, diagnostics and mandatory teardown. Integration containers and volumes are destroyed on both success and failure.

There are no public manual Integration up/down/config/status commands and no keep-running path.

## Local configuration

`infra/local/compose/.env.example` is the tracked canonical source for local runtime keys and non-secret values. The ignored `.env` is an exact projection maintained by `tools/dev/ensure-local-env.ps1`.

Only explicitly declared generated secret keys may preserve an existing local value. Missing secrets are generated once. Unknown keys are removed rather than preserved as shadow configuration. Destructive `-Force` regeneration is not part of the workflow.

Do not duplicate hosts, ports or origins in documentation. Read current values from executable configuration.
