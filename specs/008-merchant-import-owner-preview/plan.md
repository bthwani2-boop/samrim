# Implementation plan — Owner-backed catalog import and review

Derived from [spec.md](spec.md) and [catalog governance](../../governance/catalog.md). Reconcile current implementation, contracts and evidence before editing; keep one DSH writer.

## Bounded review and recovery

1. Use Merchant catalog-import, catalog-pages, merchant-private-catalog and existing SDK/BFF. Reuse verified traversal, pre-file permission, scope and cancellation. Verify multi-page matches, repeated cursors, invalid/duplicate rows and no partial result.
2. Keep conflict counts, exact comparison values, filters and row identity. Use existing generation/actor/Store proof for first read, switches, failure and control withdrawal; test overlap, cancellation, ordinary filter, revocation and retry.
3. Reuse draft edit/recovery for explicit unique inactive match, exact values and canonical name. Verify version, stable operation identity, eligibility and acknowledgment. No automatic dispatch or second write path.
4. For compatible CSV use complete unfiltered traversal, same normalization/eligibility rules and existing Web/Android delivery. Preserve reports; exclude unsafe/ambiguous names instead of transforming identity. Reuse existing CatalogExport/CatalogImport and owner-confirmed refresh within verified Inventory.

## Owner completion and dependencies

1. Reconcile Product/Variant/Offer identity and category/identifier constraints in the existing DSH registry. Verify compatible scope, composite Offer references and retained identities before shared references. Baseline-first fresh SQL; retained-data transition separately authorized.
2. Reuse transaction-scoped create/edit writers, scope lock and current grant checks. Explicit manifest disposition binds operation/row; absent disposition preserves compatible hold. Creation receipt binds created Offer/version, edit receipt preserves immutable audit. Recheck resolver under lock; no nested transaction/HTTP in row processor or duplicate effect.
3. Reuse bounded preflight/decoder and traversal. Evaluate actual XLSX tooling, pinned dependency necessity, license/security and decompression bounds; no donor engine copy. Preserve bytes, rows, exact values and explicit dispositions. Verify strict owner result and compatible contract/SDK/BFF.
4. Use canonical publication/Offer writer with eligibility, version, Customer browse/cart/checkout, reservations and concurrency. Media metadata/rights belong to DSH; storage adapter remains constrained.
5. Verify affected Go, real isolated PostgreSQL/Identity, SDK/BFF/component, contracts, uncached Nx/type/lint, coverage/quality and authorized Web/Android. Include denial/interrupt/replay, material technical risk assessment and exact delivery/CI per AGENTS.md. Do not declare extended capability complete without applicable AC13–20 proof.
