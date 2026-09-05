# Incremental Product Delivery Guidance

DOCUMENT_CLASS: HUMAN_DEVELOPMENT_GUIDANCE
EXECUTION_AUTHORITY: NONE
PRODUCT_SEMANTIC_AUTHORITY: NONE
CURRENT_IMPLEMENTATION_AUTHORITY: NONE

## Purpose

This guide explains how to reason about a **small authorized Product slice** without turning incremental delivery into disposable architecture or a hidden roadmap.

Durable Product meaning remains in `governance/**`. The current invocation and Orchestrator own Product breadth, active slice, execution order, recovery, verification and closure. This document never chooses the next feature, fulfillment mode, payment mode, actor surface or rollout sequence.

## Core discipline

```text
TARGET_PRODUCT_VISION != AUTHORIZED_PRODUCT_SCOPE
AUTHORIZED_PRODUCT_SCOPE != CURRENT_IMPLEMENTATION_STATE
SMALL_BREADTH != TEMPORARY_ARCHITECTURE
```

For an already-authorized slice:

- resolve the durable Product/capability/journey owners first;
- use the final canonical owner/model for the admitted behavior;
- close the complete materially affected vertical path and required readback;
- preserve prerequisites, security, financial and data invariants actually exercised;
- keep future Product breadth absent rather than represented by fake screens, APIs, tables, enum values or compatibility structures;
- re-run prior evidence invalidated by shared owners/contracts/data/runtime/hosts.

## What incremental must not mean

Do not create:

```text
simple_*
*_v1
bootstrap_* BUSINESS MODELS
FAKE BUSINESS ROUTES/TABLES
SHADOW DTOs
TEMPORARY STATE MACHINES
PLACEHOLDER PRODUCT SCREENS
SPECULATIVE PROVIDER/FRAMEWORK ABSTRACTIONS
PARALLEL SOURCES OF TRUTH
```

A host may be technically ready while its business journeys remain unimplemented. Host readiness does not authorize Product furnishing.

## Slice reasoning questions

Before implementing behavior **already authorized by the invocation**, ask:

1. Which durable capability/journey outcome is being delivered?
2. Which canonical owner/writer/data/contract owns every material effect?
3. Which surfaces and readbacks are required by this slice?
4. Which security, financial, migration, provider or compatibility consequences are actually activated?
5. Which future breadth remains deliberately absent?
6. What previously proven behavior is invalidated and must be reverified?

These questions help implement an authorized slice; they do not authorize a new one.

## Donor and OSS

Inspect only the donor/OSS evidence cone capable of changing the authorized slice's semantics, ownership, edge cases, failure/recovery behavior, UX or tests. Extract applicable truth; never import donor topology or activate adjacent features merely because a reference product contains them.
