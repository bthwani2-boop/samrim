# Identity database

This directory is the canonical migration/schema lane for durable Identity state.

Current canonical tables:

```text
identity_schema_migrations
identity_actors
identity_actor_roles
identity_password_credentials
identity_challenges
identity_sessions
identity_refresh_token_history
identity_password_attempts
identity_security_audit
identity_operator_enrollment_tokens
```

`identity_actors` owns the permanent `actor_id`, current verified phone identifier and minimal Identity-wide `security_enabled` state. Passwords are not actor columns: client/operator/platform-owner password credentials are role-scoped in `identity_password_credentials`. Managed-role and operator one-time enrollment are represented by `identity_actor_roles.activated_at`.

`identity_challenges` is purpose-bound. Current purposes distinguish client registration, client recovery, managed activation, managed recovery, and operator MFA. Managed recovery may replace an already activated operator or platform-owner credential after phone proof; it cannot silently become activation or bootstrap authority.

`identity_operator_enrollment_tokens` stores the one-time control-surface token for a pre-provisioned operator role. Only its digest is persisted; the plaintext is returned once to the authorized issuing surface. It is separate from `identity_challenges`, which carries the phone verification proof.

The current challenge contract is six decimal digits, enforced by the Identity security boundary and generated contract. `007_four_digit_challenges.sql` is an immutable historical migration name: it revoked pending proofs from the previous contract and removed a global digest uniqueness rule. It does not define the current code width and must not be edited; any future schema transition is forward-only.

Superseded schemas were never integrated as production truth. Migration 001
intentionally fails if losing actor-global credential/context columns are
detected. For stale local/non-production data, reset the development
PostgreSQL volume and apply the canonical schema cleanly. Never apply
destructive reset instructions to production data without a separately proven
migration plan.


Migration 002 adds `identity_challenge_deliveries` as durable provider-execution provenance with `suppressed | pending | sending | sent | unknown | expired` states. It is a forward migration; migration 001 remains immutable. Ordered migration application rejects missing, duplicate or non-contiguous versions.

Migration 015 is the forward-only six-digit challenge cutover. It revokes all pending challenges, suppresses pending deliveries and marks in-flight deliveries as unknown before the six-digit runtime contract is allowed to issue new proofs. This prevents a legacy four-digit `code_hash` from being paired with a newly generated six-digit delivery code.

Migration 016 extends only the `managed_recover` challenge boundary to `platform_owner`; platform-owner activation remains bootstrap-only.
