# WLT

WLT is Samrim's canonical owner for payment intent and collection state.

WLT owns cash-on-delivery and cash-at-store payment collection. It provides an
internal, service-token protected API, append-only payment intent events,
idempotent mutations, optimistic version checks, schema readback, and separate
financial treatment for Captain COD custody and Partner store-collected cash commission
receivables. Store proceeds remain with the Partner; the platform commission is
offset against later eligible Partner earnings or settled by a verified direct
Partner remittance.

This service does not integrate an external card/mobile-money provider.
Collection, Partner commission receivables, earning offsets, and verified
remittance readback remain canonical here; they must not be duplicated in DSH
or in a mobile application. Captain cash remittance is a custody closure, not a
merchant payout or a platform settlement.

Endpoints:

- `POST /wlt/v1/payment-intents`
- `GET /wlt/v1/payment-intents/{intentId}`
- `POST /wlt/v1/payment-intents/{intentId}/collect`
- `POST /wlt/v1/payment-intents/{intentId}/cancel`
- `GET /wlt/v1/captains/{captainActorId}/cash-liability`
- `GET /wlt/v1/operator/cash-liability` (server-side search, sort, and cursor pagination)
- `POST /wlt/v1/payment-intents/{intentId}/remit`
- `POST /wlt/v1/partner-store-cash-commissions/finalize`
- `POST /wlt/v1/operator/partners/{partnerActorId}/commission-remittances`

Health and readiness are available under `/wlt/health` and `/wlt/readiness`.
