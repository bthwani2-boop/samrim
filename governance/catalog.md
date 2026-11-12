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

## Design boundaries
Use real retained catalogue features, not blind copy of old folders. No `independentCatalog` or `marketplaceCatalog` with its own writer; relation differences are eligible views/policies. A shared technical package requires proven multiple consumers and never contains mutable catalog truth.
