---
version: alpha
name: "BThwani Control Panel"
description: "Arabic-first operator workspace for moving canonical partner, catalog, fulfillment and platform work forward with a calm, high-signal shell."
colors:
  primary: "#0A2F5C"
  background: "#FFFCF8"
  surface: "#FFFFFF"
  focus: "#B73809"
typography:
  arabic:
    fontFamily: "system-ui, sans-serif"
    fontSize: "15px"
    lineHeight: "24px"
  display:
    fontFamily: "system-ui, sans-serif"
    fontSize: "36px"
    lineHeight: "44px"
  mono:
    fontFamily: "ui-monospace, monospace"
    fontSize: "13px"
    lineHeight: "19px"
rounded:
  DEFAULT: "12px"
  sm: "8px"
  md: "12px"
  lg: "16px"
  xl: "20px"
spacing:
  control: "44px"
  page-gap: "24px"
  shell-gap: "32px"
  content-max: "1280px"
components:
  navigation:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.primary}"
    padding: "12px 16px"
    rounded: "{rounded.md}"
  card:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.primary}"
    padding: "24px"
    rounded: "{rounded.lg}"
  focus:
    backgroundColor: "{colors.focus}"
    textColor: "{colors.surface}"
    size: "3px"
  button:
    backgroundColor: "{colors.focus}"
    textColor: "{colors.surface}"
    rounded: "{rounded.md}"
---

# BThwani Control Panel Design System

## Overview

### Creative North Star

The control panel is a dispatch desk for a busy Arabic RTL operation: a warm, quiet work surface, a deep blue orientation rail, and one orange action signal that tells the operator where movement is possible. It should feel like a well-marked operations room, not a campaign landing page.

### Product context and register

- **Audience and primary job:** Authenticated operators route work across partners, catalog, operations, finance, marketing and platform controls without losing the canonical state of a case or resource.
- **Target market(s) and evidence:** BThwani operator workspace; the durable center taxonomy follows `governance/policy/EXPERIENCE.md` at the pinned Governance commit in `../../knowledge.sources.json`.
- **Locale(s) and language policy:** Arabic RTL is the primary web locale. User-facing labels name the operator's job, while API and backend identifiers stay out of normal UI copy.
- **Usage scene:** Desktop-first operations with narrow laptop and phone access during review, admission and recovery work. Navigation must remain reachable when the viewport is short or the browser is zoomed.
- **Register:** Product. Familiarity, hierarchy, focus and recovery lead; brand expression is concentrated in the orange action signal and deep-blue orientation structure.
- **Memorable signature:** A calm blue navigation spine with indented child routes and a restrained orange focus/action accent.
- **Restraint:** Tables, forms, error states and financial screens use quiet surfaces, clear labels and stable geometry. No decorative animation competes with a pending or destructive action.
- **Anti-references:** Do not resemble a marketing hero, neon analytics dashboard, or dense admin wall of tiny controls. Those registers hide the next safe operator action.
- **Token ownership/runtime mapping:** Model B. `packages/design-system/src/tokens` and generated `packages/design-system/theme.css` remain canonical; `apps/control-panel/app/globals.css` imports the generated projection. This file mirrors accepted values and does not define a second token registry. `pnpm theme:verify` is the drift gate.

## Colors

Deep blue (`#0A2F5C`) carries orientation and primary text. Orange (`#FF500D`) is expressive brand energy; the darker action role (`#B73809`) is used for readable controls and focus. Warm surfaces keep long sessions comfortable in light mode. Dark mode remaps the same semantic roles to near-black navy surfaces and light text without changing hierarchy. Borders, focus rings and status tones remain semantic rather than decorative; color is never the only state signal.

## Typography

The runtime uses the design-system `system-ui` Arabic-capable stack for stable browser rendering and mixed Arabic/Latin identifiers. Display headings use the existing 36/44 role with restrained weight; body text uses 15/24; captions and technical values use the existing label/caption/code roles. Arabic copy is sentence-like and action-led. Long labels wrap or ellipsize only when the full value remains available; route labels preserve the current page and nearest useful ancestor.

## Layout

The authenticated shell uses a 1280px maximum frame, a persistent desktop navigation spine, and a fixed mobile drawer that becomes the only navigation surface below 820px. The main content keeps a 24px page rhythm and a 32px shell gap. Child routes are visibly indented under their owning center. At narrow widths the breadcrumb remains present and truncates only the current segment, while the drawer traps focus and closes with Escape. Scroll ownership stays with the document except for deliberate navigation overlays and data surfaces.

## Elevation & Depth

Hierarchy comes first from surface tone and borders. Cards are flat by default; the navigation drawer and account menu may use the existing shadow token because they float above content. Dark mode deepens the surface rather than adding glow. Avoid shadow on ordinary content blocks and never use elevation to signal a dangerous action.

## Shapes

Controls use the design-system 12px radius, cards use the 16px family, and compact labels use the 8px family. The child navigation rail is a one-pixel semantic border, not a decorative rule. Focus uses the shared three-pixel ring with three-pixel offset. Rounded shapes support grouping and touch targeting; they do not turn every item into a pill.

## Components

### Foundational visual states

Every interactive target has default, hover, focus-visible, active/current, disabled and busy treatment where applicable. Loading preserves geometry; errors explain recovery inline or in an app-owned alert. Reduced motion collapses transitions to the runtime reduced duration.

### Buttons and actions

Solid orange is the primary action, outline/neutral is secondary, and text links are navigation. Dangerous actions remain visually separated and use explicit verbs. Busy labels do not widen controls. The same action vocabulary is used from page heading through success and error feedback.

### Navigation and data display

The workspace registry is the sole owner of top-level destinations and nested route labels. Breadcrumbs represent real hierarchy and never turn the current page into a self-link. Lists and tables retain semantic HTML and expose loading, empty, error and recovery states through their owning feature.

### Forms and overlays

Forms use real labels, app-owned validation and explicit recovery. Selects remain native where the browser-owned popup is accepted by the product; dialogs and account surfaces keep focus and Escape behavior visible. The navigation drawer makes the background inert and restores focus to its trigger.

### Iconography

The shell uses text labels for every destination and reserves symbols for compact, named controls such as the mobile menu and close action. Icons never carry a business meaning without an accessible label.

### Motion

Motion is short, calm and structural: drawer entry, hover and focus feedback only. It never delays navigation or hides an error. `prefers-reduced-motion` is honored globally.

### Content and data visualization

Copy names what the operator controls: الشركاء، الكتالوج، العمليات، الكباتن، الميدان. Backend vocabulary and raw state codes are translated at the feature boundary. Numeric and identifier values keep their semantic direction and remain copyable where relevant.

## Do's and Don'ts

- **Do:** Keep one route owner for each center and let child routes remain bookmarkable.
- **Do:** Preserve RTL, keyboard focus, theme semantics and readable density as correctness requirements.
- **Don't:** Reintroduce screen-local navigation registries or combine Partners and Catalog into one label.
- **Don't:** Add empty Finance/Marketing tabs or decorative controls that do not lead to real pages.
