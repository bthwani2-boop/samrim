# Promotions Coupons Funding

ARTIFACT_CLASS: DURABLE_PRODUCT_CAPABILITY_GOVERNANCE
SEMANTIC_OWNER: governance/product/capabilities/partner/promotions-coupons-funding.md
EXECUTION_AUTHORITY: NONE
CLOSURE_AUTHORITY: NONE
IMPLEMENTATION_STATE_AUTHORITY: NONE
PARENT_CAPABILITY_INDEX: governance/product/CAPABILITIES.md
CAPABILITY_ID: PROMOTIONS_COUPONS_FUNDING

## Scope

This file is the **sole editable durable semantic owner** of `PROMOTIONS_COUPONS_FUNDING`. Capability taxonomy/schema/admission law remains in `../../CAPABILITIES.md`; cross-capability journey semantics remain in `../../JOURNEYS.md`.

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
