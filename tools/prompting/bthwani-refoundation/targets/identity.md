# Target — Identity

TEMPORARY_TARGET_SPECIALIZATION: YES
GENERAL_EXECUTION_AUTHORITY: NONE
DURABLE_AUTHORITY: NONE

## 1. Service placement

Refound `core/identity` directly into `services/identity`. A path move alone is not closure: rebuild canonical internals, migrate required data/contracts/clients/runtime consumers, then delete old roots and aliases.

Legacy `core/workforce` is not mapped to a replacement service or module. Extract each still-required fact to its proven current owner: DSH for current client/partner/captain/field operational participant truth, Identity only for actor/authentication/access truth, and WLT only for financial truth.

## 2. Identity authority

Identity owns:

```text
actor_id
actor identity
authentication
credentials/verification
session create/refresh/revoke
activation/security state
roles/permissions identity vocabulary
trusted identity context
device/session authorization semantics where applicable
```

`actor_id` is the single cross-boundary human identifier. Do not introduce `worker_id`, `employee_id`, `captain_id`, `field_id`, `person_id` or `staff_id` as competing cross-service human identities. Service-local technical primary keys may exist but remain private implementation details.

Identity does not own DSH participant profiles, partner/captain/field operational status, assignments, availability, qualification/fleet facts, WLT financial state, or app navigation.

## 3. Domain participation

Current role-specific operational truth is owned where the work occurs:

```text
client/customer operational profile/preferences → DSH
partner/store membership and operations          → DSH
captain affiliation/eligibility/fleet/dispatch  → DSH
field participant/assignment/readiness          → DSH
financial truth                                 → WLT
authentication/access                           → Identity
```

Do not create a generic `Workforce`, `People`, `Staff` or `Actors` service/module merely to group human participants. A future enterprise HR domain requires fresh independent admission proof from concrete cross-domain lifecycle/data/rule requirements.

## 4. Identity topology

Conceptual target when applicable:

```text
services/identity/
├── backend/
│   ├── cmd/
│   └── internal/
│       ├── runtime/
│       ├── transport/http/
│       ├── integrations/
│       └── <cohesive-identity-capabilities>/
├── contracts/
├── clients/generated/
├── frontend/          # only reusable host-neutral identity presentation/controllers
├── database/
└── tests/testing/
```

Possible cohesive capabilities come from live evidence: actor, authentication, session, activation/access, authorization vocabulary, device/session trust. HTTP, token parsing, cache, rate limiting, cleanup, provider adapters and audit plumbing are mechanisms, not business domains.

## 5. Contracts and generated clients

Identity has one canonical service contract composition root, e.g. `services/identity/contracts/identity.openapi.yaml`.

```text
IDENTITY CANONICAL CONTRACT
→ VALIDATE/COMPOSE
→ DETERMINISTIC GENERATED CLIENT/BINDING
→ DSH/WLT/APPS/PLATFORM CONSUMERS
```

No hand-maintained duplicate auth DTOs, role/permission enumerations, session interpretations or consumer-local mirrors may compete with canonical Identity semantics.

## 6. Database and security

For every durable Identity/security fact prove owner, writer, table/columns, readback/revocation, constraints, lifecycle, PII/secret classification, audit requirements and losing authorities. Multiple mutable session/credential/actor authorities are forbidden.

Security closure proves secret non-exposure, single-authority session/token lifecycle, server-derived trusted context, actor/operator-context isolation, replay/expiry/revocation handling, abuse controls where required, auditability, PII minimization and runtime secret hygiene.

## 7. Integrations and presentation

External messaging/verification belongs under explicit Identity integrations only when Identity owns the semantic operation. Reusable login/security presentation may live with Identity only when host-neutral and genuinely reused; app route/shell/deep-link/native storage bindings remain in app roots.

## 8. Exit gate

```text
core/identity=ABSENT
core/workforce=ABSENT_AS_LEGACY_SOURCE
services/workforce=ABSENT
IDENTITY_WORKFORCE_MODULE=ABSENT
GENERIC_PEOPLE_STAFF_ACTORS_SERVICE=ABSENT
ONE_CROSS_BOUNDARY_HUMAN_IDENTIFIER_actor_id=PASS
PARALLEL_AUTH/SESSION/CREDENTIAL/ACTOR_AUTHORITIES=0
IDENTITY_CONTRACT/GENERATED_CLIENT_DRIFT=0
IDENTITY_SECURITY/PII/REVOCATION/AUDIT_GAPS=0
DSH_OPERATIONAL_PARTICIPANT_TRUTH_OWNED_OUTSIDE_DSH=0
WLT_FINANCIAL_TRUTH_OWNED_OUTSIDE_WLT=0
OLD_CONTRACT/CLIENT/WORKSPACE/DOCKER_PATHS=0
```
