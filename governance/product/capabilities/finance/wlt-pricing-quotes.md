# Wlt Pricing Quotes

ARTIFACT_CLASS: DURABLE_PRODUCT_CAPABILITY_GOVERNANCE
SEMANTIC_OWNER: governance/product/capabilities/finance/wlt-pricing-quotes.md
EXECUTION_AUTHORITY: NONE
CLOSURE_AUTHORITY: NONE
IMPLEMENTATION_STATE_AUTHORITY: NONE
PARENT_CAPABILITY_INDEX: governance/product/CAPABILITIES.md
CAPABILITY_ID: WLT_PRICING_QUOTES

## Scope

This file is the **sole editable durable semantic owner** of `WLT_PRICING_QUOTES`. Capability taxonomy/schema/admission law remains in `../../CAPABILITIES.md`; cross-capability journey semantics remain in `../../JOURNEYS.md`.

### WLT_PRICING_QUOTES

**Problem.** Checkout pricing can be manipulated or overflow if client values or unsigned/unbounded evidence are trusted.

**Required outcome.** WLT produces one bounded, currency-consistent quote from authoritative pricing evidence tied to client/store/cart identity and version.

**Primary actors.** customer as intent source, DSH pricing/catalog evidence producer, WLT system, authorized operator for diagnostics only.

**Canonical ownership.** WLT quote/allocation financial computation; source commercial item evidence comes from canonical DSH owners.

**Material surfaces.** app-client checkout readback, DSH↔WLT integration, control-panel diagnostics where authorized.

**Durable semantics.** every line has canonical product identity/quantity and authoritative unit-price evidence; currency is one governed currency per quote; fee/discount figures are non-negative and bounded; quote is correlated to cart version and source evidence version.

**Forbidden/negative invariants.**
- no client-supplied unit price/fee/discount is authoritative;
- no overflow/unbounded quantity/amount;
- no mismatched product/currency evidence;
- no quote accepted without authentic source evidence;
- no quote becomes a ledger posting until the owning payment/checkout transition authorizes it.

**Failure/recovery.** invalid/bounds failure, stale/mismatched evidence, unavailable evidence verifier/owner, cart version conflict; reacquire canonical evidence and requote.

**Acceptance expectations.** quote arithmetic conserves totals, evidence provenance is verifiable, and checkout/order snapshot preserves the accepted commercial/financial basis.

**Target state.** One WLT quote lifecycle computes bounded currency-consistent totals from authenticated DSH evidence and exposes versioned readback without becoming a ledger posting by itself.
**Primary success measure.** quotes reproducible from accepted source evidence/cart version with conserved totals.
**Guardrail measures.** client-authoritative price; overflow/unbounded quantity; mismatched currency/product; stale evidence accepted; quote posted to ledger without owning transition.
**Business invariants**
- authoritative item/commercial evidence comes from canonical DSH owners;
- WLT alone computes authoritative quote allocation/financial arithmetic;
- quote is correlated to cart/evidence version and currency;
- quote is non-posting until a payment/checkout owner authorizes money movement.
**Actor responsibility envelope**
- `customer` — requests/reads quote through checkout; forbidden: author amounts.
- `DSH` — supplies authenticated commercial evidence; forbidden: duplicate WLT arithmetic.
- `WLT` — computes/version-bounds quote and canonical readback.
**Surface semantics**
- `app-client` via DSH checkout readback and authorized diagnostics.
- `backend` and `database` — required WLT quote computation/evidence/version state.
- technical presentation binding — implementation evidence only.
