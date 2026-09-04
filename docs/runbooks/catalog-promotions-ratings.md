# Catalog, Promotions and Ratings Recovery

DOCUMENT_CLASS: OPERATIONAL_RUNBOOK
PRODUCT_AUTHORITY: NONE

## Catalog/publication

When an item/store unexpectedly appears or disappears from discovery, trace canonical catalog identity, approval/publication eligibility, store/serviceability state and derived search/discovery freshness. Do not fix visibility only in the client or search index.

If the derived index is stale, rebuild/reconcile it from source owners and verify both positive-visible and negative-hidden cases.

## Promotions/coupons

For incorrect eligibility or amount, identify DSH operational eligibility and any WLT monetary effect separately. Prevent duplicate application, stale/expired scope and double funding. If a financial effect is ambiguous, follow WLT unknown-outcome/reconciliation rules rather than applying a second discount/credit.

## Ratings/reviews

Validate eligibility, author/object scope, duplicate/spam controls and moderation state. Derived aggregate scores/search ranking must be reconciled from canonical rating/review records; do not edit aggregates as source truth.

## Closure

Verify owner-side readback, customer/operator surface consistency, derived index/aggregate freshness, authorization and any WLT financial consequence before closing the incident.
