# WLT client boundary

`@bthwani/wlt` is the read-only TypeScript consumer of the
[WLT OpenAPI contract](../contracts/openapi/README.md). The stable public
exports live in `index.ts`. No SDK function writes funds, authorizes
checkout, or activates an agreement.

| Module | Responsibility |
| --- | --- |
| `wallet-balance.ts` | Customer posted and available exact-YER balance |
| `funding-history.ts` | Customer funding history, reversals and bounded UTC keyset cursor |
| `order-payment-readback.ts` | Actor- and checkout-bound allocation/release readback |
| `commercial-agreement.ts` | Operator and owned Merchant Store proposal/review readback |
| `types.ts`, `errors.ts`, `validation.ts` | Shared DTOs, bounded errors and field/native-origin validation |
| `transport.ts` | Bounded read-only HTTP transport, cancellation and response admission |
| `generated/wlt-operations.ts` | Contract-derived method/path metadata; never hand-edit |

The transport sends the existing opaque bearer only to an isolated
loopback origin (or Android emulator host alias), rejects redirects,
requires JSON/no-store for success, bounds response size and does not
return a late response after cancellation. The parsers validate the
financial projection, scope and exact decimal amounts; missing or invalid
data fails closed. Funding history returns at most ten entries per page.
The allocation response distinguishes explicit absence from confirmed
allocation or release; absence does not authorize retry of an unknown write.

Native financial reads require an explicitly configured Android emulator
(`isDevice === false`) with distinct Identity and WLT origins on
`10.0.2.2`, before any session access. Physical Android devices, iOS and
invalid or absent configuration are not admitted. Web and admitted native
consumers must preserve the current Identity binding before and after the
read; the owner independently verifies actor/role and any required DSH
Store relation. Native cash-in remains unavailable.

Regenerate operation metadata with
`node tools/dev/generate-openapi-operations.mjs wlt`; verify it with the
same command using `--check`. Contract parity is not proof of live
authorization, persistence or journey acceptance.
