# Design System Development

DOCUMENT_CLASS: HUMAN_DEVELOPMENT_GUIDE
EXECUTION_AUTHORITY: NONE
PRODUCT_SEMANTIC_AUTHORITY: NONE
CURRENT_IMPLEMENTATION_AUTHORITY: NONE

## Scope

The Design System owns reusable visual tokens, domain-neutral primitives and interaction patterns proven across real consumers. It must not own business state, authorization, financial logic, capability validation, domain content policy or app routing.

Before broad Product journeys, implement only domain-neutral primitives actually required across hosts: typography/text, button/input families, surface/container primitives, status/feedback, loading/empty/error/offline states, and modal/sheet/dialog behavior as real consumers require them.

Do not prebuild domain components such as OrderCard, StoreCard, WalletBalanceCard or CaptainAssignmentCard.

## Contribution discipline

Before adding a primitive/token:

1. prove multi-consumer reuse or a platform-wide design requirement;
2. define semantic rather than page-specific purpose;
3. preserve web/native differences where behavior diverges;
4. verify RTL/LTR;
5. verify accessibility;
6. avoid a second token/brand authority.

```text
REAL_CONSUMER_NEED
→ SMALLEST_DOMAIN_NEUTRAL_PRIMITIVE
→ STATE/STORY EVIDENCE
→ RTL/A11Y/DEVICE PROOF
→ REUSE

PREBUILD_FULL_COMPONENT_CATALOG = FORBIDDEN
```

Shared semantic tokens may coexist with platform-specific component implementations.

## External tooling references

`docs/reference/external-systems/experience-design-ui-assurance.md` is non-authoritative evidence only.

Potential evaluation routes include Style Dictionary for token transforms, standards-grade web primitives, Storybook-like state workbenches, Playwright/axe-style web verification, Maestro-like mobile E2E and a semantic icon API over a generic icon source. Dependency adoption always returns to current Governance and executable manifests; this guide never authorizes installation.
