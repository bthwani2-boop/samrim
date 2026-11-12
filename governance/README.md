# BThwani — Governance Cutover Registry

ARTIFACT_CLASS: FOUNDATION_CUTOVER_INDEX
SEMANTIC_OWNER: governance/README.md
GOVERNANCE_CUTOVER: NOT_READY
BUSINESS_DECISION_AUTHORITY: NONE_WHILE_NOT_READY
IMPLEMENTATION_STATE_AUTHORITY: NONE

## Intent and authority boundary
This is the sole **target** root for future durable BThwani governance. It does not yet declare a complete Product policy; in particular, the 26 admitted capabilities and all domain decisions have **not** been independently reconciled or rewritten here.

The former `docs/governance/` directory was removed from this candidate at the user's request. Its content remains available for selective inspection in source branch `41` and archived evidence. Never restore or copy its tree into the new candidate. Its contents, the dated plans, the November 11 command, and ZIP packages must be semantically compared to approved decisions and verified implementation before cutover. The user owns approvals; current source/runtime proves implementations, not product approvals.

## Required final owners (planned; not yet admitted)
- `product.md`: admitted scope and CAPABILITY_ID census
- `platform.md`: canonical Customer/Merchant/Captain/Operator vocabulary and human actor/surface distinctions
- `architecture.md`: Identity/DSH/WLT/HR boundaries; single writer, single engine
- `identity.md`: actor/session/authz, recovery, delegated roles
- `stores.md`: one Store entity, Marketplace/Direct relation, publication, owners and permissions
- `catalog.md`: one DSH registry, shared suggestions and Store-owned products, one StoreOffer writer
- `commerce.md`: cart, checkout, orders, adjustments, promotions, communications
- `fulfillment.md`: dispatch, Store Captain, pickup, handoff, delivery
- `finance.md`: **draft created**, pending full semantic cutover and independent review; WLT commission/subscription, collection, wallet, ledger and settlements
- `hr.md`: internal personnel relationships
- `experience.md`: design, accessibility, RTL, Design System and multi-platform behavior
- `safety.md`: security, data, concurrency, migrations, recovery
- `engineering.md`: refoundation and proof acceptance, quality and technical practices
- `journeys.md`: required cross-owner end-to-end semantics

## Non-negotiable reconciliation
- **Merchant versus Store:** a Merchant is a human actor with potentially multiple Store relationships; a Store is a DSH resource. Do not merge them into one identity or create two Store engines.
- **Store relations:** Marketplace and Direct select channel rules, never a second catalog, Order, Product or wallet engine; old enum values are migration evidence, not additional accepted models.
- **Commercial model:** either relation can be COMMISSION or SUBSCRIPTION via one versioned WLT agreement. Order collection responsibility is an independent authorized dimension; a policy toggle cannot activate missing finance/checkout.
- **Retired enrollment workflow:** no new operational entrypoint, permission, screen, accrual or role; protect only any binding historical liabilities and audit records.
- **SQL:** rebuild new baselines per owner rather than copy-pasting old migrations, but preserve applicable protected history and test fresh/upgrade/restore before deletion.
- **Links and benchmarks:** preserve original OSS and competitor citations and historical provenance outside binding governance, never adopt an old screenshot or archived ZIP as product truth.

## Adoption gate
Until every owner has a semantic rewrite, a single Product admission set with exactly one domain-owner section per capability, resolved references, reviewed conflict disposition and tested CI guards, `GOVERNANCE_CUTOVER` must stay NOT_READY. Draft files (including `finance.md`) are review candidates and cannot activate business features by themselves. **Do not treat this index or a Foundation Guard PASS as completed BThwani governance.**
