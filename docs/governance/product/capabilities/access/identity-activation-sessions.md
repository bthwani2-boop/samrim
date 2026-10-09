# Identity Activation Sessions

ARTIFACT_CLASS: DURABLE_PRODUCT_CAPABILITY_GOVERNANCE
SEMANTIC_OWNER: docs/governance/product/capabilities/access/identity-activation-sessions.md
EXECUTION_AUTHORITY: NONE
IMPLEMENTATION_STATE_AUTHORITY: NONE
CAPABILITY_ID: IDENTITY_ACTIVATION_SESSIONS

## Outcome

One Human Actor resolves to one permanent `actor_id`; verification, role admission, credential enrollment, authentication, session lifecycle and recovery remain distinct facts.

## Ownership

Identity owns `actor_id`, the current canonical official identity name, verified identifiers, credentials, high-level role admission, first-Operator bootstrap state, authentication proofs and role-scoped sessions. For a domain-managed role, the owning domain first establishes admission/eligibility and then sends an authorized role-admission request to Identity; Identity alone resolves or creates the `actor_id`, accepts any initial name through its identity path, and persists the role admission. DSH may request governed `partner`, `captain` and `field` role admission only from DSH-owned eligibility truth. For `partner`, DSH eligibility may arise from canonical Partner onboarding/Store ownership or from an accepted Store-scoped access invitation that explicitly requires Partner-workspace access; the role admits the workspace and never substitutes for DSH Store ownership/grant authorization. For `field`, eligibility is the distinct DSH standing Field admission, not a joining-case field, phone number, or surface assertion. Surfaces never grant roles themselves.

## Role-specific lifecycle

The canonical current role set is owned by `docs/governance/platform.md`. Identity applies the following lifecycle distinctions to that set; this section does not independently admit roles.

- Client uses governed self-registration/login/recovery.
- Partner/Captain/Field require domain admission/eligibility, governed Identity role admission, then one-time activation/enrollment and normal role-scoped session behavior. A current dispatch assignment is not a prerequisite for standing Captain admission. A Partner session authenticates the Partner workspace only; DSH separately authorizes every Store resource from Store ownership or an active Store-scoped grant.
- Operator is the only Operator-workspace human role. First bootstrap is one-time. Normal Operator login requires user-verified WebAuthn/Passkey; Operator password login and SMS-as-normal-login-MFA are not admitted.

## Invariants

- phone is a mutable verified identifier, never the cross-boundary primary key;
- the current official identity name is an Identity-owned actor fact; a domain-submitted admission name is only initial input until Identity accepts it, and onboarding or financial destination input never creates a second name authority;
- one human resolution must not create duplicate actors;
- domain admission/eligibility, Identity role admission, activation/enrollment, authentication/session and resource authorization are distinct ordered facts;
- a domain-managed role admission request is authorized by the owning domain's admission/eligibility truth, never by a phone number, surface input or current task assignment;
- `partner` role means admitted Partner-workspace authentication, not ownership of every Store or membership in a generic organization;
- DSH is responsible for determining whether a Partner actor still has standing Partner-workspace eligibility from at least one admitted ownership/grant relationship before requesting role disable; Identity does not infer that standing from UI state;
- one role's credential/session cannot authenticate another role;
- role disable revokes only that role's sessions unless Identity-wide security disable applies;
- refresh rotates atomically and known replay compromises the session family;
- public authentication avoids unnecessary account/role eligibility disclosure;
- security challenges are bounded by expiry, attempts, replay/single-use and throttling;
- client-controlled values never grant actor, role, service identity or business scope.

## Operator invariants

Bootstrap creates the first `operator` exactly once. Subsequent Operator admission requires an authorized existing Operator path. Enrollment/recovery material is bounded and one-use. WebAuthn validation checks the ceremony and user verification before an Operator session is created. Break-glass recovery re-enrolls the authenticator through governed proof and revokes affected Operator sessions/authenticators.

## Failure and recovery

Reject duplicate identity, self-granted managed role, repeated activation-as-login, cross-role credential use, challenge/session replay, invalid Passkey ceremony, unauthorized re-enrollment and caller-authored authority. Store grant acceptance/revocation never silently rebinds actor identity. Recovery preserves one canonical actor and role isolation.

## Material participants

Client self-access, managed Partner/Captain/Field access, Operator access and the Identity owner runtime/persistence are material consumers of this capability. Deployable host names and repository paths remain implementation truth.

## Operator Finance permission

Identity issues one bounded `finance` permission to an Operator identity. It controls Finance workspace access without creating a new high-level role or a generic permissions engine. The one-time bootstrapped first Operator receives this permission and is the initial Finance access administrator; it may grant or revoke the permission only for another enabled Operator. Later Operators receive no Finance permission by default. Grants and revocations are reasoned, versioned and audited, and revocation invalidates affected Operator sessions.

## Operator Platform Policies permission

Identity issues one bounded `platform_policies` permission to an Operator identity. It controls write access to the Operator Platform Policies workspace and its owner-authorized policy mutations; it does not create a new high-level role or a generic permissions engine. The one-time bootstrapped first Operator receives this permission. Later Operators receive no Platform Policies permission by default. Only the one-time bootstrapped first Operator may grant or revoke it, and only for another enabled Operator. Grants and revocations are reasoned, versioned and audited, and invalidate the affected Operator's sessions. Each canonical mutation owner independently verifies the active Operator and this permission before accepting a protected write; inability to verify authorization fails closed. Reads may remain available according to the owning workspace's access rules.

## Operator workspace permission boundaries

Operator workspace permissions are a finite, Identity-owned set for Operator identities only. The current set is `operations`, `partners`, `catalog`, `marketing`, `finance` and `platform_policies`. These bounded scopes do not create new high-level roles or a generic permissions engine. The initial bootstrapped Operator receives each registered scope; subsequent Operators receive none by default. Only the initial bootstrapped Operator can grant or revoke a registered scope for another enabled Operator. Every grant or revocation requires a reason and expected version, is audited, and invalidates the target Operator's sessions. Operator handlers and canonical mutation owners enforce the relevant scope at their respective boundaries and fail closed when the permission cannot be verified.

`operations` covers operational order handling and Captain administration. `partners` covers Partner and Field admission, status and directory administration. `catalog` covers central products, shared category taxonomy and attribute policy, proposals and imports. `marketing` covers promotion and discovery-content administration. `finance` remains the financial workspace scope, and `platform_policies` remains the shared platform-rule workspace scope. Leadership is a read-oriented center without an independent write permission; sensitive data retains its owning domain's access rules. Access and Permissions administration is not delegated by these scopes and remains limited to the initial bootstrapped Operator. Partner, Captain and Field role admission and entitlements remain distinct from Operator workspace permissions.
