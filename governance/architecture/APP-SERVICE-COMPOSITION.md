# App and Service Composition

ARTIFACT_CLASS: DURABLE_ARCHITECTURE_GOVERNANCE
SEMANTIC_OWNER: governance/architecture/APP-SERVICE-COMPOSITION.md
EXECUTION_AUTHORITY: NONE
CLOSURE_AUTHORITY: NONE
IMPLEMENTATION_STATE_AUTHORITY: NONE

## Ownership boundary

This file is the **sole durable semantic owner** of the deployable-app-host versus service-capability responsibility split. Other Governance files may route here but must not restate the rule as a competing owner.

## App-host responsibility

Deployable apps own route hierarchy, navigation/tabs/shell, deep links, cross-capability page composition, bootstrap/session binding, native/OS adapters, app-specific assets, deployable/build configuration and host observability/error boundaries.

Apps do not own durable business, financial or authentication truth merely because they render it.

## Service capability responsibility

Services own stable capability semantics, business/system rules, canonical writers, durable state, service contracts/events and generated/public client lineage.

Surface-specific composition is app-host responsibility by default. A service may expose a reusable presentation client for its own bounded-context workflow only when the repository proves all of the following:

- multiple real deployable hosts consume the same interaction semantics;
- the presentation module is reached only through the service's public client boundary;
- it owns no route tree, navigation shell, deep-link policy, native/OS configuration, deployable identity or app-specific asset authority;
- it owns no canonical business/authentication truth, persistence, authorization decision or hidden fallback state machine;
- host-specific labels/adapters are injected rather than inferred from app-private internals;
- keeping the reusable client with the bounded-context owner creates less total duplication and coupling than copying the flow into every host.

This is a public presentation client, not ownership of the deployable app. It may live under `services/<owner>/clients/presentation` when the bounded-context owner and consumers above are proven. A separate `packages/*` workspace is not required merely to make reused code look shared, and a package must not be introduced when it only renames the same bounded-context ownership.

```text
SURFACE_SPECIFIC_APP_COMPOSITION → APP HOST
PROVEN_BOUNDED_CONTEXT_PRESENTATION_CLIENT → SERVICE PUBLIC CLIENT BOUNDARY
GENERIC_CROSS_DOMAIN_PRESENTATION_PRIMITIVE → DESIGN SYSTEM / PROVEN TECHNICAL PACKAGE
PREMATURE_SHARED_CAPABILITY_UI → FORBIDDEN
COPYING_IDENTICAL_DOMAIN_FLOW_ACROSS_HOSTS → FORBIDDEN_WHEN_ONE_PUBLIC_CLIENT_CAN_OWN_IT
```

## Canonical composition law

- `WHERE_IT_APPEARS != WHO_OWNS_IT`
- `APP_HOST != BUSINESS_CAPABILITY_OWNER`
- `APP → SERVICE_PUBLIC_CLIENT/CONTRACT = ALLOWED`
- `APP → SERVICE_PRIVATE_INTERNAL = FORBIDDEN`
- `SERVICE_RUNTIME → APP_HOST = FORBIDDEN`

Home, Account, Settings, aggregate Search and similar app sections are composition/information architecture by default, not business bounded contexts.

## Notifications

Notification responsibility is split:

- source business event/eligibility → originating domain;
- inbox/preferences/topic configuration/delivery-attempt records → DSH Notifications capability under the current durable model;
- vendor/channel execution → replaceable delivery adapter;
- OS push/deep-link/native route translation → app host.

No app, channel adapter or generic notification infrastructure may become source-domain truth. A future independent notification service requires normal service-admission evidence and explicit rehoming; it is not inferred from multi-channel delivery.

## Search

Search/query infrastructure is derived. The owning domain remains authoritative for eligibility and mutation decisions.

- `SEARCH_INDEX != SOURCE_DOMAIN`
- `SEARCH_RESULT != AUTHORIZATION`

## Control Panel

Control Panel is a deployable trusted operator host. It composes service-owned capabilities and may own operator navigation/shell, but it does not absorb Identity, DSH, WLT or Platform Control semantics into a generic administration domain.
