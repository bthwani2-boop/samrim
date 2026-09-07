# Central Catalog

ARTIFACT_CLASS: DURABLE_PRODUCT_CAPABILITY_GOVERNANCE
SEMANTIC_OWNER: governance/product/capabilities/partner/central-catalog.md
EXECUTION_AUTHORITY: NONE
CLOSURE_AUTHORITY: NONE
IMPLEMENTATION_STATE_AUTHORITY: NONE
PARENT_CAPABILITY_INDEX: governance/product/CAPABILITIES.md
CAPABILITY_ID: CENTRAL_CATALOG

## Scope

This file is the **sole editable durable semantic owner** of `CENTRAL_CATALOG`. Capability taxonomy/schema/admission law remains in `../../CAPABILITIES.md`; cross-capability journey semantics remain in `../../JOURNEYS.md`.

### CENTRAL_CATALOG — الكتالوج المركزي والاعتماد والنشر

**Problem.** Taxonomy, master-product identity, governed attributes, store assortment, proposals, digital-asset references and customer publication can diverge when partner, field, marketing, search or UI layers keep independent catalog meaning.
**Target state.** One DSH Central Catalog capability owns canonical catalog identity and lifecycle; approval/publication is a named workflow inside that owner, while search/discovery and object storage remain derived/technical consumers.
**Primary success measure.** percentage of catalog and assortment mutations that complete through one versioned owner lifecycle and produce consistent owner-side and customer-visible readback.
**Guardrail measures.** duplicate taxonomy/master-product identities; illegal lifecycle transitions; client-visible ineligible records; stale-version writes; parallel publication flags; search-index publication authority; orphaned business asset references.

**Required outcome.** Canonical category/taxonomy, master-product identity, governed attributes/relationships, store assortment/proposals and publication eligibility are versioned, auditable and owned by DSH Central Catalog, with customer visibility derived only after every applicable catalog/store/serviceability gate passes.

**Primary actors.** catalog operator, partner submitter/reviewer, field submitter, marketing reviewer, store operator, customer as read-only consumer.

**Canonical ownership.** DSH Central Catalog capability. Catalog approval/publication is a subcapability/workflow of Central Catalog; search/discovery is derived; binary object storage is a technical adapter.

**Boundary/non-overlap.** PARTNER_ONBOARDING_STORE_PUBLICATION owns Partner/Store onboarding, activation/readiness and store publication eligibility. CENTRAL_CATALOG owns taxonomy, master-product identity, governed attributes/relationships, assortment/proposals and catalog/product publication. Neither may mutate the other's lifecycle merely to force customer visibility.

**Material deployable surfaces.** app-partner, app-field where evidence/proposals are submitted, control-panel, app-client read-only discovery.

**Business invariants**
- Category/taxonomy and master-product identity have one canonical DSH owner.
- Governed attributes, option/rule relationships and master-product relationships are versioned and validated by the catalog owner.
- Store assortment and product proposals reference canonical catalog identity rather than forking product/category meaning.
- Approval/publication is part of the catalog lifecycle and cannot be bypassed by search, store-local flags, marketing presentation or client state.
- Digital-asset business references and canonical-image selection belong to the catalog/business owner; object storage owns bytes/transport only.
- Every material mutation is scoped, version-fenced, attributable and auditable.

**Durable lifecycle semantics.**
- taxonomy/node lifecycle may include active, merged and deprecated states when the governed object supports them;
- master-product review uses draft, pending_review, approved, rejected and archived;
- proposal/review flow may progress through catalog-draft, partner-proposed, partner-review, marketing-review, catalog-adopted, catalog-approved and client-visible, with needs-fix/rejected legal branches;
- store-assortment publication uses governed draft/submitted/approved/client_visible/rejected/hidden style states with pause/resume/retire only through legal owner transitions.

**Forbidden/negative invariants**
- no duplicate mutable category/master-product authority;
- no client-visible record before applicable approval/publication/serviceability gates;
- no illegal stage jump or stale-version mutation;
- no partner/field/marketing/search/UI layer independently publishes canonical catalog truth;
- no search/index result becomes eligibility or mutation authority;
- no object/bucket URL becomes business ownership truth;
- no deletion/merge loses required relationship, audit or active-assortment semantics.

**Failure/recovery.** invalid transition, stale version, duplicate identity, unresolved relationship, rejected/needs-fix proposal, invalid assortment state, asset-reference failure, derived-index lag or dependency outage; recovery rereads the canonical catalog owner, applies a legal versioned correction and rebuilds derived consumers.

**Acceptance expectations.** taxonomy/master products/attributes/relationships and assortment/proposal state have one owner; approval/publication readback is consistent across operator/partner/customer surfaces; append-only audit is retained; derived search can be rebuilt; customer visibility disappears when owner eligibility is revoked without editing the index as source truth.

**Actor responsibility envelope**
- `catalog operator` — governs taxonomy, master products, relationships, approval/publication and audit; forbidden: bypass version/review gates or make search/object storage authoritative.
- `partner submitter/reviewer` — proposes or reviews authorized store/catalog material within scope; forbidden: mutate global taxonomy/master identity without granted catalog authority or self-publish through local flags.
- `field submitter` — supplies assigned evidence/proposals; forbidden: approve its own evidence when separation is required.
- `marketing reviewer` — reviews presentation/publication stage where Product requires it; forbidden: create catalog identity or bypass catalog owner.
- `customer` — reads only customer-visible catalog/store material; forbidden: observe private review/evidence state.

**Surface semantics**
- `app-partner` — required where partner catalog/assortment proposals exist; states include loading, draft, submitted, needs_fix, approved, rejected, hidden, conflict, offline and error.
- `app-field` — required where field evidence/proposals are part of the governed workflow; states include assigned, draft, submitted, needs_fix, forbidden, offline and error.
- `control-panel` — required for authorized catalog/review/publication operations and audit.
- `app-client` — required read-only customer visibility derived from canonical eligibility.
- `backend` — required owner enforcement for identity, lifecycle, version, scope, audit and publication gates.
- `database` — required canonical persistence for versioned catalog identities/relationships/workflow/audit.
- technical presentation binding — implementation evidence only; maps canonical contracts/readback and owns no catalog truth.
