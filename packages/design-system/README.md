# Design System

Canonical reusable visual-system authority for BThwani deployable surfaces.

This package owns reusable design tokens, semantic themes, directionality primitives, and later only those reusable visual primitives/components/patterns that prove cross-surface value.

It must not own product/domain strings, business rules, permissions, durable state, app-specific native configuration, or service-specific presentation semantics.

The package provides the reusable token and theme kernel. Application
appearance persistence, repository-wide localization, product strings, and
domain behavior remain owned by the appropriate host or capability. Add a
primitive or component only when it proves cross-surface value.
