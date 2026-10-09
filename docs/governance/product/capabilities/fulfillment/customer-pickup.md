# Customer Pickup

ARTIFACT_CLASS: DURABLE_PRODUCT_CAPABILITY_GOVERNANCE
SEMANTIC_OWNER: docs/governance/product/capabilities/fulfillment/customer-pickup.md
EXECUTION_AUTHORITY: NONE
IMPLEMENTATION_STATE_AUTHORITY: NONE
CAPABILITY_ID: CUSTOMER_PICKUP

## Outcome

A `CUSTOMER_PICKUP` Store Order reaches governed Store pickup readiness and is released to the authorized customer exactly once with canonical proof/readback and no Captain assignment.

## Ownership

DSH owns pickup eligibility, readiness, proof and operational completion. WLT owns applicable payment/refund effects.

## Invariants

- pickup is explicit Order fulfillment mode;
- no Captain assignment/handoff/cash-custody fact is invented for pickup;
- delivery-address fields that are not meaningful to pickup cannot be required merely because another fulfillment mode uses them;
- Store confirms readiness before customer pickup completion;
- pickup proof is bounded to the Order and cannot be replayed for another Order;
- customer payment method remains a separate decision.

## Failure and recovery

Customer no-show, stale readiness, duplicate proof, wrong customer, cancellation and payment/refund uncertainty remain explicit and reconcile through canonical owners.
