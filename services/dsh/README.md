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

## Public Store name search — 2026-11-18 increment

`CUSTOMER_STORE_CATALOG`: `GET /v1/public/stores` accepts optional `q`, a trimmed literal case-insensitive name substring of at most 80 Unicode code points. Search stays inside the same city/publication/active-vertical/MARKETPLACE query. `%`, `_` and SQL-looking text are ordinary text; empty search preserves existing unfiltered pagination. Cursors bind city, search and public revision. DSH remains the only Store owner; the Customer home/directory submits the search through the existing public client, clears results on city/search changes and provides Arabic empty/error/retry/clear states.

Risk assessment: this is a bounded read-only extension, with no migration, permission, session, Order or money writes. Parameterized SQL preserves owner isolation. The existing four-second query deadline, page limit and request size bound still apply; substring search performance on a production-size corpus is unmeasured and no production activation is authorized.

Verification on `codex/next-capability-20261118`, based on `e088d2d805713ec0f5ca4e00103031ebe07a7403`:
- PASS: native Spec Kit 1.3.0 check and existing discovery specification/context inspection; local Graphify `listPublicStores` query matched the base HEAD and live consumers, then code graph refreshed after changes.
- PASS: DSH Go unit tests/vet; real Linux discovery test binary against isolated PostgreSQL database `bthwani_refoundation`, schema `dsh_test_search_20261118`, using the reviewed migration and DSH-owned synthetic import. Search/pagination/cross-city and cross-search rejection, hidden/DIRECT exclusion, literal wildcard/SQL text, existing revision recovery and concurrent read tests passed. Independent durable SQL readback confirmed the isolated database and six synthetic Stores. First runner attempt lacked migration files; rerun with the complete migration directory passed the full discovery suite.
- PASS: 13 public-client tests, 21 OpenAPI tests, DSH/Customer typechecks, exact toolchain, affected Biome checks, source-test discovery and tracked-secret guard.
- BLOCKED: the automatic execution review rejected the combined isolated runtime/Web verification command with `blocked by policy`. No alternate channel was used. Actual Web/Android interaction and final compatible app/runtime proof remain unverified; iOS NOT_RUN. This increment and its broader discovery journey are **NOT CLOSED**.
- Remote publication/CI: NOT_RUN; this trigger grants no independent Push, PR, merge or deployment authority.
