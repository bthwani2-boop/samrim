# External References — Experience, Design Systems and UI Assurance

DOCUMENT_CLASS: NON_AUTHORITATIVE_EXTERNAL_REFERENCE
EXECUTION_AUTHORITY: NONE
PRODUCT_AUTHORITY: NONE
CURRENT_REPOSITORY_STATE_AUTHORITY: NONE
REFERENCE_FRESHNESS: REVALIDATE_MATERIAL_FACTS_AT_USE
REFERENCE_REVIEWED_ON: 2026-09-05
REFERENCE_MAX_REVIEW_AGE_DAYS: 180
LICENSE_RECHECK_ON_ADOPTION: REQUIRED
SECURITY_SUPPLY_CHAIN_RECHECK_ON_ADOPTION: REQUIRED
ADOPTION_AUTHORITY: NONE

## Purpose

Use this corpus to falsify BThwani UI/UX assumptions, borrow mature interaction/accessibility/testing behavior, and identify small technical component candidates without importing another product's visual identity or architecture.

~~~text
BTHWANI_OWNS
= brand + Product meaning + Arabic content + information architecture
+ domain-specific patterns + component public API + Product journeys

EXTERNAL_REFERENCE
= behavior + accessibility + i18n/RTL edge cases + testing patterns
+ generic tooling candidates

REFERENCE_SELECTION != DEPENDENCY_ADOPTION_SELECTION
~~~

Any direct dependency/code adoption must pass the exact current license, maintenance, security/supply-chain, stack-fit, ownership and exit-cost gates in Governance.

## 1. Design token transformation

### P1 — Style Dictionary

- Official docs: https://www.styledictionary.org/
- Use for: cross-platform token transformation, CSS/JS/native outputs, token naming/aliasing and DTCG-compatible authoring concepts.
- BThwani mode: COMPONENT_CANDIDATE_FOR_GOVERNANCE_REVIEW.
- Boundary: Style Dictionary may transform the canonical BThwani token source; it must not become a second brand/design authority.

Stop when BThwani has one semantic token authority and deterministic platform outputs. Do not add another token framework merely for variety.

## 2. Accessible web behavior primitives

### P1 — Base UI

- Official docs: https://base-ui.com/react/overview/accessibility
- Use for: headless React interaction behavior, ARIA, keyboard navigation, focus management and accessible primitive composition.
- BThwani mode: COMPONENT_CANDIDATE_FOR_GOVERNANCE_REVIEW for Control Panel.
- Boundary: BThwani owns styling, semantics, Arabic copy and domain patterns.

### P2 — React Aria

- Official docs: https://react-spectrum.adobe.com/react-aria/
- Use for: independent accessibility/i18n/RTL falsification, interaction edge cases and complex control behavior.
- BThwani mode: REFERENCE_ONLY by default; adoption requires an independent comparison against the selected primitive approach.

### P3 — shadcn/ui

- Official RTL docs: https://ui.shadcn.com/docs/rtl
- Use for: composition examples, logical RTL styling transformations and agent-friendly component composition patterns.
- BThwani mode: REFERENCE/SCAFFOLD_ONLY by default.
- Boundary: do not adopt its visual language, copied component corpus or extra stack merely because examples are convenient.

## 3. Control Panel UX pattern oracles

### P1 — Cloudscape Design System

- Official patterns: https://cloudscape.design/patterns/
- Use for: resource-management IA, tables/lists, filters, empty/no-result/loading states, forms, bulk actions, details and operator workflow patterns.
- BThwani mode: REFERENCE_ONLY.
- Boundary: patterns are problem-solving references, not BThwani branding or Product authority.

### P2 — Saleor Dashboard / commerce administration

- Repository: https://github.com/saleor/saleor-dashboard
- Use for: commerce-specific Product/order/catalog/operator workflow comparison.
- BThwani mode: REFERENCE_ONLY unless a specific generic mechanism is separately proven.
- Boundary: Saleor domain or GraphQL architecture does not become BThwani architecture.

## 4. Component workbench and documentation

### P1 — Storybook

- Official docs: https://storybook.js.org/docs
- React Native material: https://storybook.js.org/docs/get-started/frameworks/react-native-web-vite
- Use for: isolated component states, interaction examples, visual documentation and cross-platform component review.
- BThwani mode: COMPONENT_CANDIDATE_FOR_GOVERNANCE_REVIEW.
- Boundary: Storybook stories are evidence/examples; they do not become Product truth or completion proof.

## 5. Web E2E, visual and accessibility evidence

### P1 — Playwright

- Official docs: https://playwright.dev/docs/
- Use for: browser E2E, visual comparisons, ARIA snapshots, keyboard/interaction flows and production-like web journey evidence.
- BThwani mode: COMPONENT_CANDIDATE_FOR_GOVERNANCE_REVIEW.

### P1 companion — axe-core

- Repository: https://github.com/dequelabs/axe-core
- Use for: automated WCAG rule checks integrated with web tests.
- BThwani mode: COMPONENT_CANDIDATE_FOR_GOVERNANCE_REVIEW.
- Critical limitation: automated accessibility results are partial evidence only; manual keyboard, screen-reader, focus, language/RTL and real-user checks remain required where material.

~~~text
AXE_GREEN != ACCESSIBILITY_CLOSED
SCREENSHOT_GREEN != UX_CLOSED
~~~

## 6. Mobile E2E

### P1 — Maestro

- Official site/docs: https://maestro.dev/
- Use for: readable Android/iOS golden-journey flows, device assertions and CI-friendly mobile E2E.
- BThwani mode: COMPONENT_CANDIDATE_FOR_GOVERNANCE_REVIEW.
- Boundary: Maestro proves observed UI/runtime behavior only; it does not prove backend ownership or financial correctness without canonical readback evidence.

## 7. Icon implementation

### P1 — Lucide

- Official site: https://lucide.dev/
- Use for: generic web/native icon implementation behind a BThwani semantic icon layer.
- BThwani mode: COMPONENT_CANDIDATE_FOR_GOVERNANCE_REVIEW.
- Boundary: app/domain code should prefer BThwani semantic icon names rather than scattering vendor icon imports. Directional icons require explicit RTL semantics.

Brand logos and proprietary third-party marks are outside this generic icon authority and require their own provenance/usage rights.

## 8. BThwani extraction checklist

For each UI/UX root, use the smallest relevant subset above to challenge:

~~~text
INFORMATION_HIERARCHY
PRIMARY_ACTION
LEGAL_NEXT_ACTIONS
LOADING
EMPTY
NO_RESULTS
PARTIAL/STALE
VALIDATION
CONFLICT
FORBIDDEN
OFFLINE
SERVICE_UNAVAILABLE
UNKNOWN_RESULT
SUCCESS_READBACK
RECOVERY
KEYBOARD/FOCUS
SCREEN_READER_SEMANTICS
TEXT_SCALING
TOUCH_TARGETS
REDUCED_MOTION
RTL/LTR
MIXED_ARABIC_LATIN_NUMERIC_CONTENT
VISUAL_REGRESSION
REAL_DEVICE_FLOW
~~~

Do not add a state merely because an external library demonstrates it; add it only when the BThwani capability can materially enter that state.

## 9. Current preferred evaluation order

For Control Panel primitives:

~~~text
Base UI
→ React Aria cross-check when complex accessibility/i18n uncertainty remains
→ Cloudscape pattern reference for operator UX
→ Saleor reference for commerce-specific UX
~~~

For shared token/tooling:

~~~text
BThwani semantic token authority
→ evaluate Style Dictionary only as deterministic transformer
~~~

For assurance:

~~~text
Storybook component-state evidence
+ Playwright web journey/visual/ARIA evidence
+ axe-core automated accessibility
+ manual accessibility
+ Maestro real mobile journey evidence
~~~

This ordering is reference/adoption evaluation guidance only. It does not authorize installing any dependency.

## 10. Final rule

~~~text
BORROW BEHAVIOR
BORROW TEST IDEAS
BORROW ACCESSIBILITY/I18N EDGE CASES
BORROW GENERIC TOOLING ONLY WHEN PROVEN

DO NOT BORROW
ANOTHER PRODUCT'S IDENTITY
ANOTHER PRODUCT'S DOMAIN AUTHORITY
ANOTHER PRODUCT'S TOPOLOGY
UNNEEDED FRAMEWORK BREADTH
~~~
