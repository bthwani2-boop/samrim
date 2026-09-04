# BThwani Ubiquitous Language

ARTIFACT_CLASS: DURABLE_PROJECT_GOVERNANCE
SEMANTIC_OWNER: governance/project/GLOSSARY.md
EXECUTION_AUTHORITY: NONE

## Purpose

This glossary defines stable platform vocabulary. If implementation naming conflicts with this vocabulary, the implementation name is evidence of drift, not permission to silently redefine the concept.

## Core terms

**Actor** — a human or system participant capable of authenticated/authorized action or consumption.

**Role** — a responsibility/permission grouping; not the same as a person, engagement or organization.

**Engagement** — the workforce/business relationship through which a person participates.

**Organization** — a business entity such as a partner organization. It is not automatically a tenant.

**Store** — an operational commerce location/business scope governed by DSH.

**Authorization Scope** — the object/business boundary inside which a permission applies.

**Platform Context** — the platform-level isolation boundary.

**Operator Context** — trusted server-derived operational/data context for operator work inside the platform boundary.

**Capability** — a stable semantic responsibility with a canonical owner.

**Journey** — an actor/system outcome that may cross multiple capabilities and surfaces.

**Surface** — a deployable presentation/interaction host.

**Route/Screen** — implementation composition; not a capability owner.

**Canonical Owner** — the bounded context responsible for the meaning of a material fact.

**Canonical Writer** — the only authority permitted to mutate a canonical durable fact.

**Projection** — derived read model/copy. It is not authoritative unless explicitly defined as such.

**Contract** — an executable cross-boundary protocol/schema/API/event definition.

**Readback** — authoritative post-action observation proving the resulting state.

**Unknown Outcome** — a mutation whose final external/system result is not yet proven; it remains unknown until reconciled.

**Idempotency** — repeated delivery/retry of the same logical operation cannot create duplicate effect.

**Settlement** — governed financial accounting between parties over authoritative operational/financial facts; not equivalent to wallet balance.

**Payout** — movement of eligible funds to an external destination through governed WLT policy.

**COD Exposure** — order-specific financial exposure required before allowing a captain to carry eligible cash-on-delivery responsibility.

**Provider/External Integration** — replaceable implementation behind a semantic owner; never internal business truth by vendor name alone.

**Design System** — reusable presentation tokens/primitives/patterns without domain/business truth.

**Platform Control** — narrow platform-wide control-plane authority; never a generic domain-data execution service.

## Naming law

```text
ACTOR_PREFIX != CAPABILITY
ROUTE != CAPABILITY
SCREEN != CAPABILITY
VENDOR != DOMAIN
IMPLEMENTATION_MECHANISM != DOMAIN
GENERIC_BUCKET != CANONICAL_OWNER
```
