# DSH OpenAPI — public discovery and isolated Store/policy commands

STATUS: CONTRACT_IN_PROGRESS
SEMANTIC_OWNER: DSH
EXECUTION: IN_PROGRESS

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
The fifth populated fragment, `paths/operational-policies.yaml`, exposes
`GET/PATCH /v1/operators/cities/{cityID}/store-availability-policy` only in the
explicitly isolated synthetic DSH host. Both methods require the current
Identity Operator session with the distinct `platform_policies` permission;
`operations` is not interchangeable. Readback uses DSH's one versioned city
policy source. A complete PATCH uses `expectedVersion` (0 only when
deliberately provisioning), a stable `operationId`, immutable audit and the
additive `005_store_operational_policy_commands.sql` idempotency ledger.
An ambiguous outcome requires canonical readback and same-key replay.
Missing policy never implies a default. This is not a production Operator UI,
WLT writer, payment permission or production policy activation.

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
