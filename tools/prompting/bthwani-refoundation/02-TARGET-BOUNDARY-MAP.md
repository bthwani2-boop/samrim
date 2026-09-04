# Target Boundary Map

TEMPORARY_TARGET_SPECIALIZATION: YES
GENERAL_LAW_AUTHORITY: NONE

## Purpose

Apply the durable orchestrator architecture/data/product laws to BThwani-specific boundaries without redefining those laws.

## Identity

Identity owns actor authentication, credentials, sessions, activation, roles/permissions and trusted identity context. It does not own workforce engagement, DSH operational assignment or WLT financial truth.

## Workforce

Workforce owns person/engagement/workforce status/eligibility/evidence. Captain/field operational roles may consume Workforce truth but do not create separate identity systems.

## DSH

DSH owns commerce/partner/store/order/serviceability/dispatch/delivery/support and other assigned operational truth. DSH may consume WLT/Identity/Workforce facts through contracts but cannot become their writer.

## WLT

WLT owns wallet, ledger, payment, refund, commission, payout, settlement, reconciliation and COD financial exposure. DSH/apps may expose bounded projections/readback only.

## Platform Control

Platform Control owns explicitly admitted platform-wide configuration/change/rollout control-plane facts. It may not become a generic domain-data execution or provider god service.

## Apps

Apps are deployable hosts/composition owners: routes, navigation, shell/tabs, deep links, native adapters, app assets/build identity and cross-capability page composition.

```text
WHERE_IT_APPEARS != WHO_OWNS_IT
APP_HOST != BUSINESS_CAPABILITY_OWNER
```

## Design system

Design System owns reusable visual tokens/primitives/patterns. It does not own business copy/state/validation/permissions or domain translations.

## Contracts

Service-owned business contracts remain sovereign. Root `contracts/` contains only genuinely cross-service protocol primitives/catalog material and cannot become a parallel business API authority.

## External integrations

The operation-owning domain expresses a semantic port; adapters implement vendors/channels.

```text
VENDOR != DOMAIN
FINANCIAL_RAIL != BILLER_GATEWAY
OTP_ENGINE != SMS_PROVIDER
SEARCH_INDEX != SOURCE_DOMAIN
```

## Dependency exit gate

- service → app dependencies = 0;
- package → service business internals = 0;
- generic provider business authority = 0;
- duplicate mutable writers = 0;
- app-owned domain truth = 0;
- cross-service facts have one canonical owner/writer and explicit derived status.
