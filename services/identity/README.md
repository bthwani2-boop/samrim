# Identity Service

STRUCTURAL_STATUS: CANONICAL
CAPABILITY_IMPLEMENTATION_STATUS: STAGE_B_CANDIDATE_PENDING_EXACT_HEAD_CLOSURE

Identity is the sole creator/owner of the cross-boundary human `actor_id` and owns authentication, credentials, minimal Identity-wide security eligibility, explicit high-level actor-role admission, activation proofs and role-scoped sessions.

```text
identity_actors
  1
  └── * identity_actor_roles
          └── role-scoped activation/session
```

One normalized phone resolves to one actor. The same actor may hold client, partner, captain, field and operator roles without creating another human identity.

Identity intentionally does not own DSH participant eligibility/assignment, partner/store membership/business scope, WLT finance, enterprise HR/personnel, a generic permissions engine, Tenant, AccessGrant, or generic Operator Context.

Internal service identity is resolved from the bearer service credential itself. DSH manages only partner/captain/field Identity-role admission; Platform Control manages only operator role/credential intent.

Public OTP: client may establish client; partner/captain/field require a pre-existing enabled role; operator OTP is forbidden.

Each session carries exactly one role. Role disablement revokes only that role's sessions/challenges. The actor row also carries one `security_enabled` flag used only as an Identity-wide kill switch: Platform Control may disable it to revoke all actor sessions/challenges; roles remain intact and re-enable requires re-authentication.
