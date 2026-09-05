# Apps, Routing and Composition

DOCUMENT_CLASS: HUMAN_DEVELOPMENT_GUIDE
PRODUCT_AUTHORITY: NONE

## App role

BThwani deployable apps are hosts, not business-domain owners.

Apps own route hierarchy, navigation, tabs/shell, deep links, cross-capability page composition, bootstrap/session binding, native adapters, app assets, build/deployable configuration and surface-specific feature presentation.

Services remain the business/data/contract owners. A feature screen living under an app does not make the app the business owner.

## Target hosts

- app-client
- app-partner
- app-captain
- app-field
- control-panel

A target host may be **host-ready but business-deferred**. Keep its deployable identity, auth/session bootstrap, shell/runtime/build valid without inventing placeholder Product screens.

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

## Feature placement

Surface-specific Product presentation starts under the consuming app's feature area (for example `src/features/<capability>`) and calls the canonical service public client/contract. Do not recreate `services/<service>/frontend/app-*` or a parallel app-shaped service UI tree.

Extract only proven domain-neutral visual reuse to the Design System. Do not create a runtime feature/journey registry merely to make routes appear automatically; file-based routing plus explicit navigation composition is the default.

## Account/Home/Settings/Search

Treat these as composition/information architecture by default. Do not create generic business domains for them without a proven stable responsibility.

## Notifications

Source business event remains source-domain truth; delivery/inbox mechanics are infrastructure/capability concerns; native push routing belongs to the app host.

## Search

Search results are derived. Search/index state does not authorize a mutation against stale/invalid owner truth.
