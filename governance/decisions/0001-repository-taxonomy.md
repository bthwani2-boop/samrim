# ADR 0001 — Repository taxonomy

ARTIFACT_CLASS: DURABLE_DECISION_RATIONALE
STATUS: ACTIVE
EXECUTION_AUTHORITY: NONE

## Context
Generic top-level buckets such as core/shared accumulate unrelated owners and make placement/history look like architecture.

## Decision
Use explicit top-level responsibility classes: apps, services, packages, contracts, infra, governance, docs and tools. Business/domain ownership lives under bounded contexts/services; reusable technical code lives in packages only when reuse is proven.

## Alternatives
Keep broad core/shared roots; organize primarily by technical layer.

## Consequences
Placement becomes ownership-driven and generic dumping grounds carry a high burden of proof.

## Supersession
A later ADR may supersede this decision only by explicitly accounting for migration, ownership and affected Product/System truth.
