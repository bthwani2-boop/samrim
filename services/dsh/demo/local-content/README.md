# Local BThwani demo content

These files are offline examples for implemented DSH catalog, media and promotion flows. Names, prices, codes and illustrations are synthetic. SVG art is original local vector art with no remote assets.

## Contents

- `catalog-scenario.json`: a Sana'a grocery with categories, shared products, Store assortment, package variants and promotion scenarios. `categoryKey` and `storeKey` are fixture labels, never DSH IDs or grants.
- `shared-products.import-template.jsonl`: input shape accepted by `node services/dsh/tools/import-catalog-products.mjs`. `MAP:` category values and the vertical marker are intentionally unresolved. Resolve via canonical DSH readback and replace in a working copy; never submit the template as-is.
- `store-offers.import.csv`: DSH Store Catalog import columns (name, variant, unit and whole-YER price). No Store ID, barcode, actor or credentials are included. DSH binds scope to the already-authorized Store import path.
- `promotion-drafts.json`: two request examples with symbolic references and dates that must be resolved. Partner authoring requires the authorized Store Partner; platform campaigns/publication/opt-in have separate Operator/Partner owners.
- `images/`: 10 original SVG illustration sources and corresponding 960 × 720 pixel PNG assets. Catalog manifest references PNG paths; PNG is an accepted DSH media format. No images have been uploaded.

## Safe preparation

1. Prove the exact DSH API and database are a separate disposable demo environment. A worktree, `DEMO` label, local-development mode or healthy local service does not prove isolation. This worktree has no demonstrated isolated demo runtime, so no API request or insert was made.
2. Read CommerceVertical, categories, Store, Product, Variant and StoreOffer through DSH. Reuse matches; preserve every existing entity. Do not create Store, actor, credentials, permissions, wallet, Order or Identity for this fixture.
3. Create only missing taxonomy through the authorized DSH category owner, respecting the current vertical and parent tree. Map `MAP:produce`, `MAP:dairy`, `MAP:pantry`, and `MAP:poultry` to returned category IDs. Never guess IDs.
4. Use the canonical central importer in `preview` mode only after target isolation/authority is established. Preview does not mutate Products, but it creates an auditable DSH import run and therefore writes durable DSH state. Review conflicts and existing matches; explicitly approve a commit only within the isolated demo. A stable source hash/run ID makes replay auditable, not disposable.
5. Use the canonical Store Catalog import preview/commit for the CSV with an already-authorized synthetic Store owner path. Name-only rows create STORE_SCOPED identities and draft offers; this is not a Shared Product import. Never alter an existing Store to fit the fixture.
6. The CSV starts with one sellable Variant per row. Add optional package variants only through the owning Product/Store Variant endpoint after canonical Product readback.
7. PNG assets are already generated (960 × 720 pixels; all under 10 MiB) alongside the source SVGs; no converter or additional image dependency is required to use them. Attest provenance/rights, then upload through the matching Category, shared Product, Store-scoped Product and Store cover multipart owners. Use unique stable idempotency keys, current entity versions, and verify canonical media readback. The Store cover uses the Store profile/cover media owner.
8. Create promotion drafts only through the matching DSH Operator or authorized Partner route. Examples use a 10% item discount and a fixed 100 YER order-threshold discount; resolve references/dates and review funding policy first. Do not publish, redeem or create an Order during setup.

Canonical references: `services/dsh/tools/import-catalog-products.mjs`, `services/dsh/contracts/openapi/paths/catalog.yaml`, `services/dsh/contracts/openapi/paths/marketing.yaml`, `docs/governance/product/capabilities/partner/central-catalog.md`, and `docs/governance/product/capabilities/commerce/commerce-promotions.md`.

## Offline checks

Run `node --test services/dsh/tools/local-demo-content.test.mjs` for fixture shape, synthetic references, PNG signature/dimensions and safe local SVG sources. It does not access the network or write DSH data. Run `node tools/dev/check-encoding.mjs` for repository encoding. Neither proves runtime isolation or inserts data.
