# ADR 0002 — App host versus service capability ownership

ARTIFACT_CLASS: DURABLE_DECISION_RATIONALE
STATUS: ACTIVE
EXECUTION_AUTHORITY: NONE

## Context
Multiple deployable surfaces render the same capabilities. Actor/app-shaped service feature trees create duplicated semantics and cross-surface drift.

## Decision
Apps own routing/navigation/shell/native/deployable composition. Services own reusable capability semantics, canonical writers/contracts and service-owned presentation where justified.

## Alternatives
Let each app own its own business feature implementation; let services own app composition.

## Consequences
Where a capability appears no longer determines ownership. Cross-surface behavior converges on one semantic owner.

## Supersession
A later ADR may supersede this decision only by explicitly accounting for migration, ownership and affected Product/System truth.
