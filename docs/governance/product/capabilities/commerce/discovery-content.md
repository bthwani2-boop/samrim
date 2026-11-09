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
- discovery content may target admitted canonical `STORE`, `PRODUCT`, `CATEGORY` or `PROMOTION` destinations as appropriate to its kind; DSH validates relation and scope;
- Partner-sourced `SHORT_FORM` and in-Store image `BANNER` specifically target a `STORE`, `PRODUCT` or `PROMOTION` belonging to the authorized source Store; `CATEGORY` is not an admitted Partner-owned destination;
- customer visibility requires the applicable review/approval and publication transition;
- an authenticated Partner with the Store-scoped `promotions` grant may submit a `SHORT_FORM` or image `BANNER` draft only with `source_store_id` bound to the authorized Store and an eligible destination belonging to it; the Operator retains publication authority;
- the platform-wide homepage banner is authored/published by Marketing Operators and excludes Partner-sourced Store media; the customer Store banner reads only the authorized Store’s published, approved, within-window images and never fills empty slots with ordinary products;
- the same DSH Discovery Content publication engine may serve Operator-approved independent Store-owned image banners only on the legally published independent Store website. Publication requires its own reviewed Store/legal/policy facts and a self-Store destination, never a marketplace publication flag, homepage inclusion, short-form distribution, or a merchant-controlled approval shortcut; withdrawing that public Store makes its banners unavailable at read time;
- the Partner may hide or restore its own approved Store banner independently of Operator publication, but cannot publish an unapproved draft or override an Operator pause; independent Partner display state and version are owned by DSH;
- SHORT_FORM MP4 media is bounded to 10 MiB input and 30 seconds, normalized to mobile-friendly H.264/AAC and accompanied by an immutable JPEG poster in the existing DSH media owner;
- normalization failures block publication, and cleanup removes both the normalized video and derived poster;
- app-local hard-coded content is not publication authority;
- media provider identity is replaceable without redefining content identity;
- publication/expiry/scope are explicit and server-owned;
- promotional financial effect remains with `COMMERCE_PROMOTIONS`/WLT rather than content itself;
- autoplay/media behavior must preserve accessibility, bandwidth and platform constraints through Experience policy.

## Failure and recovery

Missing media, expired target, invalid scope, provider failure and stale publication recover without exposing unavailable commerce actions as valid.
