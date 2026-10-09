# Store Operational Availability

ARTIFACT_CLASS: DURABLE_PRODUCT_CAPABILITY_GOVERNANCE
SEMANTIC_OWNER: docs/governance/product/capabilities/partner/store-operational-availability.md
EXECUTION_AUTHORITY: NONE
IMPLEMENTATION_STATE_AUTHORITY: NONE
CAPABILITY_ID: STORE_OPERATIONAL_AVAILABILITY

## Outcome

A published Store has one DSH-owned operational-orderability truth that distinguishes durable publication and contractually admitted fulfillment modes from whether the Store and each admitted mode can accept a new order now. Partner, Client and authorized Operator surfaces read the same canonical result.

## Ownership

DSH owns Store operating schedule, one-off closure, temporary pause, bounded preparation estimate, current derived Store orderability, current fulfillment-mode availability and canonical readback. Store publication remains owned by `PARTNER_ONBOARDING_STORE_PUBLICATION`; durable fulfillment-mode admission and financial terms are governed through the Store onboarding/commercial-agreement owners; offer availability remains owned by `CENTRAL_CATALOG`; geographic serviceability remains owned by `SERVICEABILITY_ADDRESSES`; checkout confirmation remains owned by `CART_CHECKOUT`.

## Invariants

- `PUBLISHED_STORE`, `CUSTOMER_VISIBLE_OFFER`, `SERVICEABLE`, `DURABLY_ENABLED_FULFILLMENT_MODE` and `STORE_OPERATIONALLY_AVAILABLE` are distinct facts;
- publication never implies that a Store is open for orders now;
- an operational availability control may pause/resume only a fulfillment mode already durably admitted for that Store;
- operational availability can never add a new fulfillment mode or bypass Store Commercial Agreement acceptance/Finance approval when the durable change has financial meaning;
- temporarily pausing/resuming an already admitted mode does not create a new Commercial Agreement version;
- a Store has a versioned weekly operating schedule; an authorized Partner may maintain it for an owned or explicitly granted Store scope;
- DSH may represent a bounded one-off closure or temporary pause with attributable reason and optional end time;
- temporary operational pressure is represented initially by pause/unavailable semantics, not by inventing a numeric capacity engine;
- each admitted fulfillment mode may be temporarily unavailable independently when DSH has a current operational reason; no unavailable mode is silently replaced by another mode;
- a bounded preparation estimate may participate in customer orderability/readback when needed, but predictive queueing or AI preparation-time machinery is not admitted by this capability;
- checkout revalidates current Store and selected-mode orderability before creating an Order;
- Client discovery/readback may show a published Store as closed or paused without deleting or unpublishing the Store;
- an authorized Operator may perform only bounded intervention admitted by current policy; the Operator surface is not a second writer;
- mutations are versioned, attributable, idempotent and converge on canonical DSH readback.

## Minimal state semantics

The exact executable representation belongs to implementation, but current durable meaning must distinguish at least:

```text
OPEN_FOR_ORDERS
CLOSED_BY_SCHEDULE
PAUSED
OPERATIONALLY_UNAVAILABLE
```

Reason and `until` semantics are explicit when applicable. The state is derived from canonical DSH facts rather than authored by Client presentation.

## Failure and recovery

Stale schedule version, duplicate pause/resume, invalid time interval, unauthorized Store scope, attempt to operationally enable an unadmitted mode, conflicting Operator/Partner mutation, offline mutation and ambiguous commit recover through canonical DSH reread. A failed mutation never changes publication, catalog, commercial agreement or serviceability truth as a side effect.

## Material participants

Partner maintains normal Store operating state, Client consumes orderability, Operator may perform bounded authorized intervention, and DSH owns persistence/evaluation/readback.

## Explicit non-goals

This capability does not admit a generic workforce scheduler, numeric Store-capacity engine, mandatory daily check-in, queue forecasting, AI preparation prediction, route optimization, financial-rate mutation or a second Store-publication lifecycle.
