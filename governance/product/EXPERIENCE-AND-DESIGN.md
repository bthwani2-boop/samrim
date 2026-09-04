# BThwani Experience and Design Authority

ARTIFACT_CLASS: DURABLE_EXPERIENCE_GOVERNANCE
SEMANTIC_OWNER: governance/product/EXPERIENCE-AND-DESIGN.md
EXECUTION_AUTHORITY: NONE
CLOSURE_AUTHORITY: NONE
IMPLEMENTATION_STATE_AUTHORITY: NONE

## Scope

This file owns durable cross-surface UX, information architecture, content/terminology, accessibility/localization and brand/design-language decisions. Capability-specific business states/actions remain owned by `PRD.md` and `CAPABILITIES.md`; runtime token/component implementation remains owned by the executable shared UI/design-system code.

A design source, prototype, `DESIGN.md`, `UX-CONTRACT.md`, token source, component library and rendered screen must not survive as competing authorities. This file owns durable meaning; tool-facing maps and runtime tokens are derived implementations.

## Experience authority chain

```text
Product/Brand Truth
-> User/Actor Need
-> Journey/Task
-> Information Architecture
-> Available/Authorized Actions
-> Interaction/Feedback/Recovery
-> Content/Terminology
-> Visual Language
-> Semantic Design-System Implementation
-> Cross-Surface Rendered Experience
```

UX is operational meaning, not styling. Treat a journey as:

`entry -> understanding -> discoverability -> action -> authorization -> decision -> state change -> feedback -> handoff -> later readback -> failure -> recovery -> terminal outcome`.

A screen that looks correct but communicates the wrong state, authority, next action or persisted outcome is incorrect.

## Audience and platform character

BThwani serves customer, partner, captain, field worker and operator surfaces over one governed platform. The product is Arabic-first for its current operating context while supporting English/Latin technical presentation where needed. The control-panel default experience is Arabic/RTL.

Cross-surface vocabulary should feel like one platform while allowing different information density, task urgency, input mode, viewport and native-platform adaptation.

## Accessibility and localization baseline

Target WCAG 2.2 AA for web semantics where applicable, with visible keyboard focus, accessible names/relationships, truthful live/status feedback, reduced-motion support and readable contrast/state distinction. Mobile surfaces apply equivalent platform accessibility semantics, text scaling, touch-target and device constraints.

Arabic/RTL and English/LTR must preserve the same Product meaning. Use logical direction/layout semantics instead of hard-coded mirrored coordinates. Technical IDs/numeric/mixed-script values may use a Latin/mono lane for readability without converting Product copy to a different semantic register.

## Information architecture and navigation

Group by actor responsibility and real tasks rather than current folder structure. Navigation, breadcrumbs/tabs, search/filter/sort/page state and bulk-selection scope must not become hidden business truth.

Required actions are discoverable and legal next actions are understandable. Forbidden/unauthorized actions do not become client-granted permissions. Route/screen transitions preserve truthful state, recovery and focus semantics.

## Content and terminology

Labels, state names, errors, confirmations, destructive-action copy, help, empty states and recovery guidance are Product/UX semantics when they change understanding or action. Shared concepts use one canonical meaning across surfaces/languages while allowing platform-appropriate phrasing.

Copy must not claim success, service health, balance, eligibility or completion before canonical evidence/readback supports it. Errors explain recoverable action without exposing secrets or unnecessary sensitive data.

## Brand and visual language

Current BThwani visual direction is a calm operational commerce/control environment: warm neutral work surfaces, navy for trusted structure/content and orange for governed primary action.

Current core palette decisions are:

- trusted structure/primary text: `#0A2F5C`;
- governed primary action: `#FF500D`;
- warm background: `#FFFCF8`;
- primary surface: `#FFFFFF`.

Semantic success/warning/danger/info/border/focus roles must be expressed through the shared semantic token system rather than copied raw values per surface. Brand changes update this durable authority and then the runtime token implementation; runtime drift does not redefine the brand.

Arabic is the primary reading lane. Current typography uses an Arabic-first sans lane and a distinct Latin/technical lane; runtime font loading/fallback implementation may evolve without changing this semantic requirement.

Hierarchy uses restrained spacing, borders/surface tone and depth; decorative effects must not obscure action/state meaning. Motion communicates state change rather than routine decoration and respects reduced motion.

## Components and interaction semantics

Reusable controls must expose their materially applicable states rather than only a happy state: default, hover/pressed where applicable, visible focus, selected, disabled with truthful reason when necessary, busy, validation/error, success and recovery.

Forms preserve values through recoverable failure, prevent unsafe duplicate submission and expose actionable errors. Dialogs/sheets/overlays preserve focus and dismissal semantics. Icon-only actions require accessible names; icons do not replace required state/action text.

Tables/lists distinguish loading, empty, no-results, partial/stale, forbidden/unavailable and error. Bulk actions define selection scope and post-mutation canonical readback.

## Cross-surface design-system authority

Durable shared decisions should flow:

```text
Canonical Experience/Design Decision
-> Semantic Token / authorized platform adaptation
-> Canonical Component
-> Canonical Pattern
-> Surface Composition
-> Rendered Experience
```

Do not create local token foundations/components that independently encode a materially shared decision. Local adaptation is valid when a platform, viewport, actor task or accessibility requirement materially demands it and Product meaning remains identical.

Shared UI may own presentation behavior; it never becomes a domain/business/financial truth owner.

## Design asset provenance

Fonts, icons, images, illustrations, motion assets and other material design dependencies require known source/ownership and licensing/provenance compatible with repository/product use. Unknown, incompatible or unverifiable provenance is not an acceptable final-state asset merely because it looks correct.

Generated/third-party assets remain subordinate to the same privacy, security and supply-chain requirements as other dependencies. Do not copy another product's proprietary visual identity or asset corpus as a shortcut to a coherent design system.

## Async, offline, weak-network, and recovery experience

Loading/busy geometry and messaging must not fabricate completion. Retry preserves safe input/correlation and avoids duplicate mutations. Offline/local state remains subordinate to canonical authority and communicates synchronization/conflict/unknown outcomes truthfully.

Financial/provider unknown outcomes remain pending/reconcilable rather than displayed as completed. Session expiry routes through canonical Identity semantics.

## Experiments and variants

Experiments/feature flags are bounded transition/evidence mechanisms, not permanent parallel Product/UX truth. A material variant requires owner, hypothesis/decision purpose, audience/scope, measurement plan, canonical winner/cutover rule and expiry/removal condition.

## Evidence

Rendered correctness requires the evidence class capable of proving the claim: visual/interaction/accessibility/browser/device/runtime/usability evidence as applicable. An attractive screenshot, design file or token audit alone is not proof of a correct journey.

Real-user comprehension/discoverability/task-completion claims require appropriate research/usability evidence when code/runtime/design evidence cannot establish them.


## Journey and capability linkage

Experience acceptance follows `CAPABILITIES.md` and `JOURNEYS.md`. A polished screen is incomplete when the cross-capability journey, failure/recovery path or canonical readback is incomplete.

Refoundation preserves required approved experience value but does not automatically preserve losing component/container topology.
