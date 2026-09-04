# Actors, Trust and Scope Model

ARTIFACT_CLASS: DURABLE_PROJECT_GOVERNANCE
SEMANTIC_OWNER: governance/project/ACTORS-TRUST-AND-SCOPE.md
EXECUTION_AUTHORITY: NONE

## Separation model

BThwani treats these as independent axes:

```text
PERSON / ACTOR
AUTHENTICATION IDENTITY
ROLE / PERMISSION
WORKFORCE ENGAGEMENT
ORGANIZATION
STORE / BUSINESS SCOPE
OPERATIONAL ROLE / ASSIGNMENT
AUTHORIZATION SCOPE
OPERATOR CONTEXT
FINANCIAL IDENTITY / WALLET
```

No identifier should be overloaded to represent several meanings.

## Trust model

Trusted identity/context is derived server-side from authenticated identity, governed delegation and canonical owner facts.

Client headers, query parameters, request bodies, cached local values, UI selectors and navigation state may request context but never grant it.

```text
CLIENT_CLAIM != TRUSTED_CONTEXT
DISPLAYED_SCOPE != AUTHORIZATION_SCOPE
READ_PERMISSION != MUTATION_PERMISSION
```

## Primary actor responsibilities

### Customer
Consumes discovery/catalog/serviceability, checkout/order, support/tracking and authorized WLT-backed financial readback. Customer input never defines authoritative price, financial amount, serviceability or ownership.

### Partner
Acts within governed partner/store scopes for store/catalog/order/team operations and authorized financial readback. Partner organization is a business scope, not platform isolation.

### Captain
Acts within dispatch/delivery/custody/proof/exception responsibilities when eligibility and assignment are valid. Captain workforce affiliation and DSH assignment are related but distinct facts.

### Field worker
Performs assigned workforce-linked field/onboarding/verification tasks. Workforce truth and DSH operational task truth remain separate owners.

### Operator
Acts through trusted operator context and exact server-side permissions. Read, mutation, approval and financial permissions are distinct.

## Approval and separation of duties

```text
MAKER != CHECKER
BENEFICIARY != APPROVER_WHEN_PROHIBITED
READ != APPROVE
APPROVE != EXECUTE_UNLESS_EXPLICITLY_ALLOWED
```

Approval is bound to the exact object/version/decision being approved and cannot be recreated by a broad role bypass.

## Tenant admission

A `TENANT` concept may be introduced only if Product/System requirements prove independent lifecycle and isolation semantics. Partner/store alone do not satisfy that burden.
