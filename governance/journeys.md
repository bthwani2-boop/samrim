# BThwani — Cross-Owner Business Journeys and Acceptance

ARTIFACT_CLASS: DOMAIN_GOVERNANCE_DRAFT
SEMANTIC_OWNER: governance/journeys.md
STATUS: DRAFT_PENDING_FULL_GOVERNANCE_CUTOVER
IMPLEMENTATION_STATE_AUTHORITY: NONE

## Meaning and responsibility
This document defines **shared observable outcomes and handoffs**, not a second Product capability catalog, implementation checklist, test fixture or orchestration engine. Identity, DSH and WLT retain their own writable facts. Bounded notifications/maps/media and Operator surfaces read legal projections.

## Direct Merchant registration to published eligible Store
1. Merchant identity and authorized session exist in Identity. DSH reads current relation-admission policy and permits creation of one Store ID under an idempotent command.
2. Merchant selects `MARKETPLACE` or `DIRECT`. DSH validates service city, Store type, documents, ownership, required Store consent, eligible publication path and draft catalogue.
3. WLT reads accepted effective fee/collector policy by relevant scope; a versioned Store-specific agreement is proposed, expressly accepted and Finance-approved where required. Selecting `SUBSCRIPTION` is not a paid subscription until billing/ledger implementation is admissible.
4. DSH publishes only the approved channel and retains separate current Store, Offer, operational and fulfillment eligibility. A full Store Web URL in Customer Expo Web does not grant marketplace discovery.
5. A second Store under the same Merchant reuses the same Identity actor and DSH Store command; a revoked or unrelated actor cannot write it.

**Failure/negative:** closed admission, identity revocation, malformed relation, WLT unreachable, missing consent, publication rejected, duplicate create and delayed response. The process fails with recoverable real state rather than a phantom Store.

## Operator policy update to changed prospective business outcome
Operator Identity session → qualified Owner policy read → authorized scoped write with expected version/reason/effective time → durable readback → only newly eligible Store/Order flow observes the effective policy. Where financial, an already accepted WLT Store agreement prevails until deliberate prospective transition and consent. An Operator policy never bypasses readiness.

**Negative:** wrong permission, stale policy version, conflicting concurrent updates, unknown POST outcome, unsupported DIRECT + BThwani Captain or SUBSCRIPTION billing, expired consent and existing Order repricing must not silently succeed. Show exact reason and next safe action.

## Catalog/Store Offer to canonical checkout
DSH publishes approved category/Product/Variant/StoreOffer with allowed price/quantity/inventory; Customer uses marketplace discovery or full public Store Web read. DSH creates a bounded short-lived quote and at confirmation revalidates price, availability, serviceability, participant rights, selected delivery method, Store relation and accepted commercial terms. WLT confirms admissible customer funding and applicable collection responsibility. One canonical Store Order results or the outcome remains explicitly unknown with owner-safe reconciliation.

**Negative:** hidden Offer, different Store's Offer, changed price/quantity, unserviceable address, canceled consent, duplicated idempotency, guest identity restrictions, old quote and accidental wallet double debit.

## Multi-Store checkout to independent Store Orders
The Customer may submit one orchestration intent containing multiple Store-specific carts. Each Store has its own DSH Order, WLT funding/beneficiary allocation, fulfillment route, cancellation and dispute status. The parent is a read/orchestration reference, not a second legal writer. Partial failure is explicit; do not display successful combined delivery before independent child results are known.

## BThwani Captain delivery and COD/Mixed
DSH produces up to three eligible dispatch offers, at most one winning assignment, WLT atomically verifies gross Order exposure and reserves only cash portion when positive, and the Captain sees private customer address only after assignment. DSH records accepted pickup/handoff and confirmed delivery; WLT posts financial settlement/once-only COD debit after authorized evidence. An uncertain loss of connection never leads to duplicate holds, settlements or completion.

## Store-affiliated Captain and Customer Pickup
The Store-associated Captain requires current authorized DSH Store membership, not global platform-dispatch standing or automatic platform cash custody. Customer Pickup uses the same DSH Store Order and a verified Store/customer handoff with no Captain assignment. Both retain effective WLT commercial obligations; Store-collected cash cannot be misrepresented as platform Captain liability.

## Order communications and adjustments
Only admitted current Order participants can exchange private scoped messages, recorded media and bounded operational updates. A later substitution, measured-weight change, damaged item, cancellation or refund is an attributable Order adjustment with WLT financial delta and balanced reconciliation, not a rewrite of original Order price or a generic returns product.

## Funds: customer → Order → beneficiary
WLT accepts verified funding from eligible customer wallet/external provider rails, authorizes valid payment allocation (COD/WALLET/MIXED where admitted), records balanced ledger effects, separates Store earnings from platform fees, verifies official beneficiary and destination, and performs/independently reconciles eligible settlement. An intake request is not a payout, physical cash is not a WLT wallet top-up until verified, and an unresolved refund or transfer remains explicit.

## Common proof rule
For each materially changed journey record a concrete exact SHA, service/DB revision, authenticated actors and Store scopes, contract/migration versions and observed owner readbacks. Include legitimate, unauthorized, concurrent, offline/retry, privacy and financial negative flows. Browser and Android real behavior matter when affected; iOS is NOT_RUN without an actual device/simulator test. Distinguish source-only, mocked, partial and live-proven capability states without inventing success.
