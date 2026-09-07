# Control Panel

Administrative web deployable application host.

Owns control-panel composition only: web application bootstrap, routes, navigation, cross-capability page composition, app-specific assets, and deployable configuration.

Administrative UI does not become a second authority for backend business rules, permissions, contracts, or durable state.

## Local verification

`pnpm --dir apps/control-panel test:e2e` builds and starts the production Next runtime, then exercises the auth shell, typed recovery states, CSP/HSTS headers, and the cross-origin mutation guard.

Production deployments must set `CONTROL_PANEL_PUBLIC_ORIGIN` to the canonical HTTPS origin. Missing or invalid production origin configuration fails closed for unsafe API mutations.
