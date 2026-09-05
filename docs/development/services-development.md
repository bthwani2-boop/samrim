# Service Development

DOCUMENT_CLASS: HUMAN_DEVELOPMENT_GUIDE
PRODUCT_AUTHORITY: NONE

## Start from ownership

Before creating/changing a service capability:

1. locate the durable capability/journey;
2. identify canonical owner/writer;
3. identify persisted facts and invariants;
4. define legal commands/state transitions;
5. define executable contract/event;
6. define readback;
7. identify all consumers/surfaces;
8. identify failure/recovery/idempotency/concurrency requirements.

## Service boundary

A service owns stable business/system semantics, its durable data, canonical public contract and generated/public client lineage. Do not split one capability by actor surface or create a service for a vendor/mechanism name.

Surface-specific feature UI remains in the consuming app. Do not add `services/<service>/frontend/app-*` or equivalent app-shaped presentation ownership merely because the service owns the underlying truth.

Before a service is called journey-ready, its technical chassis must have real config validation, health/readiness, graceful shutdown, request/correlation/error conventions as actually adopted, and its private data/contract/migration lanes must be executable where required. Do not build a generic internal service framework solely to centralize these few conventions.

## Cross-service calls

Cross-service dependency uses explicit contract/event/client boundaries. Never import another service's private internals or database.

For material cross-service facts prove owner, writer, source API/event, mutability, persistence, authoritative/derived status, rebuildability, consistency/retry model, consumers and readback.

## Mutations

Material mutations define trusted context, preconditions, allowed/forbidden state, transaction boundary, idempotency, concurrency, timeout/retry, partial failure, compensation/reversal and canonical readback.

## External effects

Preserve external operation identity/provenance. Timeout is not proof of failure; do not blind-fallback an ambiguous mutation.


## Internal responsibility shape

Use responsibility-driven internals rather than preserving donor folders or forcing one universal framework. A common shape is:

~~~text
backend/
  cmd/<process>/          process startup/composition only
  internal/
    <capability>/         domain/application policy
    transport/http/       decode/trusted-context/validate/call/encode
    integrations/         cross-service/provider adapters
    runtime/              process/runtime technical composition
~~~

Adapt physical folders when cohesion proves a better shape, but preserve these boundaries:

- process entrypoints do not become business mega-modules;
- HTTP transport does not own SQL, state machines, permission truth or financial policy;
- repositories/persistence stay behind the owning capability/data boundary;
- integrations translate to semantic service/provider contracts;
- one mechanism name such as saga, outbox, worker, cache, retry, handler or controller does not become a top-level Product domain by itself;
- large mixed files are split by real responsibility, not arbitrary line count.

One service may contain several cohesive capabilities while still owning one public contract/migration/runtime lineage where that is the true deployment/data boundary.
