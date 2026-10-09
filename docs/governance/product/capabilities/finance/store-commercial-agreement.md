# Store Commercial Agreement

ARTIFACT_CLASS: DURABLE_PRODUCT_CAPABILITY_GOVERNANCE
SEMANTIC_OWNER: docs/governance/product/capabilities/finance/store-commercial-agreement.md
EXECUTION_AUTHORITY: NONE
IMPLEMENTATION_STATE_AUTHORITY: NONE
CAPABILITY_ID: STORE_COMMERCIAL_AGREEMENT

## Outcome

Each Store's final Partner commission terms are explicit, accepted by that Store's bound Partner owner and approved by Finance before becoming active. WLT supplies one durable financial truth for the Store and each enabled fulfillment mode.

## Ownership

WLT owns agreement identity and versions, proposed rates, Partner acceptance, Finance approval, activation, effective and superseded facts and audit. DSH supplies canonical Store context, joining attribution and enabled fulfillment modes and performs the bounded operational handoff; DSH does not write financial rates. Field may propose initial terms for its authorized joining case. The bound Partner owner accepts exact terms. An authorized Finance actor approves them. ORDER_PAYMENT_COLLECTION alone resolves the active agreement for an applicable Order and owns that Order's immutable agreement snapshot.

## Invariants

- final terms are Store-specific; a Store's terms do not derive from another Store with the same commercial Store Type;
- each version identifies Store, agreement version, status, proposer/provenance, enabled fulfillment modes and rates, Partner acceptance, Finance approval, effective/superseded facts, reason/audit and idempotency/correlation;
- every durably enabled fulfillment mode has exactly one rate in an active agreement;
- the lifecycle is `PROPOSED` → `PARTNER_ACCEPTED` → Finance-approved `ACTIVE` → `SUPERSEDED`;
- silence, Store creation, role admission, catalog readiness or publication is not Partner acceptance;
- only authorized Finance approval can activate an accepted version;
- each material term change creates a new version and historical evidence is immutable;
- adding a fulfillment mode that changes commercial obligations requires a new agreement version containing that mode before DSH may treat it as durably enabled;
- materially changing or removing an enabled mode's commercial terms also requires a new agreement version;
- temporarily pausing/resuming a mode already durably admitted is operational state owned by `STORE_OPERATIONAL_AVAILABILITY` and does not create a new agreement version;
- an operational toggle cannot activate a fulfillment mode absent from the Store's durable admitted mode policy and active agreement;
- a Store Type-by-mode policy, if retained, is only a suggested negotiation starting value and never a fallback authority;
- no more than one agreement version is active for a Store at a time;
- Field can propose only for its authorized joining Store and cannot accept or approve terms on another actor's behalf;
- retries, stale versions and concurrent transitions preserve one auditable result.

## Failure and recovery

Missing Store context, unsupported mode, invalid rate, Store-scope mismatch, non-acceptance, missing Finance authority, stale version and conflicting mutation fail closed and recover through WLT and DSH canonical readback. Missing or inactive terms block Store publication and any Order that requires them; operational availability cannot bypass this capability.
