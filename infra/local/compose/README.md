# Local runtime ownership

`tools/dev/local.ps1` is the single repository owner for local development commands; its Docker actions delegate directly to Compose. Compose owns PostgreSQL, Mailpit, Identity, DSH and the migration one-shots. It does not own Control Panel, Metro or Android device processes.

Daily backend lifecycle:

- `pnpm runtime:up`
- `pnpm runtime:down`
- `pnpm runtime:status`
- `pnpm runtime:doctor`

Application development is host-owned:

- `pnpm control` — Windows-hosted Next.js.
- `pnpm client|partner|captain|field` — Windows-hosted Expo/Metro with one USB Android device.
- `pnpm scr` — direct USB scrcpy mirroring.

All of these route through `tools/dev/local.ps1`; there are no secondary local runtime wrapper files.

`infra/local/.env.example` is the tracked canonical local configuration template. `infra/local/.env` is ignored, created from that template only when missing, and preserved afterward.

There is no Docker JavaScript runtime, workspace bind mount, Docker node_modules volume, Wi-Fi ADB fallback or alternate host/Docker application mode.
