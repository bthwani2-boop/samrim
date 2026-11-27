# Feature Specification: Merchant draft price and inventory editing

**Capability:** CENTRAL_CATALOG / BTH-13 (bounded increment)
**Authority:** governance/catalog.md and existing DSH Merchant draft contracts; derived Spec Kit artifact, not policy.
**Scope:** existing authenticated Merchant workspace, Web and Android; no new route admission, API, SQL or writer.

## User scenario (P1)
A Merchant chooses a Store, opens a focused price/inventory view, searches its current owner offers, and updates an eligible unpublished Store-scoped draft without editing product identity. The price and stock are saved by DSH using the existing versioned draft edit, then the catalog and summary reload. This is a bounded precursor to full Quick Prices, not the full published/bulk capability.

## Acceptance
- AC-01: The price/stock view is reachable from the existing authenticated Products area and supports the existing Store selection, search and pagination. Store/account changes discard the previous visible mode/edit context.
- AC-02: Prices are integer YER; quantity uses existing owner limits. Name is fixed to the selected draft; no edit action for published/available/active/sellable/validated or non-draft identifiers.
- AC-03: Existing version, operation ID, recovery metadata, same-scope owner authorization and no automatic new ID after uncertainty are retained. The full draft editor remains available for recovery involving name changes.
- AC-04: After owner confirmation refresh catalog and inventory; never claim publication or update success from a local change.
- AC-05: Negative tests for mode/Store/account switching and ineligible rows; component tests for preserved name, exact request and uncertain replay. Real authenticated Web/Android and owner readback required for closure.
- AC-06: Full bulk/published edits, stock reservation and audit remain separate open work; no local price table.

## Edge cases
Empty catalogs, owner failures, permission revocation, stale pagination, account/Store change during an edit, version conflict, unresolved previous full edit, interrupted save, Arabic digits.

## Increment 2 — Store catalog status filters
- AC-07: Merchant can select all, unpublished, published, available, unavailable or stockout; optional owner-side status applies before keyset pagination, combines with literal search and does not change complete inventory counts.
- AC-08: Available/unavailable and stockout match the existing inventory-summary definitions. Invalid or repeated selectors fail before owner calls; omitted filter preserves existing clients. Foreign Store and revoked sessions remain denied.
- AC-09: On filter change start a new cursor and discard stale responses. No publication or price mutation, new table, or new API route.

## Increment 5 — immutable old/new values for draft edits
- AC-10: Each accepted versioned draft edit records exact old and new name, integer YER price, stock and expected/result version in the existing DSH command journal within the same transaction. Replay and failed/stale/cross-store commands must not append or modify audit rows.
- AC-11: The audit record must bind Offer and Store through a composite foreign key; one result version per Offer. The audit remains immutable. No published/stock reservation write or additional permission is admitted.
## Stockout shortcut from the verified inventory summary

A Merchant can open all out-of-stock offers in the current Store by selecting an action on the verified summary. The action starts a fresh DSH catalog read with the existing stockout selector and clears the name query so the results reflect the same Store-wide scope as the summary. A zero count or unverified summary offers no shortcut.

## Direct inventory workspace
- AC-12: Web sidebar and native More expose a dedicated Inventory destination. Home Store shortcut opens the selected Store's inventory. All inventory counts, filters, pagination and eligible draft price/stock writes reuse the existing DSH owner contract and recovery form.
- AC-13: Inventory mode stays focused when choosing another authorized Store; hide product creation/import/export and identity editing there. Product management retains its existing mode and controls. Revoked Store and actor changes discard old rows, summary and actions; no fake counts, new grants, published edits or bulk writes.
