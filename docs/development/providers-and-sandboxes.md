# Development Providers and Sandboxes

DOCUMENT_CLASS: HUMAN_DEVELOPMENT_GUIDE
EXECUTION_AUTHORITY: NONE
PRODUCT_SEMANTIC_AUTHORITY: NONE
CURRENT_IMPLEMENTATION_AUTHORITY: NONE

CURRENT_PROVIDER_CONFIG_TRUTH_SOURCE: live repository configuration

## Core law

Development providers are replaceable implementations behind BThwani semantic boundaries.

- MANAGED_DEV_SERVICE != DOMAIN_AUTHORITY
- DEVELOPMENT_PROVIDER != REQUIRED_PRODUCTION_PROVIDER
- PROVIDER_NAME != BUSINESS_DOMAIN

## Identity and messaging

Identity owns OTP/challenge lifecycle. SMS/email/push are delivery channels.

Daily development should prefer a development OTP delivery sink. Real SMS delivery is used only when the test specifically requires channel E2E behavior.

Fixed universal OTPs are not a normal Identity mechanism. Raw OTP production logging is forbidden.

Messaging channel usage should prefer the cheapest/least intrusive channel that satisfies the Product requirement; do not use paid SMS for every development interaction.

## Privileged authentication

Control Panel/operator authentication should remain capable of stronger factors such as TOTP and Passkeys/WebAuthn when implemented.

## Financial rail simulator

Use deterministic simulator behavior for success, pending, rejection, timeout, unavailable, delayed result, duplicate callback/reference, invalid signature, unknown outcome and reconciliation mismatch.

WLT remains internal financial authority.

## Biller simulator

FinancialRail and BillerGateway are distinct. Biller simulation covers inquiry, subscriber/bill errors, recharge/bill fulfillment, duplicate request, provider float/balance errors, timeout/unknown/delayed result, quote change, reversal and reconciliation mismatch where supported.

Do not blind-retry an ambiguous fulfillment through another provider.

## Storage/maps/email/push

Use whichever configured development adapter is currently selected; it does not define the domain model.

## Sensitive data

General external development services receive synthetic/test data. Production PII/financial/identity data requires its approved environment/classification policy.

## OTP/SMS abuse protection

Development architecture must preserve the same anti-abuse boundary expected in production-facing Identity flows. A public OTP endpoint must never become an unlimited messaging-spend or brute-force surface.

Applicable controls include:

```text
PER-PHONE RATE/VELOCITY LIMIT
PER-IP RATE/VELOCITY LIMIT
PER-DEVICE RATE/VELOCITY LIMIT WHEN DEVICE SIGNAL EXISTS
COUNTRY/NUMBER POLICY
RESEND COOLDOWN
CHALLENGE ATTEMPT CAP
DAILY/PROVIDER SPEND LIMIT WHEN REAL PAID DELIVERY IS ENABLED
SINGLE ACTIVE OR EXPLICITLY SUPERSEDING CHALLENGE POLICY
RAW OTP NOT PERSISTED
RAW OTP NOT LOGGED IN PRODUCTION
```

Exact thresholds are runtime/policy configuration, not durable documentation constants. Local sinks/simulators must not bypass the challenge lifecycle, attempt counting or supersession semantics simply because they do not incur provider cost.
