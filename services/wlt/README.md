# WLT — Wallet and financial owner

STATUS: IMPLEMENTATION_IN_PROGRESS
OWNER: WLT
EXECUTION: IN_PROGRESS

WLT owns wallets, ledger entries, fees, commercial agreements, cash custody,
payouts and settlements. Identity verifies the actor and DSH owns Stores and
Orders.

The isolated Customer wallet slice exposes `GET /v1/wallets/me` and
`GET /v1/wallets/me/transactions`. WLT verifies the current opaque session
with Identity, reads only that actor's posted YER balance and bounded pages of
funding entries, and rechecks Identity before returning either response. The
Customer Web preview uses a same-origin route with the existing
HttpOnly session. The API serializes whole YER as decimal text to retain exact
values above JavaScript's safe integer range.

The first migration stores one immutable funding journal per funding identity
and per provider reference. Debit and credit legs derive from the same stored
amount. A least-privilege runtime role can read the balance and bounded funding-history
projections; it cannot read raw provider references. Older entries are retrieved
with a canonical keyset cursor instead of unsafe unbounded reads. The CI suite
uses a separate Identity fixture role and a disposable PostgreSQL container.

The isolated WLT command can post synthetic Customer funding into the same
journal. It verifies the Customer session with Identity and uses a dedicated
database role. A replay with the same reference, actor and amount confirms the
earlier posting. The Customer wallet reads the resulting balance and history
through the existing API.

The sandbox reversal command takes the original reference and current Customer
session. It appends one offsetting journal using the original amount and
currency. The original remains visible in history, and both Customer previews
label the reversal as a deduction.

Synthetic external-provider **status verification** is available through an
isolated WLT CLI command and fixed WireMock fixtures. It reuses the existing
sandbox posting ledger and is not a real external rail or a Customer funding
write API. Provider authentication, production-grade evidence retention,
checkout, withdrawals, reconciliation and production runtime remain pending.

See the [API](contracts/openapi/wlt.openapi.yaml), [runtime](backend/README.md),
[migration](database/migrations/README.md) and [finance policy](../../governance/finance.md).
