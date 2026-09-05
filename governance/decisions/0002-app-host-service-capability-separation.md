# ADR 0002 — App host versus service capability ownership

ARTIFACT_CLASS: DURABLE_DECISION_RATIONALE
STATUS: ACTIVE
EXECUTION_AUTHORITY: NONE
CLOSURE_AUTHORITY: NONE
IMPLEMENTATION_STATE_AUTHORITY: NONE
CURRENT_RULE_ROUTING: governance/architecture/APP-SERVICE-COMPOSITION.md

## Context
Multiple deployable surfaces render the same capabilities. Actor/app-shaped service feature trees create duplicated semantics and cross-surface drift.

## Decision
Apps own routing/navigation/shell/native/deployable composition and surface-specific feature presentation. Services own reusable capability semantics, canonical writers/contracts and generated/public client lineage. A host-neutral presentation abstraction is extracted only when multiple real host consumers and lower total complexity are proven; it must not create an app-shaped service frontend tree.

## Alternatives
Let each app own its own business feature implementation; let services own app composition.

## Consequences
Where a capability appears no longer determines ownership. Cross-surface behavior converges on one semantic owner.

## Supersession
A later ADR may supersede this decision only by explicitly accounting for migration, ownership and affected Product/System truth.
