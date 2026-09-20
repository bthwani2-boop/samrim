# WLT

WLT is Samrim's canonical owner for payment intent and collection state.

The first slice is deliberately limited to cash on delivery. It provides an
internal, service-token protected API, append-only payment intent events,
idempotent mutations, optimistic version checks, and schema readback.

This service does not yet integrate an external card/mobile-money provider or
settle merchant/captain balances. Those responsibilities require the pricing
snapshot and settlement rules to be bound first; they must not be duplicated in
DSH or in a mobile application.

Endpoints:

- `POST /wlt/v1/payment-intents`
- `GET /wlt/v1/payment-intents/{intentId}`
- `POST /wlt/v1/payment-intents/{intentId}/collect`
- `POST /wlt/v1/payment-intents/{intentId}/cancel`

Health and readiness are available under `/wlt/health` and `/wlt/readiness`.
