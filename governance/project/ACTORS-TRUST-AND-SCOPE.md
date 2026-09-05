# Actors, Trust and Scope Model

ARTIFACT_CLASS: DURABLE_PROJECT_GOVERNANCE
SEMANTIC_OWNER: governance/project/ACTORS-TRUST-AND-SCOPE.md
EXECUTION_AUTHORITY: NONE
CLOSURE_AUTHORITY: NONE
IMPLEMENTATION_STATE_AUTHORITY: NONE

## Separation model

BThwani treats these as independent axes:

```text
PERSON / ACTOR
AUTHENTICATION IDENTITY
HIGH-LEVEL IDENTITY ROLE
ORGANIZATION
STORE / BUSINESS SCOPE
OPERATIONAL ROLE / ASSIGNMENT
AUTHORIZATION SCOPE / PERMISSION
FINANCIAL IDENTITY / WALLET
```

No identifier or table row may be overloaded to represent several meanings.

```text
ACTOR != ROLE
ROLE != BUSINESS_SCOPE
IDENTITY_ROLE != DSH_OPERATIONAL_ELIGIBILITY
```

The existence of an independent semantic axis does not require a generic service/table/header for that axis. Persist it only when a concrete owner and lifecycle require it.

## Canonical human-role-persona mapping

| Human identity | Identity role | Product persona | Primary host | Business-scope owner |
|---|---|---|---|---|
| Human Actor | `client` | Customer | `app-client` | DSH for non-authentication business truth |
| Human Actor | `partner` | Partner member | `app-partner` | DSH Partner/Store membership and scope |
| Human Actor | `captain` | Captain | `app-captain` | DSH eligibility/assignment/affiliation |
| Human Actor | `field` | Field worker | `app-field` | DSH eligibility/assignment/readiness |
| Human Actor | `operator` | Operator | `control-panel` | applicable protected capability; Platform Control only where explicitly assigned |
| Human Actor | `platform_owner` | Platform owner | `control-panel` | Platform Control sovereign administration; fine-grained duties remain capability-owned |

A Partner Organization is never the Human Actor. Role/persona/host mapping does not grant business scope; server-side owner facts do.

## Identity role law

Identity creates the one `actor_id`. Current high-level surface roles are explicit actor↔role bindings:

```text
client   → app-client
partner  → app-partner
captain  → app-captain
field    → app-field
operator → control-panel
platform_owner → control-panel
```

A session is bound to one actor and one role. It does not carry every role held by the human.

Customer self-service may establish only the `client` role after proving phone possession and registering a client credential. DSH provisions partner/captain/field role admission; those governed roles use one-time activation only after admission exists. Platform Control provisions the authorized `platform_owner` bootstrap and `operator` role admission; an operator consumes a phone-bound activation code before first access, while both control-panel roles require password plus a second factor/challenge for normal access.

`actor_id` is the permanent cross-boundary human identifier. Phone is a mutable verified identifier, not the primary identity key; username is optional and must not exist merely as an authentication convention without Product need.

```text
PHONE_VERIFICATION != MANAGED_ACTIVATION
MANAGED_ACTIVATION != NORMAL_AUTHENTICATION
NORMAL_AUTHENTICATION != RECOVERY_OR_REENROLLMENT
```

Customer registration/recovery, managed-role activation and operator authentication therefore have separate journeys while remaining owned by the same Identity authority. Passkeys/WebAuthn are a preferred progressive hardening path, especially for privileged operator access, but are not a mandatory first-release credential for every actor class.

Role enable/disable is Identity admission truth. Captain/field/partner eligibility, assignment, organization/store membership and other operational states remain DSH truth.

## Trust model

Trusted identity is derived server-side from authentication/session state. Internal service identity is derived from the authenticated service credential itself.

A client header, query parameter, request body, cached local value, UI selector or navigation state may request a business operation but never grants identity, role, scope or context.

```text
CLIENT_CLAIM != TRUSTED_CONTEXT
DISPLAYED_SCOPE != AUTHORIZATION_SCOPE
READ_PERMISSION != MUTATION_PERMISSION
SERVICE_CALLER_HEADER != SERVICE_IDENTITY
```

Any contextual authorization dimension must be owned by the capability that proves it and derived from authenticated identity, governed delegation and canonical owner facts. Identity must not fabricate generic isolation scope.

## Primary role/persona responsibilities

### Customer
Consumes discovery/catalog/serviceability, checkout/order, support/tracking and authorized WLT-backed financial readback. Customer input never defines authoritative price, financial amount, serviceability or ownership.

### Partner
Acts within DSH-governed partner/store scopes for store/catalog/order/team operations and authorized financial readback. Partner organization is a business scope, not platform isolation.

### Captain
Acts within dispatch/delivery/custody/proof/exception responsibilities only when DSH eligibility and assignment are valid.

### Field worker
Performs DSH-assigned field/onboarding/verification tasks. Field participant status, eligibility and task truth are DSH-owned.

### Operator
Authenticates through the operator Identity role and acts only through exact server-side permissions/scopes owned by the applicable administration/domain capability.

### Platform owner
Authenticates through the `platform_owner` Identity role and is the human control-panel authority allowed to provision employees and issue role-bound activation codes. This role does not become a generic permissions blob; each protected capability still owns its exact duties and approval separation.

## Approval and separation of duties

```text
MAKER != CHECKER
BENEFICIARY != APPROVER_WHEN_PROHIBITED
READ != APPROVE
APPROVE != EXECUTE_UNLESS_EXPLICITLY_ALLOWED
```

Approval is bound to the exact object/version/decision being approved and cannot be recreated by a broad role bypass.

## Tenant admission

A `TENANT` concept may be introduced only if Product/System requirements prove independent lifecycle and isolation semantics. Partner/store/role alone do not satisfy that burden.
