# Development Providers and Sandboxes

DOCUMENT_CLASS: HUMAN_DEVELOPMENT_GUIDE
PRODUCT_AUTHORITY: NONE
CURRENT_PROVIDER_CONFIG_AUTHORITY: live repository configuration

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
