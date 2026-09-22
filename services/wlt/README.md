# WLT

WLT is Samrim's canonical owner for payment intent and collection state.

The first slice is deliberately limited to cash on delivery. It provides an
internal, service-token protected API, append-only payment intent events,
idempotent mutations, optimistic version checks, schema readback, and the
captain cash-custody closure: a collected COD intent becomes an outstanding
liability for the collecting captain until one exact remittance is recorded.

This service does not yet integrate an external card/mobile-money provider or
settle merchant/platform balances. Those responsibilities require the pricing
snapshot, commission, and settlement rules to be bound first; they must not be
duplicated in DSH or in a mobile application. Captain cash remittance is a
custody closure, not a merchant payout or a platform settlement.

Endpoints:

- `POST /wlt/v1/payment-intents`
- `GET /wlt/v1/payment-intents/{intentId}`
- `POST /wlt/v1/payment-intents/{intentId}/collect`
- `POST /wlt/v1/payment-intents/{intentId}/cancel`
- `GET /wlt/v1/captains/{captainActorId}/cash-liability`
- `GET /wlt/v1/operator/cash-liability`
- `POST /wlt/v1/payment-intents/{intentId}/remit`

Health and readiness are available under `/wlt/health` and `/wlt/readiness`.
