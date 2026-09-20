# Identity Service

Identity is the sole creator/owner of the permanent cross-boundary human `actor_id`. Phone is a mutable verified login identifier, never the database identity. High-level surface roles remain explicit actor↔role bindings and each session carries exactly one role.

Authentication policy is intentionally actor-class specific:

```text
Customer
  registration: phone verification -> client password -> session
  normal re-authentication: phone + client password
  recovery: phone verification -> replace client password -> fresh session

Partner / Captain / Field
  governed DSH role provisioning -> phone verification + password enrollment -> initial activation -> device-bound session
  normal use: restore/rotate the existing session
  lost/revoked access: explicit DSH-authorized re-enrollment, never repeated activation as ordinary login

Operator
  first-operator bootstrap or Control Panel provisioning -> one-time enrollment authorization + phone proof -> user-verified WebAuthn registration -> session
  normal access: discoverable, user-verified WebAuthn/Passkey -> server verification -> session
  break-glass: one-use recovery credential + fresh phone proof -> bounded WebAuthn re-enrollment -> rotated recovery credential
```

Credentials are role-scoped. Customer and managed-role passwords cannot authenticate each other's roles even when they belong to the same `actor_id`; Operator has no password credential or normal SMS login path.

For `BTHWANI_ENV=development` only, the HTTP composition registers a development-session convenience route. It can mint a normal role-scoped session only for an already-existing enabled, security-enabled, authentication-ready actor/role whose canonical activation or enrollment is complete; it never creates actors, roles or credentials. Mobile and Control use it only when reusable local session state is missing or terminally invalid. Explicit logout or recovery remains signed out for that runtime instance, while a fresh runtime may resume development continuity. This keeps authentication ceremonies out of ordinary local product iteration without allowing the development shortcut to satisfy activation, enrollment, login, or recovery proof.

Identity does not own DSH participant eligibility/assignment, partner/store membership/business scope, WLT finance, enterprise HR/personnel, a generic permissions engine, Tenant, AccessGrant, or cross-domain authorization scope.

Internal service identity is resolved from the bearer service credential itself. DSH may request only the Identity partner-role admission that follows its canonical joining-case eligibility transition; it does not admit Captain or Field roles and has no phone-addressed mutation path. The dedicated operator-bootstrap service credential owns the one-time first-operator lifecycle, while Control Panel manages operator role/credential intent, actor_id-addressed role/security state, domain-managed re-enrollment authorization, and issuance of a single-use phone-bound enrollment token for an operator invite. The token cannot create or grant a role and is distinct from the phone verification challenge.

Refresh tokens rotate atomically and require the protected random `clientInstanceId` for the same client installation/browser instance; Identity stores and compares only its digest. This is a refresh possession/binding signal, not hardware fingerprinting, MFA or device attestation. Role disable revokes that role only. The actor-level `security_enabled` flag is an Identity-wide emergency authentication kill switch and never represents domain lifecycle state.


## Challenge delivery isolation

Public challenge acknowledgement is committed independently from provider delivery. An admissible challenge enters durable `pending` delivery state; a decoy is durably `suppressed`. The service-owned worker performs the external send after the HTTP acknowledgement boundary. An interrupted or failed in-flight attempt becomes `unknown` and is not blindly retried, preventing provider outage/timing from becoming an actor/role admission oracle.
