# Repository Map

DOCUMENT_CLASS: HUMAN_DEVELOPMENT_GUIDE
PRODUCT_AUTHORITY: NONE

## Top-level intent

- `apps/` — deployable hosts/composition.
- `services/` — bounded-context/service implementations.
- `packages/` — proven reusable technical packages only.
- `contracts/` — genuinely cross-service protocol primitives/catalog material only.
- `infra/` — environment/deployment composition.
- `governance/` — durable Product/System/architecture/policy knowledge.
- `docs/` — human development/operations guidance.
- `tools/` — automation/evidence, not product/architecture authority.

## Before editing

1. Identify the Product capability/journey in Governance.
2. Identify the canonical owner/writer.
3. Determine whether the change belongs to an app host, service capability, technical package, contract, infra or tooling.
4. Inspect current executable source rather than inferring from documentation filenames.
5. Build/verify the complete affected cone.

## Placement law

A file belongs where its durable responsibility is owned, not where it is easiest to import from.

- routes/navigation/native shell → app host;
- business semantics/writers → owning service;
- visual primitives → design system;
- cross-boundary API/event schema → owning executable contract;
- environment composition → infra;
- developer automation → tools.

Generic `shared`, `common`, `core`, actor-prefixed capability buckets and mechanism-named domains require explicit proof before admission.
