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
