# Customer Store Catalog

ARTIFACT_CLASS: DURABLE_PRODUCT_CAPABILITY_GOVERNANCE
SEMANTIC_OWNER: docs/governance/product/capabilities/commerce/customer-store-catalog.md
EXECUTION_AUTHORITY: NONE
IMPLEMENTATION_STATE_AUTHORITY: NONE
CAPABILITY_ID: CUSTOMER_STORE_CATALOG

## Outcome

A Client can find and compare customer-visible offers inside a published Store catalog using Store-owned categories, favorites and an honest recent-order ranking.

## Ownership

DSH owns published Store, category, offer and completed Order evidence. The Client presents that canonical read model and owns only its authenticated customer's favorite selections.

## Invariants

- default catalog order and Store-curated sections remain unchanged;
- “الأكثر رواجًا” ranks only currently customer-visible Store offers by the count of distinct completed Store Orders containing each offer during the trailing 30 days;
- completed delivery and completed customer pickup count; failed, rejected and cancelled Orders do not;
- offers with no completed Order in the window are omitted from this ranking;
- equal counts use product name and offer ID as deterministic tie-breakers;
- category and text filters remain bounded and compatible with the popularity ranking;
- favorites remain actor-scoped and separate from popularity;
- product quantity and modifier details remain available through the product interaction, not duplicated as nonessential metadata in the compact catalog card.

## Failure and recovery

An empty 30-day ranking is shown as an explicit empty state. Catalog read failures preserve the prior results and expose the existing retry path.
