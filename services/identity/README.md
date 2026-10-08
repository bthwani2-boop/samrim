# Identity Service

Identity is the sole creator/owner of the permanent cross-boundary human `actor_id`. Phone is a mutable verified login identifier, never the database identity. High-level surface roles remain explicit actor↔role bindings and each session carries exactly one role.

Authentication policy is intentionally actor-class specific:

```text
Customer
  registration: phone verification -> client password -> session
  normal re-authentication: phone + client password
  recovery: phone verification -> replace client password -> normal password login

Partner / Captain / Field
  first password: governed DSH role provisioning -> phone verification + password enrollment -> session
  normal/new-device access: phone + role-scoped password; restore/rotate a valid saved session
  forgotten password: phone verification -> replace existing role credential + revoke that role's sessions -> normal password login
  disabled/unadmitted role: no login, enrollment or recovery grant; admission remains DSH-owned

Operator
  first-operator bootstrap or Control Panel provisioning -> one-time enrollment authorization + phone proof -> user-verified WebAuthn registration -> session
  normal access: discoverable, user-verified WebAuthn/Passkey -> server verification -> session
  break-glass: one-use recovery credential + fresh phone proof -> bounded WebAuthn re-enrollment -> rotated recovery credential
```

Credentials are role-scoped. Customer and managed-role passwords cannot authenticate each other's roles even when they belong to the same `actor_id`; Operator has no password credential or normal SMS login path.

Managed mobile apps open on a minimal login screen, with separate password setup and recovery links. Neither requires device activation or self-registration. Local Yemeni and international phone forms resolve through the same canonical phone normalization. Password recovery returns only `recovery_complete`, never a session or a role grant; existing admission, activation and actor security are checked again at the credential write boundary.

For `BTHWANI_ENV=development` only, the HTTP composition registers a development-session convenience route. Each role resolves only to its server-configured local `actor_id`; the client never chooses an actor. Identity requires the existing actor/role to be enabled and actor security to remain enabled before minting a role-scoped development session. The Control Panel requires the local `CONTROL_PANEL_DEVELOPMENT_PASSWORD` before requesting it. For the configured Control Panel operator only, Identity records first local activation as `actor_role.development_activated` without enrolling a passkey, allowing canonical domain owners to recognize the admitted operator as active. That configured operator is also the local permission administrator; the same Identity authorization owner determines both the session claim and access to operator administration. Workspace scopes remain the persisted, versioned and audited Identity grants. The shortcut never creates actors, roles or credentials and does not prove production activation/enrollment, normal login, or recovery. Development actor pins are rejected outside development; the persisted first-bootstrap administrator and normal passkey login remain the production path. Mobile development-session readiness remains role-specific. Control Panel logout clears its session and requires the local password again.

Mobile activation proof can set `EXPO_PUBLIC_BTHWANI_AUTH_JOURNEY_PROOF=1` before starting Metro. The mobile session owner then refuses development-session fallback for that run, so managed activation/login is exercised through the canonical product path. The flag does not register or broaden the development route and has no effect on production, where `__DEV__` is false.

Identity does not own DSH participant eligibility/assignment, partner/store membership/business scope, WLT financial truth, enterprise HR/personnel, a generic permissions engine, Tenant, AccessGrant, or cross-domain authorization scope. Identity owns the one bounded `finance` permission for Operator Finance workspace access, including its initial-Operator grant administration and role-scoped session representation; this does not create a general authorization engine.

Internal service identity is resolved from the bearer service credential itself. DSH requests Identity role admission for Partner, Captain and Field only after its canonical domain eligibility transition and has no phone-addressed mutation path. DSH also verifies current domain eligibility before actor_id-addressed managed-role re-enrollment; Identity applies the versioned credential/session transition and records the operator attribution. The dedicated operator-bootstrap service credential owns the one-time first-operator lifecycle, while Control Panel manages operator role/credential intent, actor_id-addressed role/security state, and issuance of a single-use phone-bound enrollment token for an operator invite. The token cannot create or grant a role and is distinct from the phone verification challenge.

Refresh tokens rotate atomically and require the protected random `clientInstanceId` for the same client installation/browser instance; Identity stores and compares only its digest. This is a refresh possession/binding signal, not hardware fingerprinting, MFA or device attestation. Role disable revokes that role only. The actor-level `security_enabled` flag is an Identity-wide emergency authentication kill switch and never represents domain lifecycle state.


## Challenge delivery isolation

Public challenge acknowledgement is committed independently from provider delivery. An admissible challenge enters durable `pending` delivery state; a decoy is durably `suppressed`. The service-owned worker performs the external send after the HTTP acknowledgement boundary. An interrupted or failed in-flight attempt becomes `unknown` and is not blindly retried, preventing provider outage/timing from becoming an actor/role admission oracle.
