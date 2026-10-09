# Multi-Store Checkout

ARTIFACT_CLASS: DURABLE_PRODUCT_CAPABILITY_GOVERNANCE
SEMANTIC_OWNER: docs/governance/product/capabilities/commerce/multi-store-checkout.md
EXECUTION_AUTHORITY: NONE
IMPLEMENTATION_STATE_AUTHORITY: NONE
CAPABILITY_ID: MULTI_STORE_CHECKOUT

## Outcome

One customer checkout container may coordinate purchases from multiple Stores while creating independent canonical Store Orders and preserving per-Store fulfillment, financial and exception isolation.

## Ownership

DSH owns parent checkout composition and child Store Order relations. Each child Order remains owned by `ORDER_LIFECYCLE`; WLT owns per-child financial allocation/effects. Grouped pickup/delivery planning, when admitted by actual volume, remains DSH operational truth.

## Invariants

- one child Store Order belongs to one Store;
- parent checkout never becomes a multi-Store Order writer that erases child autonomy;
- child fulfillment modes may differ where Product rules permit;
- financial allocation/effects are traceable per child;
- partial failure/cancellation/refund is explicit and idempotently reconciled;
- parent cannot appear fully complete while an accepted child or associated financial effect remains unresolved;
- grouped delivery/pickup optimization may coordinate children but cannot merge their ownership or settlement truth.
- grouped planning is bounded operational coordination; advanced route-optimization is not admitted by this capability.

## Failure and recovery

Partial child creation, financial refusal, Store rejection, mixed fulfillment failure, grouped-delivery failure and retry ambiguity reconcile per child and at parent readback without duplicate Orders or money movement.
