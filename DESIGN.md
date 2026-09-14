---
name: Samrim product design context
description: Current visual and interaction context for the Arabic RTL BThwani commerce surfaces.
version: 1.0
---

ARTIFACT_CLASS: REPOSITORY_LOCAL_DESIGN_CONTEXT
PRODUCT_SEMANTIC_AUTHORITY: NONE
DURABLE_KNOWLEDGE_AUTHORITY: NONE
RUNTIME_DESIGN_TOKEN_AUTHORITY: packages/design-system

# Samrim design context

## Product north star

Samrim should feel like a calm, trustworthy operations layer for BThwani commerce: clear ownership, visible state, and one confident next action. The current product language is Arabic-first and RTL. Screens should make the canonical state easy to recognize and should never imply that a local capture or preview is itself a business decision.

## Current design authority

The runtime Design System in `packages/design-system` is the source of truth for tokens. This document is repository-local design context for current multi-surface implementation and verification; it owns no durable Product/System/Policy truth. The Location Core uses those tokens through `resolveTheme` and adds no new color, spacing, typography, or icon system.

## Foundations

### Color

Light surfaces use warm white `#FFFCF8`, base white `#FFFFFF`, and muted surface `#F8F5F0`. Structure and primary text use deep navy `#0A2F5C`; the primary action is orange `#FF500D`, with pressed/focus `#B73809`. Semantic colors are success `#16653A`, warning `#8E5204`, danger `#9B2F2B`, and informational `#214D89`. Dark mode maps these roles to the existing dark palette in `theme.css`, preserving semantic roles rather than copying light values.

### Typography

Use the existing `system-ui` Arabic/Latin family and `ui-monospace` only for technical values. The established hierarchy is: display 36/44, hero 30/38, title large 24/32, title medium 20/28, title small 18/26, body large 17/27, body 15/24, body small 14/21, label 13/18, caption 12/17. Prefer the smallest role that preserves readable hierarchy; Arabic copy remains selectable where it carries user-visible state or recovery information.

### Spacing and shape

Spacing follows the existing 4px base scale: 4, 8, 12, 16, 20, 24, 32, 40, 48, 56, 64, 80, and 96px. Radius uses 4, 8, 12, 16, 20, and 24px, with 999px only for fully rounded controls. Cards use restrained borders and existing raised elevation; avoid decorative gradients and ornamental containers.

### Direction and layout

RTL is the default direction and Arabic is the default language. Use logical start/end alignment, right-aligned Arabic reading text, and mirrored directional affordances. Preserve generous touch targets and keep the primary action visually dominant. Mobile flows use a root scroll container when content can exceed the viewport.

## Component language

Use existing BThwani cards, bordered inputs, orange primary buttons, neutral secondary buttons, semantic notice/error panels, and compact metadata rows. A component should expose its state through text and accessibility semantics, not color alone. Technical coordinates are displayed with six decimal places in a tabular numeric style and are always paired with a plain-language label.

## Current Location Core interaction contract

The client owns its saved delivery addresses. The partner owns the Store delivery origin. Both surfaces read canonical DSH state, show loading/empty/error/retry states, use pessimistic saves, and surface version conflicts inline. Foreground location permission is requested only after an explicit capture action; denial, disabled device services, and capture failure each provide recoverable Arabic guidance. No map, geocoding, radius, distance, or serviceability verdict is presented in this unit.

## Content rules

Use direct Arabic action labels such as “التقاط الموقع الحالي”, “حفظ العنوان”, and “إعادة المحاولة”. Explain ownership and what was actually completed. Do not claim that a coordinate is serviceable, nearby, verified, or delivery-ready. Error copy should identify the recovery action without exposing implementation details or secrets.

## Accessibility and resilience

All material controls have Arabic accessibility labels, busy/disabled state where applicable, and live-region or alert semantics for notices and errors. Keep contrast aligned with the semantic palette, allow text selection for durable readback, avoid browser dialogs, prevent duplicate submissions, and keep network failures recoverable. The app remains usable when location permission is denied or device location services are disabled.

## Responsive and theme behavior

The current implementation targets Expo mobile surfaces with compact cards and full-width controls. Layouts must remain readable on small Android widths, support light and dark themes through `resolveTheme`, and keep state/ownership labels visible without relying on a map or a horizontal overflow surface.

## Change policy

Extend existing tokens and components when a current journey requires it. Add a new visual primitive only with a proven current consumer and a documented ownership reason. Any future serviceability decision UI must wait for an admitted DSH policy and versioned decision contract; it must not be inferred from Location Core coordinates.
