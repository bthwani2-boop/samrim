# Cart and Checkout

ARTIFACT_CLASS: DURABLE_PRODUCT_CAPABILITY_GOVERNANCE
SEMANTIC_OWNER: docs/governance/product/capabilities/commerce/cart-checkout.md
EXECUTION_AUTHORITY: NONE
IMPLEMENTATION_STATE_AUTHORITY: NONE
CAPABILITY_ID: CART_CHECKOUT

## Outcome

A Client builds one owned Store cart and confirms one Store-scoped checkout intent from canonical Catalog, Store, current orderability and serviceability evidence without client-authoritative eligibility or duplicate operational/financial effects.

## Ownership

DSH owns cart/checkout operational truth and the bounded delivery-recipient snapshot carried into the resulting Store Order. Catalog, Store publication, `STORE_OPERATIONAL_AVAILABILITY` and serviceability owners provide canonical evidence. WLT owns admitted financial intent/allocation. Multi-Store composition belongs to `MULTI_STORE_CHECKOUT`.

## Invariants

- one logical cart is scoped to authenticated Client and Store;
- each CartLine identifies one canonical StoreOffer and ProductVariant plus exact requested quantity and selected modifier option IDs;
- item identity, availability and commercial evidence come from canonical DSH owners;
- mutation is versioned/idempotent and one retry identity cannot represent a different payload;
- checkout carries an explicit fulfillment intent independent from payment method;
- checkout revalidates current Store operational orderability and selected fulfillment-mode availability immediately before confirmation; a published Store or enabled mode policy alone is insufficient;
- an unavailable selected mode is rejected with explicit readback and is never silently replaced by another mode;
- checkout establishes one stable logical operation identity before cross-owner financial effects; an ambiguous commit/retry cannot silently allocate another logical Order identity;
- confirmed checkout snapshots address/serviceability, Store/mode orderability evidence, item/variant/quantity/pricing/modifier evidence and other transaction facts required by `ORDER_LIFECYCLE`;
- a delivery recipient may be `SELF` or `OTHER`; when `OTHER`, only bounded recipient name/phone/delivery instructions needed for execution are snapshotted, while the purchasing Client remains Order/payment principal;
- recipient data never creates an actor, account, role or financial authority;
- stale or invalidated evidence blocks confirmation;
- client-supplied totals, Product/Variant/Offer facts, eligibility, Store scope, quantity validity, inventory, serviceability, operational availability, fulfillment authority or financial result are not authoritative.

## Financial boundary

DSH derives authoritative commercial basis from owner facts and asks WLT to establish applicable payment/collection intent through `ORDER_PAYMENT_COLLECTION`. Customer payment allocation and later settlement allocation remain separate. External-provider funding becomes checkout-usable only after `CUSTOMER_BALANCE_FUNDING` has produced canonical WLT internal balance.

## Failure and recovery

Stale cart, unavailable/unpublished Offer, invalid modifier/quantity, closed/paused Store, unavailable selected mode, unserviceable address, invalid recipient data, financial refusal, conflict, offline state and ambiguous cross-owner outcome recover through canonical reread/reconciliation. No success is reported before committed owner readback.

## Material participants

Client ordering experience, Partner new-Order readback and DSH/WLT owner runtimes are material consumers. Deployable host names and repository paths remain implementation truth.
