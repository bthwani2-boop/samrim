# Order Lifecycle

ARTIFACT_CLASS: DURABLE_PRODUCT_CAPABILITY_GOVERNANCE
SEMANTIC_OWNER: docs/governance/product/capabilities/commerce/order-lifecycle.md
EXECUTION_AUTHORITY: NONE
IMPLEMENTATION_STATE_AUTHORITY: NONE
CAPABILITY_ID: ORDER_LIFECYCLE

## Outcome

One eligible confirmed Store-scoped checkout creates at most one canonical DSH Store Order, preserving original purchased evidence, explicit fulfillment meaning, attributable legal post-confirmation adjustments and legal operational transitions through completion/exception.

## Ownership

DSH owns operational Order truth, original confirmation snapshot, OrderAdjustment history, cancellation/failure/dispute operational state and final fulfilled snapshot. WLT owns every financial effect, including adjustment deltas/refunds/reconciliation. Mode-specific execution is owned by the applicable fulfillment capability.

## Invariants

- one canonical Store-scoped checkout operation yields at most one Store Order;
- one Store Order belongs to exactly one Store;
- a parent Multi-Store checkout never collapses multiple Stores into one Store Order;
- the durable Order model distinguishes `BTHWANI_CAPTAIN`, `PARTNER_CAPTAIN` and `CUSTOMER_PICKUP`; fulfillment mode is distinct from payment method;
- the Client selects one fulfillment mode from current canonical eligible modes; checkout rejects disabled/unavailable mode and snapshots the selection without fallback;
- when adding a fulfillment mode, any required backfill must preserve existing Order identities and explicit historical mode meaning; never silently reinterpret past Orders to introduce another mode;
- required StoreOffer/ProductVariant/display-name/variant/modifier/requested-quantity/pricing/amount/serviceability and other purchase evidence remains the original confirmation snapshot;
- a legal post-confirmation change never mutates that original snapshot in place; it creates an attributable OrderAdjustment and contributes to a separate final fulfilled snapshot;
- an OrderAdjustment may cover bounded item removal, eligible substitution or actual fulfilled quantity/measure where current catalog quantity semantics permit it;
- a required customer decision is explicit when the adjustment materially changes what the customer will receive/pay; Partner cannot self-approve a customer-required substitute merely by continuing preparation;
- unresolved mandatory adjustment blocks readiness/completion until it reaches a legal outcome or the Order enters the appropriate exception/cancellation path;
- WLT alone owns resulting financial delta, refund or additional required financial treatment; DSH never infers ledger completion from operational adjustment state;
- a delivery recipient snapshot may differ from the purchasing Client, but it has no Order/payment authority;
- Partner acts only on Orders for an authorized owned/granted Store scope;
- Partner acceptance, rejection, preparation and readiness are canonical DSH transitions;
- cancellation/failure/refund eligibility derives from explicit canonical state, custody, adjustment and policy rather than UI inference;
- after delivery/pickup, wrong/damaged/missing-item review may open a bounded post-completion incident/refund branch without reopening or rewriting the completed Order;
- generic returns/exchanges/warranty management is not admitted by this capability;
- basic rating/feedback may attach to a completed Order as bounded feedback and remains independent from conversation closure;
- canonical readback is required after mutation.

## Order adjustment boundary

```text
PARTNER reports item unavailable / quantity difference
→ DSH validates canonical OrderLine + allowed action
→ remove OR propose eligible substitute OR record actual quantity
→ CLIENT decision when required
→ DSH appends immutable attributable adjustment
→ WLT applies/reconciles financial effect
→ DSH exposes final fulfilled snapshot
```

Retry of the same logical adjustment cannot create another adjustment/effect. A replacement remains a canonical referenced item/variant where required; free-text substitution is not transaction authority.

## Lifecycle boundary

The Partner preparation path is common until fulfillment readiness. Downstream state is mode-specific: platform Captain dispatch, Store-affiliated Captain fulfillment or Customer Pickup. Delivery/pickup completion and governed failures remain explicit. Conversation is parallel to this lifecycle and cannot mutate Order/payment/custody truth.

## Failure and recovery

Handle duplicate creation, stale version, unauthorized Store scope, rejection, cancellation, preparation conflict, item unavailable, adjustment timeout/rejection/conflict, concurrent cancellation, fulfillment failure, custody mismatch, post-completion dispute, retry conflict and restart/resume without forking Order truth. Cross-owner financial consequences reconcile through WLT rather than being inferred from DSH state alone.
