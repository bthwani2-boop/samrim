# Commerce Ordering Capabilities

ARTIFACT_CLASS: DURABLE_PRODUCT_CAPABILITY_GOVERNANCE
SEMANTIC_OWNER: governance/product/capabilities/commerce-ordering.md
EXECUTION_AUTHORITY: NONE
CLOSURE_AUTHORITY: NONE
IMPLEMENTATION_STATE_AUTHORITY: NONE
PARENT_CAPABILITY_INDEX: governance/product/CAPABILITIES.md

## Scope

This owner defines only the durable capability semantics listed below. Capability taxonomy/schema/admission law remains in `../CAPABILITIES.md`; cross-capability journeys remain in `../JOURNEYS.md`.

### ORDER_CREATION — إنشاء الطلب وحقيقة الطلب

**Problem.** A valid checkout intent must create at most one auditable DSH order whose accepted commercial/address/item snapshots and operational truth cannot be silently repriced, rebound or duplicated under retry/concurrency.
**Target state.** Retries/concurrency cannot duplicate the order, accepted snapshots remain stable, all affected surfaces read the same authorized operational truth, and no DSH/frontend financial authority is created.

**Required outcome.** One eligible checkout intent yields one canonical DSH order with durable accepted snapshots, authorized multi-surface readback and WLT-owned financial projection semantics.

**Primary actors.** client, partner, operator, system.

**Canonical ownership.** DSH operational order truth; WLT financial truth.

**Boundary/non-overlap.** CART_CHECKOUT owns cart mutation, checkout validation, checkout-intent state and the eligibility handoff. ORDER_CREATION begins only after that boundary and owns atomic order creation plus immutable accepted order snapshots; it does not re-own cart or checkout state.

**Material deployable surfaces.** app-client, app-partner, control-panel.

**Business invariants**
- DSH owns order operational truth; WLT owns financial truth.
- A canonical eligible checkout/idempotency scope yields at most one order.
- Accepted commercial/address/item snapshots required by the contract remain stable after creation unless a later explicit legal transition governs a change.
- All required surfaces consume one authorized DSH order truth and bounded WLT-backed financial projection.
- Required operational event/outbox state follows the same transactional consistency guarantees as order creation.

**Forbidden/negative invariants**
- No order is created from an invalid/ineligible checkout intent.
- No duplicate order is created for one canonical checkout/idempotency scope.
- No accepted snapshot is silently re-derived from live catalog/address state.
- No frontend derives allowed business actions solely from a local status label.
- No surface exposes full address PII to an actor that does not operationally require it.
- No DSH/frontend path performs debit, refund, settlement or balance mutation as order-creation truth.

**Acceptance expectations**
- One checkout intent/canonical idempotency scope creates at most one order even under concurrent retry.
- The created order carries the governed identifiers/versioning required for subsequent concurrency-safe transitions.
- Order items, prices, currency, address and fulfillment snapshots required by the contract are fixed at creation and are not re-derived from live catalog state.
- Client, partner and operator readbacks expose the same operational truth with actor-appropriate redaction.
- Payment state is a read-only WLT-owned projection and DSH performs no authoritative financial mutation for order creation.
- Required operational event/outbox effects are persisted with the order under the required transactional discipline and remain retry/reconciliation safe.
- Affected surfaces expose truthful loading/empty/offline/forbidden/conflict/partial/error/retry states without mock/local truth.
- Every read/write is scoped by trusted context plus actor/object authorization and produces attributable correlation/audit evidence where required.

**Named failure classes:** ineligible_checkout_created, duplicate_order_for_checkout, snapshot_repriced_or_rebound, frontend_status_authority, cross_scope_order_access, address_pii_overexposed, dsh_financial_mutation, success_without_canonical_readback.

**Actor responsibility envelope**
- `client` — Creates an order from an owned eligible checkout intent and reads only authorized customer order truth.; permitted: submit eligible checkout intent for order creation, read owned order, retry with governed idempotency semantics; forbidden: supply authoritative price/financial truth, create from another client checkout intent, change immutable order snapshots after creation.
- `partner` — Reads/operates store-scoped order truth after creation according to later legal transitions.; permitted: read authorized owned-store order, consume immutable order snapshot; forbidden: reprice the created order, change client address snapshot, read another store order, mutate WLT financial truth.
- `operator` — Reads or performs separately authorized order operations without changing canonical creation truth outside legal transitions.; permitted: read authorized order truth, perform explicitly governed later order operations; forbidden: create duplicate order, rewrite immutable commercial/address/item snapshot, mutate WLT financial truth through DSH.
- `system` — Validates the checkout intent and atomically persists one DSH order plus required operational event/outbox effects.; permitted: validate checkout eligibility, enforce one-order-per-canonical-idempotency scope, persist immutable snapshots, emit required operational event/outbox, return canonical readback; forbidden: rederive accepted price from live catalog after creation, create duplicate order on retry, treat WLT projection as DSH-owned finance.

**Surface semantics**
- `app-client` — required; actors: client; states: loading, success, offline, forbidden, conflict, partial, error; actions: create order from eligible checkout, read order, retry/recover.
- `app-partner` — required; actors: partner; states: loading, empty, ready, forbidden, offline, error; actions: read owned-store order truth.
- `control-panel` — required; actors: operator; states: loading, ready, not_found, forbidden, error; actions: read authorized order truth.
- `backend` — required; actors: client, partner, operator, system; states: authorized, forbidden, invalid_checkout, conflict, idempotent_replay, created; actions: authorize, validate checkout, persist order snapshot, persist required event/outbox, return canonical readback.
- `database` — required; actors: system; states: transactional, idempotent, snapshot_persisted, auditable; actions: enforce one order per canonical checkout/idempotency identity, persist immutable required snapshot, atomically retain required operational event/outbox state.
- technical presentation binding — required implementation evidence; actors: client, partner, operator; states: loading, success, forbidden, conflict, offline, error; actions: map canonical contract state, coordinate readback, avoid local order/payment authority.
- `app-captain` — excluded; states: not_affected; exclusion reason: Captain enters later dispatch/fulfillment journeys, not order creation.
- `app-field` — excluded; states: not_affected; exclusion reason: Field actors do not own order creation/truth under the current model.

**Additional durable semantic model**

```json
{
  "preconditions": [
    "Checkout intent belongs to the same server-resolved business scope and client required by the current contract.",
    "Checkout intent is in the financial/operational state allowed for order creation, including COD when applicable.",
    "Cart is active/non-empty and each item has a valid accepted commercial snapshot.",
    "Address, fulfillment mode and serviceability are proven in the checkout intent.",
    "Any WLT reference required by checkout remains a reference and does not grant DSH financial ownership."
  ]
}
```

**Primary success measure.** eligible confirmed checkout intents producing exactly one canonical order with immutable accepted snapshots and owner-side readback.
**Guardrail measures.** duplicate order per checkout; order from blocked/expired checkout; snapshot repricing/rebinding; DSH financial write; success without persisted readback.

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
