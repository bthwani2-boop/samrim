# Target — Identity

TEMPORARY_TARGET_SPECIALIZATION: YES
GENERAL_EXECUTION_AUTHORITY: NONE
DURABLE_AUTHORITY: NONE

## 1. Service placement

Refound donor Identity truth directly into `services/identity`. A path move alone is not closure: establish the canonical actor/auth/session model, migrate/cut over all required contracts/clients/consumers, then delete losing authorities.

A legacy generic human-participant source is not mapped to a replacement service/module. Required facts go to the proven owner: DSH for current client/partner/captain/field operational truth, Identity for actor/authentication/high-level role admission, and WLT for financial truth.

## 2. Identity authority

Identity owns only:

```text
one actor_id per human identity
canonical phone/credential identity required for authentication
minimal Identity-wide security eligibility
explicit high-level actor↔role admission
OTP/password authentication proof
role-scoped session create/refresh/revoke
security audit and abuse-control evidence required by those operations
```

Current canonical high-level roles:

```text
client   → app-client
partner  → app-partner
captain  → app-captain
field    → app-field
operator → control-panel
```

`actor_id` is the single cross-boundary human identifier and is created only by Identity. Do not introduce competing cross-service human identifiers.

```text
ACTOR != ROLE
ACTOR != OPERATOR_CONTEXT
ROLE != DSH_OPERATIONAL_ELIGIBILITY
```

Do not encode role in actor ID. Do not store all roles as an array on the actor. Current role admission uses the smallest direct actor↔role binding; a generic access-grant/entitlement/tenant/context abstraction requires fresh admission proof.

## 3. Domain participation and authorization scope

```text
client/customer operational profile/preferences → DSH
partner/store membership and operations          → DSH
captain affiliation/eligibility/fleet/dispatch  → DSH
field participant/assignment/readiness          → DSH
DSH business permissions/scopes                 → DSH/capability owner
financial truth                                 → WLT
actor/high-level role/authentication/session    → Identity
```

Identity does not invent a generic `operator_context_id` merely to isolate calls. Operator Context remains an independent project concept only when a concrete capability proves owner/lifecycle/isolation semantics.

Do not create `generic human-participant`, `AccessGrant` or Tenant modules/services merely to group participants or prepare for hypothetical requirements.

## 4. Authentication and role laws

- Client public OTP may create only the client role.
- Partner/captain/field OTP may authenticate only an already-provisioned enabled role.
- OTP never grants a governed DSH role.
- Operator is password-only in the current model.
- DSH credential may manage only partner/captain/field role admission.
- Platform Control credential may manage only operator role admission/credential reset.
- Internal service principal is derived from the service credential itself; caller-name headers do not grant identity.
- Every session is bound to exactly one role. Surface is derived from role.
- Disabling a role revokes only that actor-role's sessions/challenges.
- Identity-wide security disable is separate from role/domain lifecycle, is Platform-Control-only, revokes all actor sessions/pending challenges, preserves role bindings, and requires fresh authentication after re-enable.
- Refresh is device-fingerprint checked and rotated; access remains a short-lived bearer token.
- Password storage uses the current approved memory-hard hash; no periodic password change is invented without policy need.

## 5. Contracts and generated clients

Identity has one canonical contract:
`services/identity/contracts/identity.openapi.yaml` → deterministic generated DTOs → canonical TS/Go clients → consumers.

No consumer-local auth DTO, role registry, session interpretation, direct internal route, service-caller header or context header may become parallel authority.

## 6. Database and migration

Current canonical persisted shapes are:

```text
identity_actors
identity_actor_roles
identity_activation_challenges
identity_sessions
identity_refresh_token_history
identity_login_attempts
identity_security_audit
identity_schema_migrations
```

The actor row must not contain role arrays, generic permissions, operator context, provisioning fingerprint, creator-service provenance or domain-operational lifecycle status. A single `security_enabled` boolean is allowed only for Identity-wide authentication eligibility.

Before integration there is no production data obligation for the discarded Stage-B candidate schema. A stale local/non-production database containing that losing schema must fail migration explicitly and be reset; do not add compatibility columns or dual-read/write logic merely to preserve an unmerged candidate.

## 7. Security closure

Prove one normalized phone cannot produce duplicate actors; same actor can hold multiple roles; role disable cannot affect another role; Platform Control global security disable revokes all actor sessions without deleting roles and DSH cannot invoke it; governed OTP cannot self-provision; operator OTP is rejected; credential not caller header determines internal principal; consumer cannot author actor ID; OTP/login abuse controls work; Argon2id reset revokes operator sessions; refresh rotation/replay behavior holds; secrets are not exposed; readiness rejects legacy schema.

## 8. Exit gate

```text
core/identity=ABSENT
LEGACY_GENERIC_HUMAN_SOURCE=ABSENT
GENERIC_HUMAN_PARTICIPANT_SERVICE_OR_MODULE=ABSENT
ONE_CROSS_BOUNDARY_HUMAN_IDENTIFIER_actor_id=PASS
ONE_NORMALIZED_PHONE_ONE_ACTOR=PASS
ACTOR_ROLE_BINDING_CANONICAL=PASS
ROLE_SHAPED_ACTOR_ID=0
SESSION_SINGLE_ROLE=PASS
GLOBAL_SECURITY_DISABLE=PASS
GLOBAL_SECURITY_REENABLE_REQUIRES_REAUTH=PASS
DSH_GLOBAL_SECURITY_MUTATION=0
CROSS_ROLE_REVOCATION_LEAK=0
GOVERNED_ROLE_OTP_SELF_GRANT=0
OPERATOR_OTP=0
CONSUMER_AUTHORED_ACTOR_ID=0
CALLER_HEADER_AS_SERVICE_IDENTITY=0
IDENTITY_OPERATOR_CONTEXT_OR_TENANT_ABSTRACTION=0
PARALLEL_AUTH_SESSION_CREDENTIAL_ACTOR_AUTHORITIES=0
IDENTITY_CONTRACT_GENERATED_CLIENT_DRIFT=0
IDENTITY_SECURITY_PII_REVOCATION_AUDIT_GAPS=0
DSH_OPERATIONAL_PARTICIPANT_TRUTH_OWNED_OUTSIDE_DSH=0
WLT_FINANCIAL_TRUTH_OWNED_OUTSIDE_WLT=0
OLD_CONTRACT_CLIENT_WORKSPACE_DOCKER_PATHS=0
```
