# Control Panel

Administrative web deployable application host.

Owns control-panel composition only: web application bootstrap, routes, navigation, cross-capability page composition, app-specific assets, and deployable configuration.

Administrative UI does not become a second authority for backend business rules, permissions, contracts, or durable state.

## Local verification

Use `pnpm --dir apps/control-panel typecheck` or `pnpm --dir apps/control-panel build` for source validation. Backend readiness is owned by `pnpm dev`; candidate compilation is owned by `pnpm verify`, and remote push closure is owned by `pnpm safe:push`.

Production deployments must set `CONTROL_PANEL_PUBLIC_ORIGIN` to the canonical HTTPS origin. Missing or invalid production origin configuration fails closed for unsafe API mutations.
