# Identity Service

STRUCTURAL_STATUS: CANONICAL
CAPABILITY_IMPLEMENTATION_STATUS: STAGE_B_CANDIDATE_PENDING_EXACT_HEAD_CLOSURE

Identity is the sole creator/owner of the permanent cross-boundary human `actor_id`. Phone is a mutable verified login identifier, never the database identity. High-level surface roles remain explicit actor↔role bindings and each session carries exactly one role.

Authentication policy is intentionally actor-class specific:

```text
Customer
  registration: phone verification -> client password -> session
  normal re-authentication: phone + client password
  recovery: phone verification -> replace client password -> fresh session

Partner / Captain / Field
  governed role provisioning -> one-time activation -> device-bound session
  normal use: restore/rotate the existing session
  lost/revoked access: explicit DSH-authorized re-enrollment, never repeated activation as ordinary login

Operator
  Platform Control provisioning -> password proof -> required second-factor challenge -> session
  Passkeys/WebAuthn: preferred progressive phishing-resistant target, not a universal first-release requirement
```

Credentials are role-scoped. Customer and operator passwords cannot authenticate each other's roles even when they belong to the same `actor_id`.

Identity does not own DSH participant eligibility/assignment, partner/store membership/business scope, WLT finance, enterprise HR/personnel, a generic permissions engine, Tenant, AccessGrant, or cross-domain authorization scope.

Internal service identity is resolved from the bearer service credential itself. DSH manages only partner/captain/field Identity-role admission and explicit re-enrollment authorization; Platform Control manages only operator role/credential intent and Identity-wide security eligibility.

Refresh tokens rotate atomically and remain device-fingerprint bound. Role disable revokes that role only. The actor-level `security_enabled` flag is an Identity-wide emergency authentication kill switch and never represents domain lifecycle state.


## Challenge delivery isolation

Public challenge acknowledgement is committed independently from provider delivery. An admissible challenge enters durable `pending` delivery state; a decoy is durably `suppressed`. The service-owned worker performs the external send after the HTTP acknowledgement boundary. An interrupted or failed in-flight attempt becomes `unknown` and is not blindly retried, preventing provider outage/timing from becoming an actor/role admission oracle.
