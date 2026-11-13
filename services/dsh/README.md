# DSH — Service Placement

STATUS: SCAFFOLD_ONLY
OWNER: DSH
EXECUTION: NOT_STARTED

DSH owns Stores, catalog, Offers, authoritative prices, carts, Orders, serviceability and fulfillment. One Store/catalog/Order engine serves MARKETPLACE and DIRECT; no relation-specific duplicate writer. The single bounded employee-administration engine for BThwani staff and Merchant staff belongs here, with organizational isolation; Identity still owns accounts and platform permissions, WLT still owns money. The future Go location for that employee engine is `backend/internal/employees/` (not created by this scaffold).

Future owner-local paths (create actual content only when separately authorized):
- `backend/` — Go service source and owner-specific tests.
- `contracts/openapi/` — one authoritative DSH OpenAPI entrypoint with domain-grouped `paths/`.
- `database/` — reviewed fresh-bootstrap schema and a protected `migrations/` upgrade path.

See [architecture](../../governance/architecture.md), [Store governance](../../governance/stores.md) and [employee governance](../../governance/hr.md). This README is **not** a deployed engine, contract, schema or HR authorization.
