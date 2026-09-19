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

Identity and DSH each use one canonical backend image for both migration and runtime processes; migration services override the entrypoint instead of owning duplicate images/builds.

For a material service, use the strict targeted interface:

- `pnpm runtime:rebuild -- -Service identity`
- `pnpm runtime:restart-service -- -Service dsh`
- `pnpm runtime:logs-service -- -Service control`

Only `identity`, `dsh`, `control`, and the four `metro-*` services are accepted. Arbitrary Compose passthrough is not a public command.

## Normal daily development

After one-time bootstrap has created the local environment, the normal human workday uses only:

- `pnpm scr` — establish/reuse the canonical physical device, ADB reverse mappings, Wi-Fi fallback, and a long-running scrcpy session (normally in its own terminal).
- `pnpm runtime:up` — start/reconcile the complete canonical Docker stack once.
- `pnpm runtime:doctor` — read-only deep validation of Docker ownership, workspace/volume topology, and current host-published service endpoints.
- `pnpm runtime:status` — lightweight read-only service state display.

`runtime:up` owns Docker startup. When the exact full runtime and JavaScript dependency fingerprint are already valid, it checks that fingerprint inside an already-running JavaScript container and reconciles only the long-running services without creating a transient dependency-check container or rerunning completed migrations/ `js-deps`; any failed warm reconciliation falls back to the canonical full repair path. `runtime:doctor` performs deep read-only proof; `runtime:status` only displays current service state. Neither repairs or mutates the runtime. Docker remains the only owner of Control Panel and all four Metro servers. After startup, ordinary JavaScript/TypeScript source edits use the already-running Expo Fast Refresh / Next.js HMR path; they do not require runtime restart, dependency materialization, ADB preparation, app relaunch, or login.

## Android development

The four root app commands remain optional claim-specific openers:

- `pnpm client`
- `pnpm partner`
- `pnpm captain`
- `pnpm field`

They require the relevant Docker-owned backend and Metro service to already be ready. They perform read-only runtime validation, reuse the canonical device policy, and open the selected installed development client when a real-device interaction is required. They do not start/reconcile Docker or materialize JavaScript dependencies. Normal source-edit feedback comes from Fast Refresh and does not require re-running an app command.

Current mobile LOCAL_INTEGRATION proof is Android-only. iOS export/runtime proof is deferred until iOS becomes an admitted development target; do not pay that cost in the current Android workflow.

`pnpm control` likewise validates the already-running Docker-owned Control Panel and reports its URL; it does not start/reconcile Docker.

`pnpm scr` is the canonical device/scrcpy owner. It uses USB as the primary device identity, prepares a bounded Wi-Fi fallback, reuses valid ADB reverse mappings, and runs a resource-bounded development mirror; it does not own Docker runtime lifecycle.

## Local configuration

`infra/local/compose/.env.example` is the tracked canonical source for local runtime keys and non-secret values. The ignored `.env` is an exact projection reconciled by `tools/dev/runtime.ps1` during startup only.

Only explicitly declared generated secret keys may preserve an existing local value. Missing secrets are generated once. Unknown keys are removed during explicit startup reconciliation rather than preserved as shadow configuration.
