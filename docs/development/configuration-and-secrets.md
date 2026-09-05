# Configuration and Secrets

DOCUMENT_CLASS: HUMAN_DEVELOPMENT_GUIDE
EXECUTION_AUTHORITY: NONE
PRODUCT_SEMANTIC_AUTHORITY: NONE
CURRENT_IMPLEMENTATION_AUTHORITY: NONE

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

## Identity development credentials

Identity internal service identity is derived server-side from the configured bearer credential:

- `IDENTITY_DSH_SERVICE_TOKEN` → DSH principal;
- `IDENTITY_PLATFORM_CONTROL_SERVICE_TOKEN` → Platform Control principal.

Do not add caller-supplied trust headers or a generic Identity tenant/scope setting to compensate for missing business authorization modeling. The two service tokens must be distinct and satisfy runtime validation.

`IDENTITY_CHALLENGE_HMAC_SECRET` protects purpose-bound verification/challenge-code derivation and is never a client value. `IDENTITY_CHALLENGE_DELIVERY_MODE` selects the configured development/runtime delivery adapter; delivery is not challenge-state authority. Development examples are local-only placeholders, not production secrets.
