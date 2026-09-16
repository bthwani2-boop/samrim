# Control Panel

Administrative web deployable application host.

Owns control-panel composition only: web application bootstrap, routes, navigation, cross-capability page composition, app-specific assets, and deployable configuration.

Administrative UI does not become a second authority for backend business rules, permissions, contracts, or durable state.

## Local verification

`pnpm --dir apps/control-panel test:e2e` runs the non-live browser suite against an already-running Control Panel runtime. Set `PLAYWRIGHT_BASE_URL` (or `CONTROL_PANEL_PUBLIC_ORIGIN`) to an explicit loopback origin first. The canonical full candidate proof is `node tools/dev/verify-candidate-runtime.mjs --env-file=infra/local/compose/.env` after `pnpm runtime:up`; it also exercises live Identity and the service/runtime readback checks.

Production deployments must set `CONTROL_PANEL_PUBLIC_ORIGIN` to the canonical HTTPS origin. Missing or invalid production origin configuration fails closed for unsafe API mutations.
