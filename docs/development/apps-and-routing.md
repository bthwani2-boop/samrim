# Apps, Routing and Composition

DOCUMENT_CLASS: HUMAN_DEVELOPMENT_GUIDE
PRODUCT_AUTHORITY: NONE

## App role

BThwani deployable apps are hosts, not business-domain owners.

Apps own route hierarchy, navigation, tabs/shell, deep links, cross-capability page composition, bootstrap/session binding, native adapters, app assets and build/deployable configuration.

## Required hosts

- app-client
- app-partner
- app-captain
- app-field
- control-panel

## Adding a route/screen

Before adding a route:

1. identify the capability/journey it serves;
2. verify which service owns the semantics;
3. define required loading/error/offline/authorization/readback states;
4. use the service public capability entrypoint/client;
5. keep mutations/readback canonical;
6. verify navigation/deep-link/back behavior;
7. verify RTL/accessibility;
8. verify all cross-surface consumers affected by the same mutation.

A route/page/screen name does not create a capability.

## Account/Home/Settings/Search

Treat these as composition/information architecture by default. Do not create generic business domains for them without a proven stable responsibility.

## Notifications

Source business event remains source-domain truth; delivery/inbox mechanics are infrastructure/capability concerns; native push routing belongs to the app host.

## Search

Search results are derived. Search/index state does not authorize a mutation against stale/invalid owner truth.
