# DSH OpenAPI — source-linked public discovery paths

STATUS: CONTRACT_IN_PROGRESS
SEMANTIC_OWNER: DSH
EXECUTION: IN_PROGRESS
PRODUCTION_ACTIVATION: BLOCKED

The **sole canonical entrypoint** is `dsh.openapi.yaml` (OpenAPI 3.1.0).
Its four existing read-only operations are defined exactly once in three
domain files and referenced with standard local Path Item references:

- `paths/runtime.yaml` — `GET /health`
- `paths/stores.yaml` — `GET /v1/public/stores` and `GET /v1/public/stores/{id}`
- `paths/offers.yaml` — `GET /v1/public/stores/{id}/offers`

The fragments point back only to the **same DSH owner's** canonical
`components` in `dsh.openapi.yaml`. No schemas, response contracts or
parameter definitions are duplicated; no new endpoints, authentication
grants or checkout permissions are introduced. The other 18
`paths/*.yaml` groups remain empty until their real owner-backed operations
are implemented.

The original scaffold note `no server, no security scheme` described the
**historical empty contract**, not the admitted public discovery API.
The current contract has no `servers` field and every public read explicitly
declares `security: []`. It confers no private Merchant, Order, Identity
or WLT permissions.

The 21 reserved domain groups are organizational, not 21 services or
permission engines. The [source- and SHA-pinned inventory](../../../../docs/reference/OPENAPI-DONOR-CONTRACT-INVENTORY.md)
is historical evidence, not a live API. `cart` will cover quote/checkout
without duplicating the DSH Order owner. `financial-views` is a WLT-backed
read projection only. Historical donor endpoints require source and Product
reconciliation before any transfer.

The Foundation source-boundary guard is **not arbitrary OpenAPI validity**.
For each populated Path Item, run strict YAML parsing, local reference
resolution and operation-ID/security/response checks, then verify compatibility
with the real Go owner routes and TypeScript clients. Structural approval
is not real owner-backed integration or production authorization.
