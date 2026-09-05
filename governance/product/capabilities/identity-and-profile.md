# Identity And Profile Capabilities

ARTIFACT_CLASS: DURABLE_PRODUCT_CAPABILITY_GOVERNANCE
SEMANTIC_OWNER: governance/product/capabilities/identity-and-profile.md
EXECUTION_AUTHORITY: NONE
CLOSURE_AUTHORITY: NONE
IMPLEMENTATION_STATE_AUTHORITY: NONE
PARENT_CAPABILITY_INDEX: governance/product/CAPABILITIES.md

## Scope

This owner defines only the durable capability semantics listed below. Capability taxonomy/schema/admission law remains in `../CAPABILITIES.md`; cross-capability journeys remain in `../JOURNEYS.md`.

### IDENTITY_ACTIVATION_SESSIONS

**Problem.** Every BThwani surface needs one sovereign human actor while customer self-service, governed managed-role activation and privileged operator access require deliberately different authentication journeys. A single phone+OTP flow for every actor would collapse verification, activation, authentication and recovery into one unsafe abstraction.
**Problem frequency.** continuous
**Problem severity.** critical
**Target state.** One normalized human identity resolves to one permanent `actor_id`; phone is a mutable verified identifier; high-level roles are explicit bindings; every session is single-role; each actor class follows the minimum-strength authentication policy appropriate to its risk without forcing one universal credential journey.
**Primary success measure.** identity_single_actor_role_isolation
**Guardrail measures.** duplicate_actor_count; governed_role_self_grants; repeated_managed_activation; cross_role_revocations; customer_activation_login; operator_single_factor_sessions; consumer_authored_actor_ids; refresh_replays; session_token_leaks

**Required outcome.** One Identity authority serves all required surfaces while keeping four concerns distinct: phone verification, governed activation, normal authentication/session continuation and recovery/re-enrollment. Customer self-registration uses verified phone plus a customer password credential; partner/captain/field use governed one-time activation plus durable session continuity; operator access is governed and multi-factor, with phishing-resistant passkeys/WebAuthn as the preferred progressive target rather than a mandatory dependency for every actor in the first delivery.

**Primary actors.** customer, partner, captain, field, operator, dsh-service, platform-control-service.
**Canonical ownership.** Identity owns `actor_id`, verified login identifiers, credentials, Identity-wide security eligibility, high-level role admission, verification/activation proofs, authentication and role-scoped sessions. DSH owns DSH operational participant/eligibility/business scopes. WLT owns financial truth.
**Material deployable surfaces.** app-client, app-partner, app-captain, app-field, control-panel.

**Business invariants**
- Identity alone creates `actor_id`; runtime consumers cannot request a new actor identifier.
- One normalized canonical phone resolves to one actor even when the same human holds several roles. Phone can change through a governed verification/change process and is never the cross-boundary primary key.
- Username is not a required Identity attribute. It may be introduced only when a concrete Product capability needs a public or alternate handle.
- Actor, role, identifier, credential, activation, session and recovery/re-enrollment are distinct facts/lifecycles.
- Public customer self-service may establish only the client role after proving phone possession and registering a customer password credential. Customer phone verification never creates partner/captain/field/operator admission.
- Customer normal authentication is phone + customer password when no valid session can be restored. Successful authentication creates a role-scoped session; normal app open restores/refreshes that session instead of asking the customer to sign in on every launch.
- Customer password recovery requires a fresh phone-verification proof, replaces only the client credential and revokes client sessions. It does not become a general activation mechanism for governed roles.
- DSH manages only partner/captain/field role admission. Those roles require pre-provisioning and one-time activation before their first role session; the activation proof never grants the role itself and cannot be reused as a recurring login mechanism.
- Loss of a managed-role session/device after activation follows an explicit governed recovery/re-enrollment path. A new installation/device does not automatically reset activation eligibility.
- Platform Control manages only operator role admission and operator credential reset intent. Operator normal access requires password plus a second authentication factor/challenge before a session is created. Passkeys/WebAuthn are the preferred phishing-resistant progressive target; they are not mandatory for customer/partner/captain/field in the initial delivery.
- Internal service principal is resolved from its credential, not a caller/context header.
- Every session has exactly one role; surface is derived from role.
- Disabling one actor-role revokes only that role's sessions and pending role-specific proofs.
- Identity-wide security disable is distinct from role/DSH lifecycle state: Platform Control may disable authentication globally for an actor, which revokes every active session/pending proof while preserving role bindings; re-enable requires fresh authentication.
- Refresh rotates atomically; known replay compromises that session family; an unrelated random refresh cannot revoke it.
- Refresh is device-fingerprint checked; access remains a short-lived bearer token.
- Password credentials use a current password-hashing primitive and server-side password policy appropriate to whether the password is a sole or multi-factor credential. Credential policy is not defined by bootstrap examples.
- Verification/activation/operator-challenge abuse controls include bounded expiry, attempts, replay/single-use behavior and source/identifier throttling without permanent account lockout.
- Public verification/authentication/activation surfaces are non-enumerating before the caller has proven the applicable identifier. Privileged status inspection belongs only to authorized internal/admin contracts.
- Local sign-out and remote revocation are distinct outcomes. Once local credentials/cookies are cleared, every consuming host converges to `signed_out` even if remote revocation fails.

**Forbidden/negative invariants**
- No universal `phone + activation code` login journey across all actor classes.
- No mandatory `username + phone + password` tuple for customer identity.
- No phone number, username or email as cross-boundary primary identity.
- No actor-global credential that accidentally allows one role's password to authenticate another role.
- No actor-global `roles[]`, generic permissions blob, provisioning fingerprint or creator-service provenance. A minimal `security_enabled` boolean is permitted only as Identity-wide authentication eligibility and must never represent DSH operational lifecycle.
- No generic AccessGrant/Tenant/generic-human-participant authority without proven independent requirements.
- No governed role creation through OTP/verification/activation.
- No repeated managed activation as ordinary login after successful enrollment.
- No automatic new-device activation reset.
- No provisioning retry silently re-enables a disabled role or mutates another role.
- No DSH operator grant and no Platform Control DSH-role grant.
- No cross-role session or credential revocation except explicit Identity-wide security disable.
- No consumer-authored actor ID, service-caller header or Identity context header grants authority.
- No operator session from password alone in the current privileged baseline.
- No public authentication response unnecessarily distinguishes blocked/disabled/non-admissible actor or role state.
- No app/control-panel remains visually or behaviorally authenticated after its local session material has been cleared merely because remote logout/revocation failed.

**Acceptance expectations**
- Readiness fails closed for missing configuration/database/schema/relations, legacy actor/credential columns and clock failure.
- Customer registration proves phone ownership before creating/enabling the client credential and creates/reuses exactly one `actor_id` for that phone.
- Customer login uses phone + client credential and cannot authenticate an operator credential for the same actor; customer password reset revokes client sessions only.
- Partner/captain/field activation succeeds only for a pre-existing enabled role that has not already been activated; replay or ordinary repeated activation cannot create a fresh session.
- A governed recovery/re-enrollment action is explicit and server-authorized rather than inferred from a new device/install.
- Client/captain sessions may coexist; disabling captain invalidates captain only.
- Platform Control global security disable invalidates all role sessions for the same actor, DSH cannot invoke it, role bindings remain intact, and re-enable requires new authentication.
- Operator password proof alone does not create a session; the required second-factor challenge must also be successfully consumed.
- Operator credential reset invalidates operator sessions but not unrelated-role sessions.
- Forged caller headers cannot change the principal resolved from a service credential.
- Generated contract/client/app/database/runtime evidence contains zero legacy universal-OTP/client-activation or caller-header authority.
- Mobile hosts and Control Panel transition to `signed_out` after local credential/cookie clearing even when remote revoke fails; remote-revocation failure remains separately observable/retriable according to policy.

**Named failure classes:** duplicate_actor, role_shaped_actor_id, actor_role_collapse, customer_activation_login, customer_username_requirement, governed_role_self_grant, repeated_managed_activation, automatic_device_reactivation, cross_role_credential, cross_role_revocation, operator_single_factor_session, missing_global_security_kill_switch, consumer_authored_actor_id, service_caller_header_trust, premature_identity_context_or_tenant, account_lockout_dos, challenge_replay, refresh_reuse, public_auth_state_enumeration, local_logout_ui_divergence, secret_or_pii_leak, parallel_identity_truth.

**Actor responsibility envelope**
- `customer` — self-registers only client after phone verification, authenticates with its client credential when session restoration is unavailable, and uses phone verification for governed password recovery.
- `partner` — performs one-time activation only after DSH pre-provisions partner admission; normal use relies on the resulting governed session and explicit recovery/re-enrollment when required.
- `captain` — performs one-time activation only after DSH pre-provisions captain admission; Identity role never implies dispatch eligibility.
- `field` — performs one-time activation only after DSH pre-provisions field admission; Identity role never implies assignment.
- `operator` — authenticates a Platform-Control-provisioned operator role with password plus required second factor/challenge; fine-grained administration permission and sensitive-operation step-up are separate concerns.
- `dsh-service` — credential-authenticated manager of partner/captain/field Identity-role admission and explicit re-enrollment authorization only.
- `platform-control-service` — credential-authenticated manager of operator Identity-role admission/credential reset and Identity-wide security eligibility.

**Surface semantics**
- `app-client` — restore/refresh existing session; signed-out choice between registration and login; registration = phone verification + customer password; recovery = phone verification + password replacement; no activation-screen semantics.
- `app-partner`, `app-captain`, `app-field` — one-time activation after pre-provisioned role, then restore/refresh/logout; re-enrollment only after governed recovery authorization.
- `control-panel` — operator password proof + required second-factor challenge, then restore/refresh/logout; passkey/WebAuthn is a progressive hardening target rather than a blocker for the initial baseline.
- `backend` — credential-derived service identity, differentiated actor-class authentication policy, role admission, verification/activation/recovery and session lifecycle.
- `database` — one actor identity, actor-role bindings, role-scoped password credentials where required, purpose-bound single-use challenges, sessions, refresh history, login attempts and security audit.
- technical presentation binding — generated typed role-specific flows without parallel auth truth.

### CUSTOMER_PROFILE_PREFERENCES

**Problem.** Customer locale, currency preference and marketing-channel consent must not be mixed into authentication/session truth or become device-local authority.

**Required outcome.** An authenticated customer owns one versioned non-authentication profile readback containing governed locale/preferences/consents; mutations are idempotent, conflict-safe and privacy-scoped.

**Primary actors.** customer, authorized support/operator where explicitly permitted.

**Canonical ownership.** DSH customer/profile truth; Identity owns authentication/session/activation only.

**Material surfaces.** app-client; authorized control-panel/support view when required.

**Durable states/actions.**
- profile absent or present with monotonically versioned readback;
- supported locale/preference values are server validated;
- preferences and consent mutations require expected-version plus mutation identity/correlation;
- marketing consent channels are independent booleans/preferences, not inferred from notification delivery success.

**Forbidden/negative invariants.**
- No device/local storage is authoritative profile or consent truth.
- No Identity credential/session record becomes the owner of customer commerce preferences.
- No stale expected version silently overwrites a newer profile.
- No retry with a conflicting payload reuses the same idempotency identity as success.
- No consent is inferred from silence, delivery success or app installation.

**Failure/recovery.** not_found/initial creation, invalid value, version conflict, idempotency conflict, owner unavailable; recover through canonical reread and explicit retry with current version.

**Acceptance expectations.**
- profile/preferences and consents have canonical server readback;
- mutation concurrency/version conflict is explicit;
- privacy/marketing consent is enforced by downstream consumers rather than copied into parallel stores;
- app-client loading/empty/success/conflict/forbidden/offline/error states are truthful.

**Target state.** One versioned DSH profile/preferences readback owns non-authentication customer profile, locale/currency preference and communication consent with privacy-safe scoped mutation.
**Primary success measure.** successful versioned owner-side profile/preference updates with canonical readback across required customer surfaces.
**Guardrail measures.** stale-version overwrite; Identity profile duplication; consent inferred from provider delivery; cross-customer read/write; unsupported locale/currency accepted.
**Business invariants**
- authentication/session facts remain Identity-owned;
- profile/preferences are customer-scoped and versioned;
- locale/currency/consent values are validated server-side;
- delivery success/failure never fabricates consent.
**Actor responsibility envelope**
- `customer` — reads/updates only delegated own profile/preferences; forbidden: mutate authentication/privileged status or another customer.
- `operator` — reads/changes only explicitly authorized support fields with audit; forbidden: bypass privacy/scope.
- `DSH profile system` — canonical writer/readback for this capability.
**Surface semantics**
- `app-client` — required for owned profile/preferences and truthful conflict/offline/error recovery.
- `control-panel` — conditional authorized support only.
- `backend` and `database` — required scoped/versioned owner enforcement.
- technical presentation binding — implementation evidence only; no local profile truth.
