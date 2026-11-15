# DSH OpenAPI — public discovery and isolated Store/policy readback

STATUS: CONTRACT_IN_PROGRESS
SEMANTIC_OWNER: DSH
EXECUTION: IN_PROGRESS
PRODUCTION_ACTIVATION: BLOCKED

The **sole canonical entrypoint** is `dsh.openapi.yaml` (OpenAPI 3.1.0).
Its four public read-only operations are defined exactly once in three
domain files and referenced with standard local Path Item references:

- `paths/runtime.yaml` — `GET /health`
- `paths/stores.yaml` — `GET /v1/public/stores` and `GET /v1/public/stores/{id}`
- `paths/offers.yaml` — `GET /v1/public/stores/{id}/offers`

A fourth populated path module, `paths/store-access.yaml`, contains protected
`GET` and `PATCH /v1/stores/{storeID}/availability` for the canonical DSH
Store operational facts. The Go service mounts these handlers only when
`DSH_ENABLE_ISOLATED_STORE_AVAILABILITY=true` and synthetic development
mode with a `dsh_test_*` schema and a loopback-only
`DSH_LISTEN_ADDR=127.0.0.1:<port>` are explicitly selected.
Cross-origin private requests only allow exact configured
`DSH_PUBLIC_CORS_ORIGINS`; preflight never skips Identity checks.
The fifth populated fragment, `paths/operational-policies.yaml`, exposes a
**read-only** `GET /v1/operators/cities/{cityID}/store-availability-policy`.
It requires an active Identity Operator session and the distinct
`platform_policies` permission. The DSH policy reader returns only an
explicitly stored, active city's versioned limits and accountable metadata;
no default, Operator mutation, or production UI is activated. Its CORS
preflight allows GET only. The documented policy writer remains unimplemented.

A real current Identity verifier, DSH Store owner check, and active DSH policy must succeed;
no production authenticated service, checkout, WLT, or user permission issuer
is activated by this incremental contract.

The fragments point back only to the **same DSH owner's** canonical
`components` in `dsh.openapi.yaml`. No schemas, response contracts or
parameter definitions are duplicated; no new endpoints, authentication
grants or checkout permissions are introduced for public reads. The other 16
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
