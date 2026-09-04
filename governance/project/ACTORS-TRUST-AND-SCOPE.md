# Actors, Trust and Scope Model

ARTIFACT_CLASS: DURABLE_PROJECT_GOVERNANCE
SEMANTIC_OWNER: governance/project/ACTORS-TRUST-AND-SCOPE.md
EXECUTION_AUTHORITY: NONE

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
OPERATOR CONTEXT WHEN A CAPABILITY PROVES IT
FINANCIAL IDENTITY / WALLET
```

No identifier or table row may be overloaded to represent several meanings.

```text
ACTOR != ROLE
ROLE != BUSINESS_SCOPE
ACTOR != OPERATOR_CONTEXT
OPERATOR_CONTEXT != TENANT
IDENTITY_ROLE != DSH_OPERATIONAL_ELIGIBILITY
```

The existence of an independent semantic axis does not require a generic service/table/header for that axis. Persist it only when a concrete owner and lifecycle require it.

## Identity role law

Identity creates the one `actor_id`. Current high-level surface roles are explicit actor↔role bindings:

```text
client   → app-client
partner  → app-partner
captain  → app-captain
field    → app-field
operator → control-panel
```

A session is bound to one actor and one role. It does not carry every role held by the human.

Client may establish only the `client` role through public OTP. DSH provisions partner/captain/field role admission. Platform Control provisions operator role admission. OTP authentication for a governed DSH role requires that enabled role to exist first and never creates it.

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

If a future capability proves Operator Context or another contextual authorization dimension, its canonical owner must derive it from authenticated identity, governed delegation and owner facts. Identity must not fabricate a generic `operator_context_id` solely to create isolation.

## Primary actor responsibilities

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
