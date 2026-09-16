---
version: alpha
colors:
  primary: "#0A2F5C"
  action: "#B73809"
  background: "#FFFCF8"
  surface: "#FFFFFF"
typography:
  body:
    fontFamily: "Inter, Noto Sans Arabic, system-ui, sans-serif"
    fontSize: "16px"
    lineHeight: "1.5"
  heading:
    fontFamily: "Inter, Noto Sans Arabic, system-ui, sans-serif"
    fontSize: "28px"
    lineHeight: "1.2"
rounded:
  control: "10px"
  surface: "16px"
spacing:
  unit: "4px"
components:
  primaryAction:
    backgroundColor: "{colors.action}"
    textColor: "{colors.surface}"
    rounded: "{rounded.control}"
    height: "44px"
  surface:
    backgroundColor: "{colors.surface}"
    rounded: "{rounded.surface}"
  status:
    backgroundColor: "{colors.background}"
    textColor: "{colors.primary}"
    rounded: "{rounded.control}"
---

# Overview

Samrim is a BThwani operational product for Arabic-speaking customers, partners,
captains, field staff, and control-panel operators. This document preserves the
accepted visual direction while the product is refounded around readable work,
clear ownership, and truthful remote state.

The product register is operational and familiar, not a marketing landing page.
The memorable BThwani signature is the navy structural rail paired with a single
orange action emphasis. Surfaces, state colors, and spacing stay quiet so the
next action and the canonical state remain obvious.

# Colors

The brand anchors are owned by `packages/design-system/src/tokens/colors.ts` and
adapted to web through `packages/design-system/theme.css`. The values above are
the documented mirror, not a second runtime token source. Light mode uses the
warm background and white primary surface; dark mode preserves hierarchy with a
deep navy surface and semantic light-on-dark state colors. Orange is reserved
for the primary action, focus emphasis, and the brand mark—not decoration on
every card.

# Typography

Use the existing system stack with Arabic-capable fallback. Do not introduce a
custom font without proof across Android, iOS, web, numerals, scaling, shaping,
performance, and licensing. Titles establish the job of the screen; supporting
copy explains state and recovery in plain Arabic. Important values must not be
communicated by truncation, color alone, or backend vocabulary.

# Layout

Mobile surfaces use natural document flow, safe-area-aware edges, and focused
task stacks. Control Panel uses a calm workspace shell with a clear resource
context and contextual actions. Lists separate loading, empty, no-results,
forbidden, failure, and canonical post-mutation readback. Arabic uses RTL
direction with LTR treatment only for phone numbers, numeric quantities, and
other machine-shaped values.

# Elevation & Depth

Borders and restrained elevation separate work areas. Do not use shadows to
replace hierarchy, and do not add decorative gradients or animation that delays
an operational action.

# Shapes

Controls use the shared radius family and at least a practical touch target.
Cards are containers for one responsibility, not giant click targets containing
unrelated actions. Focus, busy, disabled, error, and selected states retain
geometry while changing semantic treatment.

# Components

`packages/design-system` owns semantic tokens, themes, direction helpers, and
formatting primitives. Domain enum-to-Arabic mappings remain with the DSH
presentation layer or the feature that owns the presentation responsibility.
Applications extend existing shared behavior only when real cross-surface reuse
is proven. There is no second UI package, and there are no product rules in the
design-system package.

# Do's and Don'ts

- Do name the human job, next action, and recovery path.
- Do show canonical readback after a mutation and prevent duplicate submission.
- Do preserve Arabic RTL, readable long text, light/dark semantic roles, and
  keyboard/safe-area reachability.
- Do keep internal identifiers and concurrency versions inside transport logic.
- Don't expose raw IDs, coordinates, backend enum strings, or JSON as normal
  user-facing content.
- Don't invent routes, business capabilities, security policy, or a competing
  visual system to make a screen look complete.
