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

A service owns stable business/system semantics and its durable data. Do not split one capability by actor surface or create a service for a vendor/mechanism name.

## Cross-service calls

Cross-service dependency uses explicit contract/event/client boundaries. Never import another service's private internals or database.

For material cross-service facts prove owner, writer, source API/event, mutability, persistence, authoritative/derived status, rebuildability, consistency/retry model, consumers and readback.

## Mutations

Material mutations define trusted context, preconditions, allowed/forbidden state, transaction boundary, idempotency, concurrency, timeout/retry, partial failure, compensation/reversal and canonical readback.

## External effects

Preserve external operation identity/provenance. Timeout is not proof of failure; do not blind-fallback an ambiguous mutation.
