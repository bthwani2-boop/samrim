# Local runtime ownership

`tools/dev/runtime.ps1` is the single public owner of the Docker backend/state lifecycle for LOCAL_INTEGRATION. Compose owns PostgreSQL, Mailpit, Identity, DSH and the migration one-shots. It does not own Control Panel, Metro or Android device processes.

Daily backend lifecycle:

- `pnpm runtime:up`
- `pnpm runtime:down`
- `pnpm runtime:status`
- `pnpm runtime:logs`
- `pnpm runtime:doctor`

Targeted rebuild admits only `identity` and `dsh`. Destructive reset requires `-AllowDataLoss`.

Application development is host-owned:

- `pnpm control` — Windows-hosted Next.js.
- `pnpm client|partner|captain|field` — Windows-hosted Expo/Metro with one authorized USB Android device.
- `pnpm scr` — direct USB scrcpy mirroring.

`infra/local/.env.example` is the tracked canonical local configuration template. `infra/local/.env` is ignored, created from that template only when missing, and preserved afterward.

There is no Docker JavaScript runtime, workspace bind mount, Docker node_modules volume, Wi-Fi ADB fallback or alternate host/Docker application mode.
