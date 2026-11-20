# WLT — Wallet and financial owner

STATUS: IMPLEMENTATION_IN_PROGRESS
OWNER: WLT
EXECUTION: IN_PROGRESS

WLT owns wallets, ledger entries, fees, commercial agreements, cash custody,
payouts and settlements. Identity verifies the actor and DSH owns Stores and
Orders.

The isolated Customer wallet slice exposes `GET /v1/wallets/me`. WLT verifies
the current opaque session with Identity and reads the posted YER balance for
that actor. The Customer Web preview uses a same-origin route with the existing
HttpOnly session. The API serializes whole YER as decimal text to retain exact
values above JavaScript's safe integer range.

The first migration stores one immutable funding journal per funding identity
and per provider reference. Debit and credit legs derive from the same stored
amount. A least-privilege runtime role can read the balance view. The CI suite
uses a separate Identity fixture role and a disposable PostgreSQL container.

Provider verification, funding commands, checkout, withdrawals, reconciliation
and production runtime remain pending. The suite's synthetic journal fixtures
exercise the PostgreSQL constraints and balance read. They confer no authority
to post money.

See the [API](contracts/openapi/wlt.openapi.yaml), [runtime](backend/README.md),
[migration](database/migrations/README.md) and [finance policy](../../governance/finance.md).
