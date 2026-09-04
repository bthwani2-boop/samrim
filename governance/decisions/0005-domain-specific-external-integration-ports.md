# ADR 0005 — Domain-specific external integration ports

ARTIFACT_CLASS: DURABLE_DECISION_RATIONALE
STATUS: ACTIVE
EXECUTION_AUTHORITY: NONE

## Context
Generic provider abstractions tend to become god services and blur financial, biller, maps, messaging and storage semantics.

## Decision
The operation-owning domain expresses a semantic port; vendor adapters implement it. FinancialRail, BillerGateway, OTP delivery, Maps/Geo, Push, Email and Object Storage remain semantically distinct.

## Alternatives
Generic Provider.execute abstraction or standalone generic Providers business domain.

## Consequences
Vendor replacement does not rewrite domain semantics; unknown-result/retry/reconciliation rules stay with the owning operation.

## Supersession
A later ADR may supersede this decision only by explicitly accounting for migration, ownership and affected Product/System truth.
