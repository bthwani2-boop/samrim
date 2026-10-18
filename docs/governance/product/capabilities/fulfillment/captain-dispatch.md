# Captain Dispatch

ARTIFACT_CLASS: DURABLE_PRODUCT_CAPABILITY_GOVERNANCE
SEMANTIC_OWNER: docs/governance/product/capabilities/fulfillment/captain-dispatch.md
EXECUTION_AUTHORITY: NONE
IMPLEMENTATION_STATE_AUTHORITY: NONE
CAPABILITY_ID: CAPTAIN_DISPATCH

## Outcome

A ready `BTHWANI_CAPTAIN` Store Order may receive up to three concurrent DSH dispatch offers to eligible Captains, but at most one active assignment. The first valid, transactionally committed acceptance wins; all other open offers are superseded with capacity and financial exposure reconciled. Partner Captain dispatch remains separately governed.

## Ownership

DSH owns Captain standing operational eligibility/availability, dispatch offer, assignment and reassignment truth. WLT owns COD exposure/hold and other financial effects.

## Admission boundary

DSH establishes standing Captain operational eligibility before authorized Identity role admission. A transient delivery assignment is not standing role admission.

Store-affiliated Partner Captain eligibility belongs to `STORE_CAPTAIN_MEMBERSHIP` and does not silently place that relationship into the platform Captain dispatch pool.

## Invariants

- only a ready `BTHWANI_CAPTAIN` order is platform-dispatchable;
- one platform-dispatch batch creates no more than three concurrent offers to distinct eligible available Captains;
- only an eligible available Captain with required financial exposure capacity may accept an applicable COD offer;
- one order has at most one active assignment, regardless of competing acceptances;
- successful assignment supersedes all losing open offers and restores their available capacity and financial holds through their owning services;
- capacity, eligibility and financial authorization are owner-backed and enforced under concurrency;
- only the authenticated offered Captain may accept/reject the live offer;
- expiry and rejection are durable decisions;
- reassignment before pickup is canonical and must reconcile any prior financial hold; after custody begins, ordinary reassignment is forbidden;
- no surface computes final dispatch authority.

## Failure and recovery

No eligible Captain, insufficient governed exposure, timeout, decline, stale offer, concurrent assignment, financial-hold failure, reassignment conflict and offline state preserve one assignment truth. Unknown cross-owner effects reconcile before another assignment/hold creates duplicate liability.
