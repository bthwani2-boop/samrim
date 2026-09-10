# Local runtime ownership

This directory contains two deliberately isolated Docker substrates with different lifecycles. They are not interchangeable development modes.

## DAILY_DEV

`compose.yaml` is the only interactive Docker substrate. It owns PostgreSQL/PostGIS and Mailpit only. Identity, DSH, Control Panel and mobile runtimes are host-owned.

Use only:

- `pnpm runtime:daily:up`
- `pnpm runtime:daily:down`
- `pnpm runtime:status` for read-only ownership/residue census

`runtime:daily:down` removes DAILY_DEV containers while preserving its named PostgreSQL data volume.

## FULL_INTEGRATION

`compose.integration.yaml` is a separate ephemeral proof appliance with project identity `samrim-integration` and an integration-only PostgreSQL volume. It is not a development runtime and it does not share DAILY_DEV database state.

The only public entry point is `pnpm runtime:integration:close`. That command owns reset, build, start, readiness, verification and mandatory teardown. Teardown destroys integration containers and volumes on both success and failure.

There are no public manual Integration up/down/config/status commands and no keep-running path.

## Local configuration

`infra/local/compose/.env.example` is the tracked canonical source for local runtime keys and non-secret values. The ignored `.env` is an exact projection maintained by `tools/dev/ensure-local-env.ps1`.

Only explicitly declared generated secret keys may preserve an existing local value. Missing secrets are generated once. Unknown keys are removed rather than preserved as shadow configuration. Destructive `-Force` regeneration is not part of the workflow.

Do not duplicate hosts, ports or origins in documentation. Read current values from the executable configuration.
