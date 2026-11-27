# Identity client — public transport boundary

The private workspace package `@bthwani/identity` exposes [index.ts](index.ts).
Identity Go/PostgreSQL owns actor, role, session and permission decisions;
the client transports and validates owner replies. DSH owns Store grants,
and WLT owns financial authority. See the [owner guide](../README.md) and
[OpenAPI entrypoint](../contracts/openapi/identity.openapi.yaml).

## Modules and responsibilities

| Module | Responsibility |
| --- | --- |
| `phone-challenge.ts` | Canonical Yemeni mobile input and owner challenge/verification |
| `sessions.ts` | Current verified session read and revocation |
| `persistent-sessions.ts` | Family establishment, rotation, revocation and verified credential handoff |
| `role-admission.ts` | Customer-bound Merchant/Captain admission and re-entry |
| `operator-permissions.ts` | Original Operator permission read and versioned command |
| `transport.ts` | Credential/origin admission, request deadline, bounded stream and stable error classification |
| `types.ts` | Shared public DTOs |
| `generated/identity-operations.ts` | Contract-derived method/path metadata |

## One bounded owner transport

All public SDK HTTP operations use the same transport. It rejects unsafe
origins and malformed credentials, omits cookies, rejects redirects and
requires `Cache-Control: no-store` for accepted responses. HTTPS is required
except for explicit local HTTP hosts localhost, 127.0.0.1 and 10.0.2.2.

The entire request (including headers and body) has a 10-second maximum;
current-session read, persistent enrollment and family revocation use five
seconds. Rejected persistent handoff cleanup has two seconds. JSON bodies
also have a five-second read cap and a 16,384-byte limit; a bridge without
a readable stream is not admitted. A late response after cancellation or
deadline is discarded, never read back into another account. An owner
deadline is an outage for reads, not a caller account switch; any interrupted
mutation has an unknown result and is not automatically retried. A caller
cancellation is linked to the request without aborting the caller itself.

## Credential and command lifecycle

Role admission and re-entry use the canonical owner endpoints; a rendered
screen cannot create standing or a Store grant. An uncertain versioned
permission command is recovered with the same operation identity and payload.

`readPersistentIdentityRole` checks the current owner role, verifies an
unexpired receipt and principal before storage handoff, and quarantines the
previous refresh credential before dispatching rotation. An acknowledged
rotation is reconciled even when the view disappears; it cannot publish
into an abandoned view. The application owns serialized secure storage and
account switching. A rejected handoff remains rejected, with bounded
best-effort family revocation. Never automatically replay an unknown refresh
result. The owner HTTP budgets do not make a storage callback cancellable.

## Verification and contract maintenance

From the repository root:

```sh
node --test services/identity/clients/identity-client.test.mjs
pnpm --filter @bthwani/identity typecheck
node tools/dev/generate-openapi-operations.mjs --check identity
pnpm check:contracts
```

Regenerate with `node tools/dev/generate-openapi-operations.mjs identity`
only after an authorized contract change. Never hand-edit generated metadata.
Transport tests use synthetic responses; they do not prove real phone/Passkey
login, persisted device state, deployed owner ACLs or production readiness.
Actual owner HTTP, durable PostgreSQL and affected Web/Android evidence belong
to the existing owner and journey acceptance workflow.
