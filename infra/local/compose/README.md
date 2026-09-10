# Local compose

Single canonical local Compose substrate for development and integration.

## Runtime ownership

- **DAILY_DEV**: `pnpm runtime:daily:up` runs PostgreSQL/PostGIS and Mailpit in Docker. Identity and DSH run from the host through `pnpm identity` and `pnpm dsh`.
- **FULL_INTEGRATION**: `pnpm runtime:integration:up` runs PostgreSQL/PostGIS, Mailpit, Identity migrations, Identity and DSH in Docker.
- Do not mix host Identity/DSH processes with the FULL_INTEGRATION containers. The runtime commands fail or reconcile closed instead of accepting an ambiguous owner.
- `pnpm runtime:status` always includes integration-profile containers so Docker-owned Identity/DSH cannot be hidden by profile filtering.

`pnpm runtime:daily:down` and `pnpm runtime:integration:down` remove the complete local Compose project while preserving the named PostgreSQL data volume.

Copy `.env.example` to the ignored `.env` through `pnpm bootstrap`; never commit real local credentials.
