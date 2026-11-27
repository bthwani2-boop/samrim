# WLT - Wallet and financial owner

STATUS: IMPLEMENTATION_IN_PROGRESS
OWNER: WLT

WLT owns financial facts: wallets, ledger, fees, commercial agreements,
cash custody, payout and settlement. Identity owns actors, sessions and
platform permissions; DSH owns Stores, Orders and commercial relations.
See [finance governance](../../governance/finance.md) for binding policy.

## Current isolated development boundary

The serving Go owner is read-only. Its public contract contains five
protected financial GET operations (Customer balance, funding history,
checkout allocation/release readback, Merchant Store agreement review and
Operator agreement review) and a development health probe. The
[OpenAPI owner](contracts/openapi/README.md) lists the exact operations and
authorization; the [SDK boundary](clients/README.md) describes their
consumers. A recorded proposal is not an effective agreement; allocation
readback is not a captured payment or a confirmed Order.

The [SQL baseline](database/schema/) owns immutable funding records,
balanced ledger projections, commercial agreement proposals/decisions and
order payment allocations/releases. Posted and available whole YER are
returned as exact decimal text. The serving reader cannot execute financial
commands or access private relations. Synthetic funding/reversal and fixed
provider-evidence verification use the separately scoped
[sandbox](database/sandbox/) and explicit CLI commands described in the
[runtime guide](backend/README.md); these are not payment-rail activation.

Source, generated operations, disposable PostgreSQL tests and serving
runtime provenance are independent evidence. No production rail, live
funding, checkout completion, withdrawal, settlement or journey closure is
inferred from the isolated implementation.
