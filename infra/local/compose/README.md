# Local compose

Single canonical local Compose substrate for local development and integration proof.

## Runtime ownership

- **DAILY_DEV is the only interactive development mode.** `pnpm runtime:daily:up` owns PostgreSQL/PostGIS and Mailpit in Docker. Identity, DSH, Control Panel and mobile runtimes are host-owned.
- **FULL_INTEGRATION is an ephemeral proof appliance, not a second development mode.** The only public entry point is `pnpm runtime:integration:close`; it owns build/start/readiness/proof/teardown and must leave zero Docker domain-service residue.
- `pnpm runtime:status` is diagnostic only and always includes integration-profile containers so stale Docker-owned Identity/DSH cannot be hidden.
- Direct `docker compose` lifecycle mutation is an internal implementation/diagnostic mechanism, not the normal developer workflow.

`pnpm runtime:daily:down` removes the complete local Compose project while preserving the named PostgreSQL data volume.

## Local configuration

`infra/local/compose/.env.example` is the tracked canonical source for non-secret local runtime values. The ignored `.env` is derived/reconciled by `tools/dev/ensure-local-env.ps1`.

Existing secret values are preserved. Missing generated secrets are created once. Non-secret drift is reconciled to `.env.example`; destructive `-Force` regeneration is not part of the local workflow.

Do not duplicate local hosts, ports or origins in documentation. Read their current values from the executable configuration.
