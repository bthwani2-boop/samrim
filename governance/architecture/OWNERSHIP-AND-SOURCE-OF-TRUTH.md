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
| actor authentication/session/activation | Identity | apps/services through Identity contracts |
| roles/permissions/trusted identity context | Identity | authorized services/hosts |
| workforce person/engagement/status/eligibility | Workforce | DSH/operator/app bounded reads |
| partner/store operational truth | DSH | partner/operator hosts and dependent services through contracts |
| address/serviceability/order/dispatch/delivery/support | DSH | apps and WLT where trusted operational evidence is required |
| wallet/ledger/payment/refund | WLT | DSH/app bounded projections/readback |
| commission/settlement/payout/reconciliation/COD exposure | WLT | authorized stakeholder/operator reads |
| cross-platform governed variables/change/rollout state | Platform Control when explicitly assigned | services/apps through validated configuration contracts |
| deployable route/navigation/shell composition | each app host | local presentation only |
| design tokens/primitives | Design System technical owner | deployable/service presentation layers |
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
| customer profile/preferences excluding authentication | DSH customer/profile capability unless a future explicit owner supersedes it | apps consume bounded readback |
| partner-team membership and store-scoped operational access facts | DSH partner/team capability; Identity remains permission/session authority | partner/control surfaces consume scoped projections |
| catalog identity/approval/publication eligibility | DSH catalog/store capabilities according to the governed split | discovery/search are derived consumers |
| promotion/coupon operational eligibility | DSH for commerce eligibility; WLT owns resulting authoritative monetary postings/effects | clients/operators consume bounded readback |
| notification intent/source event | originating domain | notification delivery mechanics route email/SMS/push/inbox; app host owns native route |
| media asset business association/authorization | owning business domain | object-storage adapter owns transport/storage mechanics only |
| rating/review business record and moderation policy | DSH trust/commerce capability unless explicitly rehomed | search/analytics may project it |
| analytics/operational dashboards | derived read-model owner only | never transactional writer or authorization source |
| search/discovery index/result | derived query capability | source domains remain eligibility/mutation authority |
| pricing/penalty/collateral financial truth | WLT when value/financial exposure is authoritative; DSH may own non-financial operational inputs | projections only outside owner |

A row establishes ownership class, not a promise that a particular implementation already exists. Current implementation must still be proven from executable evidence.
