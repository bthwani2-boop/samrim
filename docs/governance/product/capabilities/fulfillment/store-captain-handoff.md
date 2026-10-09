# Store to Captain Handoff

ARTIFACT_CLASS: DURABLE_PRODUCT_CAPABILITY_GOVERNANCE
SEMANTIC_OWNER: docs/governance/product/capabilities/fulfillment/store-captain-handoff.md
EXECUTION_AUTHORITY: NONE
IMPLEMENTATION_STATE_AUTHORITY: NONE
CAPABILITY_ID: STORE_CAPTAIN_HANDOFF

## Outcome

For a Captain-delivered Store Order, custody transfers from the owning Store to the legally assigned/eligible canonical Captain exactly once through one DSH-owned handoff truth.

## Ownership

DSH owns custody/handoff and operational exception truth. Platform assignment eligibility comes from `CAPTAIN_DISPATCH`; Store-affiliated Captain eligibility comes from `STORE_CAPTAIN_MEMBERSHIP`. Financial consequences belong to WLT.

## Invariants

- handoff is bound to current Order, Store, fulfillment mode and canonical Captain actor;
- only authorized owning-Store Partner scope confirms the Store side;
- only the legally assigned/eligible Captain completes Captain-side pickup;
- pickup cannot complete before required confirmation;
- one executable custody transfer exists per current fulfillment assignment;
- replacement before custody supersedes obsolete handoff attempts and reconciles affected financial holds;
- a blocking mismatch/shortage prevents pickup until canonically resolved;
- retries are idempotent and materially different payload cannot reuse one operation identity;
- no surface keeps independent custody truth.

## Failure and recovery

Stale assignment/membership, wrong Store/Captain, duplicate attempt, retry conflict, mismatch/shortage, financial-hold mismatch and offline state recover from canonical DSH/WLT readback.
