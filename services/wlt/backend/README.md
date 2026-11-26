# WLT Go owner

`cmd/wlt` serves the Customer's posted balance and successive bounded pages of
posted funding transactions (up to ten entries per page) in isolated development. No funding write endpoint is exposed.
Use the pinned Go toolchain and a fresh `bthwani_wlt_test` PostgreSQL database.
The runtime requires all of these settings.

- `BTHWANI_ISOLATED_TEST_MODE=true`
- `WLT_DEV_LISTEN_ADDR` as an explicit `127.0.0.1` address with a port
- `WLT_TEST_DATABASE_URL` as a local PostgreSQL URL for the `bthwani_wlt_reader` role and `bthwani_wlt_test` database, with `sslmode=disable`
- `WLT_TEST_IDENTITY_ORIGIN` as the isolated Identity HTTP origin on `127.0.0.1`

For opt-in Customer **Android emulator** preview, the same WLT process must
remain bound only to the isolated host loopback. The emulator reaches that
host via `10.0.2.2:<port>`, only after the launcher confirms that WLT
rejects an unauthenticated balance read. WLT never binds to a LAN address
for this preview. Physical device, real credentials and production financial
activation are not approved by this development transport.

For Customer Web, set `CUSTOMER_SYNTHETIC_WLT_ORIGIN` to the same WLT loopback
origin in the Surface preview. The route reads the existing preview cookie
and the app confirms the current actor on both sides of the wallet request.

The HTTP owner verifies the Customer with Identity before querying PostgreSQL,
then checks the same binding again before releasing the balance or transaction
history. `hasMore` and an optional `nextCursor` indicate older pages without
an actor selector. The [fresh owner schema](../database/schema/) defines journal records and the
reader's grant. The disposable baseline is the only current authored WLT schema.
The five experimental migrations remain available in Git at
`6db78a588760e21bab1d895eceab13cb8763590e`, not in the active source tree.

### Isolated Docker development reader

`infra/compose.yaml` defines the opt-in `wlt` service in the
existing `bthwani-refoundation` Compose project. Its pinned `Dockerfile`
runs the actual Go reader as UID 65532 with no writable filesystem or container
capabilities and loopback-only host port `3203`. It uses an explicit
`BTHWANI_ISOLATED_CONTAINER_MODE=true`, a *different* startup mode from the
existing strict local/Android loopback mode. The only permitted endpoints are
`postgres:5432/bthwani_wlt_test` under `bthwani_wlt_reader` and the
synthetic `http://identity:3302` verifier. No ledger writes, funding command,
automatic migrations, provider credentials or production services are enabled.

The new `tools/dev/provision-wlt-test-db.ps1` is an additive, explicit, one-time
development-only provisioner. It refuses an existing WLT database, roles or
credential entry, requires the verified refoundation PostgreSQL container, and
creates `bthwani_wlt_test` plus no-login owner/sandbox roles and a unique
read-only reader credential in the Git-ignored `infra/.env`. It applies the current three domain baseline files from `database/schema/` and
synthetic funding commands from `database/sandbox/` only to a NEW empty
isolated database; it verifies journal emptiness, SELECT grants and write-denial.
The five historical files were retired after isolated catalog equivalence,
owner-backed HTTP, immutable journal, concurrency, privilege and restore tests.
Never replay the baseline over an existing database. It never runs as
part of Compose or on another database. If a step fails, inspect the actual
durable database state before any attempted recovery; do not delete, reset or
rerun the provisioner blindly.

Build the committed WLT source image using `pnpm dev docker build wlt`,
then use guarded reconciliation for an existing WLT. For an explicitly approved first start, set `REF_WLT_IMAGE_TAG` to the returned `build-<full SHA>` tag and use the canonical `infra/compose.yaml` with `--no-deps --no-build --pull never` for `wlt` only after Identity and PostgreSQL are confirmed healthy. Verify `/health`, unauthenticated `401` and
read-only `405`, then real Identity session authorization/denial on
`/v1/wallets/me`; health alone is not journey acceptance.

### Post synthetic Customer funding

The fresh disposable baseline installs the sandbox functions from
`database/sandbox/` with the separate owner-only provisioner. An existing
schema must already have the required functions and privileges; if it does not,
refuse use and reconcile its version against the preserved Git history. Never
install the fresh baseline over it or automatically reset its data. Set `WLT_SANDBOX_DATABASE_URL` to the loopback database URL
for that role. Use the existing isolation mode and Identity origin settings
above. Run `wlt post-sandbox-funding <reference> <whole-yemeni-riyals>` and
supply the current synthetic Customer session token through standard input.

An additional **development-only, provider-confirmed** command,
`wlt verify-sandbox-provider-funding <reference> <whole-yemeni-riyals>`,
requires `WLT_SANDBOX_PROVIDER_ORIGIN=http://127.0.0.1:<port>` in addition
to the isolated sandbox credentials. With the existing synthetic Customer
session on standard input, WLT checks the sandbox provider's
`GET /sandbox/v1/funding/{reference}` response before using its *existing*
immutable synthetic journal function. It accepts only an exact successful
YER amount, provider reference and current Identity actor. A missing,
pending, failed, mismatched, redirected, malformed, oversized or unreachable
response fails without a new credit. The simulator and this command are **not**
a production provider verification scheme; no external funds are transferred.
The WLT process must reach the simulator through a separately authorized
local loopback endpoint or tunnel, never a LAN-open financial port.

The command returns `POSTED` or `REPLAYED`. After a lost or uncertain result,
submit the same reference, actor and amount. A changed actor or amount for
an existing reference is rejected. The same Customer session must still be
current immediately before the journal transaction commits. Use the existing
wallet and history HTTP reads to verify the result. The synthetic posting
operation is CLI-only and permits writes exclusively in `bthwani_wlt_test`.

Run `wlt reverse-sandbox-funding <original-reference>` with the current
synthetic Customer session on standard input to offset that Customer's exact
posted amount. The command returns `REVERSED` or `REPLAYED`. After a lost
result, repeat the command with the same reference and Customer. Verify the net
balance and the linked entries through the existing wallet reads.
