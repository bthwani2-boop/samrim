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
5. verify Light/Dark appearance where rendering is affected;
6. verify accessibility;
7. avoid a second token/brand authority.

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

## Current Arabic-first surface brief

The implementation-facing brief for the current operational surfaces belongs here; durable product meaning remains in `governance/product/EXPERIENCE-AND-DESIGN.md`, and runtime tokens remain in `packages/design-system`.

- Light appearance uses a warm, quiet work surface (`#FFFCF8`) with white working cards (`#FFFFFF`).
- Dark appearance uses the same semantic surface/content/action roles through the shared theme tokens; do not invert colors mechanically or add page-local dark palettes.
- Navy (`#0A2F5C`) and orange (`#FF500D`) are brand/light anchors; consume semantic roles so theme-specific values can preserve contrast and state meaning.
- Keep the brand signature consistent: a small orange rail, clear navy wordmark, bounded spacing and one dominant action per state.
- Arabic is the reading lane. Technical identifiers are secondary and never the headline of a successful task.
- Role apps open with one focused activation surface. Phone, code and the next legal action are visible in sequence.
- Control-panel sign-in is password first and second factor second; current step, required input, busy state and recovery action are explicit.
- Recoverable failures are Arabic, actionable and safe to repeat. Raw service errors are not rendered to operators.
- Mobile surfaces consume semantic tokens from `@bthwani/design-system`; web surfaces mirror the same roles through CSS variables.
