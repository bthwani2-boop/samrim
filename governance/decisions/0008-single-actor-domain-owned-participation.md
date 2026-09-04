# ADR 0008 — Single actor identity and domain-owned participation

ARTIFACT_CLASS: DURABLE_DECISION_RATIONALE
STATUS: ACTIVE
EXECUTION_AUTHORITY: NONE
SUPERSEDES: governance/decisions/0004-identity-workforce-separation.md

## Context

The platform needs one stable human identity across surfaces without creating a generic people/workforce service before an independently justified HR capability exists. Client, partner, captain, field and operator are actor/domain participation roles, not reasons to create separate identity systems.

## Decision

- `actor_id` is the single cross-boundary human identifier.
- Identity owns actor identity, credentials, authentication, activation, sessions, roles/permissions vocabulary and trusted identity context.
- DSH owns current client/partner/captain/field operational participant state, affiliation, eligibility, assignments and other DSH-specific operational facts.
- WLT owns financial truth.
- No `Workforce`, `People`, `Staff` or `Actors` peer service/module is admitted merely to group human participants.
- Control Panel sections such as HR are composition/navigation and do not imply a backend bounded context.
- A future enterprise HR/workforce bounded context may be extracted only when concrete cross-domain lifecycle/data/rule independence proves the need.

## Consequences

Identity does not become an HR database. DSH does not own authentication or financial truth. Domain participant records reference `actor_id` directly; service-local primary keys may exist as implementation details but must not become a second cross-boundary human identifier.

## Guardrail

```text
ONE_CROSS_BOUNDARY_HUMAN_IDENTIFIER=actor_id
CURRENT_WORKFORCE_SERVICE_OR_MODULE=ABSENT
PREMATURE_GENERIC_PEOPLE_DOMAIN=FORBIDDEN
DOMAIN_PARTICIPATION_TRUTH=OWNED_BY_THE_DOMAIN_THAT_USES_IT
```
