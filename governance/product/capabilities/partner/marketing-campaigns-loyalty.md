# Marketing Campaigns Loyalty

ARTIFACT_CLASS: DURABLE_PRODUCT_CAPABILITY_GOVERNANCE
SEMANTIC_OWNER: governance/product/capabilities/partner/marketing-campaigns-loyalty.md
EXECUTION_AUTHORITY: NONE
CLOSURE_AUTHORITY: NONE
IMPLEMENTATION_STATE_AUTHORITY: NONE
PARENT_CAPABILITY_INDEX: governance/product/CAPABILITIES.md
CAPABILITY_ID: MARKETING_CAMPAIGNS_LOYALTY

## Scope

This file is the **sole editable durable semantic owner** of `MARKETING_CAMPAIGNS_LOYALTY`. Capability taxonomy/schema/admission law remains in `../../CAPABILITIES.md`; cross-capability journey semantics remain in `../../JOURNEYS.md`.

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
