# Design System Development

DOCUMENT_CLASS: HUMAN_DEVELOPMENT_GUIDE
PRODUCT_AUTHORITY: NONE

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
