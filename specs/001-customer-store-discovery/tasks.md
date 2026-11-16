# Tasks: Customer Store and Catalog Discovery

**Input**: spec.md and plan.md in this directory.
**Status**: IN_PROGRESS — real isolated DSH/PostgreSQL read, Web and Android discovery smoke implemented and tested; mandatory security, Identity, orderability, cross-context race/checkout and current Lenovo mirror acceptance not complete.
**Branch**: refoundation/clean-house-20261112 (reuse, never create feature branch).
**Ownership**: DSH for Store/catalog/read contract; Identity for actor; Customer Expo for presentation; WLT untouched.
**Execution rule**: A checkbox becomes complete only with actual tested evidence and matching SHA. T001 scopes and reconciles this journey; it does not require 100% global governance cutover.

## Phase 1 — Governance and owner readiness

- [ ] **T001** Reconcile the material source obligations and owner policies affecting Customer Store discovery, its cross-surface prerequisites and its negative cases. The existing 26 Product capabilities are already approved for development; global 14-owner reconciliation remains a separate end-program task. Owner: affected domain owners.
- [ ] **T002** Establish public Store/listing permission and visibility matrix from governance/stores.md and catalog.md (MARKETPLACE versus DIRECT link-only; publish/revoke; service city/vertical); settle disputed terms with human policy owner before mutating contract.
- [ ] **T003** Confirm original donor-41 Store/Offer read semantics from pinned source blobs (read-only), consumer contracts, external Store link identities, applicable historical migrations and protected records; do not cherry-pick or copy donor runtime blindly.

## Phase 2 — One DSH owner contract and storage

- [ ] **T004** [US1] Design DSH owner-backed read operations in services/dsh/contracts/openapi/dsh.openapi.yaml and reserved customer-discovery/stores/catalog/offers groups after journey-scoped T001–T003 and a passing stage-aware contract guard. Explicitly model public field allowlist, supported city, publication, relation, bounded pagination, statuses and errors; no duplicate writer.
- [ ] **T005** [US1] Write failing contract/ACL tests for DIRECT excluded from marketplace, unpublished Store, inaccessible city/vertical, forbidden private fields and response shape; separately prove a paused/closed published Store can remain visible but marked not orderable as DSH policy permits. Verify RED against missing implementation before writing Go code.
- [ ] **T006** [US1] Select reviewed DSH schema/read model and applied migration safety path; prove isolated fresh/upgrade/backup-restore when database work is admitted, with no real funds or customers.
- [ ] **T007** [US1] Implement DSH public Store query with canonical eligibility and attributable readback; make tests GREEN. Do not assume HTTP 200 proves published data.
- [ ] **T008** [US2] Write failing Offer tests for positive exact YER price, sellable Variant, Store publication, required attributes, stock visibility, modifier/quantity eligibility and unreadable draft Offers; then implement DSH public Offer query to pass.
- [ ] **T009** [US2] Add owner-side deterministic cursor, filter and stale-pagination tests and bounded implementation; ensure no client joins across Offer/Store internals.

## Phase 3 — Genuine Customer experience

- [ ] **T010** [US1] Consume the approved owner-generated TypeScript read client in apps/customer/app/ only after T004–T007; render published eligible Store cards, a valid full Store link, empty and unavailable states; no hardcoded fake Store data.
- [ ] **T011** [US2] Add eligible Offer view/filter/pagination and exact current YER price from DSH; show stale/retry error rather than invented checkout eligibility.
- [ ] **T012** [US3] Write failing stale-promise/Store/city/account context-switch tests and then implement cancellation/revision handling that ignores prior-context responses.
- [ ] **T013** [US1–US3] Verify Arabic RTL, WCAG 2.2 AA applicable keyboard/focus/labels, light/dark, error/empty/retry, pagination/deep-link and native Android back behavior on genuine web/Android.

## Phase 4 — Independent acceptance and delivery

- [ ] **T014** Exercise two Store owners/two cities, published and unpublished/direct-only Store, changed Offer price/availability, invalid cursor, offline/error and IDOR; read canonical DSH state for all positive/negative cases and record the resulting evidence.
- [ ] **T015** Run affected check/test commands, full diff/UTF-8/source compatibility review, independent critical-risk review when required; record explicit iOS NOT_RUN if untested.
- [ ] **T016** After EACH tested coherent tranche: acquire existing exclusive GIT-TURN, verify branch/index/foreign work, stage own files only and make a local Commit. Only an independently authorized Push may update origin; verify its SHA and applicable CI. Never open PR, merge, deploy or force push from this checklist.

## Stop conditions

Continue analysis and isolated development while reporting unmet evidence accurately; never invent Product approval, mock owner-backed readback, signed consent, real-money tests or an unlocked Git turn. GOVERNANCE_CUTOVER: NOT_READY does not bar this existing-capability development; an unreviewed material security, financial or data risk still blocks the affected activation and prevents false closure. This checklist does not attest that any commercial service or screen currently exists.
