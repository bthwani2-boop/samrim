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

## Infra and runtime ownership

`infra/` owns environment/deployment composition and shared environment-level infrastructure wiring. It does not own service business logic, service schema/migrations, app runtime configuration contracts, provider business semantics or financial test behavior.

~~~text
INFRA BINDS/COMPOSES VALUES
OWNER DEFINES VALUE SEMANTICS
~~~

App runtime input schema/example configuration belongs with the app when it defines app behavior. Service configuration schema/validation belongs with the service. Infra may supply environment-specific bindings but cannot redefine those contracts.

Local infrastructure may provision server instances/databases/users/extensions required for development, while the owning service retains private schema/migration authority.

Service-specific provider simulators/fixtures follow the owning service testing lifecycle; Infra may compose them into an environment but does not own their business/failure semantics.

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
