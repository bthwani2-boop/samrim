# BThwani — One Product Registry and Store Offers

ARTIFACT_CLASS: DOMAIN_GOVERNANCE_DRAFT
SEMANTIC_OWNER: governance/catalog.md
STATUS: DRAFT_PENDING_FULL_GOVERNANCE_CUTOVER
IMPLEMENTATION_STATE_AUTHORITY: NONE

## CENTRAL_CATALOG — Canonical taxonomy and assortment
CAPABILITY_ID: CENTRAL_CATALOG

**Owner and outcome:** DSH owns one canonical commercial category taxonomy, Product, ProductVariant, StoreOffer and StorefrontSection model. Operator maintains global taxonomy and appropriate shared product suggestions. A Merchant manages eligible Store-specific products, variants, attributes, prices, inventory, images, ordering and availability through the **same owner**, including the quick-entry path for small Shops.

The catalogue has domain-specific needs (groceries, restaurants, variable weights, modifiers, pharmacies and other admitted service types) without a second Registry or bespoke Order engine per Store relation. Shared products may be referenced by Stores; Store-owned unique products remain properly scoped. Publication and visibility are controlled at appropriate category/Product/Variant/Offer/Store levels; a retired or unapproved Product must not reappear by way of stale public read models.

One StoreOffer belongs to one Store and one valid ProductVariant; its current price and availability are authoritative DSH facts evaluated at confirmation. Unit normalization, quantities, stock reservation, quick prices, imports/exports, media processing and operator review follow explicit traceable contracts. Do not precompute unrelated Store prices in customer clients or create a duplicate local Catalogue for DIRECT Store Web.

**Safety:** Every Store SKU, variant, category, media key, batch import, pagination cursor and catalog bulk edit is authenticated and Store-scoped. Cross-Store IDOR and published/unpublished isolation are mandatory. Images/videos and references retain lawful ownership and approvals; media storage is an adapter, not a catalogue writer.

**Failure/recovery:** A bad import or partial network response does not create conflicting Product IDs or shadow offers. Bulk operations must be resumable/idempotent at the owner with bounded audit. Product removal/restore is governed, not arbitrary cascade deletion. Variable-measure pricing uses exact authoritative quantity/units and, if actual measure changes after confirmation, a legal DSH Order adjustment with WLT financial delta.

## CUSTOMER_STORE_CATALOG — Privacy-safe, consistent discovery
CAPABILITY_ID: CUSTOMER_STORE_CATALOG

**Outcome:** Customer sees only permitted published Stores and eligible Offers with accurate current price/availability and appropriate filters. Marketplace discovery obeys the Store's relation and publication state; a DIRECT Store full Web page does not grant marketplace listing. A full public Store presentation and compact marketplace Store view share one DSH catalog read model and approved media.

A search/filter result, video card or deep link is a **projection**, not proof that checkout is eligible. On opening an Offer and at cart/checkout confirmation, DSH revalidates availability, Store scope, city serviceability, variants, authorized pricing and fulfillment rules.

**Proof:** Two Store owners, empty/large catalog, unavailable/draft items, stale pagination, identifier collision, category permission, price changed during browsing, variant/modifier/weight mismatch and safe recovery. Rendered Customer Web/Android/affected platform evidence complements owner-backed readback.

## Exact public eligibility and batch acceptance

DSH exposes one server-side `CUSTOMER_VISIBLE_OFFER` decision for public catalogue, offer details, cart and checkout. Its complete admitted inputs include an eligible **published Store** and active CommerceVertical/ServiceCity; an active Product and sellable Variant; validated required taxonomy/typed attributes for `SHARED` identities or valid Store-owned facts for `STORE_SCOPED` without forcing a shared category; a published, available StoreOffer with **positive exact price**, allowed quantity/inventory and valid modifiers. A raw Offer ID or deep link never bypasses this evaluator. The owner composes bounded, Store-scoped catalog pages instead of requiring the Customer to fetch/join unrelated Product/Offer tables or an unbounded full catalogue.

An import run has one explicit **preview → conflict disposition → authorized commit** with per-row durable outcomes for accepted, held and failed rows. Bad minority rows cannot erase valid accepted rows, and unknown/failing network outcomes must be resolved by run identity before retry. Duplicate barcode, shared-name ambiguity, missing price, Store-scoped name collisions and malformed quantities are actionable held/conflict cases, never guessed new Product identities; an XLSX/CSV import and Quick Prices remain alternate interfaces to the single DSH StoreOffer/Store-scoped Product writers. The actor, Store, original source and changed old/new values are preserved in attribution and audit. Owner-authorized pagination, deterministic cursor ties and grant checks apply before any bulk update.

## Design boundaries
Use real retained catalogue features, not blind copy of old folders. No `independentCatalog` or `marketplaceCatalog` with its own writer; relation differences are eligible views/policies. A shared technical package requires proven multiple consumers and never contains mutable catalog truth.

## Typed taxonomy and sellable-identity preservation

A `ServiceCity` is geography, a `CommerceVertical` is the Store's business activity, a `CommercialStoreType` is its compatible operating business model, a `CatalogCategory` is a shared Product taxonomy node and a `StorefrontSection` is Store-local merchandising. These are **five different facts**, not a hierarchy of derived display strings, foreign-key shortcuts or fee selectors. A Store has exactly one admitted primary vertical in the initial model. No legacy Store is assigned a guessed vertical merely because it lacks a current one.

Categories are a same-vertical acyclic tree with flexible depth, not mandatory L1–L4 columns. Required/filterable/variant attribute rules belong to categories and have **typed values** (text, number, boolean, enum, measured value, date); no opaque options object becomes a second source. A Store-scoped Product is allowed to remain uncategorized without hiding an otherwise eligible StoreOffer. A compatible category assignment does not convert it to Shared ownership.

`Product` represents a common identity and `ProductVariant` a concrete sellable/package identity. Every Product has at least one Variant, including a default one for simple items; every CartLine/StoreOffer/OrderLine references the **sellable Variant ID**. `SHARED` and `STORE_SCOPED` are one model with two owner scopes. Only authorized Operators may create or edit SHARED; a Merchant may use Shared Variants through an Offer, submit a non-sellable proposal, or directly create a Store-scoped Product without central proposal. Store SKU belongs to one Store; GTIN/EAN/UPC are global Variant identifier types, and unknown barcode types must not be fabricated.

StoreOffer owns Store-specific integer YER price, pricing basis, exact unit/quantity min/max/step, inventory/availability/publication and version. Discrete, measured and variable-measure quantities are distinct; no binary floating-point quantity or fictitious `half` unit becomes authoritative. Availability-only is not fake numeric inventory; admitted finite inventory requires real atomic reserve/release/replay handling. Restaurant modifier groups/options carry bounded selections, price deltas and availability without becoming additional ProductVariants.

## Import/quick prices as interfaces, not writers

One Merchant quick-entry path uses name/barcode lookup, Shared Variant selection or Store-scoped Product creation, Store price/availability and one canonical save. Do not require a category tree wizard or manual internal IDs for every offer. Import accepts actual CSV/XLSX Store-scoped inputs with preview/conflict review before an authorized commit. Unknown barcode, collision, missing price or ambiguous Shared name is **held for review**, not guessed into a current identity or automatically deleted. A run may include **5,000 rows** and process internally in chunks without becoming separate user-visible imports, losing valid rows because a minority fail, or imposing a false 1,000-row ceiling. Quick Prices, Store record bulk editing and barcode scanning invoke the same DSH StoreOffer writer and per-row audit, never an alternate price table.

A Store-local Product may later be promoted to an approved Shared identity **only** with explicit authorized DSH identity mapping, rebinding Offers and historical audit, not a cosmetic classification or silent ID replacement. Media, category, variant, Store SKU, requested quantities and invoice snapshots must survive a lawful migration without cross-Store disclosure.

## Donor-preserved Store catalog authorization and barcode resolution

A Store-specific Operator import or bulk Offer action is a **bounded DSH Store operation**, not a grant to edit all Shared Products or another Merchant's Store. The donor's existing Operator grants `partners` and `catalog` may each authorize the **specific Store import operation** only after independent trusted Operator/Store/action scope verification. Possessing either grant does not automatically confer the other's domain mutations, financial rights, publication or Store ownership; the exact new API/ACL mapping awaits Identity/DSH contract review. Merchant Store import requires a current Store-specific grant and canonical DSH readback. Failures and revoked scope fail closed, including partial batch retries.

The shared DSH barcode resolver receives the verified Store context and scanned identifier and distinguishes **existing StoreOffer, eligible SHARED Variant match, STORE_SCOPED match, unknown identifier, and variable-measure identifier** before proposing a mutation. A Store-scoped SKU is not a global barcode; an unknown or variable-measure code must not be silently interpreted as GTIN/EAN/UPC or create a new Product. A lookup result alone does not add an Offer or confer authorization.

In one CSV/XLSX Store import, a name-only row with an admissible Store-specific price may create a **draft STORE_SCOPED Product and draft StoreOffer**, never a SHARED Product, after explicit preview/commit. An existing local match, ambiguous Shared match, unknown identifier, stale version or conflicting quantity is held with a per-row reason and does not silently duplicate identity. Missing input is not authorization to delete existing catalog facts, and blind upsert is prohibited. Replayed runs preserve one run identity, Store scope and durable per-row result.

An illustrative image attached to a `CommerceVertical` is a separate DSH-governed catalog media reference with provenance, rights and moderation; it is not Product media, category identity or a change to Store classification. A Store's primary vertical is never inferred from a picture, label or legacy record.

These are **draft-preservation conditions from branch 41**, not evidence of a runnable importer, authorized ACL implementation or completed independent security review. Implement and test them only after governance cutover and a real owner contract.

## Owner-backed merchandising and media limits

A **5,000-row** Store import run and the earlier **10 MiB / 30-second** short video bounds are *initial accepted donor settings*, not immutable code constants. DSH/content owners may expose validated **per-source bulk-import limits, file/media size, video duration, moderation, listing windows, inventory thresholds and promotion usage limits** as clearly named Operator Policies controls only if the media/storage, validation, user experience and costs are actually supported.

A higher number never authorizes oversized unvalidated payloads, unrestricted uploads, privacy violations, unaudited price changes or bypassing Product/Store eligibility. Existing approved media URLs and historical Order product snapshots remain stable on policy changes. An absent policy fails safe and cannot be silently replaced with a new client constant.

## Customer popularity, favorites and Store sections — one DSH read model

The pre-existing `الأكثر رواجًا` Store catalog ranking is based on **distinct canonically completed Store Orders containing each customer-visible StoreOffer** in an effective trailing time window (historical initial setting: **30 days**). Delivered Orders and completed Customer Pickup qualify; rejected, cancelled, failed, uncompleted or unpublished/hidden Offers do not. Offers with zero qualifying completions are excluded from the popularity section; equal counts sort deterministically by approved Product display name and stable Offer identity. Only the DSH Order and Offer owners supply counts and visibility, never client likes, impression counts or a second analytics-derived pricing writer.

The qualifying time window, permitted display count and eligible ranking scope are **DSH owner-backed Operator Policies**, with lawful bounds and versioned readback. Changing a window changes only future published ranking queries, not completed Order history or a Store's price. Avoid the tempting mistake of hardcoding a 30-day client calculation or inferring a ranking from one loaded page. Store-curated sections and current catalog default ordering remain separate from popularity, and **actor-scoped Customer favorites** are separate from completed sales, promotions and entitlement.

Catalog list filters, category/text search, paginated cursors, relevant modifiers and quantity controls must preserve Store/owner/publication isolation. Detailed Product/Variant information belongs in the product interaction, not duplicated as unreadable compact-card metadata. An unavailable Offer may remain in a truthful read-only owner projection but is never silently orderable.
