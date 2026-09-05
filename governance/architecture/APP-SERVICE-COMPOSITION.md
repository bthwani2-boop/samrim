# App and Service Composition

ARTIFACT_CLASS: DURABLE_ARCHITECTURE_GOVERNANCE
SEMANTIC_OWNER: governance/architecture/APP-SERVICE-COMPOSITION.md
EXECUTION_AUTHORITY: NONE

## App-host responsibility

Deployable apps own route hierarchy, navigation/tabs/shell, deep links, cross-capability page composition, bootstrap/session binding, native/OS adapters, app-specific assets, deployable/build configuration and host observability/error boundaries.

Apps do not own durable business, financial or authentication truth merely because they render it.

## Service capability responsibility

Services own stable capability semantics, business/system rules, canonical writers, durable state, service contracts/events and generated/public client lineage.

Surface-specific feature presentation is app-host responsibility by default. A host-neutral presentation abstraction may be extracted only after real multi-host reuse is proven, its owner is explicit, and it does not become a second business-truth authority or recreate app-shaped frontend trees inside a service.

```text
SURFACE_SPECIFIC_FEATURE_UI → APP HOST
SERVICE → BUSINESS SEMANTICS + CONTRACT + CLIENT LINEAGE
PREMATURE_SHARED_CAPABILITY_UI → FORBIDDEN
REAL_PROVEN_HOST_NEUTRAL_REUSE → EXTRACT_TO_SMALLEST_JUSTIFIED_OWNER
```

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

Control Panel is a deployable trusted operator host. It composes service-owned capabilities and may own operator navigation/shell, but it does not absorb Identity, DSH, WLT or Platform Control semantics into a generic administration domain.
