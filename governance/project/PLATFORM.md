# BThwani Platform Orientation

ARTIFACT_CLASS: DURABLE_PROJECT_GOVERNANCE
SEMANTIC_OWNER: governance/project/PLATFORM.md
EXECUTION_AUTHORITY: NONE
IMPLEMENTATION_STATE_AUTHORITY: NONE

## Platform classification

BThwani is one BThwani-operated unified multi-surface B2B2C commerce, fulfillment, operations and financial platform.

It is not a collection of independent apps, not a separate platform instance per partner/store and not a generic multi-tenant SaaS abstraction by default.

## Primary deployable surfaces

- `app-client` — customer-facing mobile host.
- `app-partner` — partner/store-facing mobile host.
- `app-captain` — captain/delivery mobile host.
- `app-field` — field-operations mobile host.
- `control-panel` — trusted operator web host.

Surfaces compose capabilities; they do not own domain truth merely because a capability is rendered there.

## Primary actors

Customer, Partner, Captain, Field worker, Operator, plus system/service actors where required.

Captain affiliation may be BThwani-affiliated or partner-affiliated. Affiliation, authentication identity, operational role and financial identity are separate facts.

## Fulfillment policy modes

- `BTHWANI_DELIVERY`
- `PARTNER_DELIVERY`
- `CLIENT_PICKUP`

A lower-level fleet/operational arrangement does not create an additional fulfillment policy mode unless Product governance explicitly introduces one.

## Partner commercial models

- `COMMISSION`
- `SUBSCRIPTION`
- `HYBRID`
- `OPERATOR_MANAGED`

A subscription is a pricing/billing relationship only. It does not create an independent platform instance or isolation authority.

## Geographic/service-area model

The primary operating market is Sana'a, Yemen. City/zone/serviceability is governed data and Product policy, not a hard-coded platform instance or tenant boundary. Expansion to additional cities must reuse the same ownership/contracts unless a real new Product boundary is approved.

## Bounded contexts

- Identity — authentication/session/activation/identity authority.
- DSH — commerce, catalog consumption, partner/store operations, checkout/order, serviceability, dispatch/delivery, special requests, support/rescue and other operational truth assigned by Product.
- WLT — wallet, ledger, payment, refund, commission, payout, settlement and reconciliation authority.
- Platform Control — admitted semantic control-plane responsibility for explicitly assigned platform-wide governed configuration/change/rollout facts; independent deployable-service admission remains conditional on executable lifecycle/persistence/API/runtime evidence.

External vendors and technical mechanisms are integrations/adapters, not business-domain owners.

## Cross-cutting capability classes

Some capabilities cross several bounded contexts without becoming new sovereign domains by default:

- customer profile/preferences, partner-team operations, catalog/publication, ratings/reviews, support and commerce eligibility remain assigned DSH operational capabilities unless Governance explicitly rehomes them;
- promotions/coupons can span DSH eligibility and WLT financial effect while retaining one owner per fact;
- notification source-event meaning remains with the originating domain; DSH Notifications owns current inbox/preferences/topic/delivery-attempt truth; replaceable adapters execute channels; media business authorization remains with its owning domain while object storage is technical infrastructure;
- search/discovery and analytics are derived/query capabilities and never become authorization, transactional or financial truth;
- external providers remain adapters behind the operation-owning domain; Platform Control may govern configuration/rollout but does not execute unrelated domain semantics.

## Core non-conflation laws

```text
ACTOR != ROLE
ROLE != ORGANIZATION
ORGANIZATION != AUTHORIZATION_SCOPE
PARTNER != TENANT_BY_DEFAULT
STORE != TENANT_BY_DEFAULT
OPERATOR_CONTEXT != TENANT
APP_HOST != BUSINESS_CAPABILITY_OWNER
PROVIDER != BUSINESS_DOMAIN
```
