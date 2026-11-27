# WLT client — serving reads and isolated decision integration

The [WLT OpenAPI entrypoint](../contracts/openapi/wlt.openapi.yaml) owns the
HTTP operations and financial response schemas. Consumers import the public
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
| `isolated-agreement-decision.ts` | Disposable local Merchant and Finance decision commands; exact receipt, rejection and uncertainty |
| `transport.ts` | Contract-bound reads and isolated decision exchange, verified response framing, one 12-second budget and cancellation |
| `generated/wlt-operations.ts` | Contract-derived method/path metadata; never edit manually |

## Admission and financial meaning

The shared transport admits only configured isolated HTTP origins on
`127.0.0.1` or `10.0.2.2` with an explicit valid port. It sends the opaque
bearer without cookies, rejects redirects and requires HTTP 200, JSON and
`Cache-Control: no-store` for successful reads. The direct owner sends
uncompressed JSON: contradictory length/transfer metadata and unsupported
encodings are rejected. A declared positive byte length must equal the
received UTF-8 representation. Streaming bodies are capped at 8,192 bytes
for funding history and 4,096 bytes for other reads; the same limits apply
when no length is declared. Cancellation or the single end-to-end budget
terminates the read, and the acquired reader owns cancellation and release.

The existing text-only Native bridge is checked for exact decoded UTF-8
length and the same limits, but cannot bound allocation before the bridge
returns or establish raw-wire validity. It does not prove device safety.
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

From the repository root, regenerate only after an authorized contract change:
`node tools/dev/generate-openapi-operations.mjs wlt`.

Verify generated metadata without changing files using
`node tools/dev/generate-openapi-operations.mjs --check wlt` and
`pnpm check:contracts`.

The generated operation metadata includes two isolated-only decision routes.
The explicit SDK entrypoints `recordIsolatedMerchantAgreementDecision` and
`recordIsolatedFinanceAgreementDecision` admit only a configured HTTP
`127.0.0.1` origin and exact Store, proposal version/operation identity,
decision operation identity and role-specific decision. The serving binary
still does not mount these routes. No app activation or new grant is implied.

The caller supplies and retains one operation ID and immutable payload.
A verified receipt binds Store, version, proposal operation and decision
operation, returning only `RECORDED` or `REPLAYED`. `WltDecisionError` distinguishes
`NOT_SENT` (local admission), `REJECTED` (the current request's verified owner
rejection) and `UNCONFIRMED` (including lost, malformed or mismatched replies).
A subsequent rejection does not resolve a previous unknown effect. The SDK
never retries automatically, generates a replacement identity or implies
activation. Reconcile uncertainty with the original owner using the same
identity and payload. Actual authorization remains exclusively in WLT and
its Identity/DSH dependencies.

Contract parity and transport tests do not prove live authorization,
persistence or journey acceptance; use the existing
[Go owner and disposable PostgreSQL suite](../backend/README.md)
for those claims.
