# Tasks — Merchant draft price and inventory editing

Derived decomposition of [spec.md](spec.md) and [plan.md](plan.md). Reconcile actual completion and existing evidence with the authorized work source before executing; this file is not a live status register.

- [ ] T001 — Verify DSH scope, draft eligibility, owner contracts and consumers (AC-01–06).
- [ ] T002 — Verify focused price/stock editing, immutable name, integer values, version/operation identity, recovery and Store/account changes using existing owner and presentation tests.
- [ ] T003 — Verify status filtering before paging; same availability/stockout definitions as owner inventory summary, combined literal search and keyset cursor, invalid/repeated selector denial (AC-07–09).
- [ ] T004 — Verify filtered/full export across every owner page, exact values, cancellation, scope and no partial file.
- [ ] T005 — Verify immutable old/new edit journal in the existing transaction, composite Store/Offer binding, result-version uniqueness, replay, stale/cross-Store rejection and no direct history mutation (AC-10/11).
- [ ] T006 — Verify stockout shortcut only from a positive verified count; clear search and preserve Store-wide scope.
- [ ] T007 — Verify Inventory and Products navigation/modes, actor/Store switching, eligible edit/recovery and absence of creation/publication controls in Inventory (AC-12/13).
- [ ] T008 — Run affected owner Go, isolated PostgreSQL, SDK/UI, uncached type and quality checks; actual authenticated Web/Android owner readback, exact source and CI. Preserve missing proof at the owner. No blanket data/schema transition or full journey claim.
- [ ] T009 — Deliver each owned tested foundation and reconcile its acceptance with the current engineering law. Published/bulk edits and related inventory reservation and import rights remain governed by the catalog owner.
