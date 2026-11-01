# BThwani local demo content

This is an **offline authoring and preview pack** with synthetic Yemeni Arabic store/category examples, CSV rows accepted by the existing Store Catalog importer, and original local SVG artwork. It has no database, account, service token, external storage, or startup-seed integration. Preview never contacts a service.

## Safe preview

From the repository root run:

`node services/dsh/tools/preview-demo-content.mjs`

It validates the pack and prints counts plus missing canonical bindings. It does not create or modify files or send network requests.

## Canonical use in a separately isolated demo environment

1. Verify a separately isolated, disposable DSH/database/media target. Bind each `storeKey` to a Store created through the normal joining/admission and Store-creation workflow. Examples here are not Store records or permission to create them.
2. Create categories through the existing Operator Catalog category owner under a matching active CommerceVertical. Resolve canonical vertical/category IDs from isolated DSH; this pack intentionally does not guess them.
3. For each bound Store, use its existing Store Catalog CSV preview, review rows, then explicitly commit through that Store's canonical importer. Headers (`name`, `variant`, `unit`, `priceYER`) are supported. Whole-YER prices are synthetic examples, not commercial guidance.
4. Attach product/category/store images only through canonical media owners and provide provenance and rights attestation. SVGs here are **preview artwork**, not upload files: current image owners accept PNG/JPEG up to 10 MiB and 6000 by 6000 pixels. Rasterize selected artwork before a separately authorized media upload.
5. The discovery sample is a proposed informational banner. Create it only through DSH discovery-content flow with canonical media, valid dates/scope, an authorized Operator, and the normal publication transition. This pack does not publish content.

No shared/local database, protected Root Owner, account, order, wallet, role, key, session, real record, or external system is part of this pack. Never point an importer at a general development environment.

## Contents

- `content.json`: synthetic Store and category descriptions, artwork mapping, and a proposed informational discovery banner.
- `stores/*.csv`: one Store-specific import file per example Store, with three products and variants each.
- `images/*.svg`: original vector artwork with no remote assets or hotlinks.

Keys are pack-local references, not canonical DSH identifiers. Missing canonical bindings are expected until an isolated environment and owner-created records exist.
