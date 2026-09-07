# Order Creation

ARTIFACT_CLASS: DURABLE_PRODUCT_CAPABILITY_GOVERNANCE
SEMANTIC_OWNER: governance/product/capabilities/commerce/order-creation.md
EXECUTION_AUTHORITY: NONE
CLOSURE_AUTHORITY: NONE
IMPLEMENTATION_STATE_AUTHORITY: NONE
PARENT_CAPABILITY_INDEX: governance/product/CAPABILITIES.md
CAPABILITY_ID: ORDER_CREATION

## Scope

This file is the **sole editable durable semantic owner** of `ORDER_CREATION`. Capability taxonomy/schema/admission law remains in `../../CAPABILITIES.md`; cross-capability journey semantics remain in `../../JOURNEYS.md`.

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
