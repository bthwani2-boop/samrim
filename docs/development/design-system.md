# Design System Development

DOCUMENT_CLASS: HUMAN_DEVELOPMENT_GUIDE
EXECUTION_AUTHORITY: NONE
PRODUCT_SEMANTIC_AUTHORITY: NONE
CURRENT_IMPLEMENTATION_AUTHORITY: NONE

## Scope

The design system owns reusable visual tokens, primitives and interaction patterns that are truly cross-surface/cross-capability.

It must not own:

- domain/business state;
- permissions/authorization;
- financial logic;
- capability-specific validation;
- domain-specific translations/content policy;
- app routing/navigation.

## Journey-ready baseline

Before broad Product journeys, implement only the small domain-neutral primitives actually required across hosts: typography/text, button/input families, surface/container primitives, status/feedback, loading/empty/error/offline states, and modal/sheet/dialog behavior as real consumers require them.

Do not prebuild domain components such as OrderCard, StoreCard, WalletBalanceCard or CaptainAssignmentCard. Business components start with the consuming app feature and are extracted only after genuine reusable responsibility is proven.

## Contribution gate

Before adding a primitive/token:

1. prove reuse across more than one real consumer or a platform-wide design requirement;
2. define semantic purpose rather than page-specific naming;
3. preserve web/native boundaries where implementations differ;
4. verify RTL/LTR;
5. verify accessibility;
6. avoid introducing a second token/brand authority.

## Platform differences

A semantic design token may be shared while web/native component implementation remains platform-specific. Do not force one implementation abstraction where platform behavior differs materially.

## External reference and tooling route

Use `docs/reference/external-systems/experience-design-ui-assurance.md` only as non-authoritative evidence.

Preferred evaluation order:

~~~text
semantic token transformation → Style Dictionary candidate
web behavior primitives        → Base UI candidate
complex a11y/i18n cross-check  → React Aria reference
operator UX patterns           → Cloudscape / Saleor reference
component-state workbench      → Storybook candidate
web E2E/visual/ARIA            → Playwright candidate
automated accessibility        → axe-core candidate + mandatory manual evidence
mobile E2E                     → Maestro candidate
generic icons                  → Lucide candidate behind BThwani semantic icon API
~~~

Do not install any candidate merely because it appears in this guide. Dependency adoption remains governed by `governance/policies/standards-and-quality.md` and applicable architecture/security/delivery owners.

## Just-in-time component law

Grow the Design System from real active-slice consumers. A new reusable component/pattern is admitted only when its shared responsibility is proven; otherwise keep the presentation in the consuming app feature until reuse becomes real.

~~~text
REAL_CONSUMER_NEED
→ SMALLEST_DOMAIN_NEUTRAL_PRIMITIVE
→ STORY/STATE EVIDENCE
→ RTL/A11Y/DEVICE PROOF
→ REUSE

PREBUILD_FULL_COMPONENT_CATALOG = FORBIDDEN
~~~
