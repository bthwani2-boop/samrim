# Control Panel

Administrative web deployable application host.

Owns control-panel composition only: web application bootstrap, routes, navigation, cross-capability page composition, app-specific assets, and deployable configuration.

Administrative UI does not become a second authority for backend business rules, permissions, contracts, or durable state.

## Local verification

`pnpm --dir apps/control-panel test:e2e` runs the non-live browser suite against an already-running Control Panel runtime. Set `PLAYWRIGHT_BASE_URL` (or `CONTROL_PANEL_PUBLIC_ORIGIN`) to an explicit loopback origin first. Runtime readiness is owned by `pnpm runtime:doctor`; candidate verification is owned by `pnpm verify`, and final verified push closure is owned by `pnpm safe:push`.

Production deployments must set `CONTROL_PANEL_PUBLIC_ORIGIN` to the canonical HTTPS origin. Missing or invalid production origin configuration fails closed for unsafe API mutations.
