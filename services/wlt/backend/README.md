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
an actor selector. The [migration](../database/migrations/README.md)
defines journal records and the reader's grant. Funding and provider operations
require their own verified implementation.
