# BThwani Capability Governance Index

ARTIFACT_CLASS: DURABLE_PRODUCT_CAPABILITY_INDEX
SEMANTIC_OWNER: governance/product/CAPABILITIES.md
EXECUTION_AUTHORITY: NONE
CLOSURE_AUTHORITY: NONE
IMPLEMENTATION_STATE_AUTHORITY: NONE

## Purpose

This file owns the **capability taxonomy, semantic-envelope schema, admission/change law and routing only**. It does not restate individual capability semantics.

Each capability has exactly one semantic owner under `governance/product/capabilities/`. A capability ID may appear here only as routing identity.

## Target catalog versus active delivery

The capability catalog describes durable target Product meaning. It does not activate implementation breadth.

```text
TARGET_CAPABILITY_CATALOG != ACTIVE_PRODUCT_SLICE
CAPABILITY_LISTING != EXECUTION_AUTHORIZATION
CAPABILITY_SEMANTIC_OWNER != CURRENT_IMPLEMENTATION_STATE
```

The current invocation and Orchestrator determine which capability/increment is executable now.

## Capability semantic envelope

Every material capability owner defines, when applicable:

1. problem and required outcome;
2. primary actors/personas and responsibilities;
3. canonical owner/writer/readback;
4. required/excluded surfaces;
5. preconditions and trusted authorization scope;
6. durable states and legal/forbidden transitions;
7. data/contract/event/provider effects;
8. idempotency/concurrency/retry/unknown-result behavior;
9. security/privacy/financial invariants;
10. loading/empty/offline/forbidden/conflict/error/recovery semantics;
11. acceptance semantics and negative invariants.

## Capability-change law

A new capability or material capability change must prove a stable responsibility, canonical owner, affected actors/surfaces, legal state/mutation/readback semantics, authorization, failure/recovery behavior and acceptance expectations.

```text
ACTOR != CAPABILITY_OWNER
ROUTE != CAPABILITY_OWNER
SCREEN != CAPABILITY_OWNER
IMPLEMENTATION_MECHANISM != DOMAIN
```

Generic storage/search/transport mechanisms do not become Product capabilities without an independently proven Product lifecycle and responsibility.

## Canonical capability owners

- `capabilities/access-and-control.md` — `ADMINISTRATION_ROLES_APPROVALS_AUDIT`, `IDENTITY_ACTIVATION_SESSIONS`, `PLATFORM_SOVEREIGN_CONTROL_PLANE`, `CUSTOMER_PROFILE_PREFERENCES`
- `capabilities/commerce-and-serviceability.md` — `MAPS_SERVICE_AREA_ADDRESS_PRIVACY`, `ORDER_CREATION`, `SPECIAL_REQUESTS`, `SUPPORT_INCIDENTS_ORDER_RESCUE`, `ZONES_SLA_CAPACITY_DELIVERY_MODES`, `CART_CHECKOUT`
- `capabilities/partner-and-catalog.md` — `PARTNER_ONBOARDING_STORE_PUBLICATION`, `PARTNER_TEAM_MEMBERSHIP`, `CENTRAL_CATALOG`, `PROMOTIONS_COUPONS_FUNDING`, `RATINGS_REVIEWS_TRUST`, `MARKETING_CAMPAIGNS_LOYALTY`
- `capabilities/fulfillment-and-field.md` — `CAPTAIN_DISPATCH`, `PARTNER_FLEET_CONNECTION`, `STORE_CAPTAIN_HANDOFF`, `FIELD_OPERATIONS_ASSIGNMENT_READINESS`
- `capabilities/finance.md` — `REPRESENTATIVE_WALLETS_REFERENCE_FINANCE`, `SETTLEMENTS_COMMISSIONS`, `WLT_MONEY_MOVEMENT_PAYOUT_RECONCILIATION`, `WLT_PRICING_QUOTES`, `WLT_CAPTAIN_COLLATERAL`, `WLT_PROVIDER_PENALTIES`
- `capabilities/communications-and-insights.md` — `NOTIFICATIONS_COMMUNICATIONS`, `ANALYTICS_OPERATIONAL_READ_MODELS`

## Routing

Use source-derived lookup rather than loading every capability owner:

```text
pnpm knowledge:query -- list capabilities
pnpm knowledge:query -- capability <CAPABILITY_ID>
```
