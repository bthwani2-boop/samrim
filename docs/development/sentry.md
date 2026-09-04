# Mobile Sentry Activation Runbook

DOCUMENT_CLASS: HUMAN_DEVELOPMENT_GUIDE
PRODUCT_AUTHORITY: NONE
CURRENT_IMPLEMENTATION_AUTHORITY: NONE

Status: OPERATIONAL_RUNBOOK
Owner: Mobile observability operations

Sentry is a technical observability provider only. It is not an identity, trusted-context, finance, analytics or audit source of truth.

## Scope

Covers Sentry activation for the current mobile applications registered by the repository. Verify the app list and Expo/EAS project mapping on the candidate commit rather than treating a historical list as permanent.

## Required configuration

Use the current mobile runtime/build contract. Typical classes of configuration are:

- client-visible DSN;
- build-only source-map authentication secret;
- organization/project identifiers;
- application environment/release identity;
- bounded tracing/sample-rate configuration.

Each application should use the project identity and secret scope defined by the active observability/release configuration. Secrets must never be committed.

## Privacy boundary

Sentry events must not contain access/refresh/activation/service/provider tokens, cookies/authorization headers, raw client-asserted trusted context, personal contact/identity data, precise location history, message bodies, wallet balances, ledger payloads, payment credentials or unmasked financial references.

Stable opaque correlation IDs and application surface identifiers may be used when allowed by current privacy policy. Any context-aware diagnosis should rely on trusted/redacted telemetry rather than a client-supplied ownership identifier.

## Release verification

Before enabling production delivery:

1. Use an immutable clean candidate commit.
2. Confirm the Sentry Expo/Metro integration is present in resolved configuration.
3. Build an internal/preview candidate and emit a controlled test exception.
4. Verify symbolicated JavaScript/native frames and correct environment/release mapping.
5. Inspect the event payload for forbidden fields.
6. Verify source-map handling for the active EAS build/update flow before production activation.

## Failure policy

Missing optional client DSN may disable event delivery if the active app contract permits that behavior. Missing required build-time source-map credentials should fail the release preflight rather than silently ship an unsymbolicated production candidate. Observability success does not prove application/runtime correctness or production acceptance.
