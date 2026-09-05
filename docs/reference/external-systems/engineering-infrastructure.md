# External References — Engineering and Infrastructure

DOCUMENT_CLASS: NON_AUTHORITATIVE_EXTERNAL_REFERENCE
EXECUTION_AUTHORITY: NONE
PRODUCT_AUTHORITY: NONE
CURRENT_REPOSITORY_STATE_AUTHORITY: NONE
ADOPTION_AUTHORITY: NONE
REFERENCE_FRESHNESS: REVALIDATE_MATERIAL_FACTS_AT_USE
LICENSE_RECHECK_ON_ADOPTION: REQUIRED
SECURITY_SUPPLY_CHAIN_RECHECK_ON_ADOPTION: REQUIRED


### 1B.11 Durable workflows / sagas / long-running orchestration

**P1 — Temporal**
- Repository: https://github.com/temporalio/temporal
- Docs: https://docs.temporal.io/
- Use for durable execution, retries, timers, compensations and crash recovery.

**P2 — Restate**
- Repository: https://github.com/restatedev/restate
- Docs: https://docs.restate.dev/
- Use for durable functions/objects and idempotent execution.

**P3 — Cadence**
- Repository: https://github.com/uber/cadence
- Docs: https://cadenceworkflow.io/docs/
- Use for a mature alternative workflow model.

**P4 — Inngest**
- Docs: https://www.inngest.com/docs
- Use only as a developer-experience/event-driven counterexample.

Do not add a workflow engine merely because a saga/outbox exists; first prove native mechanisms are insufficient.

### 1B.12 Observability / errors / metrics / traces / logs

**P1 — OpenTelemetry**
- GitHub: https://github.com/open-telemetry
- Docs: https://opentelemetry.io/docs/
- Use for telemetry conventions, traces/metrics/logs and context propagation.

**P2 — Sentry**
- Docs: https://docs.sentry.io/
- GitHub: https://github.com/getsentry
- Use for application errors, releases and mobile/web tracing.

**P3 — Grafana stack**
- Docs: https://grafana.com/docs/
- Use for dashboards, logs, traces, metrics and operational composition.

**P4 — Prometheus**
- Repository: https://github.com/prometheus/prometheus
- Docs: https://prometheus.io/docs/
- Use for metrics, labels and alerting semantics.

**P5 — Datadog**
- Docs: https://docs.datadoghq.com/
- Use only as an enterprise operability counterexample.

### 1B.19 Object storage / media

**P1 — Amazon S3 semantics**
- Docs: https://docs.aws.amazon.com/s3/
- Use for object semantics, presigned access, lifecycle, metadata and multipart upload.

**P2 — Cloudflare R2**
- Docs: https://developers.cloudflare.com/r2/
- Use because BThwani development may use R2 and it is S3-compatible.

**P3 — MinIO**
- Repository: https://github.com/minio/minio
- Docs: https://min.io/docs/
- Use for local/self-hosted S3-compatible conformance.

Domain code depends on ObjectStorage semantics, not an S3/R2/MinIO business authority.

### 1B.21 API contracts / generation / compatibility

**P1 — OpenAPI Specification**
- Spec: https://spec.openapis.org/oas/latest.html
- Use for canonical HTTP API contract semantics.

**P2 — oapi-codegen**
- Repository: https://github.com/oapi-codegen/oapi-codegen
- Use if BThwani needs one Go OpenAPI generation lineage.

**P3 — Redocly**
- Docs: https://redocly.com/docs/
- Use for OpenAPI lint/bundle/governance concepts.

**P4 — Pact**
- GitHub: https://github.com/pact-foundation
- Docs: https://docs.pact.io/
- Use for consumer/provider contract testing concepts.

**P5 — Schemathesis**
- Repository: https://github.com/schemathesis/schemathesis
- Docs: https://schemathesis.readthedocs.io/
- Use for property/fuzz-style OpenAPI testing when applicable.

### 1B.22 Integration testing / failure injection / real infrastructure proof

**P1 — Testcontainers-Go**
- Repository: https://github.com/testcontainers/testcontainers-go
- Use for real PostgreSQL/Redis/service dependencies in deterministic integration tests.

**P2 — WireMock**
- Repository: https://github.com/wiremock/wiremock
- Docs: https://wiremock.org/docs/
- Use for provider simulators, timeout/duplicate/unknown-result behavior and API conformance.

**P3 — Toxiproxy**
- Repository: https://github.com/Shopify/toxiproxy
- Use for latency, disconnect, timeout and network-failure simulation.

**P4 — Pact**
- Docs: https://docs.pact.io/
- Use when consumer/provider compatibility is the unresolved risk.

**P5 — k6**
- Repository: https://github.com/grafana/k6
- Docs: https://grafana.com/docs/k6/
- Use for load/performance only when performance becomes a proven closure criterion.

---

## 9. Go/PostgreSQL engineering candidates

These candidates are not part of the stack merely because they are good projects.

### Testcontainers-Go
Repository: https://github.com/testcontainers/testcontainers-go
Typical license class: MIT
Primary mode: `SMALL_COMPONENT_CANDIDATE`

High-value use:

```text
REAL_POSTGRESQL
→ RUN_MIGRATIONS
→ START_SERVICE
→ WRITE
→ READ_BACK
→ ASSERT_EVENT/FINANCIAL_EFFECT
→ DESTROY_ENVIRONMENT
```

Strong candidate when real-database integration verification is required.

### sqlc
Repository: https://github.com/sqlc-dev/sqlc
Typical license class: MIT
Primary mode: `SMALL_COMPONENT_CANDIDATE`

Use only if the current data-access/root refoundation proves that generated type-safe SQL access removes material hand-written duplication or drift.

Do not introduce it as cosmetic modernization.

### pgx
Repository: https://github.com/jackc/pgx
Typical license class: MIT
Primary mode: `SMALL_COMPONENT_CANDIDATE`

BThwani currently uses PostgreSQL and existing Go database access must not be migrated to pgx as an unrelated side project.

Adopt only if the DB access layer is already the proven root and the migration removes a material defect.

### oapi-codegen
Repository: https://github.com/oapi-codegen/oapi-codegen
Typical license class: Apache-2.0
Primary mode: `SMALL_COMPONENT_CANDIDATE`

Strong candidate if it helps achieve:

```text
ONE_CANONICAL_OPENAPI_SOURCE
→ ONE_REPRODUCIBLE_COMPOSER
→ ONE_GENERATOR_LINEAGE
→ NO_MANUAL_DTO/ENUM/OPERATION_MIRRORS
```

Do not introduce a second generator alongside another surviving generator lineage.

### Watermill
Repository: https://github.com/ThreeDotsLabs/watermill
Typical license class: MIT
Primary mode: `SMALL_COMPONENT_CANDIDATE`

Use only if event/outbox/messaging refoundation proves a genuine need.

Do not add an event framework merely for architectural sophistication.

### River
Repository: https://github.com/riverqueue/river
Typical license class: MPL-2.0
Primary mode: `REFERENCE_ONLY / CONDITIONAL_COMPONENT_CANDIDATE`

Free does not mean zero licensing consideration. Prefer simpler licensing when two technically adequate choices exist.

### OpenTelemetry-Go
Repository: https://github.com/open-telemetry/opentelemetry-go
Primary mode: `SMALL_COMPONENT_CANDIDATE`

Use for observability only when the runtime/observability root requires it. Observability must not become business authority.

### Casbin
Repository: https://github.com/casbin/casbin
Primary mode: `REFERENCE_ONLY / CONDITIONAL_COMPONENT_CANDIDATE`

Use only if authorization architecture proves a need. Identity/security remains canonical authority for BThwani permission semantics.

---
