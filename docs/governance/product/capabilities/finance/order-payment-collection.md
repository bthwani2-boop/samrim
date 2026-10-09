# Order Payment and Collection

ARTIFACT_CLASS: DURABLE_PRODUCT_CAPABILITY_GOVERNANCE
SEMANTIC_OWNER: docs/governance/product/capabilities/finance/order-payment-collection.md
EXECUTION_AUTHORITY: NONE
IMPLEMENTATION_STATE_AUTHORITY: NONE
CAPABILITY_ID: ORDER_PAYMENT_COLLECTION

## Outcome

Every admitted Store Order has one WLT-owned payment/collection truth that conserves the customer's payable amount across admitted sources and reconciles legal Order adjustments, delivery COD, Store-collected cash, Partner commission receivables and refund effects without duplicate movement.

## Ownership

WLT owns payment intent, customer payment allocation, collection state, Order-adjustment financial deltas, COD receivable/exposure, Partner commission receivable, refund/reversal treatment and financial readback. DSH owns operational Order/fulfillment/adjustment facts that qualify financial effects.

## Invariants

- payment method/source is independent from fulfillment mode;
- customer funding allocation currently composes admitted WLT internal balance and/or cash semantics; external provider account balance is never directly authoritative at checkout;
- original financial confirmation remains attributable to the original Order snapshot; an approved DSH OrderAdjustment causes a new WLT delta/reversal/additional-treatment fact rather than rewriting prior ledger movement;
- duplicate/retried OrderAdjustment identity cannot create a duplicate financial effect;
- where a substitute/actual measure would require more value than the already authorized amount, WLT determines the legal additional financial treatment; DSH/Partner cannot assume extra collection authority;
- for `CUSTOMER_PICKUP` paid with cash at the Store, the Store receives and retains the customer's sale proceeds; WLT records the Order-bound collection and the versioned commission receivable owed by the responsible Partner;
- Partner commission uses product value as its calculation basis and is governed by the active Store-specific `STORE_COMMERCIAL_AGREEMENT` for that Store and fulfillment mode. Each applicable Order snapshots the agreement identity and version, fulfillment mode, commission rate, calculation basis and required rounding facts; later agreement changes never reinterpret an existing Order;
- for the initial `PARTNER_CAPTAIN` release, no customer delivery fee is charged; Store-Captain remuneration remains an off-WLT Store responsibility;
- when a Store Captain collects cash for a `PARTNER_CAPTAIN` Order, sale proceeds belong to Store/Partner and the Captain hands them to the Store; DSH records collection/handoff/Store acknowledgment outside WLT, and WLT creates no BThwani-Captain COD receivable, Captain earning or wallet movement for those proceeds;
- Store-collected pickup cash never creates BThwani Captain cash custody, COD exposure, Captain COD remittance or a duplicate Partner wallet credit for sale proceeds already retained by the Store;
- customer payment allocation does not include merchant/platform settlement funding;
- external provider funding first becomes WLT internal balance through `CUSTOMER_BALANCE_FUNDING`;
- COD risk hold is not ordinary payment consumption;
- BThwani Captain COD delivery completion does not close the COD receivable; authorized remittance plus reconciliation closes the corresponding receivable/exposure;
- Partner commission receivable settlement/remittance is distinct from Partner sale proceeds and from beneficiary earnings payout;
- collection, adjustment, cancellation/refund, remittance and reconciliation are idempotent and preserve stable logical identities;
- ambiguous distributed/provider outcomes remain explicit until reconciled;
- no surface or DSH projection becomes payment truth.

## Failure and recovery

Insufficient balance/exposure, adjustment delta refusal, unknown provider outcome, duplicate collection/delta/remittance, wrong collected amount, cancellation race, unresolved Partner commission receivable, remittance uncertainty and refund exception fail closed or remain reconciliation-required from canonical WLT state.
