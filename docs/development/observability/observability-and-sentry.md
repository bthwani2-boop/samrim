# Observability, Debugging and Sentry

DOCUMENT_CLASS: HUMAN_DEVELOPMENT_GUIDE
EXECUTION_AUTHORITY: NONE
PRODUCT_SEMANTIC_AUTHORITY: NONE
CURRENT_IMPLEMENTATION_AUTHORITY: NONE

## Observability semantics

Logs, metrics and traces are diagnostic/evidence surfaces only.

```text
LOGGED != AUDITED
METRIC != BUSINESS_TRUTH
TRACE != AUTHORIZATION
SENTRY != PRODUCT/IDENTITY/FINANCE/AUDIT AUTHORITY
```

Material operations should expose applicable correlation/request/actor/scope/operation/idempotency identity, canonical error code, provider provenance and retry/reconciliation signals.

Never emit secrets, raw OTPs, credentials, auth headers, payment instruments or unnecessary PII.

## Debugging order

1. reproduce exact current candidate;
2. identify canonical owner;
3. inspect correlation/error code;
4. inspect owner readback;
5. inspect service/provider provenance;
6. distinguish rejected/failed/pending/unknown;
7. fix the root rather than adding UI/runtime compensation.

Focused tracing infrastructure is on-demand, not mandatory daily runtime.

## Sentry activation

Sentry is a technical observability provider only. Resolve the current app/project mapping from executable Expo/EAS configuration.

Typical configuration classes include client-visible DSN, build-only source-map secret, organization/project IDs, environment/release identity and bounded tracing/sample rate. Secrets are never committed.

Before production delivery:

1. use an immutable clean candidate;
2. confirm Expo/Metro integration in resolved configuration;
3. build an internal/preview candidate and emit a controlled test exception;
4. verify symbolicated JS/native frames and environment/release mapping;
5. inspect payload for forbidden fields;
6. verify source-map handling for the active EAS build/update flow.

Sentry events must not contain tokens/cookies, personal contact/identity data, precise location history, message bodies, wallet balances, ledger payloads, payment credentials or unmasked financial references.

Optional missing client DSN may disable delivery if the app contract allows it. Missing required build-time source-map credentials should fail release preflight rather than silently ship unusable telemetry.
