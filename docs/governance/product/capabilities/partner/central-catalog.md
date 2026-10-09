# Central Catalog

ARTIFACT_CLASS: DURABLE_PRODUCT_CAPABILITY_GOVERNANCE
SEMANTIC_OWNER: docs/governance/product/capabilities/partner/central-catalog.md
EXECUTION_AUTHORITY: NONE
IMPLEMENTATION_STATE_AUTHORITY: NONE
CAPABILITY_ID: CENTRAL_CATALOG

## Outcome

DSH owns central shared commerce identities, Store-local catalog content and
one canonical Store offer truth. The capability serves restaurants, groceries,
pharmacies, fresh goods and other currently admitted Store verticals without
collapsing a shared sellable package, a Store-owned menu item, a Store offer or
a storefront grouping into one record. The Operator workspace manages the
shared catalog; the Partner surface manages the Store's local catalog and
assortment; the Client surface reads a DSH-composed customer-safe storefront.

This Central Catalog capability does not admit a full PIM, ERP, POS or marketing
system.

## Ownership and verticals

`CommerceVertical` is the canonical classification of the commercial activity
of a Store. A Store has exactly one `primary_vertical_id` in the admitted Product model. A
Partner is not vertical-scoped and may own Stores in different verticals.

The joining case requires the first-Store vertical before admission. The value
is preserved through review, correction and resubmission and is transferred to
the Store atomically with Store creation. An existing Store with no vertical
is retained for history but is not vertical-discoverable or customer-visible
until an authorized Operator assigns one through the DSH owner path. No legacy
Store receives a guessed vertical.

The Commerce Vertical registry is canonical DSH data, not a hard-coded Governance inventory. Registry members change only through authorized DSH mutation and canonical readback; this capability owns the classification semantics, not the current registry contents. A vertical may carry a non-authoritative workflow preference that helps route initial product entry. That preference cannot require a Store or vertical to use only shared or only Store-scoped identities and cannot block a mixed assortment.

## Reference classification and sequencing boundaries

Keep four independent DSH-owned concepts distinct: `ServiceCity` is geographic operating scope; `CommerceVertical` classifies the Store's commercial activity; `CommercialStoreType` is a compatible business-model type within one vertical; and `CatalogCategory` is the shared Product taxonomy within a vertical. A Store-local `StorefrontSection` is a fifth, separate merchandising/grouping meaning. None is a synonym, a surrogate foreign key or an authority inferred from another label.

A submitted first-Store joining case requires an active Service City, Commerce Vertical and compatible CommercialStoreType, but it does **not** require a pre-existing exhaustive shared Product library or every category of that vertical. An authorized Operator may establish the needed registry/taxonomy/Shared Product core ahead of onboarding as a current-program preparation choice; such preparation does not alter the Field role-admission prerequisites. Field may later use Shared Products, create permitted Store-scoped items and submit missing Shared Product proposals before Go-Live. Publication and customer-visible offer eligibility still enforce their separate catalog rules.

Reference readiness means proven values and owner API readback for the particular admitted scenario, including active status and vertical/type/category compatibility where that relationship applies. Database schema existence, menu navigation or a test/demo record name alone is not proof of readiness. Do not automatically seed new actor/store/offer authority when initializing a catalog.

## Shared catalog taxonomy and data definitions

`CatalogCategory` is the shared catalog taxonomy: a flexible tree with
`parent_category_id`. It is not a fixed L1/L2/L3/L4 model, a
`CommerceVertical`, or a Store-local menu grouping. A category belongs to one
vertical. A shared Product may have multiple category assignments
when each assignment is explicitly valid for its vertical. Parent links must
remain in the same vertical and cycles are rejected. Store-local items are
organized by their Store's menu/grouping data; they do not need an invented
assignment to the shared taxonomy.

Category rules are owned by the category through typed
`CategoryAttributeRule` records. A rule may be required, filterable or a
variant axis. The rule model is bounded to the data types needed by current
catalog use cases: text, number, boolean, enum, measurement and date. Values
are typed records, never an opaque options JSON blob, encoded names or a
vertical-specific column explosion.

## Product and ProductVariant

`Product` is the common commercial identity. `ProductVariant` is the concrete
sellable/package identity. Every Product has at least one Variant; a simple
Product has one default Variant. A Product family and its sellable packages
are therefore distinct, while CartLine, StoreOffer and OrderLine always refer
to `variant_id` as the sellable identity.

Product owns common identity facts: canonical name, optional brand, scope,
category assignments, common typed attributes, bounded media relations,
active state, version and timestamps. Variant owns sellable facts: display
name, measurement identity, variant typed attributes, identifiers, active
state, version and timestamps. A variant cannot be nested under another
variant.

Product ownership is explicit:

- `SHARED`: Operator/catalog-governed identity reusable by authorized Stores.
- `STORE_SCOPED`: identity and content belonging to exactly one Store, managed
  by its Partner through DSH, and never silently made shared.

A Store may hold `StoreOffer`s for both `SHARED` and `STORE_SCOPED` Products at the same time. `SHARED` does not require a barcode or any other identifier. Identifiers remain Variant-level: `GTIN`, `EAN` and `UPC` are global sellable identifiers; `SKU` is scoped to its Store.

Partners cannot create or mutate a Shared Product directly. If a required
Shared Product is missing, the Partner submits a `ProductProposal`. A proposal
is attributable, reviewable and never sellable; only the authorized DSH
acceptance transition may create the Shared identity. `STORE_SCOPED` items do
not require a proposal and their name, description, media and menu grouping
remain owned by that Store. Partner workflows may route users toward common
actions, but vertical preferences cannot restrict Store assortment ownership.
The Client does not present shared/local ownership as separate customer
categories.

## Identifiers and media

Identifiers belong to Variants, not Products. DSH supports global `GTIN`, `EAN` and `UPC` sellable identifiers and Store-scoped `SKU`, with exact uniqueness rules. An identifier whose external type is not verified must remain explicitly represented without inventing a more specific external type; no barcode or provider identifier becomes the sole Product identity.

Media is a bounded catalog-owned relation. Product media identity, role, ordering and authorization remain DSH catalog truth. Storage/provider/transport choice is an integration concern and does not become Product authority. External media references are validated, contain no credentials and are replaceable without redefining catalog identity.


## StoreOffer and StorefrontSection

`StoreOffer` is the Store-scoped commercial relation:

```text
store_id → variant_id → Product
price_minor + currency=YER
pricing_basis
quantity_policy
inventory_policy
availability
publication
version + attributable audit
```

An offer does not copy canonical Product name, taxonomy, variant attributes,
identifiers or canonical media. Partners may create and manage offers only for
Stores they own. `StoreOffer` is the sole current Store-assortment writer. Historical aggregate names or representations have no current mutation/readback authority.

Quantity has exact integer base units and separate requested quantity,
pricing basis, minimum, maximum and step semantics. Discrete quantities use a
count base unit; measured quantities use a dimension base unit such as grams.
`VARIABLE_MEASURE` is distinct from `DISCRETE` and `MEASURED`; where it is
customer-sellable, the confirmed request range and the actual fulfilled amount
are explicit facts. No floating-point business quantity, fake `half`/`quarter`
unit or display label is an authority.

Current offers admit `AVAILABILITY_ONLY` inventory. It does not
invent stock numbers for restaurants or stores without finite-stock evidence.
Finite count/measure inventory may be admitted only with an atomic reserve,
release, duplicate-retry and unknown-outcome rule owned by DSH; an enum or
unused stock table alone is not an implementation of that capability.

`StorefrontSection` is a Store-local menu/catalog grouping such as main meals,
drinks or family offers. It organizes that Store's local items and eligible
offers for presentation; it is not the shared `CatalogCategory` taxonomy. A
section placement may reference only an eligible Store item or offer. The
customer sees one coherent Store catalog organized for that Store, without
separate headings that expose internal central/local ownership.

## Restaurant modifiers

Where the current Store vertical requires customization, DSH owns bounded
`ModifierGroup` and `ModifierOption` records with required/optional selection
constraints, min/max selections, availability, price delta and ordering.
Modifier options customize an order instance; they are not ProductVariants.
Cart and Order store canonical option IDs plus the frozen snapshot required for
the transaction. Free-text line notes, if admitted, are separate bounded
fields. Customization is never an opaque `cart.options` JSON authority.

## Customer visibility and read model

DSH owns one `CUSTOMER_VISIBLE_OFFER` evaluator. It is the only eligibility
rule used by storefront catalog, cart and checkout. At minimum it requires:

```text
published Store
active primary CommerceVertical
valid Service City / Store scope where applicable
active Product and Variant
complete required shared CatalogCategory classification/attributes for a Shared Product
valid Store-local item facts for a STORE_SCOPED Product, without requiring a shared category
published and available StoreOffer
positive exact price and valid quantity policy
valid modifier configuration where applicable
```

The Client surface never composes Product, Variant, Offer, category, modifier or
inventory requests to decide visibility. DSH returns a composed storefront
read model, with bounded pagination/search and category/section filters when
material. Direct IDs cannot bypass the evaluator and a Store detail response
does not inline an unbounded catalog.

## Operator and Partner operations

The Operator Catalog workspace may manage verticals, shared taxonomy, typed
attribute rules, Shared Products, Variants, identifiers, bounded media,
proposals, legacy classification recovery and import preview/commit. Every mutation goes to DSH
for validation, authorization, idempotency, concurrency control, audit and
canonical readback; the Control Panel is not a business owner.

Catalog bulk/import mutation has one canonical DSH writer path. Any admitted import mechanism must validate before mutation, distinguish duplicate/conflict from new identity, require an explicit commit boundary, preserve attributable audit and finish with canonical readback. Missing input never implies deletion, blind upsert is forbidden, and retry/resume cannot silently create a different identity.

Field, Partner and authorized Operator catalog work use one Store Catalog import flow with surface-specific authorization. It accepts XLSX and CSV rows with a barcode and price when the identifier is known; the user does not need internal IDs or enums. One run parses, normalizes and resolves rows, previews results, commits valid rows and leaves unresolved rows for review. An invalid or conflicting minority does not discard valid rows. A run is replay-safe and auditable, and the current Product target supports 5,000 rows in one run; internal chunking does not create multiple user-visible imports or a hard 1,000-row cap.

Quick Prices edits use the canonical `StoreOffer` mutation. Search and category/brand/package filters help find products, including without-price, already-offered, not-offered and hidden items. Bulk changes show a summary and require an explicit commit. Listing a Shared Product never adds an offer. Only changed rows mutate, and the canonical audit preserves old/new price, actor, time and provenance. Field, Partner and Control Panel barcode scans use one DSH resolver with Store context and the scanned identifier; it distinguishes an existing Store offer, Shared match, Store-local match, unknown identifier and variable-measure identifier. Store SKU is not a global barcode, and variable-measure codes are not silently treated as GTINs.

Partners can browse/search Shared Products, inspect Variants and identifiers,
select Variants and create StoreOffers alongside their Store-scoped items.
They manage price/quantity/availability/publication and their Store-local
items, menu groupings and modifiers where applicable. A vertical workflow
preference may help route entry but cannot restrict a Store to one ownership
scope. Cross-Store access, Shared Product mutation and direct Shared Product
creation are denied.

Before Go-Live, Field may search the Shared Catalog, scan identifiers, create
StoreOffers and set initial price/availability, create Store-scoped Products,
import the initial Store assortment, and submit Shared Product proposals or
corrections for its authorized joining Store. DSH enforces that joining-case,
Store and pre-publication scope server-side. Field cannot approve or merge
Shared identities or directly change Shared media. Its initial catalog write
authority ends at successful Go-Live; the Partner then owns ongoing Store
catalog operations.

## Evolution and migration invariants

Catalog representation may evolve only through the DSH-owned migration history under `docs/governance/policies/data.md`.

- migration mutability and protection follow the consuming repository's exact-state execution rules and `docs/governance/policies/data.md`; never rewrite merged or preservation-required migration history, and never copy a live migration ordinal/range into Governance;
- representation changes preserve current canonical Product, Variant, StoreOffer, identifier, media, category and audit meaning unless an explicitly authorized Product decision changes that meaning;
- local-to-Shared promotion selects or creates an approved Shared identity, repoints the Store's offers while preserving price, availability and history, then removes the losing local identity responsibility;
- legacy/historical records are never guessed into a current classification merely to satisfy a newer model;
- a migration/cutover has one winning current writer/readback path; losing writers and compatibility residue are removed when their bounded coexistence need ends;
- historical cutover details belong to Git and executable migrations, not live capability truth.


## Failure, security and proof invariants

- Operator-only Shared Catalog mutations and Partner-own-Store authorization
  are enforced at DSH using trusted actor/session context.
- Client input never grants Store scope, Product scope, vertical, eligibility,
  price, quantity, inventory or publication authority.
- Exact identifier conflict, duplicate request with different facts, stale
  version, invalid category cycle, invalid typed value, unavailable offer,
  cross-Store access and direct-ID bypass fail closed.
- Mutations are idempotent, attributable and read back from committed DSH
  state. Unknown outcomes reconcile before retry.
- Public responses minimize private Partner data and do not expose credentials,
  service tokens or unnecessary precise location.
- The proof set includes migration/readback, API/generated-client drift,
  Operator and Partner negative authorization, importer preview/commit,
  duplicate/stale/conflict/retry, category/variant/identifier rules,
  customer visibility, bounded catalog pagination, RTL real-device customer
  flow and real-device Partner flow.

Campaign/promotion eligibility and discovery-content publication are separately governed by `COMMERCE_PROMOTIONS` and `DISCOVERY_CONTENT`; they do not become Catalog mutation authority. The capability does not admit loyalty, advanced search infrastructure, POS/ERP/SFTP integration, multi-warehouse, multi-currency or placeholder catalog capabilities.
