# Runtime Profiles and Development Integrations

DOCUMENT_CLASS: HUMAN_DEVELOPMENT_GUIDE
PRODUCT_AUTHORITY: NONE
CURRENT_COMMAND_AUTHORITY: live repository scripts/configuration

## Runtime profiles

### DAILY_DEV

Use the smallest active app/service set and the least infrastructure required for the change. Prefer managed or lightweight development dependencies when repository configuration selects them. Do not start full Docker/integration infrastructure merely because it exists.

### FOCUSED_INTEGRATION

Run the exact cross-service/provider/database dependencies required by the capability under test. Preserve real authorization, state transitions, idempotency and readback even when external providers are simulated.

### FULL_INTEGRATION

Use repository-owned orchestration to prove migrations, readiness, service-to-service contracts, runtime binding, representative multi-surface journeys and failure/recovery behavior. Full integration is an evidence level, not the default daily workflow.

## Stateful development dependencies

- PostgreSQL/PostGIS owns development durable relational state according to service boundaries.
- Object storage is an adapter behind owner-domain media/reference semantics; MinIO or a managed test service may implement it.
- Redis/Valkey is optional cache/coordination infrastructure and must not become Product truth.
- Docker remains a reproducible integration path even when daily development uses lighter managed services.

## Messaging and authentication delivery

OTP/challenge lifecycle belongs to Identity. SMS/email/push are delivery channels, not authentication truth. Daily development should prefer deterministic low-cost sinks/simulators unless real channel behavior is the point of the test.

Never place privileged credentials in client-visible environment variables. TOTP/passkey/WebAuthn or stronger operator factors remain separate authentication capabilities when implemented.

## Financial and biller development

External financial rails and biller/recharge providers must be exercised through deterministic simulators for success, rejection, pending, timeout, duplicate callback/reference, invalid signature, delayed result, unknown outcome, reconciliation mismatch and reversal where applicable.

A simulator may replace the external rail but must not bypass WLT authorization, accounting, idempotency, reconciliation or canonical readback.

## Maps, media and observability

Maps/geocoding/routing providers remain replaceable adapters behind DSH semantics. Media/object storage remains behind owner-domain authorization. Observability may use Sentry/OpenTelemetry-compatible tooling but logs/traces never become canonical business truth.

## Development environment laws

```text
ACTIVE CODE MAY RUN LOCALLY
STATEFUL DEV SERVICES MAY BE LOCAL OR MANAGED WHEN CONFIGURED
DEVELOPMENT PROVIDER MAY DIFFER FROM PRODUCTION
PROVIDER NAME MUST NOT DEFINE DOMAIN MODEL
PRODUCTION DATA IN GENERAL DEV ENVIRONMENTS = FORBIDDEN
DOCKER INTEGRATION PATH MUST REMAIN REPRODUCIBLE
FAKE SUCCESS THAT BYPASSES REAL OWNER STATE MACHINE = FORBIDDEN
```

## Practical selection

Use DAILY_DEV for ordinary UI/API work, FOCUSED_INTEGRATION for a capability crossing service/provider/data boundaries, and FULL_INTEGRATION for closure, migration, runtime or representative end-to-end proof. Exact commands/ports/providers are always read from live repository configuration.
