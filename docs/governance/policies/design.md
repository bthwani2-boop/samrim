# Design and Visual Identity Policy

ARTIFACT_CLASS: DURABLE_CROSS_CUTTING_POLICY
SEMANTIC_OWNER: docs/governance/policies/design.md
EXECUTION_AUTHORITY: NONE
IMPLEMENTATION_STATE_AUTHORITY: NONE

This policy owns BThwani's durable cross-surface visual identity and design-language invariants. It does not own Product capabilities, information architecture, navigation, interaction/recovery behavior, accessibility policy, implementation topology, or current rendered state.

```text
docs/governance/policies/design.md
→ durable visual identity / design language

docs/governance/policies/experience.md
→ information architecture / shell / navigation / interaction / RTL / accessibility / recovery

docs/governance/policies/quality.md
→ material review and proof obligations

EXECUTABLE DESIGN SYSTEM
→ reusable implementation of admitted visual semantics

APP SURFACES
→ app-specific composition and rendering
```

No Markdown file in an implementation repository, app-local visual foundation, donor implementation, external Design System, or rendered screenshot becomes a parallel BThwani design authority.

## Visual character

BThwani is operational, familiar, trustworthy, warm, modern and uncluttered. Visual design makes the current context, primary action, state and recovery legible before decoration.

The recognizable signature is restrained deep-navy structure with controlled orange emphasis over quiet surfaces. Brand identity must remain distinctive without overwhelming content, status meaning or platform familiarity.

## Brand anchors and color semantics

The current durable brand anchors are:

- structural navy `#0A2F5C`;
- brand/action orange `#FF500D`;
- warm light background `#FFFCF8`;
- light primary surface `#FFFFFF`.

These anchors are durable brand decisions until an explicit brand decision changes them. Derived ramps, interaction shades, contrast adaptations, opacity, component-level colors and theme-specific values belong to the executable Design System rather than being mirrored here as a second token registry.

Orange is intentional emphasis for brand and high-priority interaction, not decorative saturation across cards or chrome. Navy provides structure and identity, not a requirement to make every surface dark. Success, warning, danger and informational states use semantic state meaning and must not be overloaded with brand meaning.

Color alone never carries material state or action meaning.

## Typography and numeric expression

Typography prioritizes Arabic readability, clear hierarchy, stable shaping, legible numerals and platform-quality rendering. Screen titles identify the current job or context; supporting text clarifies state, consequence and recovery without backend vocabulary.

No custom brand typeface is currently admitted as a durable visual-identity decision. If a custom typeface is proposed, admission requires proven Arabic shaping/RTL, weights, numerals, small-size legibility, Android/iOS/web rendering, text scaling, performance and licensing. The font mechanism currently used by any surface is implementation truth.

Exact font sizes, line heights, weights and platform mappings are executable Design System concerns unless a value itself becomes a durable brand decision.

## Spacing, density and hierarchy

Spacing establishes information groups and action priority rather than filling empty space mechanically. Density may differ by surface and input model while preserving the same hierarchy and state meaning.

Operational density means information efficiency, not visual crowding. Repeated comparison and high-volume work should expose enough identity, state and decisive comparable information to scan and act without unnecessary route changes or oversized containers. Secondary metadata and secondary actions remain visually quieter than the primary job.

Narrative, form and focused-detail content may use constrained readable widths. Operational registries, comparison surfaces and other wide data workspaces may consume materially more of the available viewport when an arbitrary global maximum width would reduce scanning, comparison or action efficiency. Exact breakpoints, dimensions and layout values remain executable Design System or app concerns rather than durable constants here.

Where multiple density modes materially improve sustained operator work, compact and comfortable treatments preserve the same semantics, reachability and accessibility rather than becoming different products. Density choice is not introduced without a real user or workflow need, and exact density tokens remain executable Design System concerns.

Important values, actions and statuses must remain readable under realistic Arabic copy, large text and constrained widths. Truncation must not hide materially required meaning.

## Shape, surfaces, elevation and depth

Shape language is cohesive and restrained. Controls, fields, cards, sheets and other surfaces use a consistent radius family through semantic Design System roles rather than local per-screen invention.

Cards contain one coherent responsibility; they are not giant click targets containing unrelated actions and are not the default layout primitive for large comparable record collections. Data-dense workspaces prefer clear alignment, spacing, borders or restrained tonal separation before decorative elevation. Borders and restrained elevation may separate work areas, but shadows do not substitute for hierarchy. Decorative gradients, excessive layering or visual effects that obscure state or delay an operational action are noncanonical.

Focus, busy, disabled, selected and error treatments should preserve understandable geometry while changing semantic treatment as appropriate.

## Iconography, imagery and media

Iconography uses a coherent family, consistent stroke/fill language and semantic meaning. Direction-sensitive symbols must remain compatible with the Arabic/RTL interaction contract owned by `docs/governance/policies/experience.md`.

Images, illustrations and media support Product understanding or brand character; they do not fabricate Product truth or crowd out primary actions. Material visual assets require known provenance and compatible licensing. Donor or third-party assets are evidence/candidates only and are not adopted by existence.

## Motion

Motion communicates hierarchy, continuity, feedback or state change. Decorative motion that slows task completion, masks latency or competes with operational actions is noncanonical.

Exact durations, easing curves and platform implementations belong to the executable Design System. Accessibility and reduced-motion interaction behavior remain governed by `docs/governance/policies/experience.md`.

## Light and dark appearance

Light and dark appearance preserve semantic hierarchy, action priority, state meaning and BThwani identity rather than becoming independent visual products. Theme adaptation uses semantic roles; screens do not fork business meaning or invent local theme systems.

The dark surface model may adapt navy/orange expression for contrast and legibility while preserving their brand relationship. Exact theme values remain executable Design System implementation.

## Cross-platform expression

BThwani has one recognizable visual identity, not one pixel-identical layout. Android, iOS and web may render components, chrome, density and interaction affordances differently when platform fit requires it. Platform conventions challenge implementation choices without becoming BThwani brand authority.

## Design-system boundary

The reusable Design System implements domain-neutral visual semantics through the progression:

```text
BRAND / VISUAL INVARIANT
→ PRIMITIVE TOKEN
→ SEMANTIC TOKEN
→ REUSABLE PRIMITIVE / PATTERN WHEN PROVEN
→ PLATFORM-SPECIFIC RENDERING
```

A reusable token, primitive or pattern exists only when it has real current consumers and reduces whole-system inconsistency or complexity. Product/domain components begin with the consuming feature and move into the Design System only after domain-neutral multi-consumer need is proven.

No surface creates a competing foundation for color, typography, spacing, radius, elevation, iconography, motion, directionality or theme when the canonical Design System can own the same reusable meaning.

## Evidence and change control

A material visual change must distinguish:

```text
DURABLE BRAND / DESIGN DECISION
→ update this semantic owner when the durable meaning changes

EXECUTABLE TOKEN / COMPONENT TREATMENT
→ change the Design System and prove affected consumers

APP-SPECIFIC COMPOSITION
→ change the owning surface without promoting local composition into global design law
```

Rendered evidence is required for claims about actual appearance; source declarations alone do not prove visual quality. Interaction, accessibility, RTL, responsive/adaptive and state-transition proof remain governed by `docs/governance/policies/experience.md` and `docs/governance/policies/quality.md`.

Donor implementations, OSS, Material, Apple guidance and other external design systems are challenge/evidence sources only. Preserve useful BThwani meaning, reject defects and obsolete architecture, and never copy external visual identity as authority.
