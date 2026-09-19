# Local runtime ownership

`tools/dev/runtime.ps1` is the single public CLI owner of the Docker backend/state lifecycle for LOCAL_INTEGRATION. Compose owns PostgreSQL, Mailpit, Identity, DSH and the migration one-shots. It does not own Control Panel or Metro.

Daily backend lifecycle:

- `pnpm runtime:up`
- `pnpm runtime:doctor`
- `pnpm runtime:status`
- `pnpm runtime:down`

Targeted backend operations admit only `identity` and `dsh`.

Application development is host-owned:

- `pnpm control` — Windows-hosted Next.js dev server.
- `pnpm client|partner|captain|field` — Windows-hosted Expo/Metro plus canonical ADB/device opening.

`infra/local/.env.example` is the tracked canonical local configuration template. `infra/local/.env` is ignored and reconciled only by explicit runtime startup. The same environment file is consumed by Docker backend composition and host application development so there is no shadow configuration.

There is no Docker JavaScript runtime, no workspace bind mount, no Docker node_modules volume and no alternate host/Docker application mode.
