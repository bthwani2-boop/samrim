# Implementation Plan: Merchant draft price and inventory editing

**Owner:** DSH remains sole writer. **Source:** existing merchant-private-catalog.tsx, merchant-catalog-draft-form.tsx, catalog-transport.ts, owner Merchant draft contract. Archive donor mobile-store-quick-prices.tsx supplies reference for focus and versioned changes, not a new engine.

## Technical approach
1. Add focused mode in the existing private catalog, scoped to actor and Store. Reuse list, search, keyset and refresh.
2. Render only permitted draft edit affordances; reuse the existing MerchantCatalogDraftForm with an optional price/stock-only presentation, immutable name and same recovery key. No published write or route guard change.
3. Use existing transport and DSH write path unchanged; use actual owner results and error handling.
4. Tests first: component focus mode, non-editable name, selected Store scope, published denial; rerun draft recovery, native and browser contracts. Run Merchant typecheck and applicable Nx target.
5. Validate actual owner and browser/device only with authorized session; no auth bypass. Report remaining full capability separately.

## Design review (LIGHT, self-critique)
Rejected a duplicate screen/writer, unauthorized enabling of guarded deep links and a new bulk endpoint. Existing form's per-draft recovery record is shared between full and focused editors. Scope change unmounts form and aborts old requests; a prior uncertain name edit must be reconciled using full editor. Owner version check controls concurrent writes. No new database or migration; rollback is source-only.

## Increment 2 — canonical owner status filtering
Extend the existing GET catalog operation with an optional enum status, reuse the exact SQL eligibility predicate in inventory summary and list, forward/validate through the existing SDK and browser/native transport. Existing caller and Store grants unchanged. Add tests for selector validation, combined name/keyset/status and real isolated PostgreSQL, SDK/BFF transport and UI scope. Design critique LIGHT: no new access or writes, bounded SQL parameters, old callers unchanged. Do not edit a concurrent writer's catalog UI; complete only after coordination. Published price writes remain separate because they require versioned old/new audit and checkout impact review.

## Increment 5 — audit on existing writer
LIGHT design review: extend the existing immutable edit journal, not another writer/audit table. Snapshot the locked Offer and Product before UPDATE, preserve exact values and the current CAS and operation-id replay; no public contract change. Composite foreign key enforces Store scope. Edit only 10_catalog.sql baseline, do not overlay retained data. Extend actual existing isolated PostgreSQL integration test to verify both journal rows after two edits, race and replay, plus negative cross-store FK. Real owner integration, existing contract and Go verification required. Published and bulk mutation need separate DEEP design review (stock reservation/checkout, durable import run).
Reuse the existing private catalog state and Store status selector for the summary’s stockout shortcut. Show it only for positive verified stockout counts and cover the UI-to-transport selector in the existing render harness.

## Direct inventory workspace
Reuse MerchantPrivateCatalog with an explicit inventory-only presentation and a distinct actor-scoped mount from Products. Keep the existing owner selection, verified inventory summary, pagination, filters, draft edit and recovery. The Home shortcut passes only a currently verified Store. No parallel store, route, SDK, API, SQL or permission. Test RED/GREEN both workspace destinations and mode across Store switches, revocation and late replies; verify existing Web/native transport, Nx and actual runtime independently. Published and bulk writes remain open.
