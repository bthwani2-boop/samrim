# Local runtime ownership

`tools/dev/runtime.ps1` is the single public owner of the local Docker runtime lifecycle. The canonical Compose project is `samrim-local`, and Docker owns PostgreSQL, Mailpit, Identity, DSH, Control Panel, and the four Metro services.

Use the lifecycle commands:

- `pnpm runtime:up`
- `pnpm runtime:down`
- `pnpm runtime:restart`
- `pnpm runtime:status`
- `pnpm runtime:logs`
- `pnpm runtime:doctor`
- `pnpm runtime:reset` (destructive application-state reset)
- `pnpm runtime:purge` (destructive local Docker cleanup)

`runtime:up` and `runtime:restart` are Docker-only and work without Android or ADB. They reconcile the ignored local environment only during explicit startup. Status, doctor, logs, and down do not generate secrets, remove unknown keys, or repair `.env` implicitly. `runtime:reset` and `runtime:purge` preserve local `.env` values.

For a material service, use the strict targeted interface:

- `pnpm runtime:rebuild -- -Service identity`
- `pnpm runtime:restart-service -- -Service dsh`
- `pnpm runtime:logs-service -- -Service control`

Only `identity`, `dsh`, `control`, and the four `metro-*` services are accepted. Arbitrary Compose passthrough is not a public command.

## Android development

Start the Docker runtime first. Then open exactly one app with its root command:

- `pnpm client`
- `pnpm partner`
- `pnpm captain`
- `pnpm field`

Each command reads the selected app’s deployable identity from `apps/<app>/mobile.config.json`, checks the Docker-owned Identity/DSH/Metro services, prepares and reads back ADB reverse mappings through the canonical device policy, and opens only that app. Failures are reported as `RUNTIME_NOT_READY`, `DEVICE_NOT_READY`, `ADB_REVERSE_NOT_READY`, `APP_NOT_INSTALLED`, or `APP_LAUNCH_FAILED`.

`pnpm scr` is a display-only scrcpy consumer. It uses the canonical device policy for USB selection, bounded Wi-Fi fallback, ADB readiness, and reverse readback; it does not own a second device bootstrap policy.

## Local configuration

`infra/local/compose/.env.example` is the tracked canonical source for local runtime keys and non-secret values. The ignored `.env` is an exact projection reconciled by `tools/dev/runtime.ps1` during startup only.

Only explicitly declared generated secret keys may preserve an existing local value. Missing secrets are generated once. Unknown keys are removed during explicit startup reconciliation rather than preserved as shadow configuration.
