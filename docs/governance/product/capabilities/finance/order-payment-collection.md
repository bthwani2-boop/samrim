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
- before collection, an accepted OrderAdjustment may create one unresolved WLT reconciliation case linked to the still-uncollected payment; this is a durable handoff, not authority to alter the original payable amount, collect more money, refund, or credit a wallet. The order remains blocked from an incompatible fulfillment transition until an authorized pre-collection repricing/cancellation treatment is implemented and confirmed from WLT;
- after collection, a proven customer credit is returned to the existing BThwani Customer Wallet by default, spendable across eligible Stores; no standalone refund system or routine Customer action is required; the current implemented Finance-reviewed platform-expense credit applies only to a completed customer-approved full item removal without promotions, with original line amount and WLT collected payment independently verified; other economic responsibility/adjustments remain unresolved until their proper settlement is available;
- an accepted OrderAdjustment first records one existing WLT reconciliation case; no wallet credit may post until collected facts, the actual approved delta and all affected funding/Store/commission entitlements are reconciled; WLT owns one idempotent balanced posting and authoritative wallet history;
- cancellation or correction before collection is a payment-obligation change, not a customer refund; uncertain collection remains unresolved;
- exceptional external official-wallet refund or balance withdrawal requires the existing Operations/Finance manual authorization, transfer receipt and independent reconciliation, without a physical cash handover or duplicate credit;
- cancelled payment intents are not eligible for new OrderAdjustment reconciliation cases;
- duplicate/retried OrderAdjustment identity cannot create a duplicate financial effect;
- where a substitute/actual measure would require more value than the already authorized amount, WLT determines the legal additional financial treatment; DSH/Partner cannot assume extra collection authority;
- for `CUSTOMER_PICKUP` paid with cash at the Store, the Store receives and retains the customer's sale proceeds; WLT records the Order-bound collection and the versioned commission receivable owed by the responsible Partner;
- Partner commission uses product value as its calculation basis and is governed by the active Store-specific `STORE_COMMERCIAL_AGREEMENT` for that Store and fulfillment mode. Each applicable Order snapshots the agreement identity and version, fulfillment mode, commission rate, calculation basis and required rounding facts; later agreement changes never reinterpret an existing Order;
- for `PARTNER_CAPTAIN`, the Store chooses an approved free, fixed or distance-based customer delivery fee under its versioned Store agreement; Store-Captain remuneration remains a Store responsibility outside BThwani Captain Wallet, and the fee's economic owner is snapshot per Order;
- when a Store Captain collects cash for a `PARTNER_CAPTAIN` Order, sale proceeds belong to Store/Partner and the Captain hands them to the Store; DSH records collection/handoff/Store acknowledgment outside WLT, and WLT creates no BThwani-Captain COD receivable, Captain earning or wallet movement for those proceeds;
- Store-collected pickup cash never creates BThwani Captain cash custody, COD exposure, Captain COD remittance or a duplicate Partner wallet credit for sale proceeds already retained by the Store;
- customer payment allocation does not include merchant/platform settlement funding;
- external provider funding first becomes WLT internal balance through `CUSTOMER_BALANCE_FUNDING`;
- accepting BThwani Captain COD reserves 100% of the Order's actual cash source, atomically against posted unheld coverage; prepaid-only Orders have no COD coverage requirement;
- on confirmed collection and successful delivery by that same Captain, WLT atomically debits the reserved cash amount from the Captain Wallet and offsets the posted COD receivable once; the Captain retains the physical cash, with no second remittance to BThwani;
- cancellations before collection release the COD hold; legacy FINALIZED/REMITTED records must be reconciled with their actual historical evidence instead of being debited automatically;
- Partner commission receivable settlement/remittance is distinct from Partner sale proceeds and from beneficiary earnings payout;
- collection, adjustment, cancellation/refund, remittance and reconciliation are idempotent and preserve stable logical identities;
- ambiguous distributed/provider outcomes remain explicit until reconciled;
- no surface or DSH projection becomes payment truth.

## Failure and recovery

Insufficient balance/exposure, adjustment delta refusal, unknown provider outcome, duplicate collection/delta/remittance, wrong collected amount, cancellation race, unresolved Partner commission receivable, remittance uncertainty and refund exception fail closed or remain reconciliation-required from canonical WLT state.
