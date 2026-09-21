# Local runtime ownership

Compose owns PostgreSQL, Mailpit, Identity, DSH and migration one-shots. It does not own Control Panel, Metro, ADB or scrcpy.

Daily backend lifecycle:

- `pnpm dev` — reconcile current backend images through Docker build cache, preserve/reuse state, wait for health, then return.
- `pnpm runtime:up` — perform the same backend image/state reconciliation explicitly.
- `pnpm runtime:status` — display backend/state.
- `pnpm runtime:down` — stop repository host development processes, scrcpy and backend/state.

Interactive surfaces are package-owned foreground processes:

- `pnpm client|partner|captain|field` — run that app's Expo development server.
- `pnpm control` — run Control Panel Next development.
- `pnpm scr` — own ADB transport/reverse mappings and scrcpy.

Mobile apps are opened manually. Application-source edits reuse the running Metro process and Fast Refresh; Control uses Next HMR. Native rebuilds are not part of the source-edit loop.

`infra/local/.env.example` is the tracked local configuration template. The ignored local runtime projection is created beside it and preserved after creation.

There is no Docker JavaScript runtime, persistent synthetic world, global fixture registry, parallel surface runtime owner or automatic mobile-app opener.
