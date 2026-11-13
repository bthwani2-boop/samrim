# DSH — Service Placement

STATUS: SCAFFOLD_ONLY
OWNER: DSH
EXECUTION: NOT_STARTED

DSH owns Stores, catalog, Offers, authoritative prices, carts, Orders, serviceability and fulfillment. One Store/catalog/Order engine serves MARKETPLACE and DIRECT; no relation-specific duplicate writer. The single bounded employee-administration engine for BThwani staff and Merchant staff belongs here, with organizational isolation; Identity still owns accounts and platform permissions, WLT still owns money. The future Go location for that employee engine is `backend/internal/employees/` (not created by this scaffold).

Current scaffold and future owner-local paths (real implementation only after separate approval):
- `clients/` — private TypeScript workspace package with a nonfunctional `index.ts` entrypoint; future TypeScript/Go clients come only from validated contracts and real consumer needs.
- `package.json` and `tsconfig.json` — exact-pinned TypeScript client tooling using the existing pnpm workspace; no runtime dependencies or implemented exports yet.
- `backend/` — Go service source and owner-specific tests.
- `contracts/openapi/` — one zero-operation OpenAPI 3.1 DSH entrypoint and seven reserved empty `paths/*.yaml` domain modules (`paths: {}` only). No actual paths, refs, servers, schemas or permissions yet.
- `database/` — reviewed fresh-bootstrap schema and a protected `migrations/` upgrade path.

See [architecture](../../governance/architecture.md), [Store governance](../../governance/stores.md) and [employee governance](../../governance/hr.md). This README is **not** a deployed engine, contract, schema or HR authorization.
