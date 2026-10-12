# Security Policy

ARTIFACT_CLASS: DURABLE_CROSS_CUTTING_POLICY
SEMANTIC_OWNER: docs/governance/policies/security.md
EXECUTION_AUTHORITY: NONE
IMPLEMENTATION_STATE_AUTHORITY: NONE

- Authenticate acting humans/services from trusted proof, never caller-authored identity values.
- Authorize every protected object/action at the canonical owner using actor plus object/business scope.
- Client input never grants role, Store ownership or service authority.
- Fail closed on missing or invalid trusted context.
- Public authentication/recovery avoids unnecessary account/role enumeration.
- Credentials, tokens, recovery material and secrets are purpose-bound, protected, rotated or revoked when compromised and never logged.
- Each service's database runtime identity has only the privileges needed for its owned data and operations, even when services share one database server. Runtime identities must not have superuser or schema-administration rights; migration/administration authority is separate. Any bounded cross-owner access requires an explicit justified contract, and isolation is proved by permitted-operation success and denied cross-owner access.
- Security-sensitive challenges define expiry, attempts, replay/single-use and throttling behavior.
- Sensitive data and precise location are minimized and redacted by actor need.
- Operator access follows `IDENTITY_ACTIVATION_SESSIONS`; no weaker parallel path.
- Negative authorization tests cover cross-actor, cross-Store and cross-Captain boundaries.
