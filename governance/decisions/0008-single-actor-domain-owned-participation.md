# ADR 0008 — Single actor identity and domain-owned participation

ARTIFACT_CLASS: DURABLE_DECISION_RATIONALE
STATUS: ACTIVE
EXECUTION_AUTHORITY: NONE

## Context

The platform needs one stable human identity across surfaces without creating a generic people/workforce service or encoding roles, business scopes, organizations, stores, operational assignments, or speculative tenancy into the human identity row.

Client, partner, captain, field and operator are roles/participations of a human actor. The same human may hold more than one role. A role is not a new person.

## Decision

- `actor_id` is the single cross-boundary human identifier and is created only by Identity.
- One normalized canonical phone resolves to one Identity actor.
- Actor identity and actor-role admission are separate durable facts.
- Current Identity role admission is represented directly as an actor↔role binding; no generic grant/entitlement/tenant/context engine is admitted without a proven requirement.
- Identity owns actor identity, credentials, authentication/verification, high-level actor-role admission, activation proof, and role-scoped sessions.
- A session carries one role only. Surface is derived from the canonical role→surface mapping rather than persisted as parallel truth.
- Client may establish its own `client` role through the public OTP flow. Partner/captain/field roles must be provisioned first by DSH. Operator role is provisioned by Platform Control and authenticates with password, not OTP.
- The authenticated internal-service credential determines the service principal server-side; a caller-name header does not grant service identity.
- DSH owns current client/partner/captain/field operational participant state, affiliation, eligibility, assignment, partner/store membership and business authorization scopes.
- WLT owns financial truth.
- Operator Context remains a distinct project concept when a capability proves it, but Identity does not persist or invent a generic `operator_context_id` merely to simulate tenancy/isolation.
- No `People`, `Staff`, `Actors`, `Workforce`, generic `AccessGrant`, or tenant module/service is admitted merely to group human participants.
- A future enterprise HR or contextual authorization boundary may be extracted only after concrete lifecycle/data/rule/isolation requirements prove it.

## Consequences

Role disablement revokes only sessions and pending activation proofs for that actor-role. It must not revoke unrelated roles of the same actor.

An OTP proves control of the configured communication channel; it never grants a governed partner/captain/field role. Business eligibility remains at DSH.

Domain participant records reference `actor_id` directly. Service-local technical keys may exist, but no second cross-boundary human identifier is admitted.

## Guardrail

```text
ONE_CROSS_BOUNDARY_HUMAN_IDENTIFIER=actor_id
ONE_NORMALIZED_PHONE_ONE_ACTOR=REQUIRED
ACTOR_NE_ROLE=REQUIRED
ACTOR_NE_OPERATOR_CONTEXT=REQUIRED
SESSION_SINGLE_ROLE=REQUIRED
ROLE_DISABLE_REVOKES_ONLY_ROLE=REQUIRED
GOVERNED_ROLE_OTP_SELF_GRANT=FORBIDDEN
CALLER_HEADER_AS_SERVICE_IDENTITY=FORBIDDEN
IDENTITY_GENERIC_CONTEXT_OR_TENANT=ABSENT_UNTIL_PROVEN
CURRENT_GENERIC_PEOPLE_WORKFORCE_SERVICE_OR_MODULE=ABSENT
DOMAIN_PARTICIPATION_TRUTH=OWNED_BY_THE_DOMAIN_THAT_USES_IT
```
