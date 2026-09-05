# Service, Contract and Data Development

DOCUMENT_CLASS: HUMAN_DEVELOPMENT_GUIDE
EXECUTION_AUTHORITY: NONE
PRODUCT_SEMANTIC_AUTHORITY: NONE
CURRENT_IMPLEMENTATION_AUTHORITY: NONE

## Service boundary

Before changing a service capability, resolve its durable capability/journey, canonical owner/writer, durable facts/invariants, legal commands/transitions, public contract/event, canonical readback, affected consumers and failure/idempotency/concurrency requirements.

A service owns stable business/system semantics, its durable data, public contract and generated/public client lineage. Do not split one capability by actor surface or create a service for a vendor/mechanism name.

Surface-specific UI remains in the consuming app. Do not recreate `services/<service>/frontend/app-*`.

## Internal responsibility shape

A common responsibility-oriented shape is:

```text
backend/
  cmd/<process>/          process startup/composition
  internal/
    <capability>/         domain/application policy
    transport/http/       decode/trusted-context/validate/call/encode
    integrations/         cross-service/provider adapters
    runtime/              process/runtime composition
```

Do not let process entrypoints, transports, repositories or mechanism names become business mega-modules. Split large files by real responsibility.

## Cross-service and mutation behavior

Cross-service dependency uses explicit contract/event/client boundaries; never import another service's private internals/database.

Material mutations account for trusted context, preconditions, allowed/forbidden state, transaction boundary, idempotency, concurrency, timeout/retry, partial failure, compensation/reversal and canonical readback.

Preserve external operation identity/provenance. Timeout is not proof of failure and must not trigger blind fallback for an ambiguous mutation.

## Contract ownership and generation

Each service owns executable API/event schemas for its public semantics. Do not hand-maintain duplicate DTO/enum/status/action/operation registries when they can derive from canonical source.

For a material contract change:

1. update canonical owner source;
2. validate schema/references;
3. generate deterministic outputs;
4. update consumers;
5. test only deployable version-skew combinations;
6. remove obsolete manual/generated mirrors;
7. verify runtime/readback.

Root `contracts/` is reserved for genuinely cross-service protocol primitives/catalog material, not a business API dump. Generated artifacts are reproducible outputs, never independent authorities.

Use standards-compatible deterministic tooling such as ordinary OpenAPI generation when it faithfully represents the contract; exact installed tooling/commands come from executable manifests/scripts.

## Database and migration lane

Database schema expresses service-owned durable facts; schema alone does not define domain ownership.

Before a persistence-owning service can claim the currently required persistence path is operational:

- its database identity/credentials and private storage boundary are real;
- local development may share one PostgreSQL server only through separate logical ownership boundaries;
- readiness proves required database dependency;
- cross-service private database access is rejected;
- migration tooling is executable before the first business migration;
- no fake baseline business tables/migrations are added merely to manufacture readiness.

Use one canonical migration history per service/database. Applied migrations are immutable unless the explicitly adopted migration mechanism defines another governed model. Production migration is an explicit deployment/predeploy operation rather than arbitrary API-startup mutation.

## Ownership changes, backfills and reconciliation

When durable data changes owner/shape:

```text
PROVE REQUIRED TRUTH/HISTORY
→ DEFINE DETERMINISTIC TRANSFORM
→ MIGRATE/BACKFILL
→ VERIFY COUNTS/KEYS/CONSTRAINTS/INVARIANTS
→ CUT OVER WRITER
→ CUT OVER READERS
→ RECONCILE
→ REMOVE OLD STORAGE AUTHORITY
→ PROVE CANONICAL READBACK
```

Backfills must be versioned/repeatable/observable where material. Seeds are test/development inputs, not alternate business truth. WLT data changes require heightened scrutiny for ledger balance, idempotency, concurrency, reconciliation, reversals/refunds and historical auditability.
