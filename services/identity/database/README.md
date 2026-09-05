# Identity database

This directory is the canonical migration/schema lane for durable Identity state.

Current Stage-B candidate tables:

```text
identity_schema_migrations
identity_actors
identity_actor_roles
identity_activation_challenges
identity_sessions
identity_refresh_token_history
identity_login_attempts
identity_security_audit
```

The actor row represents human identity plus one minimal `security_enabled` authentication-eligibility flag. Roles are separate bindings; sessions are role-scoped. The security flag is not a DSH/domain lifecycle status. DSH operational state and generic Operator Context/Tenant/permissions are not stored here.

The earlier Stage-B actor schema was never integrated or production-authoritative. Migration 001 therefore fails explicitly if that losing schema is detected instead of preserving it with compatibility columns or dual reads. For stale local/non-production Stage-B data, reset the development PostgreSQL volume and apply the canonical schema cleanly. Do not use destructive reset for production data without a separately proven migration plan.
