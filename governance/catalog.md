# BThwani — One Product Registry and Store Offers

ARTIFACT_CLASS: DOMAIN_GOVERNANCE_DRAFT
SEMANTIC_OWNER: governance/catalog.md
STATUS: ACTIVE_FOR_PROGRESSIVE_DEVELOPMENT
IMPLEMENTATION_STATE_AUTHORITY: NONE

## CENTRAL_CATALOG — Canonical taxonomy and assortment
CAPABILITY_ID: CENTRAL_CATALOG

DSH owns one taxonomy, Product, ProductVariant, StoreOffer and StorefrontSection model for all admitted Store relations and business types. Operator maintains global taxonomy and shared identities; Merchant manages its authorized Store products, prices, stock, media and assortment. Domain variations (groceries, restaurants, measured goods, modifiers, lawful pharmacy) use this owner, not independent catalog or Order engines. Media infrastructure is an adapter, not a writer.

### Typed classification and sellable identity

ServiceCity (geography), CommerceVertical (business activity), CommercialStoreType (compatible operating model), CatalogCategory (shared taxonomy) and StorefrontSection (Store merchandising) are distinct facts, not derived labels or fee selectors. One admitted primary vertical per Store in the initial model; never guess a legacy classification. Categories form a same-vertical acyclic tree of flexible depth, not fixed L1–L4 columns. Category required/filterable/variant attributes use typed text, number, boolean, enum, measured value and date, not a competing opaque options object.

Product is common identity; ProductVariant is the sellable/package identity. Each Product has at least one Variant (default for simple items). Every StoreOffer, CartLine and OrderLine references the sellable Variant ID. SHARED and STORE_SCOPED are two scopes of one model. Only authorized Operators create/edit SHARED; Merchant can reference Shared Variants in Offers, submit a non-sellable proposal or directly create Store-scoped Product without central proposal. Store-scoped items may remain uncategorized; compatible category assignment does not transfer ownership.

Store SKU is local to one Store; GTIN/EAN/UPC are global Variant identifier types. Do not guess unknown barcode types. The one DSH barcode resolver uses verified Store context and distinguishes existing StoreOffer, eligible SHARED Variant, STORE_SCOPED match, unknown and variable-measure identifier. Lookup alone grants no mutation or authorization.

StoreOffer belongs to one Store and one valid Variant; owns exact integer YER price, pricing basis, unit/quantity min/max/step, inventory, availability, publication and version. Discrete, measured and variable-measure quantities are distinct; no authoritative binary floating-point or fictitious half-unit. Availability-only is not numeric inventory; finite inventory requires atomic reservation/release/replay. Restaurant modifier groups/options have bounded choices, price deltas and availability, not duplicate Variants. Actual measure changes after confirmation use lawful DSH Order adjustment and WLT financial delta.

### Entry, import and bulk operations

One quick-entry path: name/barcode lookup, Shared Variant selection or Store-scoped creation, Store price/availability, canonical save. No mandatory category wizard or internal ID input for every Offer. Quick Prices, scanning and bulk edit invoke the same writer and audit. CSV/XLSX imports use one explicit preview, conflict disposition and authorized commit with stable run identity, Store scope, durable accepted/held/failed per-row outcomes, source attribution, old/new values and resumable internal chunks. Minority failures do not erase accepted rows; reconcile unknown response before retry.

Unknown/variable-measure barcode, collisions, ambiguous Shared name, missing price, stale version or malformed quantity require held/conflict reason; never guess or blindly upsert. An admissible name-only row with Store-specific price may explicitly create a draft STORE_SCOPED Product and draft Offer after preview, never SHARED. Missing input does not authorize deletion. Preserve authorized pagination, deterministic ties and grants before bulk mutation.

Operator Store-specific import/bulk Offer action requires trusted Store/action scope; either merchant or catalog scope may authorize the specifically admitted import only after independent verification of actual Identity/DSH mapping. Neither grants the other's domain mutations, finance, publication or Store ownership. Merchant requires current Store grant. Reject revoked/foreign scope on retry as well as initial execution.

### History, media and lifecycle

Explicit authorized mapping and Offer rebinding are required to promote a local Product to SHARED; preserve audit, identities, units, attributes, media, Store SKU, quantities and historical invoice/Order snapshots. No cosmetic ownership conversion or arbitrary cascade deletion; removal/restore obeys retained rights. Draft edits record previous/resulting draft values, version and commit time; published-price and stock reports require actual publication/inventory records. Unknown or outdated is not zero stock. Category/Product/Variant/Offer/Store visibility and lawful media rights apply independently. A CommerceVertical illustration is its own moderated, provenance-backed DSH media reference, not Product media or classification evidence.

### Owner-backed limits

Historical accepted settings include 5,000 rows per Store import run and short video bounds of 10 MiB / 30 seconds. Support the admitted run without artificial 1,000-row ceiling or separate user-visible imports; internal chunks are allowed. These are reference settings for owner-backed policy, not immutable client constants. Actual DSH/content contracts govern source-specific limits, size, duration, moderation, listing windows, inventory and promotion usage thresholds. Changes require supported storage, validation, UX, costs and lawful bounds; fail safe if policy absent. No larger limit grants unvalidated payloads, unrestricted uploads, privacy bypass or unaudited prices. Preserve approved URLs and historical snapshots.

## CUSTOMER_STORE_CATALOG — Privacy-safe, consistent discovery
CAPABILITY_ID: CUSTOMER_STORE_CATALOG

One DSH read model serves eligible marketplace discovery, compact Store view and full governed Customer Expo Web Store page; Direct links never grant marketplace eligibility. Customer sees only permitted published information and truthful price/availability, with scoped bounded filters/search/cursors and approved media.

The server-side CUSTOMER_VISIBLE_OFFER eligibility decision supplies a common boundary for public catalog/detail, cart and checkout: eligible published Store, active CommerceVertical/ServiceCity, active Product/sellable Variant, required typed taxonomy for SHARED or valid STORE_SCOPED facts, published available Offer, positive exact price, permitted quantity/inventory and modifiers. A separate truthful read-only projection may display an unavailable Offer where authorized, never as orderable or a way around visibility rules. Retired/unapproved identities cannot reappear from stale public projections. A raw ID, search, video or link is not checkout authority; DSH rechecks Store, variant, price, availability, geography and fulfillment at actual confirmation. No unbounded client joins or local price engine.

### Popularity, favorites and sections

الأكثر رواجًا uses distinct canonically completed Store Orders containing each currently customer-visible Offer within an effective trailing window (historical initial 30 days). Delivered and completed pickup qualify; rejected/cancelled/failed/uncompleted Orders and hidden/unpublished Offers do not. Exclude zero qualifying completions; break ties deterministically by approved Product display name and stable Offer ID. DSH owns versioned bounded window, scope and display count; changes affect future ranking queries, not prices/history. No client page-local ranking, likes or impressions substituted for sales. Store-curated sections, default ordering and actor-scoped favorites are independent read semantics.

### Actionable quality and inventory intelligence

Use canonical Product/Variant/Offer identity to distinguish definite matches from ambiguous name/unit/attribute matches; recommend review, never silently merge/delete/publish. Substitution preserves units, modifiers, legal limits, consent and Order adjustment authority. Low-stock attention requires applicable finite inventory and approved threshold; draft quantities, expired observations, unavailable and availability-only Offers do not prove stockout. Separate draft edits, published prices, inventory movements and reservations/releases; use complete scoped queries, real timestamps and authorized exact-record links. Replenishment requires adequate demand/consumption, available/reserved stock, verified incoming supply and lead times as applicable; account for censored demand and uncertainty. Suggestions do not procure stock, bind suppliers or mutate inventory. Apply [measurement law](architecture.md#measurement-integrity-and-intelligence-admission).

## Acceptance

Preserve the admitted 2026-11-13 target obligations, not donor implementation as authority. Prove actual owner contracts, two Store owners, granted/denied import and bulk operations, draft/public isolation, empty/large catalog, stale cursor, duplicate identifier, typed taxonomy, price change, modifier/quantity/weight mismatch, availability and reservation, partial import and replay, media authorization, removal/restore and applicable rendered Customer Web/Android behavior. Every SKU, category, Variant, media reference and bulk command is validated in its actual scope; no cross-Store IDOR or unapproved shared mutation. Rendered detail carries relevant attributes without cluttering compact cards. No mock, source declaration or screen establishes deployed catalog/ACL or completed checkout.
