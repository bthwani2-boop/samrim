# Discovery Content

ARTIFACT_CLASS: DURABLE_PRODUCT_CAPABILITY_GOVERNANCE
SEMANTIC_OWNER: docs/governance/product/capabilities/commerce/discovery-content.md
EXECUTION_AUTHORITY: NONE
IMPLEMENTATION_STATE_AUTHORITY: NONE
CAPABILITY_ID: DISCOVERY_CONTENT

## Outcome

Banners, carousels, short-form media and other admitted discovery content are published through one DSH-owned eligibility/publication model that can route customers to canonical commerce destinations without becoming an app-local content truth.

## Ownership

DSH owns content identity, placement/eligibility, target relation, publication lifecycle and canonical readback. Media adapters own binary storage/delivery mechanics only.

## Invariants

- content targets canonical Store/Catalog/promotion destinations or explicit bounded informational targets;
- admitted short-form/catalog media may target a canonical `STORE`, `PRODUCT` or `CATEGORY`; DSH validates the relation and scope;
- customer visibility requires the applicable review/approval and publication transition;
- app-local hard-coded content is not publication authority;
- media provider identity is replaceable without redefining content identity;
- publication/expiry/scope are explicit and server-owned;
- promotional financial effect remains with `COMMERCE_PROMOTIONS`/WLT rather than content itself;
- autoplay/media behavior must preserve accessibility, bandwidth and platform constraints through Experience policy.

## Failure and recovery

Missing media, expired target, invalid scope, provider failure and stale publication recover without exposing unavailable commerce actions as valid.
