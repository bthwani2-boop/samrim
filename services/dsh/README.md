# DSH — progressive development

STATUS: IMPLEMENTATION_IN_PROGRESS
OWNER: DSH
EXECUTION: IN_PROGRESS

DSH owns Stores, catalog, Offers, authoritative prices, carts, Orders, serviceability and fulfillment. One Store/catalog/Order engine serves MARKETPLACE and DIRECT; no relation-specific duplicate writer. The single bounded employee-administration engine for BThwani staff and Merchant staff belongs here, with organizational isolation; Identity still owns accounts and platform permissions, WLT still owns money. The future Go location for that employee engine is `backend/internal/employees/` (not created by this scaffold).

Current owner-local implementation (progressive development only; production remains blocked):
- `clients/` — contract-bound public discovery reads and protected Store availability plus Operator city-policy GET/PATCH transport; no client is a canonical Store, policy, Order, price or financial writer.
- `package.json` and `tsconfig.json` — exact-pinned TypeScript workspace tooling; exported discovery reads must match the current DSH owner contract.
- `backend/` — current Go public Store/Offer discovery and Store availability logic with scoped tests; source presence alone does not certify every Identity, DSH or WLT integration scenario.
- `contracts/openapi/` — one OpenAPI 3.1 DSH entrypoint containing bounded public Store/Offer discovery and isolated-test-only authenticated Store availability and city-policy GET/PATCH, mapped to `paths/store-access.yaml` and `paths/operational-policies.yaml`. Other groups are reserved, not implemented APIs. See the [source-pinned contract census](../../docs/reference/OPENAPI-DONOR-CONTRACT-INVENTORY.md).
- `database/` — isolated synthetic development migrations, including additive DSH city-policy operation history in `005_store_operational_policy_commands.sql`. Protected historic schema upgrades, restore and real-user state require distinct authority and proof.

**Migration security boundary (development only):** The DSH owner verifies the SHA-256 of migration bytes against the five currently reviewed, immutable SQL files before opening a transaction. A caller-specified `--migration` path or `__SCHEMA__` marker cannot authorize different SQL, including an appended cross-schema statement. Execution also requires the explicit isolated-test opt-in, `dsh_test_*` schema and exact isolated database identity. Changing any reviewed SQL file requires security review and an explicit digest update; applied history must not be rewritten. These checks are not proof of least-privilege database credentials, protected upgrade/restore, or Sonar's remote Quality Gate. No production migration is authorized.

See [architecture](../../governance/architecture.md), [Store governance](../../governance/stores.md) and [employee governance](../../governance/hr.md). This README describes in-progress source, not production activation, complete journey acceptance, ledger authority or HR admission.
