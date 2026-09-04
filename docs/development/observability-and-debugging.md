# Observability and Debugging

DOCUMENT_CLASS: HUMAN_DEVELOPMENT_GUIDE
PRODUCT_AUTHORITY: NONE

## Observability semantics

Logs, metrics and traces are diagnostic/evidence surfaces.

- LOGGED != AUDITED
- METRIC != BUSINESS_TRUTH
- TRACE != AUTHORIZATION

## Correlation

Material operations should expose applicable correlation/request/actor/operator-context/operation/idempotency identity, canonical error code, state/audit event, provider provenance and retry/reconciliation signals.

## Redaction

Never emit secrets, raw OTPs, credentials, payment instruments or unnecessary PII to ordinary logs/traces.

## Debugging order

1. reproduce against exact current candidate;
2. identify canonical owner;
3. inspect correlation/error code;
4. inspect owner readback;
5. inspect cross-service/provider provenance;
6. distinguish rejected, failed, pending and unknown;
7. fix the root rather than adding UI/runtime compensation.

Use focused tracing infrastructure on demand for distributed-flow diagnosis; it is not mandatory daily runtime.
