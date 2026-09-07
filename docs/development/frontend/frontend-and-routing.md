# Frontend, App Hosts and Routing

DOCUMENT_CLASS: HUMAN_DEVELOPMENT_GUIDE
EXECUTION_AUTHORITY: NONE
PRODUCT_SEMANTIC_AUTHORITY: NONE
CURRENT_IMPLEMENTATION_AUTHORITY: NONE

## App-host role

BThwani deployable apps are composition hosts, not business-domain owners.

Apps own route hierarchy, navigation, shell/tabs, deep links, bootstrap/session binding, native adapters/assets, deployable configuration and surface-specific feature presentation. Services remain business/data/contract owners.

Target hosts are `app-client`, `app-partner`, `app-captain`, `app-field` and `control-panel`. A host may be technically ready while business-deferred; do not invent placeholder Product screens.

## Full-stack interaction contract

Frontend work starts from Product meaning and executable service contracts, not a mock screen.

For each material interaction verify:

```text
VISIBILITY/ENABLED STATE
→ ACTOR/ROLE/OBJECT SCOPE
→ INPUT VALIDATION
→ HANDLER BINDING
→ CANONICAL CAPABILITY OWNER
→ CONTRACT/API/EVENT CALL
→ LOADING/PENDING/DUPLICATE ACTION
→ OWNER EFFECT
→ PERSISTED/OBSERVABLE READBACK
→ ERROR/RETRY/RECOVERY
→ FINAL NAVIGATION/VISIBLE STATE
```

`RENDERED != WIRED`, `CLICKABLE != FUNCTIONAL`, `LOCAL_SUCCESS != PERSISTED_SUCCESS`.

Transient UI state must not become a second business state machine. Client validation improves UX but never replaces server/domain validation or authorization.

## Feature and route placement

Surface-specific Product presentation starts under the consuming app feature area and calls the canonical public service client/contract. A route/page/screen name never creates a capability.

Before adding a route, resolve capability/journey, owner, required loading/error/offline/authorization/readback states, deep-link/back behavior and applicable RTL/accessibility behavior.

Do not create runtime journey/feature registries merely to auto-discover routes when explicit/file-based composition is sufficient.

Account/Home/Settings/Search are composition/information architecture by default, not generic business domains.

## Control Panel

Control Panel is the trusted operator host, not Identity/DSH/WLT/Platform Control semantic authority.

Before an operator action, prove exact permission, server-side authorization scope, object/business scope, maker/checker separation when required, canonical mutation, conflict/version protection, audit event, canonical readback and failure/recovery semantics.

Financial read permission does not imply mutation/approval permission.

## Notifications and search

Business event truth remains with the source owner; notification inbox/preferences/topic/delivery-attempt records belong to the Notifications capability; transport adapters deliver channels; app host translates native/deep-link routing.

Search/index state is derived and cannot authorize mutation against stale owner truth.

## Accessibility and RTL

Arabic/RTL is first-class. Applicable web/mobile work must account for semantic labels, focus/keyboard behavior, large text, touch targets, directionality and platform constraints.
