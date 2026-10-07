# Local runtime ownership

Compose owns PostgreSQL, Mailpit, Identity, DSH and migration one-shots. It does not own Control Panel, Metro, ADB or scrcpy.

Daily backend lifecycle:

- `pnpm dev` — reconcile current backend images through Docker build cache, preserve/reuse state, wait for health, then return.
- `pnpm dev status` — display backend/state.
- `pnpm dev down` — stop repository host development processes and backend/state.

Interactive surfaces are package-owned foreground processes:

- `pnpm client|partner|captain|field` — run that app's Expo development server.
- `pnpm control` — run Control Panel Next development.
- `pnpm scr` — own ADB transport/reverse mappings and scrcpy.

Mobile apps are opened manually. Application-source edits reuse the running Metro process and Fast Refresh; Control uses Next HMR. Native rebuilds are not part of the source-edit loop.

`infra/local/.env.example` is the tracked local configuration template. The ignored local runtime projection is created beside it and preserved after creation.

The daily lifecycle preserves PostgreSQL/media volumes and does not seed or reset accounts, categories or products. Persisted rows change only through an explicit owning migration or service operation, not merely because source or test fixtures changed. Local synthetic-data cleanup follows [the repository's local-state rules](../../../AGENTS.md#4-local-development-state).

There is no Docker JavaScript runtime, persistent synthetic world, global fixture registry, parallel surface runtime owner or automatic mobile-app opener.
