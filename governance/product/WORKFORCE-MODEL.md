# Workforce Model

ARTIFACT_CLASS: DURABLE_PRODUCT_GOVERNANCE
SEMANTIC_OWNER: governance/product/WORKFORCE-MODEL.md
EXECUTION_AUTHORITY: NONE

## Core model

Workforce owns workforce-specific truth about a person participating through one or more governed engagements.

```text
PERSON
→ ENGAGEMENT
→ WORKFORCE STATUS / ELIGIBILITY
→ OPERATIONAL ROLE ASSIGNMENTS CONSUMED BY DSH
```

Identity owns authentication/session/activation; Workforce owns workforce profile/engagement; DSH owns operational assignments; WLT owns financial truth.

## Orthogonal axes

Do not encode mutually exclusive class inheritance such as `employee OR captain OR field` when the real model is orthogonal:

- person identity;
- engagement type/status;
- organizational affiliation;
- operational role(s);
- supervisor/shift/city/readiness where required;
- capability-specific evidence/document status.

## Activation relationship

Activation establishes authorized access through Identity. Workforce eligibility/readiness is a separate gate. An authenticated actor may still be incomplete, suspended or ineligible for operational work.

## Captain and field

Captain/field are operational roles/responsibilities, not alternate identity systems.

- Workforce: eligibility, engagement/profile, required workforce evidence.
- DSH: fleet/assignment/task operational state.
- WLT: earnings/COD/wallet/payout truth.

## Self-completion

When Product permits limited self-completion, the actor may provide only fields explicitly delegated to self-service. Server-owned status, approval, scope and privileged evidence decisions remain owner-controlled.

## Lifecycle

Suspension, termination and reassignment have explicit owner semantics and downstream operational effects. Deleting or disabling a surface account cannot stand in for canonical workforce lifecycle.
