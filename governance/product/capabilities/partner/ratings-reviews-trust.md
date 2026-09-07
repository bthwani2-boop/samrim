# Ratings Reviews Trust

ARTIFACT_CLASS: DURABLE_PRODUCT_CAPABILITY_GOVERNANCE
SEMANTIC_OWNER: governance/product/capabilities/partner/ratings-reviews-trust.md
EXECUTION_AUTHORITY: NONE
CLOSURE_AUTHORITY: NONE
IMPLEMENTATION_STATE_AUTHORITY: NONE
PARENT_CAPABILITY_INDEX: governance/product/CAPABILITIES.md
CAPABILITY_ID: RATINGS_REVIEWS_TRUST

## Scope

This file is the **sole editable durable semantic owner** of `RATINGS_REVIEWS_TRUST`. Capability taxonomy/schema/admission law remains in `../../CAPABILITIES.md`; cross-capability journey semantics remain in `../../JOURNEYS.md`.

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
