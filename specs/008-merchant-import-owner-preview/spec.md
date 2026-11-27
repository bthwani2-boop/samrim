# Merchant catalog import, conflict review and owner-backed completion

Derived scope: CENTRAL_CATALOG, [catalog governance](../../governance/catalog.md). DSH alone owns Product, Variant and Offer identity, visibility, price and stock. Bounded review increments do not certify the complete import or publication journey.

## Read-only conflict preview

- AC1: After current permission and local parse, read the verified Store catalog across all bounded pages and mark valid names observed in that Store, including draft, published and unavailable offers. An unmatched name is not approval or confirmed new identity.
- AC2: Preserve invalid and in-file duplicate dispositions; preview sends no write and persists neither private source bytes nor local Product identity.
- AC3: Reject foreign actor/Store, inconsistent cursor, incomplete/over-limit catalog, abort, owner error or revocation; no partial matches or false absence. Retain scope keys, cancellation and finite deadline.
- AC4: Reuse existing paginated export traversal, bounds and exact values; no second catalog engine.
- AC5: Verify Web/Android component/data scope transitions, matches beyond first page, failure and repeated cursors; authenticated owner readback is separate.
- AC6: Show matching offer count. Unique match shows exact owner YER price, stock and publication state beside imported values; multiple matches remain ambiguous.
- AC7: Filter by disposition without losing original row numbers; reset pagination on filter, file or scope change. Counts cover the complete file.

## Current scope and individual draft recovery

- AC8: Failed subsequent private catalog read withdraws previous rows and import/export, inventory and draft controls. Retry/filter cannot restore them until fresh successful DSH read for actor/Store. Retain Store choice and retry; fail closed on invalid, unavailable and denied reads.
- AC9: Valid subsequent pages append under strictly advancing owner cursors; overlapping/backward pages fail closed.
- AC10: Only explicit Merchant action opens existing versioned edit form for a valid nonduplicate row uniquely matching eligible inactive Store draft. Preserve actor, Store, Offer ID, expected version, canonical name and exact integer price/stock. No auto-selection for published, available, ambiguous, foreign or ineligible matches.
- AC11: Separate explicit save through authenticated existing DSH PATCH and operation recovery. Unknown result retains original operation ID/version including remount; validated acknowledgment precedes success. Refresh/success discards review projection and requires fresh owner review.
- AC12: Successful DSH read required before controls on first entry and every actor/Store switch, including return to prior Store. Ignore canceled results. Normal filter/refresh in verified scope retains controls until failure; owner commands recheck authority.

## Extended catalog requirements (not activation)

- AC13: One Product/Variant/Offer registry distinguishes SHARED and STORE_SCOPED. Operator alone owns SHARED, same-vertical acyclic category tree and typed attribute rules. Store-owned uncategorized products remain legal. Offer references concrete Variant; reject cross-Store/vertical identity, collisions, unapproved shared products, invalid attributes/barcode type. Store SKU is Store-local; GTIN/EAN/UPC globally resolve concrete Variant. Preserve IDs, versions, Customer eligibility and history.
- AC14: Merchant quick entry selects eligible shared variant or explicitly creates Store-scoped draft through canonical writers. Name/barcode lookup distinguishes existing StoreOffer, eligible shared variant, Store-scoped match, unknown and variable-measure identifier; unknown barcode never silently creates identity. Verify current grant, exact price/stock, collisions, concurrent duplicates and revocation.
- AC15: Bounded CSV/XLSX decoding, original-byte SHA, at most admitted 5000 data rows; no formula/macro/external link execution. Reject malformed, oversized or unsupported shape. Explicit create/edit/hold; approved name-only unmatched creation of inactive STORE_SCOPED Product/default Variant/Offer requires owner-confirmed absence of Store match or ambiguous SHARED name. Unknown barcode/missing price remains held. Recheck conflicts under transaction lock; no implicit rename/publish/delete. One immutable run, durable row outcome and atomic create/edit receipts per chunk; stable retry, revocation and unknown outcome; valid rows survive minority held/failed rows.
- AC16: Approved publication, eligible Customer projection, one DSH versioned Offer price-stock writer, exact integer values, old/new attribution, conflict/retry. Availability is not numeric stock. Preserve reservations, units, cart/checkout revalidation and WLT boundary; no implied published edit from draft path.
- AC17: Scoped DSH media metadata/rights/moderation, constrained storage adapter, authorized Product/Variant/Offer attachment, type/content/size and visibility checks, remove/retry/reconcile without orphan disclosure. No provider credentials or real writes without authority; no vertical-media repurposing or private exposure.
- AC18: Actual isolated Identity, DSH, fresh PostgreSQL and exact source, real Merchant/Operator/Customer Web and affected Android. Two owners, wrong Store, revocation, invalid category/attribute, duplicate/unknown barcode, stale cursor/version, lost ACK/replay, draft invisibility, price/stock changes during browse/cart, media denial. Owner SQL readback, runtime parity, exact CI and material technical risk assessment; no mock/HTTP 200-only acceptance.

## Compatible draft CSV and inventory entry

- AC19: Separate UTF-8 CSV with exactly name,price_yer,stock_units from fresh complete Store-wide DSH pages. Only uniquely named inactive drafts with valid price/stock/version and unmodified safe name. Exclude ambiguity across all offers, formula-like names, invalid fields and active offers; report exclusions, no empty file. Preserve exact decimal text, quoting and zero stock. Import columns as text; no guarantee of spreadsheet autoformat. Full/filtered reports unchanged. Re-import requires fresh owner review, explicit rows and existing durable run; file is not authorization. Verify quoting, amounts, normalization collisions, invalid/ineligible, denial/abort, no-file result and Web/Android delivery.
- AC20: Existing export and explicitly confirmed draft-only CSV run with owner progress recovery reachable in verified Inventory/focused price-stock mode. Fresh scoped read before controls; revocation/failure withdraws them; confirmed change refreshes catalog/inventory. No creation or published write in Inventory; Products unchanged.

Actual state, acceptance and evidence remain at their owners; this specification grants no additional rights.
