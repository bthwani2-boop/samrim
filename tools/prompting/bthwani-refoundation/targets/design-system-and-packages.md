# Target — Design System and Reusable Packages

TEMPORARY_TARGET_SPECIALIZATION: YES
GENERAL_EXECUTION_AUTHORITY: NONE
DURABLE_AUTHORITY: NONE
## 1. Demolish `shared/` as a generic ownership root

The current `shared/` root mixes unrelated responsibilities and must disappear after value migration.

Each child re-earns existence independently. Do not recreate the same dumping ground under `packages/common`, `packages/shared`, `packages/core`, `packages/client-runtime`, or similar generic names.

## 2. Refound UI Kit as Design System

Salvage valid visual primitives/tokens/components from `shared/ui-kit`, but do not move the subtree unchanged.

Canonical target package:

```text
packages/design-system/
```

This package is the canonical reusable visual-system authority for mobile apps, Control Panel, and future web/landing surfaces where applicable.

Conceptual structure:

```text
packages/design-system/
├── src/
│   ├── tokens/
│   │   ├── primitive/
│   │   └── semantic/
│   ├── themes/
│   ├── typography/
│   ├── icons/
│   ├── assets/
│   ├── primitives/
│   ├── components/
│   ├── patterns/
│   ├── accessibility/
│   └── platform/
│       ├── web/
│       └── native/
├── tests/
├── package.json
└── tsconfig.json
```

Do not create empty directories merely to match this illustration.

## 3. Visual identity law

Use semantic tokens as the stable app-facing authority.

```text
PRIMITIVE TOKENS
→ SEMANTIC TOKENS
→ THEME
→ COMPONENT/PATTERN
→ WEB/NATIVE RENDERING
```

Apps/services should not hardcode brand colors, typography scales, spacing systems, radius scales, elevation, or motion language where a canonical token exists.

One visual identity does not require identical implementation across platforms. Web and React Native may render differently while consuming the same semantic design language.

Brand identity assets and naming must have one canonical reusable source when truly shared; app-store/app-specific icon packaging may remain with the deployable app while deriving from approved brand assets.

## 4. Accessibility, directionality and responsive behavior

A unified visual system is not complete if it only unifies color/components.

The Design System must explicitly account for all applicable:

```text
RTL/LTR direction semantics
Arabic-first layout correctness where required
logical start/end spacing instead of accidental left/right coupling
accessible contrast
type scale/readability
screen-reader labels/roles/state semantics
keyboard/focus behavior on web
minimum touch targets on mobile
reduced-motion behavior
responsive/breakpoint semantics on web
safe-area/platform conventions on native
loading/empty/error/disabled/focus/pressed states
```

Directionality primitives/tokens must not be independently reimplemented by each app or Control Panel.

Accessibility semantics that belong to a domain action remain represented by the domain/presentation owner; the Design System supplies reusable accessible primitives/patterns.

## 5. Cohesion audit of current UI Kit

Large/mixed files such as current appearance/foundation/locales artifacts must be decomposed only by real responsibility.

Likely responsibilities to separate when evidence confirms:

```text
design tokens
theme resolution
appearance preference integration
platform rendering adapters
typography
localization of design-system-owned generic component strings
```

Do not split only to satisfy LOC thresholds; do not preserve God Files to avoid migration.

App-specific appearance preference persistence belongs to app/platform ownership unless a proven reusable technical package owns it; it must not become a second design-token authority.

## 6. Localization ownership

Design System may own only strings intrinsic to reusable components/patterns when necessary, for example generic accessibility/loading/control labels.

Domain/product strings stay with their semantic owner:

```text
Order delivered    → Order/DSH presentation owner
Wallet balance     → Wallet/WLT presentation owner
Captain suspended  → Workforce/DSH owner according to actual meaning
Store approval     → Store/Catalog owner according to actual meaning
```

Do not turn `locales.ts` into a repository-wide translation authority.

## 7. `shared/control-panel` disposition

Decompose by responsibility:

```text
generic visual primitives/components
→ packages/design-system

genuinely reusable admin/operator visual pattern
→ design-system pattern only if domain-neutral and multi-consumer-worthy

Control Panel shell/navigation/composition
→ apps/control-panel

service/domain-specific Control Panel presentation
→ services/<owner>/frontend/<capability>/presentation/control-panel
```

Misleading domain-shaped frames with no domain semantics (for example a finance-named frame that is only generic layout) must be renamed/absorbed or deleted rather than preserving historical names.

After cutover: `shared/control-panel` is absent.

## 8. `shared/data-runtime` disposition

Do not rename the current mixed package wholesale.

Census each responsibility separately:

```text
query client/provider/cache/persistence
connectivity
storage/sensitive storage
installation identity
power/battery policy
native adapters
mutation/idempotency scoping
```

For each determine:

```text
REAL_CONSUMERS
COHESION
PLATFORM_SPECIFICITY
SECURITY_SEMANTICS
CAN_APP_ROOT_OWN_IT_MORE_DIRECTLY
DOES_IT_DUPLICATE_IDENTITY_OR_DOMAIN AUTHORITY
```

Only create a reusable package when the package admission gate passes. App-specific native implementation belongs in the app. Security/session semantics belong to Identity. Rename ambiguous concepts such as mutation-identity scope when they actually describe idempotency/install scoping rather than identity authority.

## 9. Resilience disposition

Reliability behavior is required, but the current `shared/resilience` package is not automatically canonical merely because DSH/WLT import it.

Audit the current circuit breaker for:

```text
correct half-open concurrency behavior
context cancellation/timeouts
metrics/observability
failure classification
configuration semantics
test coverage
race safety
operation-specific policy separation
```

Then choose one:

```text
ADOPT_MATURE_LIBRARY_AND_DELETE_LOCAL_PACKAGE
REFOUND_MINIMAL_LOCAL_PACKAGE_WITH_PROVEN_UNIQUE_VALUE
ABSORB_SMALL_MECHANISM_INTO_INTEGRATION OWNER IF REUSE_DOES_NOT_JUSTIFY_PACKAGE
```

Retry/fallback/financial reconciliation policy must remain with the operation/integration owner, not in a one-size-fits-all resilience package.

## 10. Package admission gate

Every package under `packages/` must prove:

```text
COHESIVE_TECHNICAL_RESPONSIBILITY
MULTIPLE_REAL_CONSUMERS_OR_INDEPENDENT_REUSE_JUSTIFICATION
NO_BUSINESS_TRUTH
NO_SERVICE_PRIVATE_INTERNAL_IMPORTS
NO_APP_PRIVATE_INTERNAL_IMPORTS
STABLE_PUBLIC_API
TESTABLE_IN_ISOLATION
NAME_DESCRIBES_ACTUAL_RESPONSIBILITY
```

## 11. Design-system verification and prevention

As applicable verify:

```text
token uniqueness / no duplicate semantic brand authority
web typecheck/build
native typecheck/build
RTL/LTR representative rendering
accessible-state behavior
responsive representative rendering
component/pattern contract tests
visual regression or screenshot evidence for material reusable primitives/patterns
no direct hard-coded brand-system drift in consumers where canonical tokens exist
```

Visual regression snapshots are evidence, not design truth. Obsolete snapshots tied to losing topology must be deleted/rebaselined only after the canonical visual behavior is proven.

## 12. Exit gate

```text
shared/=ABSENT
shared/ui-kit=ABSENT
shared/control-panel=ABSENT
shared/data-runtime=ABSENT
shared/resilience=ABSENT
DESIGN_SYSTEM_HAS_ONE_SEMANTIC_TOKEN_AUTHORITY
DUPLICATE_BRAND_TOKEN_SYSTEMS=0
GENERIC_PACKAGE_DUMPING_GROUNDS=0
BUSINESS_TRUTH_IN_packages=0
APP_SPECIFIC_NATIVE_CODE_IN_GENERIC_PACKAGE=0
DOMAIN_TRANSLATIONS_IN_DESIGN_SYSTEM=0
MISLEADING_CONTROL_PANEL_FRAME_NAMES=0
UNJUSTIFIED_LOCAL_RESILIENCE_PACKAGE=0
DUPLICATE_RTL/DIRECTION_SYSTEMS=0
MATERIAL_ACCESSIBILITY_GAPS_IN_REUSABLE_COMPONENTS=0
UNCONTROLLED_HARDCODED_BRAND_STYLE_DRIFT=0
```
