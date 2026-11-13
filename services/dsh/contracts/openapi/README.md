# DSH OpenAPI contract scaffold

STATUS: CONTRACT_SCAFFOLD_ONLY
SEMANTIC_OWNER: DSH
EXECUTION: NOT_STARTED

The sole entrypoint is `dsh.openapi.yaml` (OpenAPI 3.1.0). It deliberately declares `paths: {}`, no server, no security scheme and no production implementation. Its `info.version: 0.0.0` denotes a **placeholder**, not a published API version.

The seven reserved, initially empty domain-grouped fragments in `paths/` are `stores`, `catalog`, `offers`, `cart`, `orders`, `fulfillment` and `employees`. Each contains only `paths: {}` and is intentionally unreferenced while it has no Path Items. These are organization labels, **not approved endpoint inventories**, and do not establish multiple Store/Offer/Order engines. DSH's bounded employee engine serves company and Merchant staff with organizational isolation.

A future **approved** implementation slice must first reconcile Product meaning, consumers and owner permissions, then introduce real Path Items, validation and refs without a second contract truth. At that point replace the exact scaffold-only gate with a standard strict OpenAPI/YAML parser, full local ref resolution, duplicate path/operationId tests, security/error/schema tests and generated client parity. The existing source-only guard enforces only the exact **zero-operation scaffold**, not arbitrary OpenAPI validity.

No historical donor endpoints, localhost servers, authentication schemes, schemas, SQL, mocks or generated clients are transferred by this change. Actual APIs, runtime, database and independent critical-risk review remain NOT_RUN.
