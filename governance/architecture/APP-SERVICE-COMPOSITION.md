# App and Service Composition

ARTIFACT_CLASS: DURABLE_ARCHITECTURE_GOVERNANCE
SEMANTIC_OWNER: governance/architecture/APP-SERVICE-COMPOSITION.md
EXECUTION_AUTHORITY: NONE

## App-host responsibility

Deployable apps own route hierarchy, navigation/tabs/shell, deep links, cross-capability page composition, bootstrap/session binding, native/OS adapters, app-specific assets, deployable/build configuration and host observability/error boundaries.

Apps do not own durable business, financial or authentication truth merely because they render it.

## Service capability responsibility

Services own stable capability semantics, business/system rules, canonical writers, durable state, service contracts/events, generated client lineage and reusable capability presentation where justified.

## Composition law

- `WHERE_IT_APPEARS != WHO_OWNS_IT`
- `APP_HOST != BUSINESS_CAPABILITY_OWNER`
- `SERVICE → APP = FORBIDDEN`
- `APP → SERVICE_PUBLIC_ENTRYPOINT = ALLOWED`

Home, Account, Settings, aggregate Search and similar app sections are composition/information architecture by default, not business bounded contexts.

## Notifications

Notification responsibility is split:

- source business event → source domain;
- delivery/inbox mechanics → notification delivery capability/adapter;
- OS push/native route → app host.

No app or generic notification infrastructure may become source-domain truth.

## Search

Search/query infrastructure is derived. The owning domain remains authoritative for eligibility and mutation decisions.

- `SEARCH_INDEX != SOURCE_DOMAIN`
- `SEARCH_RESULT != AUTHORIZATION`

## Control Panel

Control Panel is a deployable trusted operator host. It composes service-owned capabilities and may own operator navigation/shell, but it does not absorb Identity, Workforce, DSH, WLT or Platform Control semantics into a generic administration domain.
