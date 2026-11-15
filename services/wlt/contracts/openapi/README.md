# WLT OpenAPI contract scaffold

STATUS: CONTRACT_SCAFFOLD_ONLY
SEMANTIC_OWNER: WLT
EXECUTION: NOT_STARTED

The sole entrypoint is `wlt.openapi.yaml` (OpenAPI 3.1.0). It deliberately declares `paths: {}`, no server, no security scheme and no production implementation. Its `info.version: 0.0.0` denotes a **placeholder**, not a published API version.

The 14 zero-operation `paths/*.yaml` groups are `runtime`, `payment-intents`, `wallets`, `funding`, `ledger`, `cash-custody`, `fee-policies`, `commercial-agreements`, `earnings-receivables`, `beneficiaries`, `payouts`, `settlements`, `reconciliation`, and `financial-reporting`. Every fragment contains only `paths: {}`, and the root entrypoint references none of them. Grouping reflects the audited 95 inline WLT donor Path Items: funding, prepaid wallet, immutable journal, Captain COD custody, Store agreements, earnings, recipients, payouts and settled evidence are distinct financial obligations. In particular `ledger` is a future **WLT-owned contract group**, not a second ledger. No route, posting, fee value or authority is adopted by these empty files. See [the historical source inventory](../../../../docs/reference/OPENAPI-DONOR-CONTRACT-INVENTORY.md).

A future **approved** implementation slice must first reconcile Product meaning, consumers and owner permissions, then introduce real Path Items, validation and refs without a second contract truth. At that point replace the exact scaffold-only gate with a standard strict OpenAPI/YAML parser, full local ref resolution, duplicate path/operationId tests, security/error/schema tests and generated client parity. The existing source-only guard enforces only the exact **zero-operation scaffold**, not arbitrary OpenAPI validity.

No historical donor endpoints, localhost servers, authentication schemes, schemas, SQL, mocks or generated clients are transferred by this change. Actual APIs, runtime, database and independent critical-risk review remain NOT_RUN.
