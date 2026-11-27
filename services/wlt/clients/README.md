# WLT read-only client

The [WLT OpenAPI contract](../contracts/openapi/README.md) owns the HTTP
operations and financial response schemas. Consumers import the public
TypeScript API from `@bthwani/wlt` (`index.ts`). WLT alone selects and writes
financial facts: this SDK does not write funds, authorize checkout, activate
agreements or settle payments.

## Client modules

| Module | Responsibility |
| --- | --- |
| `wallet-balance.ts` | Current Customer posted and available exact-YER balance |
| `funding-history.ts` | Current Customer funding history, reversals and bounded UTC keyset cursor (at most ten entries per page) |
| `order-payment-readback.ts` | Actor- and checkout-bound allocation/release or explicit absence |
| `commercial-agreement.ts` | Operator and owned Merchant Store agreement proposal/review readback |
| `types.ts`, `errors.ts`, `validation.ts` | Shared DTOs, bounded errors and field/native-origin validation |
| `transport.ts` | Read-only HTTP admission, one 12-second budget and cancellation |
| `generated/wlt-operations.ts` | Contract-derived method/path metadata; never edit manually |

## Admission and financial meaning

The transport admits only configured isolated HTTP origins on `127.0.0.1`
or `10.0.2.2` with an explicit valid port. It sends the opaque bearer
without cookies, rejects redirects and requires HTTP 200, JSON and
`Cache-Control: no-store` for successful reads. A caller cancellation or
the end-to-end budget terminates the read. Streaming bodies are capped at
8,192 bytes for funding history and 4,096 bytes for other reads. The
existing text-only bridge bounds decoded size, not pre-buffer allocation;
this compatibility path does not prove native runtime safety.

Parsers validate scope, response shape and exact whole-YER decimal amounts.
An absent allocation is not permission to replay an uncertain write.
Native financial reads require an explicitly configured Android emulator
(`isDevice === false`) with distinct Identity and WLT origins on
`10.0.2.2` before session access. Physical Android, iOS and invalid or
absent configuration are not admitted. Web and admitted native consumers
preserve current Identity binding before and after the read; the owner
independently verifies actor/role and required DSH Store relation. Native
cash-in remains unavailable.

## Contract maintenance

From the repository root, regenerate only after an authorized contract
change:

```sh
node tools/dev/generate-openapi-operations.mjs wlt
```

Verify generated metadata without changing files:

```sh
node tools/dev/generate-openapi-operations.mjs --check wlt
pnpm check:contracts
```

The generator requires `--check` before the owner argument. Contract parity
does not prove live authorization, persistence or journey acceptance; use
the existing [Go owner and disposable PostgreSQL suite](../backend/README.md)
for those claims.
