# Runtime, Configuration, Reliability, Observability, and Recovery Policy

ARTIFACT_CLASS: DURABLE_RUNTIME_RELIABILITY_POLICY
SEMANTIC_OWNER: governance/policies/runtime-reliability.md
EXECUTION_AUTHORITY: NONE
CLOSURE_AUTHORITY: NONE
IMPLEMENTATION_STATE_AUTHORITY: NONE

## Runtime truth

A runtime claim requires evidence from the intended candidate/artifact/process/schema/configuration/profile/endpoint and readback sufficient to exclude stale execution. A configured endpoint, `enabled=true`, green build or container start is not proof that the governed dependency/journey works.

## Configuration ownership

Distinguish canonical configuration schema/meaning from environment-scoped values. Each material setting has one owner, type/validation, requiredness, security classification and failure behavior.

Required invalid/missing security-, finance- or correctness-critical configuration fails closed. Local/staging/production may differ in endpoints, credentials, scale and provider accounts, but must not silently redefine core Product/authorization/financial/state-machine semantics.

No hidden localhost/dev/legacy fallback may activate in production. Secrets never live in client-visible config, source or logs.

## Startup, health, and readiness

Startup validates required configuration and critical dependency assumptions at the earliest safe boundary. Health/readiness signals must represent what their consumers believe they mean; do not report ready/healthy while a required dependency/path is known unusable.

Distinguish liveness, readiness, dependency/provider health and business-journey health instead of collapsing them into one fake-green signal.

## Providers and external systems

Each integration defines canonical owner, authentication/service identity, request/response contract, timeout, retry/idempotency, rate/quota handling, error normalization, unknown-result behavior, observability, reconciliation/recovery and secret boundary.

Provider-specific payloads terminate at their adapter/boundary. Provider identity must not leak throughout business logic or decide internal financial/domain authority.

An ambiguous external mutation result is reconciled before another route/provider may move the same governed effect again.

## Timeouts, retries, backpressure, and failure

Retries must be bounded, idempotency-aware and consistent with the operation's semantics. Define timeout/retry budgets, cancellation and backoff only where material; do not layer retries at multiple levels without understanding amplification.

For queues/jobs/events/providers, address duplicate delivery, ordering where required, poison/failure handling, restart/replay, backpressure and observable stuck work. `event published` is not proof of consumed business outcome when readback/handoff is required.

## Observability

Material failure modes require the smallest telemetry that lets a real consumer detect/diagnose/recover: truthful health/readiness, structured logs, metrics, traces/correlation, queue/job/reconciliation signals and release identity as applicable.

Telemetry requires a decision/operational consumer; instrumentation without purpose is not quality. Evidence/logging must minimize secrets and sensitive/PII payloads.

## Performance and capacity

For material hot paths/bounded resources inspect latency, throughput/capacity, error behavior, CPU/memory, pools/connections, queues/caches, query plans/N+1, payload/pagination, provider quotas and contention. Optimize measured/proven roots, not speculative micro-optimizations.

Do not invent SLO/SLI thresholds. If safe operation requires a performance/reliability contract and none exists, that absence is a governance/operations decision gap.

## Recovery, restart, and disaster resilience

When material prove behavior across process restart, partial failure, dependency outage, migration/backfill interruption and external unknown results. Durable state requires an applicable restore/rebuild/reconciliation path; backup existence alone does not prove recoverability.

Rollback and forward recovery are distinct, especially with data/schema changes and public mobile clients. Recovery must preserve canonical ownership and must not re-enable obsolete/shadow writers.

## Clean-state reproducibility

The system must be reproducible from canonical source plus declared toolchain/dependencies/configuration/generation/migrations, without undocumented machine edits, hidden packages, manually patched databases or stale local artifacts. Local conveniences remain explicitly local.

## Closure

Runtime/reliability closure requires truthful startup/readiness, validated config ownership, bounded provider/failure semantics, required observability, recovered/reconcilable failure paths, no hidden fallback/shadow runtime authority and same-candidate evidence for the claims made.


## Development-environment invariants

Daily development may use a hybrid local/managed runtime when it preserves the same semantic contracts. Active code remains local when that gives the fastest feedback; managed stateful services are implementation choices, not domain authorities.

```text
DEV_DATABASE_ENGINE = POSTGRESQL/POSTGIS
DEVELOPMENT_PROVIDER MAY DIFFER FROM PRODUCTION_PROVIDER
MANAGED_DEV_SERVICE != DOMAIN_AUTHORITY
SYNTHETIC/TEST_DATA_ONLY_IN_EXTERNAL_DEV_SERVICES
DECLARED_LOCAL/FULL_RUNTIME MUST REMAIN A REPRODUCIBLE INTEGRATION PATH
MOCK/SIMULATOR MUST NOT BYPASS REAL AUTHORIZATION/STATE/ACCOUNTING
```

Provider-specific domain models are forbidden when the stable semantic contract is provider-neutral. Heavy local infrastructure runs on demand unless a real task requires it. Production residency/provider selection is a separate approved policy decision; development convenience does not define it.


## Cache, coordination and external-provider operating law

Redis/Valkey or equivalent coordination infrastructure is disabled by default unless a real requirement is proven, such as distributed rate limiting, measured hot-cache need, distributed locking or ephemeral coordination.

```text
CACHE != BUSINESS_SOURCE_OF_TRUTH
COORDINATION_STORE != DOMAIN_AUTHORITY
```

Development may use managed stateful services while active code remains local when that produces the fastest loop, provided the same semantic contracts and reproducible integration path remain valid.

Mocks/simulators may emulate external success, pending, rejection, timeout, delayed result, duplicate callback/reference, invalid signature, provider unavailable, unknown result and reconciliation mismatch. They must never bypass BThwani authorization, accounting, state machines, challenge lifecycle or idempotency.

Unknown external mutations remain unknown/reconcilable until authoritative evidence resolves them. Blind fallback/retry across providers is forbidden when duplicate effect is possible.
