# BThwani — One Product registry and Store offers

ARTIFACT_CLASS: DOMAIN_GOVERNANCE_DRAFT
SEMANTIC_OWNER: governance/catalog.md
STATUS: ACTIVE_FOR_PROGRESSIVE_DEVELOPMENT
IMPLEMENTATION_STATE_AUTHORITY: NONE

## CENTRAL_CATALOG — Canonical taxonomy and assortment
CAPABILITY_ID: CENTRAL_CATALOG

DSH owns one taxonomy, Product, ProductVariant, StoreOffer and StorefrontSection model for all admitted relations and business types. Operator manages global taxonomy and shared identities; Merchant manages its authorized Store items, prices, stock, media and assortment. Restaurants, groceries, measured goods, modifiers, lawful pharmacy and other admitted verticals use the same owner and Order engine. Neither media infrastructure nor an imported catalogue becomes a writer.

### Classification and discovery boundaries

ServiceCity (geography), CommerceVertical (activity), CommercialStoreType (compatible operating model), CatalogCategory (shared taxonomy) and StorefrontSection (Store merchandising) are independent DSH facts, never surrogate keys or fee selectors. A Store has one admitted primary vertical; a Merchant can own Stores in different verticals. Active city/vertical and compatible Store Type are required for initial creation, not exhaustive catalogue preparation or preapproval of Merchant Identity. Retain unclassified historical Stores without guessing their vertical; no vertical discovery or customer visibility before authorized valid assignment. Registry values are owner data rather than governance constants.

Store Type describes actual business activity, not a customer shopping shortcut. Correct labels without changing canonical IDs or WLT agreements. A shortcut is an eligible populated discovery projection across types, categories, local offers or promotions; do not force traversal of all hierarchy levels, use empty shortcuts, or expose SHARED/STORE_SCOPED ownership as a customer filter. A vertical workflow preference can simplify entry but cannot prevent a mixed assortment.

Categories form a same-vertical acyclic tree of flexible depth, not fixed L1–L4 columns. Shared Products may carry multiple independently valid assignments in their vertical. Typed category rules (required/filterable/variant-axis) support text, number, boolean, enum, measurement and date; no opaque options object or column explosion. A Store-scoped item may remain uncategorized without hiding its eligible offer. Explicit compatible active category assignment validates required typed attributes and enables matching published category discovery without transferring ownership. StorefrontSection organizes only eligible Store items/offers and never substitutes for shared taxonomy. Reference readiness requires actual owner readback; setup does not seed unrelated actor/Store/Offer authority.

### Product, Variant, identifiers and media

Product is common identity (canonical name, optional brand, scope, categories, common typed attributes and bounded media); ProductVariant is sellable/package identity (display name, measurement, variant attributes and identifiers). Every Product has at least one Variant, default for simple items. Variants do not nest. CartLine, StoreOffer and OrderLine reference the sellable Variant ID. Each mutable identity retains active state, version, attributable history and timestamps.

SHARED and STORE_SCOPED are scopes of one model. A SHARED identity need not have a barcode. Only authorized Operators create/edit it; Merchant can select it for an Offer or submit an attributable non-sellable proposal for authorized review. Store-scoped Product belongs to one Store and may be created directly without central proposal. No local registry, copied Shared Product or forced ownership conversion.

Store SKU is local to one Store; GTIN/EAN/UPC are global Variant identifier types with their actual uniqueness rules. Preserve explicitly unknown identifier types; never guess them or treat a barcode as the sole Product identity. One DSH resolver uses verified Store context and distinguishes existing StoreOffer, eligible SHARED Variant, STORE_SCOPED match, unknown and variable-measure identifier. Lookup alone grants no mutation.

DSH owns media identity, role, ordering, authorization and rights. External references are validated, credential-free and replaceable without redefining Product identity. A CommerceVertical illustration is a separate moderated provenance-backed DSH media relation, not Product or Category media or classification authority.

### Offer, quantity and modifiers

StoreOffer belongs to one Store and valid Variant; it is the sole current assortment writer. It owns exact integer YER price, pricing basis, unit/quantity min/max/step, inventory, availability, publication, version and attributable audit, not duplicate copies of Product name, taxonomy, Variant attributes, identifiers or canonical media. Discrete, measured and variable-measure quantities are distinct, expressed in exact integer base units; confirmed request range and actual fulfilled measure are separate. No authoritative floating point or fictitious half-unit. Availability-only does not invent numeric inventory; finite inventory requires atomic reservation/release/replay and unknown-outcome reconciliation before admission.

Bounded restaurant ModifierGroup/ModifierOption rules specify required/optional and min/max selections, ordering, availability and exact price delta. Options customize an Order instance, not duplicate Variants. Cart and Order retain canonical option IDs and immutable transaction facts; admitted free-text notes remain separate bounded fields. Actual measure/substitution changes after confirmation require lawful DSH adjustment and WLT financial delta.

### Entry, import and bulk operations

One DSH lookup accepts typed name, barcode or similar text and returns eligible Shared Variants with recognizable image/name/package. Normal entry selects an existing Variant or creates a private Store-scoped item, sets Store price/availability and saves. Selecting a Shared item creates or updates only its StoreOffer, not the Shared Product. Unpublished Stores may prepare drafts without acquiring public eligibility. Reveal size, measured units, variants, modifiers, SKU, taxonomy and media only as needed; no mandatory internal IDs or taxonomy wizard. Missing price and invalid variant cannot be guessed.

Quick Prices, scans, Operator Store-file preparation and bulk edit invoke the same writer. Bounded search/category/brand/package and offered/not-offered/hidden/missing-price views support preparation without automatically creating an Offer. Show explicit bulk summary, mutate only authorized changed rows and preserve old/new price, actor, time and provenance. Operator selection of multiple compatible Shared Variants uses bounded per-item commands, idempotency, actionable failures and Store scope rather than a second importer. Operator shared-registry editing and Store-local editing are different permission paths.

One CSV/XLSX Store import accepts known barcode plus price or Store-local name plus price and optional unit/variant without a barcode. Parse, normalize, resolve, preview conflicts and require explicit authorized commit. Use stable run identity, Store scope, durable per-row accepted/held/failed result, source attribution, old/new values and resumable internal chunks. A minority failure cannot erase valid committed rows. Hold existing Store-local matches, ambiguous Shared names, unknown/variable-measure identifiers and invalid or conflicting rows for explicit review; never guess, blindly upsert or duplicate. A valid name-only row can explicitly create a draft STORE_SCOPED Product and draft Offer after preview, never SHARED. Missing input is not deletion authority. Unknown responses reconcile before retry; changed facts under the same request identity reject.

Operator Store-specific import requires actual trusted Store/action scope; either merchant or catalog permission may authorize the specifically admitted import only after verification of current Identity/DSH mapping. Neither grants the other's domain mutations, finance, publication or Store ownership. Merchant needs current ownership or admitted Store-scoped authority. Revalidate revoked/foreign scope at retries as well as initial execution.

### Lifecycle and audit

Apply [safety](safety.md) and [engineering](engineering.md) to representation changes: preserve canonical identities, quantities, media, attributes, relationships and history, and immutable historical invoice/Order facts. No rewrite of protected migration history or guessed legacy classification. Explicit authorized mapping and Offer rebinding promote a local Product to approved Shared identity while preserving price/availability/audit and removing the losing identity responsibility once lawful consumers transition. No cosmetic conversion or arbitrary cascade. Bounded compatibility is not permanent dual authority.

Draft edits record previous/resulting values, version and commit time; published-price and stock reports require actual publication/inventory facts. Unknown/outdated is not zero stock. Publication/visibility of Category, Product, Variant, Offer, Store and media rights are independent. Removal and restore obey retained rights.

### Owner-backed limits

Historical accepted settings include 5,000 rows per Store import run and short video bounds of 10 MiB / 30 seconds. Support admitted import without an artificial 1,000-row ceiling or separate user-visible imports; internal chunks are allowed. Owner-backed validated policy governs applicable source-specific size, duration, moderation, listing windows, inventory and promotion usage bounds. Reference values are not immutable client constants. Changes require supported storage/validation/UX/cost and lawful limits. Missing mandatory policy fails safe. Larger limits do not grant unvalidated payloads, unrestricted upload, privacy bypass or unaudited prices.

## CUSTOMER_STORE_CATALOG — Privacy-safe, consistent discovery
CAPABILITY_ID: CUSTOMER_STORE_CATALOG

One DSH-composed read model serves eligible marketplace discovery, compact Store and full governed Customer Expo Web Store page; Direct links never grant marketplace eligibility. Bounded search/category/section/cursor reads reveal only permitted published information and truthful price/availability with approved media; minimize private Merchant facts and never expose credentials, service tokens or unnecessary precise location. No unbounded Store catalogue inline or client-side joins deciding authority.

One server CUSTOMER_VISIBLE_OFFER decision governs sellable public catalogue, cart and checkout: eligible published Store, active CommerceVertical/ServiceCity, active Product/sellable Variant, complete required typed shared classification or valid Store-scoped facts, published available Offer, positive exact price, valid quantity/inventory and modifiers. An explicitly admitted unavailable read-only projection must be truthful, never orderable or a way around visibility rules. Retired/unapproved identities cannot reappear from stale projections; raw ID, search, video and link confer no checkout authority. Recheck Store, channel, Variant, price, stock, geography and method at confirmation. Content and promotion use [commerce](commerce.md), not a new Catalogue mutation or pricing engine.

### Popularity, favorites and sections

DSH owns favorites and actor-scoped mutations; no separate durable client writer. Store-curated sections and default ordering remain independent of popularity. الأكثر رواجًا counts distinct canonically completed Store Orders containing each currently customer-visible Offer in the effective trailing window (historical initial 30 days). Delivered and completed pickup qualify; failed/rejected/cancelled/incomplete Orders and hidden/unpublished Offers do not. Exclude zero qualifying completions; ties use approved Product display name then stable Offer ID. DSH owns versioned bounded window, scope and display count; change affects future reads, not price/history. Bounded category/text filters retain ranking semantics, not page-local sorting or likes/impressions as sales. Empty ranking has explicit empty state; read failure preserves valid prior results with retry and truthful stale status, not false empty/success. Quantity and modifiers belong to product interaction, not nonessential compact-card metadata.

### Actionable quality and inventory intelligence

Distinguish definite canonical Product/Variant/Offer matches from ambiguous name/unit/attribute matches; recommend review rather than silently merge/delete/publish. Substitution preserves units, modifiers, legal bounds, consent and Order adjustment authority. Low-stock attention requires applicable finite inventory and approved threshold; expired observations, draft quantities, unavailable and availability-only Offers do not prove stockout. Separate draft edit, published price, actual stock movement and reservations/releases; use complete scoped queries, real timestamps and authorized exact-record links. Replenishment requires adequate demand/consumption, available/reserved inventory, incoming supply and lead-time evidence as applicable; account for censored demand and uncertainty. Suggestions do not bind suppliers, procure or mutate inventory. Apply [measurement law](architecture.md#measurement-integrity-and-intelligence-admission). No automatic PIM, ERP, POS, loyalty, advanced search infrastructure, multi-warehouse, multi-currency or integration product admission.

## Acceptance

Preserve admitted target obligations, not donor implementation as authority. Prove actual owner contracts and generated-client parity, two Store owners, granted/denied import and bulk operations, Operator Shared-write versus Store scope, draft/public isolation, legacy classification recovery where affected, category cycle and typed rules, exact identifier conflicts, unknown/stale/replayed mutations, empty/large catalogue, stale cursor, price change, modifier/quantity/weight mismatch, reservation, partial import, media authorization, removal/restore and applicable rendered Customer/Merchant Web/Android behavior. Verify real owner readback, customer visibility and no shared/local ownership leak or cross-Store IDOR. No mock, UI or source declaration proves deployed catalogue, migration, access or completed checkout.
