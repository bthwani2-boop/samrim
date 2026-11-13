# DSH OpenAPI contract scaffold

STATUS: CONTRACT_SCAFFOLD_ONLY
SEMANTIC_OWNER: DSH
EXECUTION: NOT_STARTED

The sole entrypoint is `dsh.openapi.yaml` (OpenAPI 3.1.0). It deliberately declares `paths: {}`, no server, no security scheme and no production implementation. Its `info.version: 0.0.0` denotes a **placeholder**, not a published API version.

The donor audit showed that **seven** domain files were insufficient. The 21 flat, zero-operation `paths/*.yaml` reservations now cover `stores`, `store-access`, `store-publication`, `catalog`, `offers`, `cart`, `orders`, `order-conversations`, `fulfillment`, `captains`, `locations`, `serviceability`, `employees`, `promotions`, `discovery-content`, `customer-discovery`, `notifications`, `client-shares`, `operational-policies`, `financial-views` and `runtime`. Each contains only `paths: {}`, and none is referenced from the main entrypoint until real operations are separately admitted.

These are **document grouping labels, not 21 engines, 21 permission domains or approved endpoints**. `cart` includes single-/multi-Store quote and checkout; `stores` is shared by Marketplace and Direct; `employees` is one bounded company/Merchant engine with organizational isolation. `financial-views` is WLT-backed read projection only: WLT owns all money/ledger/financial terms; Identity owns actor identity and platform grants. Old onboarding/financial/marketing paths must be reconciled before transfer rather than blindly restored. The [source- and SHA-pinned inventory](../../../../docs/reference/OPENAPI-DONOR-CONTRACT-INVENTORY.md) records all 23 donor DSH modules, 10 inline Path Items and the intended target classification.

A future **approved** implementation slice must first reconcile Product meaning, consumers and owner permissions, then introduce real Path Items, validation and refs without a second contract truth. At that point replace the exact scaffold-only gate with a standard strict OpenAPI/YAML parser, full local ref resolution, duplicate path/operationId tests, security/error/schema tests and generated client parity. The existing source-only guard enforces only the exact **zero-operation scaffold**, not arbitrary OpenAPI validity.

No historical donor endpoints, localhost servers, authentication schemes, schemas, SQL, mocks or generated clients are transferred by this change. Actual APIs, runtime, database and independent critical-risk review remain NOT_RUN.
