# DSH — progressive development

STATUS: IMPLEMENTATION_IN_PROGRESS
OWNER: DSH
EXECUTION: IN_PROGRESS

DSH owns Stores, catalog, Offers, authoritative prices, carts, Orders, serviceability and fulfillment. One Store/catalog/Order engine serves MARKETPLACE and DIRECT; no relation-specific duplicate writer. The single bounded employee-administration engine for BThwani staff and Merchant staff belongs here, with organizational isolation; Identity still owns accounts and platform permissions, WLT still owns money. The future Go location for that employee engine is `backend/internal/employees/` (not created by this scaffold).

Current owner-local implementation (progressive development only; production remains blocked):
- `clients/` — contract-bound public discovery reads plus protected Store operational availability GET/PATCH transport; no client is a canonical Store, Order, price or financial writer.
- `package.json` and `tsconfig.json` — exact-pinned TypeScript workspace tooling; exported discovery reads must match the current DSH owner contract.
- `backend/` — current Go public Store/Offer discovery and Store availability logic with scoped tests; source presence alone does not certify every Identity, DSH or WLT integration scenario.
- `contracts/openapi/` — one OpenAPI 3.1 DSH entrypoint containing bounded public Store/Offer discovery and isolated-test-only authenticated Store availability GET/PATCH, mapped to `paths/store-access.yaml`; unpopulated groups remain reserved rather than implemented APIs. See the [source-pinned contract census](../../docs/reference/OPENAPI-DONOR-CONTRACT-INVENTORY.md).
- `database/` — isolated synthetic development migrations for bounded DSH slices. Protected historic schema upgrades, restore and real-user state require distinct authority and proof.

See [architecture](../../governance/architecture.md), [Store governance](../../governance/stores.md) and [employee governance](../../governance/hr.md). This README describes in-progress source, not production activation, complete journey acceptance, ledger authority or HR admission.
