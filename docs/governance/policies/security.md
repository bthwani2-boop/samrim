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
- Security-sensitive challenges define expiry, attempts, replay/single-use and throttling behavior.
- Sensitive data and precise location are minimized and redacted by actor need.
- Operator access follows `IDENTITY_ACTIVATION_SESSIONS`; no weaker parallel path.
- Negative authorization tests cover cross-actor, cross-Store and cross-Captain boundaries.
