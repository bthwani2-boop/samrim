# Runtime and Configuration Architecture

ARTIFACT_CLASS: DURABLE_ARCHITECTURE_GOVERNANCE
SEMANTIC_OWNER: governance/architecture/RUNTIME-AND-CONFIGURATION.md
EXECUTION_AUTHORITY: NONE
CURRENT_VALUE_AUTHORITY: EXECUTABLE_CONFIG

## Runtime law

Runtime topology expresses service ownership without becoming a second architecture authority. Exact ports, container names and environment values remain executable configuration.

## Configuration classes

Distinguish build/deployable configuration, runtime environment configuration, platform-governed variables/flags, secret references/secret values and user/business state.

These classes must not share one generic mutable authority.

## Platform variables

Cross-surface platform variables require canonical server-side ownership, typed/schema validation, versioning, audit/reason, rollout semantics and readback. Platform Control owns only explicitly admitted cross-platform control-plane variables.

## Development runtime

Development may use local code with managed stateful dependencies when contracts remain equivalent. Development providers are implementations, not Product/domain authorities.

- `MANAGED_DEV_SERVICE != DOMAIN_AUTHORITY`
- `DEVELOPMENT_PROVIDER MAY DIFFER FROM PRODUCTION_PROVIDER`
- `SYNTHETIC/TEST_DATA_ONLY_IN_GENERAL_EXTERNAL_DEV_SERVICES`
- `REPRODUCIBLE_INTEGRATION_PATH = REQUIRED`

## Cache and coordination

Redis/Valkey or equivalent infrastructure is off by default unless a proven requirement exists, such as distributed rate limiting, measured hot-cache need, locking or ephemeral coordination.

`CACHE != BUSINESS_SOURCE_OF_TRUTH`

## Observability

Logs, metrics and traces are evidence/diagnostic surfaces, not state or authorization authorities.

- `LOGGED != AUDITED`
- `METRIC != BUSINESS_TRUTH`
- `TRACE != AUTHORIZATION`

Sensitive values, raw OTPs, credentials and unnecessary PII must not enter observability.
