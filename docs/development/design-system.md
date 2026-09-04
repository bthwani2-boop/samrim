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
