# Local runtime ownership

`tools/dev/dev.ps1` is the single repository runtime command owner. Compose owns PostgreSQL, Mailpit, Identity, DSH and migration one-shots; it does not own Control Panel, Metro, ADB or scrcpy.

Daily lifecycle:

- `pnpm dev` — reuse/prepare shared backend, backend ADB reverse and scrcpy with timing output; application servers remain on-demand.
- `pnpm runtime:up` — ensure backend/state only.
- `pnpm runtime:status` — display backend/state.
- `pnpm runtime:down` — stop backend/state.

Application aliases `pnpm client|partner|captain|field|control|scr` route to the same runtime file.

`pnpm dev` first checks the already-bound local backend ports. When they are live it skips Compose completely, so completed migration services are not restarted on every daily invocation. When backend ports are absent it runs the canonical Compose `up -d --wait` path.

`infra/local/.env.example` is the tracked canonical local configuration template. `infra/local/.env` is ignored and preserved after creation.

There is no Docker JavaScript runtime, workspace bind mount, Docker node_modules volume, Wi-Fi ADB fallback, serial registry or alternate host/Docker application mode.
