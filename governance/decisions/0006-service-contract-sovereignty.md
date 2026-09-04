# ADR 0006 — Service contract sovereignty

ARTIFACT_CLASS: DURABLE_DECISION_RATIONALE
STATUS: ACTIVE
EXECUTION_AUTHORITY: NONE

## Context
Hand-maintained root DTO/status/operation registries and duplicate generated clients drift from service owners.

## Decision
Each service owns its executable public API/event contract and deterministic generated lineage. Root contracts are limited to genuinely cross-service protocol primitives/catalog material.

## Alternatives
Central manual master API/DTO registry.

## Consequences
Contract change provenance is deterministic and duplicate semantic authorities are rejected.

## Supersession
A later ADR may supersede this decision only by explicitly accounting for migration, ownership and affected Product/System truth.
