# ADR 0007 — Design system authority

ARTIFACT_CLASS: DURABLE_DECISION_RATIONALE
STATUS: ACTIVE
EXECUTION_AUTHORITY: NONE

## Context
Generic shared UI buckets mix brand tokens, primitives, domain copy/state and platform-specific implementation, creating duplicate visual authorities.

## Decision
Maintain one semantic design-system authority for reusable tokens/primitives/patterns while preserving web/native implementation boundaries. Domain state/policy/content remains outside.

## Alternatives
Per-app design systems; one cross-platform component implementation for every primitive; generic shared UI bucket.

## Consequences
Brand/RTL/accessibility consistency improves without moving business truth into presentation infrastructure.

## Supersession
A later ADR may supersede this decision only by explicitly accounting for migration, ownership and affected Product/System truth.
