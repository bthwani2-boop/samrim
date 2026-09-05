# Catalog Marketplace Growth Capabilities

ARTIFACT_CLASS: DURABLE_PRODUCT_CAPABILITY_GOVERNANCE
SEMANTIC_OWNER: governance/product/capabilities/catalog-marketplace-growth.md
EXECUTION_AUTHORITY: NONE
CLOSURE_AUTHORITY: NONE
IMPLEMENTATION_STATE_AUTHORITY: NONE
PARENT_CAPABILITY_INDEX: governance/product/CAPABILITIES.md

## Scope

This owner defines only the durable capability semantics listed below. Capability taxonomy/schema/admission law remains in `../CAPABILITIES.md`; cross-capability journeys remain in `../JOURNEYS.md`.

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

### PROMOTIONS_COUPONS_FUNDING

**Problem.** Promotion/coupon eligibility and financial funding effects can diverge or double-apply across DSH, checkout and WLT.

**Required outcome.** DSH governs commercial coupon/promotion eligibility and lifecycle while WLT governs any authoritative financial reservation/posting/reversal.

**Primary actors.** authorized operator/marketing actor, customer, partner where a funded commercial program permits participation, WLT system.

**Canonical ownership.** DSH coupon/promotion terms and operational eligibility; WLT promotion funding reservation/ledger effects.

**Boundary/non-overlap.** MARKETING_CAMPAIGNS_LOYALTY owns campaign/audience/placement and non-financial loyalty/subscription/program eligibility. This capability owns coupon/promotion transactional eligibility and the correlated WLT funding lifecycle; WLT alone owns authoritative monetary posting.

**Material surfaces.** control-panel, app-client, app-partner where applicable, checkout/order readback.

**DSH commercial lifecycle.**
```text
draft → active | archived
active → paused | archived
paused → active | archived
```
Activation is governed and cannot be self-approved when maker/checker separation applies.

**WLT funding lifecycle.**
```text
reserved → committed | released
committed → reversed
```

**Forbidden/negative invariants.**
- no client-supplied authoritative discount/funding amount;
- no duplicate coupon application or funding reservation;
- no archived/expired/ineligible promotion applied;
- no same financial reservation committed/released/reversed inconsistently;
- no DSH commercial record becomes a second ledger;
- no unknown financial result is retried into duplicate money movement.

**Failure/recovery.** ineligible/expired, invalid status transition, funding unavailable, reservation conflict, released/reversed state, unknown provider/financial result; reconcile original financial identity before retry.

**Acceptance expectations.** accepted transaction snapshot is reproducible, funding source/amount is conserved, WLT postings are balanced/idempotent, refund/reversal uses the governed original funding lineage.

**Target state.** DSH commercial eligibility and WLT funding reservation/posting/reversal remain one correlated cross-owner flow with no duplicated discount or money effect.
**Primary success measure.** eligible promotion applications whose accepted transaction and WLT funding lineage reconcile exactly once.
**Guardrail measures.** duplicate application; stale/expired promotion accepted; double reservation/commit; client-authoritative discount; unreconciled funding reversal.
**Business invariants**
- DSH owns terms/eligibility/lifecycle and WLT owns monetary reservation/posting;
- accepted transaction preserves promotion version/funding lineage;
- each logical funding identity has one legal reservation→terminal path;
- refund/reversal references the original governed funding effect.
**Actor responsibility envelope**
- `marketing/operator` — governs terms/eligibility within permission; forbidden: post ledger truth or self-approve when separation applies.
- `customer` — supplies intent/code only; forbidden: supply authoritative amount/eligibility.
- `WLT system` — owns funding financial state and balanced effects.
**Surface semantics**
- `control-panel`, `app-client`, and conditional `app-partner` — canonical eligibility/readback only.
- `backend` and `database` — required DSH lifecycle plus correlated WLT boundary.
- technical presentation binding — implementation evidence only.

### RATINGS_REVIEWS_TRUST

**Problem.** Ratings must be tied to proven eligible interactions and cannot be fabricated, duplicated or used as authorization truth.

**Required outcome.** Eligible customer/partner actors submit one governed rating per eligible source/target relationship, with edit-window, moderation, dispute and aggregate readback.

**Primary actors.** customer, partner, rated captain/field provider as response/dispute participant where permitted, authorized moderator/operator.

**Canonical ownership.** DSH ratings/reviews trust capability; discovery/analytics consume derived summaries only.

**Material surfaces.** app-client, app-partner, control-panel moderation; derived provider/store discovery/analytics.

**Durable semantics.**
- client rating requires an eligible delivered order and attributed target;
- partner→field rating requires eligible partner/field attribution;
- canonical rating status is active unless retired through a governed path;
- moderation status is one of `pending | approved | rejected | disputed`;
- edits are bounded by the governed edit window and idempotency identity.

**Forbidden/negative invariants.**
- no rating for an ineligible/uncompleted source;
- no cross-actor/source spoofing;
- no duplicate logical rating through retry;
- no aggregate score edited as source truth;
- no rating score grants permission/assignment eligibility by itself.

**Failure/recovery.** not eligible, source/target not found, invalid score/data, edit window passed, idempotency conflict, moderation dispute; canonical reread resolves retry state.

**Acceptance expectations.** moderation/fraud/dispute metadata is attributable; aggregates derive only from canonical active records; customer/partner/operator readbacks agree.

**Target state.** One DSH trust capability owns eligible rating/review records, edit/moderation/dispute lifecycle and rebuildable aggregates.
**Primary success measure.** eligible interactions producing one canonical rating/review with attributable moderation and consistent derived aggregate readback.
**Guardrail measures.** ineligible rating; duplicate logical rating; cross-actor spoofing; aggregate direct edit; moderation without audit.
**Business invariants**
- rating requires a canonical eligible source interaction/target;
- logical duplicate retry is idempotent;
- moderation and edit-window rules are server-owned;
- aggregates/search projections are rebuildable derivatives.
**Actor responsibility envelope**
- `customer/partner author` — submits only eligible attributed feedback; forbidden: spoof source/target or edit aggregate truth.
- `moderator/operator` — applies authorized moderation/dispute action with audit.
- `rated actor` — receives only permitted response/dispute/readback rights.
**Surface semantics**
- `app-client`, `app-partner`, `control-panel` — required where submission/moderation/readback applies.
- `backend` and `database` — required canonical eligibility, record, moderation and audit.
- technical presentation binding — implementation evidence only.

### MARKETING_CAMPAIGNS_LOYALTY

**Problem.** Campaign targeting, placements, loyalty/subscription programs and commercial entitlements can drift into UI flags, coupon logic or financial truth when their lifecycle and owner are not explicit.
**Target state.** One DSH marketing/commercial-program capability owns campaign/audience/placement and non-financial loyalty/subscription eligibility semantics; coupon funding remains with PROMOTIONS_COUPONS_FUNDING and monetary billing/posting remains WLT-owned.
**Primary success measure.** governed campaign/program decisions producing consistent eligible presentation/entitlement readback across required surfaces.
**Guardrail measures.** self-approved policy activation; two active exclusive earning policies; client-visible ineligible campaign; financial amount authored by marketing; archived/paused program granting new entitlement; audience/scope leakage.

**Required outcome.** Authorized operators can govern campaigns, audiences, placements, loyalty earning policy, subscription/commercial-program eligibility and entitlement presentation without creating parallel catalog, coupon-funding, wallet or ledger truth.

**Primary actors.** marketing operator/maker, independent approver where required, customer, partner, DSH system, WLT system for monetary consequences.

**Canonical ownership.** DSH marketing/commercial-program capability owns campaign/audience/placement and non-financial program eligibility/entitlement semantics; WLT owns authoritative monetary charging/funding/posting; Central Catalog owns catalog identity/publication; notification adapters only deliver selected communications.

**Boundary/non-overlap.** PROMOTIONS_COUPONS_FUNDING owns coupon/promotion transactional eligibility and funding correlation; CENTRAL_CATALOG owns catalog/product publication; DSH Notifications owns inbox/preferences/topic/delivery-attempt state; WLT owns money. Marketing owns campaign/audience/placement and non-financial loyalty/subscription/program eligibility only.

**Material deployable surfaces.** control-panel, app-client, app-partner where a program is offered, and checkout/readback when eligibility changes commerce.

**Business invariants**
- campaign lifecycle is versioned and scoped to a governed audience/placement;
- campaign activation validates the target is otherwise eligible for client visibility;
- active commercial/loyalty policy terms are immutable; changes use a new version;
- maker/checker separation applies where required, including no self-approval of governed policy activation;
- exclusive active policy classes allow at most one active governing policy when Product defines exclusivity;
- loyalty points/entitlement bounds are server-owned and cannot be supplied authoritatively by clients;
- subscription/commercial entitlement does not create a new tenant/platform instance.

**Durable lifecycle semantics.**
- campaign: draft → active → paused/completed/cancelled as legal, with cancelled/completed terminal;
- commercial program/loyalty policy: draft → active → paused → archived according to governed transitions;
- entitlement/subscription state is versioned and references its source program/policy and WLT financial reference when money is involved.

**Forbidden/negative invariants**
- no campaign/marketing flag publishes an ineligible catalog/store object;
- no client or UI owns audience eligibility or points/benefit arithmetic;
- no marketing capability posts wallet/ledger truth;
- no promotion/coupon funding lifecycle is duplicated here;
- no archived/paused program grants new entitlement contrary to policy;
- no self-approval where independent approval is required.

**Failure/recovery.** invalid audience/target, stale version, approval conflict, paused/archived policy, entitlement mismatch, WLT billing/funding unavailable or derived delivery/index lag; reread canonical program and financial owners and resume only through legal transitions.

**Acceptance expectations.** campaign/program versions and approval lineage are auditable; eligible surfaces converge on owner readback; financial consequences reconcile to WLT; catalog visibility still depends on Central Catalog/serviceability; communication delivery failure does not rewrite program truth.

**Actor responsibility envelope**
- `marketing operator/maker` — drafts campaigns/program policies and governed targeting; forbidden: self-approve when separation applies, publish ineligible catalog or author financial ledger truth.
- `approver` — independently approves/rejects governed program/policy changes within exact scope.
- `customer` — consumes eligible campaign/loyalty/subscription benefits and readback; forbidden: author eligibility/points/price.
- `partner` — consumes/participates only when the program scope permits; forbidden: override audience/funding rules.
- `WLT system` — owns monetary charge/funding/posting consequences only.

**Surface semantics**
- `control-panel` — required for campaign/program lifecycle, targeting, approval and audit.
- `app-client` — required where customer campaigns/loyalty/subscriptions are offered; shows canonical eligibility and degraded/no-data states.
- `app-partner` — conditional where partner programs/offers require participation or readback.
- `backend` — required canonical marketing/program eligibility and lifecycle enforcement.
- `database` — required versioned campaign/program/entitlement state and audit.
- technical presentation binding — implementation evidence only; maps canonical program state without local eligibility truth.

These capabilities and read models must map to journeys and exact current implementation only through evidence. Generic media/object-storage and search/index mechanisms remain explicitly non-sovereign unless a future Product/System decision proves an independent lifecycle/owner.
