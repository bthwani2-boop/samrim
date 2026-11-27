# DSH — Store, commerce and fulfillment owner

DSH is the sole owner of Stores, catalog, Offers, inventory, prices, carts, Orders, serviceability and fulfillment. Its bounded employee administration serves BThwani and Merchant organizations. Identity owns actors, sessions and platform permissions; WLT owns financial facts. MARKETPLACE and DIRECT share the same Store and commerce owners. See [architecture](../../governance/architecture.md), [Stores](../../governance/stores.md), [catalog](../../governance/catalog.md), [commerce](../../governance/commerce.md), [fulfillment](../../governance/fulfillment.md) and [HR](../../governance/hr.md).

## Source and admission

- [OpenAPI entrypoint](contracts/openapi/dsh.openapi.yaml) is the only executable HTTP contract, linking the owner Path Items in [paths](contracts/openapi/paths/). Operation counts, authorization and wire schemas are read from that source, not a second maintained inventory.
- [Go entrypoint](backend/cmd/dsh/main.go) composes the current handlers. The [owner packages](backend/internal/) implement public discovery, Customer cart/address/favorites, Store operations and policy, catalog/import, Captain standing/interest, employees and current Identity verification.
- [Public SDK](clients/README.md) consumes the contract through the package entrypoint; its generated operation metadata is derived, not a second API.
- [SQL baseline](database/schema/) is the sole ordered fresh-install source. The schema directory and owner bootstrap determine the actual domains and order; there is no second active migration history.

The public Store/Offer discovery projection requires owner publication and eligibility. Store name search uses a bounded literal case-insensitive query; pagination is bound to its owner scope and revision. Private Store, Captain, employee and Customer routes require the applicable current Identity and DSH scope; the route declaration alone does not grant access.

Cart draft replacement, merchandise estimate, serviceability and checkout review are distinct owner operations. The draft/estimate/review do not reserve stock, freeze a payable quote, allocate WLT funds or confirm an Order. Do not infer order creation, dispatch or collection from the existing reads and policy commands. Their accepted future behavior belongs to the commerce, fulfillment and finance owners.

## Development database and serving boundary

Use [the canonical environment launcher](../../tools/dev/README-Lenovo-Development.md) and [infrastructure guide](../../infra/README.md) for the isolated daily development runtime. Actual flags, database/schema checks and transport admission belong to the Go entrypoint and environment configuration. For example, isolated Store availability and Customer cart are separately opted in; loopback or explicitly verified container transport, dedicated schema and current Identity verifier are required. Do not enable gates merely to make a UI appear populated.

The explicit bootstrap mode admits only a verified fresh, empty isolated schema and installs the ordered baseline transactionally. The serving process never applies SQL. Protect retained data and roles; use the existing verified reconciliation/recovery path, not baseline replay or another migration history. See [engineering](../../governance/engineering.md#sql-01--safe-one-baseline-per-owner-fresh-bootstrap-protected-upgrades).

The retired experimental migrations remain [historical evidence](https://github.com/bthwani2-boop/samrim/tree/9c6143773b755257d34217cc0017b5ea64ce0d6b/services/dsh/database/migrations). The dated search, runtime and device evidence previously carried by this guide remains in its [exact historical revision](https://github.com/bthwani2-boop/samrim/blob/2c7b7457abed3481f55e5242130e50c83151e753/services/dsh/README.md). The [donor contract inventory](../../docs/reference/OPENAPI-DONOR-CONTRACT-INVENTORY.md) is historical evidence, not an active API or capability ceiling.

## Verification

From the repository root run `pnpm check:contracts` and `node tools/dev/generate-openapi-operations.mjs --check dsh`. Execute the owner Go, SDK, actual isolated PostgreSQL and affected application tests for the changed scope. Verify source/runtime provenance, current authorization, durable readback, failure/replay and actual Web/Android behavior as required by [journey acceptance](../../governance/journeys.md).

Structural checks, an HTTP success or a passing build do not establish whole-client parity, an authenticated journey or production admission. This guide describes the source boundary; actual activation and acceptance require current owner evidence.
