# WLT OpenAPI - isolated development reads

[wlt.openapi.yaml](wlt.openapi.yaml) is the single owner entrypoint.
The serving API exposes GET only. Its six operations are split by
responsibility; common schemas and the opaque-session security scheme
remain in the entrypoint.

| Path fragment | Operation and scope |
| --- | --- |
| [runtime.yaml](paths/runtime.yaml) | `GET /health`: development PostgreSQL and container-mode Identity reachability; no finance readiness claim |
| [wallets.yaml](paths/wallets.yaml) | `GET /v1/wallets/me`: current Customer posted and available balance |
| [wallets.yaml](paths/wallets.yaml) | `GET /v1/wallets/me/transactions`: current Customer bounded funding history |
| [payment-intents.yaml](paths/payment-intents.yaml) | `GET /v1/wallets/me/order-payment-allocations/{checkoutID}`: current Customer exact allocation/release or explicit absence |
| [commercial-agreements.yaml](paths/commercial-agreements.yaml) | `GET /v1/merchants/stores/{storeID}/commercial-agreement`: current Merchant and DSH-owned Store relation |
| [commercial-agreements.yaml](paths/commercial-agreements.yaml) | `GET /v1/operators/stores/{storeID}/commercial-agreement`: current Operator with explicit Identity finance grant |

Protected operations recheck the required current Identity/DSH scope after
reading owner data. The contract uses exact whole-YER decimal text;
the documented states and response schemas distinguish funding, reserved
availability, allocations/releases and agreement review. No write,
effective-agreement activation, confirmed Order, captured payment or
external settlement is authorized by a read. Unknown checkout and
another actor's checkout produce the same absence result.

Run `pnpm check:contracts` and
`node tools/dev/generate-openapi-operations.mjs --check wlt`.
The [Go owner](../../backend/README.md) and disposable PostgreSQL
owner suite provide implementation and integration evidence separately.
Do not recreate retired empty contract fragments or introduce an alternate
contract owner.
