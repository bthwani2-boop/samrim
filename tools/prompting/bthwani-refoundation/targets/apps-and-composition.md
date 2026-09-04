# Target — Apps and Application Composition

TEMPORARY_TARGET_SPECIALIZATION: YES
GENERAL_EXECUTION_AUTHORITY: NONE
DURABLE_AUTHORITY: NONE
## 1. Canonical app roots

Refound deployables so each app is a direct workspace root:

```text
apps/app-client/
apps/app-partner/
apps/app-captain/
apps/app-field/
apps/control-panel/
```

Current `apps/<app>/runtime/` is a losing pass-through layer when the parent owns no independent sibling responsibility and `runtime/` contains the actual Expo/Next package/build files.

Migration pattern:

```text
CENSUS_PARENT_AND_RUNTIME_CONTENT
→ PROVE_PARENT_HAS_NO_SEPARATE_BOUNDARY
→ MOVE_RUNTIME_CONTENT_TO_apps/<app>/
→ UPDATE_WORKSPACE/SCRIPTS/CI/EAS/NX/TSCONFIG/TOOLS
→ RENAME_PACKAGE_FROM_*runtime_WHERE_APPLICABLE
→ DELETE_runtime_PARENT_LAYER
→ PROVE_BTHWANI_OLD_APP_RUNTIME_PATH_REACHABILITY=0
```

For Control Panel, classify any helper scripts outside `runtime` separately; app-start helper code may stay at app root only if app-owned, otherwise move to appropriate `tools/` ownership before flattening.

### 1.1 Deployable identity invariants during path flattening

A repository path refoundation must not accidentally create a new mobile application identity or detach the app from its existing build/update/credential lineage.

Before and after flattening every Expo app, explicitly inventory and preserve or intentionally migrate all applicable identity/configuration facts:

```text
Expo projectId / EAS project association
slug/owner when material
Android applicationId/package
Android signing/credential association
iOS bundleIdentifier
iOS signing/credential association
URL scheme/deep-link identity
runtimeVersion/update URL/update channel semantics
EAS build/update workflow project-root assumptions
app store identity where already established
notification/native entitlement identifiers
Sentry/observability project binding where app-specific
```

Changing `apps/<app>/runtime` to `apps/<app>` is a repository topology change, not permission to generate a new EAS project, package ID, bundle ID, signing identity, update lineage, or app-store identity.

For Control Panel and other web hosts, preserve or intentionally migrate all applicable deployment identity, environment-variable ownership, route/base-path, build-root, hosting-project, and observability bindings.

Required cutover proof:

```text
OLD_PROJECT_ROOT_REFERENCES=0
DEPLOYABLE_IDENTITY_UNINTENTIONAL_CHANGE=0
EAS/BUILD/UPDATE_BINDINGS=PASS
NATIVE_PACKAGE/BUNDLE_IDENTIFIERS=EXPECTED
DEEP_LINK/SCHEME_BINDINGS=EXPECTED
```

Whether a remote rebuild/update is required is an execution-time consequence of the actual native/config/fingerprint delta and release mechanism; never infer it solely from the folder move.

## 2. Host ownership

Apps own:

```text
Expo Router / Next route tree
navigation/deep links
tabs/shell/application composition
cross-capability page layout/composition
bootstrap and session binding
native permissions and OS integration
SecureStore/keychain/browser adapter binding
push-token/native notification adapter
app-specific icons/splash/assets
Expo/Next/Metro/EAS/build config
host observability wiring
```

Apps do not own canonical business truth, financial truth, auth/session semantics, serviceability, allowed actions, domain status machines, or provider execution semantics.

## 3. Route/composition matrix

### Account

`account` is Information Architecture by default.

An Account route may compose:

```text
Identity/Profile
DSH/address
WLT/wallet
Notification inbox/preferences
Support
other proven owners
```

It owns ordering/navigation/layout/transient interaction only. Do not create `account-wallet`, `account-finance`, or `services/dsh/frontend/account` as second authorities.

### Home

Home is app composition. It may compose Store, Catalog, Marketing, Promotion, Order, Special Request, Recommendation, etc. Do not preserve `home-discovery` solely because discovery-like content appears on Home.

An independent recommendation/discovery capability is admitted only with proven stable ranking/personalization/candidate-generation/signals/model-or-index lifecycle ownership.

### Settings

Settings is usually composition:

```text
appearance/theme          → app preference binding + design-system token/theme authority
language                  → localization owner
notification preferences  → notification owner
security/session           → Identity
payment preference         → WLT/payment or actual financial owner
delivery preference        → relevant DSH owner
privacy/data control       → canonical privacy/data owner
```

### Search

Domain search belongs to its domain:

```text
catalog search    → DSH/catalog
store search      → DSH/store
order search      → DSH/order
payment search    → WLT/payment
settlement search → WLT/settlement
```

An aggregate Search route may compose result providers but cannot own their ranking/filter/business semantics. A standalone Search service requires proof of independent index/ranking/query lifecycle.

## 4. Login/authentication

App owns:

```text
/login route
/auth-callback route
splash/bootstrap navigation
SecureStore/native binding
deep-link callback handling
post-auth host navigation
```

Identity owns:

```text
authentication
OTP/code verification
credentials
session create/refresh/revoke
actor identity
roles/permissions
security-sensitive device/session authorization
```

Reusable login UI/controller may live with Identity when truly reused; host-specific shell/branding/callback wiring stays in the app.

No DSH/WLT/app-local authentication authority may duplicate Identity.

## 5. Notifications

Split responsibilities:

```text
SOURCE BUSINESS EVENT
→ source domain remains owner

INBOX/PREFERENCES/TOPIC/DELIVERY-ATTEMPT STATE
→ DSH Notifications capability

OS PUSH PERMISSION/TOKEN/RECEIVE/NAVIGATION
→ app host
```

Examples:

```text
ORDER_DELIVERED  → DSH/order fact
PAYMENT_FAILED   → WLT/payment fact
REFUND_COMPLETED → WLT/refund fact
```

A notification owner may expose semantic navigation targets; the app translates them to host routes. Do not store app route strings as durable business semantics.

DSH Notifications is the current semantic owner for inbox/preferences/topic/delivery-attempt records. If future executable evidence proves a genuinely independent cross-service notification service boundary, rehome that responsibility through normal service admission rather than creating `shared/notifications`.

## 6. DSH app-shaped losers

Current DSH app-shaped implementation/export forms are transitional losers after value migration:

```text
services/dsh/frontend/app-client
services/dsh/frontend/app-partner
services/dsh/frontend/app-captain
services/dsh/frontend/app-field
services/dsh/frontend/control-panel

@bthwani/dsh/app-client
@bthwani/dsh/app-partner
@bthwani/dsh/app-captain
@bthwani/dsh/app-field
@bthwani/dsh/control-panel
```

Treatment:

```text
CENSUS_FEATURE_VALUE
→ MOVE_DOMAIN/PRESENTATION_TO_SERVICE_CAPABILITIES
→ MOVE_ROUTE/NAV/PLATFORM/COMPOSITION_TO_APP_ROOT
→ UPDATE_IMPORTS/EXPORTS/ROUTES
→ DELETE_APP_SHAPED_SERVICE_CONTAINER
→ DELETE_APP_SHAPED_EXPORT
→ PROVE_OLD_PATH=0
```

The app composes semantic exports such as DSH Order/Store/Checkout and WLT Wallet/Payment rather than importing a monolithic `Dsh*Application`.

## 7. Control Panel

Control Panel is a deployable host, not a shared service/package.

```text
navigation/shell/app composition → apps/control-panel
reusable design primitives        → packages/design-system
DSH-specific presentation         → services/dsh/frontend/<capability>/presentation/control-panel
WLT-specific presentation         → services/wlt/frontend/<capability>/presentation/control-panel
Identity/Workforce/Platform UI    → their canonical frontend capability owners when reusable
```

## 8. App closure gate

No app is structurally closed while any known instance remains of:

```text
PASS_THROUGH_runtime_LAYER
*runtime_PACKAGE_NAME_WITHOUT_REAL_RUNTIME_PACKAGE_BOUNDARY
SERVICE_OWNS_MONOLITHIC_APP_COMPOSITION
SERVICE→APP_IMPORT
APP_OWNS_BUSINESS_OR_FINANCIAL_TRUTH
LOCAL_AUTHORITY_DUPLICATING_IDENTITY
ACCOUNT/HOME/SETTINGS_AS_FALSE_DOMAINS
GENERIC_SEARCH_AS_FALSE_DOMAIN
NATIVE_ADAPTER_MISOWNED_BY_DOMAIN
APP_SHAPED_DSH_EXPORTS
OLD_WORKSPACE/EAS/CI/SCRIPT_PATHS
UNINTENTIONAL_EAS_PROJECT_IDENTITY_CHANGE
UNINTENTIONAL_ANDROID_PACKAGE_CHANGE
UNINTENTIONAL_IOS_BUNDLE_ID_CHANGE
BROKEN_UPDATE/DEEPLINK/SIGNING/OBSERVABILITY_BINDINGS
```
