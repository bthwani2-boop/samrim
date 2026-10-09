# Store Captain Membership

ARTIFACT_CLASS: DURABLE_PRODUCT_CAPABILITY_GOVERNANCE
SEMANTIC_OWNER: docs/governance/product/capabilities/partner/store-captain-membership.md
EXECUTION_AUTHORITY: NONE
IMPLEMENTATION_STATE_AUTHORITY: NONE
CAPABILITY_ID: STORE_CAPTAIN_MEMBERSHIP

## Outcome

A Store may establish an accepted Store-scoped affiliation with a canonical Captain actor so eligible Partner-Captain fulfillment can occur without inventing another Identity role.

## Ownership

DSH owns invitation/membership/affiliation, Store scope, acceptance, eligibility, suspension/removal and operational readback. Identity owns the canonical Human Actor and standing `captain` role. WLT retains only the Order payment/Partner commission financial authority that applies to `PARTNER_CAPTAIN`; Store-Captain internal remuneration is a Store responsibility outside WLT.

## Minimal lifecycle

```text
PARTNER STORE OWNER
→ invite canonical eligible Captain
→ CAPTAIN reads invitation
→ accept OR decline
→ DSH activates membership only after acceptance
→ Partner may suspend/remove when authorized
→ Captain may leave when current policy permits
```

## Invariants

- Partner Captain is not a separate Identity role;
- Partner cannot create or grant the `captain` role;
- invitation/membership references one canonical Captain actor and one Store;
- delegated membership authority is inactive until the Captain accepts;
- one Captain actor may hold multiple accepted Store relationships;
- Store owner authorization cannot grant or mutate Identity role by request input;
- membership eligibility is distinct from platform Captain availability/pool state;
- suspension/removal/leave stops future eligibility without rewriting historical fulfillment records;
- `ORDER_PAYMENT_COLLECTION`/WLT continues to govern applicable customer collection and Partner commission consequences of Partner-Captain Orders;
- Store-Captain remuneration and Store-side cash handoff do not reuse BThwani-Captain earning, wallet, COD exposure or remittance semantics.

## Failure and recovery

Unknown Captain identity, Captain without standing eligibility, declined/expired invitation, unauthorized Store scope, duplicate invitation/membership, stale accept/suspend/restore/remove and conflicting fulfillment eligibility converge on one DSH relationship truth. Retry cannot auto-accept on behalf of the Captain or create a duplicate membership.
