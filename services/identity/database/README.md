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
```

`identity_actors` owns the permanent `actor_id`, current verified phone identifier and minimal Identity-wide `security_enabled` state. Passwords are not actor columns: client/operator password credentials are role-scoped in `identity_password_credentials`. Managed-role one-time enrollment is represented by `identity_actor_roles.activated_at`.

`identity_challenges` is purpose-bound. Current purposes distinguish client registration, client recovery, managed activation and operator MFA. A challenge cannot silently become a business-role grant, recurring login credential or recovery authority for another role.

The discarded pre-refoundation schemas were never integrated as production truth. Migration 001 intentionally fails if losing actor-global credential/context columns are detected. For stale local/non-production data, reset the development PostgreSQL volume and apply the canonical schema cleanly. Never apply destructive reset instructions to production data without a separately proven migration plan.
