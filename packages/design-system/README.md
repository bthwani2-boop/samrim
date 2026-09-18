# Design System

Canonical executable reusable visual-system implementation for BThwani deployable surfaces.

Pinned Governance owns durable BThwani Design/Experience meaning. This package implements admitted reusable visual semantics through design tokens, semantic themes, directionality primitives, and only those visual primitives/components/patterns whose cross-surface value is proven.

It must not own Product/domain strings, business rules, permissions, durable state, app-specific information architecture/navigation, app-specific native configuration, or service-specific presentation semantics.

The package provides the reusable token/theme kernel, its generated browser projection (`theme.css`), and proven domain-neutral presentation primitives. Application appearance persistence, host-specific shell/presentation, repository-wide localization, Product strings and domain behavior remain with their appropriate owners. Add or retain a primitive/component only when current real consumers prove cross-surface value and lower whole-system complexity.

`theme.css` is generated from the token and semantic-theme sources with `pnpm theme:generate`; browser consumers import `@bthwani/design-system/theme.css` and do not define a second token registry. The projection includes semantic color roles plus unit-bearing web variables for spacing, radius, typography, sizing, breakpoints, motion, borders, opacity, elevation, z-index and direction.
