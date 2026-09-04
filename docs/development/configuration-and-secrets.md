# Configuration and Secrets

DOCUMENT_CLASS: HUMAN_DEVELOPMENT_GUIDE
PRODUCT_AUTHORITY: NONE
CURRENT_VALUE_AUTHORITY: EXECUTABLE_CONFIG

## Configuration classes

Keep separate:

- build/deployable configuration;
- runtime environment configuration;
- platform-governed variables/flags;
- secret references/values;
- user/business state.

## Secrets

Secret values do not belong in Git, client bundles, generic database rows, logs/traces, general audit payloads or public configuration.

Mobile/web public environment variables contain only public-client-safe values.

## Platform variables

Platform-governed variables require server-side type/schema validation, version, audit/reason, rollout and readback. A flag cannot bypass domain authorization/invariants.

## Development

Use repository examples/schemas to discover required keys; do not turn a copied local `.env` into documentation authority.

Development credentials do not define normal Identity security policy.

## Rotation/failure

Credential rotation must account for producer/consumer overlap, invalidation and external provider behavior. Missing secret/configuration should fail safely rather than silently selecting an insecure fallback.
