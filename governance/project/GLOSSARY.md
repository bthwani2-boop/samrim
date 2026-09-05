# BThwani Ubiquitous Language

ARTIFACT_CLASS: DURABLE_PROJECT_GOVERNANCE
SEMANTIC_OWNER: governance/project/GLOSSARY.md
EXECUTION_AUTHORITY: NONE
CLOSURE_AUTHORITY: NONE
IMPLEMENTATION_STATE_AUTHORITY: NONE

## Purpose

This glossary defines stable platform vocabulary. If implementation naming conflicts with this vocabulary, the implementation name is evidence of drift, not permission to silently redefine the concept.

## Core terms

**Actor** — a human or system participant capable of authenticated/authorized action or consumption.

**Human Actor** — one human identity represented cross-boundary by the permanent Identity-owned `actor_id`; the same Human Actor may hold multiple Identity roles.

**Product Persona** — the user-facing participation label through which a Human Actor performs a journey. A persona does not create a second identity or business owner.

**Role** — a responsibility/permission grouping; not the same as a person, organization or domain assignment.

**Organization** — a business entity such as a partner organization. It is not automatically a tenant.

**Partner** / **Partner Organization** — the commercial/business organization that has the governed relationship with BThwani and may own/manage one or more Stores. A Partner is not a Human Actor, Store, Identity Role or Tenant.

**Partner Member** — a Human Actor holding the `partner` Identity role and acting only through DSH-governed membership and Partner/Store authorization scope.

**Store** — an operational commerce location/business scope governed by DSH. A Store is distinct from its owning Partner and is not automatically a Tenant.

**Authorization Scope** — the object/business boundary inside which a permission applies.


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

**WLT** — the bounded context that exclusively owns BThwani authoritative financial truth.

**Internal Wallet** — an actor-linked internal financial account/view governed by WLT. It is not an external electronic-wallet provider and does not by itself define the accounting source of truth.

**Ledger** — WLT-owned authoritative posting/accounting history from which financial positions are established. Ledger entries/postings are not interchangeable with a mutable cached balance field.

**Balance** — a current financial position/projection derived from authoritative WLT ledger/accounting state. It is not an independent source of truth.

**Payment** — a governed financial operation/state representing allocation, authorization, capture/collection, or equivalent payment lifecycle semantics owned by WLT according to the applicable contract.

**External Financial Rail / External Wallet Provider** — an external payment or money-movement system integrated behind a WLT-owned semantic port. Its provider balance/state is not BThwani's Internal Wallet or Ledger.

**Finance** — a functional/operator-facing grouping or UI label when used for navigation. It is not a bounded-context owner; WLT owns the underlying financial truth.

**Settlement** — governed financial accounting between parties over authoritative operational/financial facts; not equivalent to wallet balance.

**Payout** — movement of eligible funds to an external destination through governed WLT policy.

**COD Exposure** — order-specific financial exposure required before allowing a captain to carry eligible cash-on-delivery responsibility.

**Provider/External Integration** — replaceable implementation behind a semantic owner; never internal business truth by vendor name alone.

**Design System** — reusable presentation tokens/primitives/patterns without domain/business truth.

**Platform Control** — narrow platform-wide control-plane authority; never a generic domain-data execution service.

## Naming law

```text
ACTOR_PREFIX != CAPABILITY
HUMAN_ACTOR != IDENTITY_ROLE
IDENTITY_ROLE != PRODUCT_PERSONA
PARTNER_ORGANIZATION != PARTNER_MEMBER
ROUTE != CAPABILITY
SCREEN != CAPABILITY
VENDOR != DOMAIN
IMPLEMENTATION_MECHANISM != DOMAIN
GENERIC_BUCKET != CANONICAL_OWNER

PARTNER != STORE
PARTNER != TENANT
STORE != TENANT
ACTOR != PARTNER
ACTOR != STORE

WALLET != LEDGER
BALANCE != INDEPENDENT_SOURCE_OF_TRUTH
INTERNAL_WALLET != EXTERNAL_FINANCIAL_RAIL
FINANCE_UI_SECTION != DOMAIN_OWNER
WLT = SOLE_AUTHORITATIVE_FINANCIAL_OWNER
```
