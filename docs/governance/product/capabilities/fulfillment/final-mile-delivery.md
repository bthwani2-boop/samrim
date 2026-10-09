# Final Mile Delivery

ARTIFACT_CLASS: DURABLE_PRODUCT_CAPABILITY_GOVERNANCE
SEMANTIC_OWNER: docs/governance/product/capabilities/fulfillment/final-mile-delivery.md
EXECUTION_AUTHORITY: NONE
IMPLEMENTATION_STATE_AUTHORITY: NONE
CAPABILITY_ID: FINAL_MILE_DELIVERY

## Outcome

After governed Store-to-Captain custody transfer, the canonical Captain completes one Captain-delivered Store Order to one terminal DSH result with consistent participant readback and bounded delivery evidence.

## Ownership

DSH owns operational delivery lifecycle/result, bounded tracking projection, Order recipient-contact use, delivery-evidence relationship/validation and physical cash possession/collection/handoff facts where applicable. WLT owns canonical payment collection truth, COD receivable/exposure, earnings, remittance and other financial effects. Customer Pickup is a separate fulfillment capability.

## Invariants

- delivery begins only after canonical Captain pickup/custody;
- only the canonical current Captain may advance active delivery;
- terminal completion is recorded once and cannot be duplicated by retry;
- delivery proof and payment collection are distinct owner-backed facts even when one user action triggers both;
- proof may use a bounded policy-approved mechanism such as PIN, QR, signature or media evidence; no uploaded file or UI success indicator is by itself delivery truth;
- DSH validates proof/evidence against canonical Order/assignment/custody context before terminal transition;
- the purchasing Client remains Order/payment principal even when the delivery recipient is `OTHER`;
- Captain receives only the bounded recipient contact/instructions needed for current delivery and that data grants no account/financial authority;
- failed/blocked attempt remains explicit canonical state until legal recovery;
- a recoverable failure preserves physical-custody responsibility until governed recovery/return/custody transition resolves it;
- customer/Partner/Operator tracking is a DSH projection, not a writer;
- restart/retry use canonical readback rather than local state.

## Failure and recovery

Connectivity loss, stale version, duplicate submission, invalid proof, unavailable recipient/customer, payment-collection uncertainty, failed delivery and governed return-to-Store preserve one canonical operational state and safe reconciliation/resume path. WLT effects must not be treated as atomically committed merely because DSH completion was attempted.
