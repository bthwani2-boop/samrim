# Store Commercial Agreement

ARTIFACT_CLASS: DURABLE_PRODUCT_CAPABILITY_GOVERNANCE
SEMANTIC_OWNER: docs/governance/product/capabilities/finance/store-commercial-agreement.md
EXECUTION_AUTHORITY: NONE
IMPLEMENTATION_STATE_AUTHORITY: NONE
CAPABILITY_ID: STORE_COMMERCIAL_AGREEMENT

## Outcome

Each Store has one explicit active commercial model and exact terms, accepted by its bound Partner owner and approved by Finance before activation. WLT alone owns commercial charge facts, immutable Order snapshots, recurring invoices and settlement accounting.

## Ownership

WLT owns agreement identity and versions, proposed rates, Partner acceptance, Finance approval, activation, effective and superseded facts and audit. DSH supplies canonical Store context and enabled fulfillment modes and performs the bounded operational handoff; DSH does not write financial rates. An active Operator with the Partners permission may propose Store-specific terms for an existing Store through DSH, independently of any historical Field origin. The retired Field proposal path is no longer available. The bound Partner owner accepts exact terms. An authorized Finance actor approves them. ORDER_PAYMENT_COLLECTION alone resolves the active agreement for an applicable Order and owns that Order's immutable agreement snapshot.

## Approved Store commercial models

An authorized Store agreement may select one of three mutually exclusive active commercial models:

- **COMMISSION:** an explicitly agreed percentage in basis points or fixed YER amount on defined eligible Store Orders. Fixed per-Order fees require a WLT-owned quote, snapshot and settlement implementation; they cannot be inferred from percentage-only fields.
- **SUBSCRIPTION:** an expressly accepted recurring YER Store charge for a defined billing period, with zero additional product commission. No automatic conversion from zero commission is permitted.
- **HYBRID:** an optional expressly agreed recurring Store charge plus a stated per-Order commission; neither fee is implied by the other.

Operator policies may suggest a starting model or amounts by Store Type; they never bind another Store, activate a contract or collect money. The Store-specific accepted, Finance-approved version remains the only authority. These are fees owed by a merchant under a commercial agreement, **not** paid Partner feature tiers: Store-scoped Partner permissions remain governed by Identity and DSH, never by a subscription badge.

A recurring agreement must identify YER amount, billing period and time zone, effective date, renewal/termination terms, due and grace rules, Partner consent, and adjustment or refund policy. WLT alone may produce an invoice and post a uniquely identified charge for one agreement version and period; retries and concurrent runs must not duplicate an invoice, collection, balance debit or accounting effect. Unknown payment outcomes require reconciliation. Non-payment must not silently revoke Identity access or Store ownership; any operational restriction requires a separately approved policy. Old Orders retain their original contractual snapshots.

**Delivery boundary:** existing WLT and DSH implementations currently support commission terms only. SUBSCRIPTION and HYBRID are approved commercial target semantics, not currently active billing features. They must not be exposed as chargeable or marked live before WLT schema, versioned agreements, invoicing, idempotent posting, settlement, Partner acceptance, Operator policy, authorization and independent finance/security review pass together.

## Invariants

- final terms are Store-specific; a Store's terms do not derive from another Store with the same commercial Store Type;
- each version explicitly identifies Store, the selected commercial model (COMMISSION, SUBSCRIPTION, or HYBRID), agreement version, status, proposer/provenance, enabled fulfillment modes and rates, applicable recurring terms, Partner acceptance, Finance approval, effective/superseded facts, reason/audit and idempotency/correlation; a zero product commission never implies subscription;
- every durably enabled fulfillment mode has exactly one explicit pricing/commission rule in the active agreement; SUBSCRIPTION contracts carry explicit zero product commission for each enabled mode rather than silently omitting pricing facts;
- the lifecycle is `PROPOSED` → `PARTNER_ACCEPTED` → Finance-approved `ACTIVE` → `SUPERSEDED`;
- silence, Store creation, role admission, catalog readiness or publication is not Partner acceptance;
- only authorized Finance approval can activate an accepted version; the canonical initial Operator (Root Owner) may Finance-approve a Store agreement they proposed themselves after Partner acceptance, when Identity confirms their administrator standing and Finance permission; other proposing Operators cannot self-approve;
- each material term change creates a new version and historical evidence is immutable;
- adding a fulfillment mode that changes commercial obligations requires a new agreement version containing that mode before DSH may treat it as durably enabled;
- materially changing or removing an enabled mode's commercial terms also requires a new agreement version;
- temporarily pausing/resuming a mode already durably admitted is operational state owned by `STORE_OPERATIONAL_AVAILABILITY` and does not create a new agreement version;
- an operational toggle cannot activate a fulfillment mode absent from the Store's durable admitted mode policy and active agreement;
- a Store Type-by-mode or Store Type-by-model policy, if retained, is only a suggested negotiation starting value and never a fallback authority;
- an initial Store agreement may have zero product commission for each admitted fulfillment mode; zero rates are explicit Store-specific financial facts, not an implied waiver of Partner acceptance or Finance approval;
- a zero-commission proposal does not by itself create a timed promotion or authorize automatic paid conversion; a governed duration, effective date, consent evidence and applicable policy must exist before any later paid terms become active;
- no more than one agreement version is active for a Store at a time;
- a Partners Operator may propose but cannot accept for the Partner owner; Finance approval is separate except for the Root Owner exception above. Retired Field actors cannot propose or approve on another actor's behalf;
- retries, stale versions and concurrent transitions preserve one auditable result.

## Failure and recovery

Missing Store context, unsupported mode, invalid rate, Store-scope mismatch, non-acceptance, missing Finance authority, stale version and conflicting mutation fail closed and recover through WLT and DSH canonical readback. Missing or inactive terms block Store publication and any Order that requires them; operational availability cannot bypass this capability.
