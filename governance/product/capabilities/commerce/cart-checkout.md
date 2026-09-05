# Cart Checkout

ARTIFACT_CLASS: DURABLE_PRODUCT_CAPABILITY_GOVERNANCE
SEMANTIC_OWNER: governance/product/capabilities/commerce/cart-checkout.md
EXECUTION_AUTHORITY: NONE
CLOSURE_AUTHORITY: NONE
IMPLEMENTATION_STATE_AUTHORITY: NONE
PARENT_CAPABILITY_INDEX: governance/product/CAPABILITIES.md
CAPABILITY_ID: CART_CHECKOUT

## Scope

This file is the **sole editable durable semantic owner** of `CART_CHECKOUT`. Capability taxonomy/schema/admission law remains in `../../CAPABILITIES.md`; cross-capability journey semantics remain in `../../JOURNEYS.md`.

### CART_CHECKOUT

**Problem.** Cart mutation, checkout validation and WLT handoff can diverge when item price, serviceability, address, fulfillment, quote or idempotency state is recomputed independently across client/order/payment layers.
**Target state.** DSH owns one versioned cart and checkout-intent lifecycle whose accepted evidence is server-derived, concurrency-safe and financially gated by WLT quote/session references before Order Creation can begin.
**Primary success measure.** eligible checkout intents reaching one canonical ready/confirmed result without duplicate cart mutation, stale pricing or ambiguous financial handoff.
**Guardrail measures.** client-authoritative price count; duplicate logical cart mutation; stale-version acceptance; checkout-ready after serviceability denial; duplicate WLT session/reference; order creation from blocked/expired checkout.

**Required outcome.** A customer can build one owned store cart, receive canonical current pricing/serviceability/fulfillment validation, and progress through one checkout intent to a confirmed/eligible handoff for Order Creation without duplicating money or operational truth.

**Primary actors.** customer, DSH cart/checkout system, WLT pricing/payment system, authorized operator for diagnostics.

**Canonical ownership.** DSH owns cart and checkout operational truth; canonical catalog/store/address/serviceability owners provide evidence; WLT owns authoritative financial quote/payment-session truth; Order Creation begins only after the governed checkout eligibility boundary.

**Boundary/non-overlap.** ORDER_CREATION owns only creation of the canonical order from an eligible confirmed checkout. CART_CHECKOUT owns the cart and checkout-intent lifecycle up to that handoff and cannot mutate the created order as if it were checkout state.

**Material deployable surfaces.** app-client and authorized control-panel diagnostics when operationally required.

**Business invariants**
- one active logical cart is scoped to the authenticated customer/store/current commerce flow;
- item product identity, quantity bounds, unit-price/currency evidence and assortment eligibility come from canonical server owners, never client totals;
- cart mutation is versioned and idempotent; the same mutation identity cannot represent a different payload;
- fulfillment mode must be one currently allowed by DSH policy, including bthwani_delivery, partner_delivery or client_pickup where eligible;
- non-empty checkout cannot be financially ready without the required current WLT quote/payment evidence;
- checkout intent snapshots the governed address/serviceability/fulfillment/commercial evidence needed for downstream Order Creation;
- validation does not silently mutate unrelated owner state.

**Durable state semantics.**
- cart is active until explicitly abandoned/cleared by the governed lifecycle;
- checkout intent progresses through draft, validating, ready or blocked, confirming, then confirmed, cancelled or expired;
- ready/confirmed is invalidated by materially stale cart/address/serviceability/quote evidence according to current contract/version rules.

**Forbidden/negative invariants**
- no client-supplied price, fee, discount, currency or eligibility becomes authoritative;
- no stale cart version mutates current state;
- no blocked/expired checkout creates an order;
- no duplicate WLT session or financial effect from retry;
- no DSH cart/checkout row becomes WLT financial truth;
- no cached discovery/serviceability result authorizes checkout after canonical denial.

**Failure/recovery.** stale version, item/assortment invalidation, address/serviceability denial, disabled fulfillment mode, quote unavailable/stale, WLT timeout/unknown, idempotency conflict or checkout expiry; reread canonical owners, preserve the original logical operation identity and reconcile ambiguous WLT outcomes before retry.

**Acceptance expectations.** cart totals are reproducible from authoritative evidence; checkout readiness reports exact blocking reasons; canonical readback survives retry/restart; confirmed checkout carries the immutable evidence required by Order Creation; no duplicate order/payment effect is possible from a replayed intent.

**Actor responsibility envelope**
- `customer` — mutates only the owned cart, selects allowed fulfillment/address intent and confirms checkout; forbidden: supply authoritative money/eligibility, select another actor/cart or bypass blockers.
- `DSH cart/checkout system` — validates owner evidence, versions/idempotency, snapshots checkout evidence and orchestrates WLT references; forbidden: post ledger truth or fabricate WLT success.
- `WLT system` — produces authoritative quote/payment-session facts and reconciles unknown financial outcomes; forbidden: own DSH cart/order operational lifecycle.
- `operator` — reads scoped diagnostics/recovery state only through governed interfaces.

**Surface semantics**
- `app-client` — required; states include empty, active, validating, ready, blocked, confirming, confirmed, expired, conflict, offline, partial and error; actions include add/update/remove, select allowed fulfillment/address, refresh/requote, confirm and resume.
- `control-panel` — conditional diagnostics only; no normal customer mutation authority.
- `backend` — required canonical cart/checkout owner and cross-service orchestration.
- `database` — required version/idempotency/snapshot persistence and audit where applicable.
- technical presentation binding — implementation evidence only; maps contract state and canonical readback without local commerce truth.
