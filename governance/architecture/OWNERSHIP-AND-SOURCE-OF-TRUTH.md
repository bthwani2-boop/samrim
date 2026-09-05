# Ownership and Source-of-Truth Map

ARTIFACT_CLASS: DURABLE_ARCHITECTURE_GOVERNANCE
SEMANTIC_OWNER: governance/architecture/OWNERSHIP-AND-SOURCE-OF-TRUTH.md
EXECUTION_AUTHORITY: NONE
IMPLEMENTATION_INVENTORY_AUTHORITY: NONE

## Purpose

This is a semantic ownership map, not a route/table/file registry.

For every material fact, implementation identifies:

```text
MEANING
→ CANONICAL OWNER
→ CANONICAL WRITER
→ DURABLE STORAGE CLASS WHEN APPLICABLE
→ CONTRACT/EVENT OWNER
→ DERIVED PROJECTIONS
→ REQUIRED CONSUMERS
→ MUTATION AUTHORITY
→ CANONICAL READBACK
```

## Core map

| Meaning | Owner / writer | Allowed derived consumers |
|---|---|---|
| actor identity/credential/authentication/activation/session | Identity | apps/services through Identity contracts |
| high-level actor-role admission and role-scoped session state | Identity | authorized apps/services through Identity contracts |
| business authorization scope/operational permission/context | capability/domain that owns the protected business truth; currently DSH for DSH partner/store/team/assignment scope | authorized consumers through owner contracts |
| client/partner/captain/field operational participant profile/status/eligibility | DSH | authorized DSH surfaces and dependent services through DSH contracts |
| partner/store operational truth | DSH | partner/operator hosts and dependent services through contracts |
| address/serviceability/order/dispatch/delivery/support | DSH | apps and WLT where trusted operational evidence is required |
| wallet/ledger/payment/refund | WLT | DSH/app bounded projections/readback |
| commission/settlement/payout/reconciliation/COD exposure | WLT | authorized stakeholder/operator reads |
| cross-platform governed variables/change/rollout state | Platform Control semantic control-plane responsibility when explicitly assigned; independent service deployment remains conditional on executable admission proof | services/apps through validated configuration contracts |
| deployable route/navigation/shell composition | each app host | local presentation only |
| design tokens/primitives | Design System technical owner | deployable app hosts and explicitly admitted host-neutral reusable presentation abstractions; never an app-shaped service feature UI tree |
| external provider secret value | approved secret store/runtime binding | adapter only; never client/general DB truth |
| provider operation outcome | operation-owning domain | projections only after owner normalization/reconciliation |

## Projection law

```text
DERIVED != AUTHORITATIVE
CACHED != CANONICAL
MATERIALIZED != SECOND_WRITER
SEARCH_INDEX != SOURCE_DOMAIN
ANALYTICS != TRANSACTIONAL_TRUTH
```

A projection used for an authoritative mutation decision must be proven sufficiently fresh/owned by contract or the owner must be queried.

## Ownership conflict law

```text
TWO_MUTABLE_WRITERS_FOR_ONE_MEANING = DEFECT
BOTH_SYSTEMS_KEEP_IT_IN_SYNC = NOT_OWNERSHIP
```

When two systems appear to own the same fact, resolve the semantic owner first, then redesign writer/readback/projection flow.

## Additional durable meaning classes

The following classes must preserve single-owner semantics when present:

| Meaning | Canonical owner / writer | Derived or delivery role |
|---|---|---|
| cart/checkout operational truth | DSH CART_CHECKOUT; WLT owns financial quote/payment-session facts | ORDER_CREATION consumes only eligible checkout evidence; apps consume canonical readback |
| field participant eligibility/assignment/visit/readiness/escalation | DSH FIELD_OPERATIONS_ASSIGNMENT_READINESS | Partner/Store and operator surfaces consume verified evidence |
| campaigns/audiences/placements/loyalty/non-financial program eligibility | DSH MARKETING_CAMPAIGNS_LOYALTY; WLT owns monetary charging/posting; promotion funding stays in its governed cross-owner capability | apps/checkout/notifications consume bounded eligibility/readback |
| customer profile/preferences excluding authentication | DSH customer/profile capability unless a future explicit owner supersedes it | apps consume bounded readback |
| partner-team membership and store-scoped operational access facts | DSH partner/team capability; Identity owns only high-level role admission/session authentication | partner/control surfaces consume scoped owner readback |
| catalog taxonomy/master-product/attribute/relationship/assortment identity and approval/publication eligibility | DSH CENTRAL_CATALOG; approval/publication is a named subcapability | stores/apps consume governed readback; discovery/search are derived consumers |
| promotion/coupon operational eligibility | DSH for commerce eligibility; WLT owns resulting authoritative monetary postings/effects | clients/operators consume bounded readback |
| notification source event/business meaning | originating domain | DSH Notifications owns inbox/preferences/topic/delivery records; channel adapters execute transport; app host owns native route translation |
| media asset business association/authorization | owning business domain | object-storage adapter owns transport/storage mechanics only |
| rating/review business record and moderation policy | DSH trust/commerce capability unless explicitly rehomed | search/analytics may project it |
| analytics/operational dashboards | DSH operational-analytics derived projection owner; underlying facts remain at source domains | never transactional writer or authorization source; rebuild from canonical sources |
| search/discovery index/result | derived query capability | source domains remain eligibility/mutation authority |
| pricing/penalty/collateral financial truth | WLT when value/financial exposure is authoritative; DSH may own non-financial operational inputs | projections only outside owner |

A row establishes ownership class, not a promise that a particular implementation already exists. Current implementation must still be proven from executable evidence.
