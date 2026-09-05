# Wlt Pricing Risk Capabilities

ARTIFACT_CLASS: DURABLE_PRODUCT_CAPABILITY_GOVERNANCE
SEMANTIC_OWNER: governance/product/capabilities/wlt-pricing-risk.md
EXECUTION_AUTHORITY: NONE
CLOSURE_AUTHORITY: NONE
IMPLEMENTATION_STATE_AUTHORITY: NONE
PARENT_CAPABILITY_INDEX: governance/product/CAPABILITIES.md

## Scope

This owner defines only the durable capability semantics listed below. Capability taxonomy/schema/admission law remains in `../CAPABILITIES.md`; cross-capability journeys remain in `../JOURNEYS.md`.

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

### WLT_CAPTAIN_COLLATERAL

**Problem.** Captain collateral/exposure can be confused with available balance, COD capacity or debt and be released while obligations remain.

**Required outcome.** WLT owns versioned collateral policy, captain collateral positions and releasable excess as financial truth backed by a proven captured captain top-up/ledger source.

**Primary actors.** captain, authorized finance/operator, WLT system.

**Canonical ownership.** WLT collateral/wallet/ledger truth; DSH only consumes eligibility/readback needed for operations.

**Material surfaces.** app-captain readback, control-panel finance, dispatch eligibility integration when applicable.

**Durable states.** collateral policy enabled/disabled and versioned; collateral position `active → released`; release records reason/time and cannot silently mutate source funding history.

**Forbidden/negative invariants.**
- no collateral position without proven eligible captured funding source;
- no client/operator direct balance edit;
- no release while pending/held/COD reserve/outstanding debt or required minimum makes it ineligible;
- no DSH writer for collateral/wallet truth;
- no released position reused as active exposure.

**Failure/recovery.** policy disabled, invalid input/source, position not found, insufficient/restricted state, conflicting obligations; canonical WLT reread/reconciliation determines next legal action.

**Acceptance expectations.** wallet summary distinguishes available/pending/held/COD/collateral/debt; release is atomic/auditable and preserves ledger/source lineage.

**Target state.** WLT owns versioned collateral policy and positions with explicit backing source, exposure constraints and atomic release eligibility.
**Primary success measure.** collateral positions whose backing, active/released state and release eligibility reconcile to wallet/ledger obligations.
**Guardrail measures.** unbacked collateral; release with pending/held/COD/debt obligations; direct balance edit; released position reused; DSH collateral writer.
**Business invariants**
- every position references eligible captured WLT funding/ledger evidence;
- collateral is distinct from available, pending, held, COD reserve and debt;
- release is atomic, versioned and blocked by current obligations/minimum policy;
- DSH consumes eligibility/readback only.
**Actor responsibility envelope**
- `captain` — reads own collateral/exposure; forbidden: mutate balance or release eligibility directly.
- `finance operator` — applies authorized policy/release actions with audit; forbidden: bypass obligations.
- `WLT` — sole collateral/wallet/ledger writer.
**Surface semantics**
- `app-captain`, `control-panel`, and dispatch integration readback when applicable.
- `backend` and `database` — required WLT policy/position/ledger lineage.
- technical presentation binding — implementation evidence only.

### WLT_PROVIDER_PENALTIES

**Problem.** Captain/field penalties can become manual arbitrary balance edits or be reversed after their debt/wallet state has materially changed.

**Required outcome.** WLT applies a governed versioned penalty policy to an eligible captain/field source, posts the monetary effect through wallet/debt plus balanced ledger, and permits only state-safe reversal.

**Primary actors.** authorized operator/system, captain or field provider as affected actor/read-only consumer.

**Canonical ownership.** WLT penalty/debt/wallet/ledger truth; DSH may supply trusted incident/actor evidence.

**Material surfaces.** control-panel finance/incident workflow and bounded captain/field financial readback.

**Durable semantics.** policy is enabled/versioned with provider actor type, amount, currency and reason; penalty records source incident and split between wallet-applied amount and debt; reversal restores exact governed financial effect only when live debt state still matches the reversible snapshot.

**Forbidden/negative invariants.**
- no generic manual balance decrement;
- no unsupported actor type;
- no duplicate posting for same mutation identity;
- no reversal after partial settlement/state drift without explicit reconciliation;
- no non-WLT ledger writer;
- no penalty without reason/audit/source evidence.

**Failure/recovery.** wallet unavailable, policy disabled/invalid, debt state conflict, duplicate/idempotency conflict, reversal state drift; reconcile live wallet/debt before any new financial mutation.

**Acceptance expectations.** original and reversal postings balance, debt/wallet split is reproducible, audit/source lineage is preserved and affected readback is consistent.

**Target state.** WLT owns versioned captain/field monetary-penalty policy, posting/debt split and state-safe reversal from trusted source evidence.
**Primary success measure.** penalty/reversal operations with exact source lineage and balanced reproducible wallet/debt/ledger effects.
**Guardrail measures.** direct balance decrement; duplicate posting; unsupported actor; reasonless penalty; reversal after incompatible debt/state drift; non-WLT ledger write.
**Business invariants**
- penalty policy is versioned and actor/type/currency/reason scoped;
- one logical mutation identity yields one financial effect;
- wallet-applied and debt portions are balanced and auditable;
- reversal is permitted only against compatible live debt/state or after explicit reconciliation.
**Actor responsibility envelope**
- `operator/system` — initiates only authorized evidence-backed penalty/reversal intent; forbidden: arbitrary balance edit.
- `captain/field actor` — reads bounded affected financial outcome; forbidden: mutate policy/posting.
- `WLT` — sole penalty/debt/wallet/ledger writer and reconciler.
**Surface semantics**
- `control-panel` and bounded `app-captain`/`app-field` readback where applicable.
- `backend` and `database` — required WLT policy/posting/debt/reversal lineage.
- technical presentation binding — implementation evidence only.
