# Identity client — public transport boundary

The private workspace package @bthwani/identity exposes [index.ts](index.ts) to its consumers. Identity Go/PostgreSQL owns session and permission decisions; this package transports requests and validates responses. DSH Store grants and WLT financial authority remain with their owners. See the [owner guide](../README.md) and [OpenAPI entrypoint](../contracts/openapi/identity.openapi.yaml).

## Public operations

| Module | Public functions |
| --- | --- |
| phone-challenge.ts | issueCustomerPhoneChallenge, verifyCustomerPhoneChallenge, normalizeYemeniMobile, parseCustomerPhoneChallenge |
| sessions.ts | readVerifiedIdentitySession, revokeVerifiedIdentitySession |
| persistent-sessions.ts | establishPersistentIdentitySession, rotatePersistentIdentitySession, revokePersistentIdentitySession, readPersistentIdentityRole |
| role-admission.ts | admitCurrentCustomerAsMerchant, resumeCurrentCustomerMerchantSession, admitCurrentCustomerAsCaptain, resumeCurrentCustomerCaptainSession |
| operator-permissions.ts | reviewOriginalOperatorPermissions, changeOriginalOperatorPermission, isOperatorActorId |
| transport.ts / types.ts | IdentityClientError, parseVerifiedIdentitySession, identityOperatorPermissions and exported types |

The generated [operation manifest](generated/identity-operations.ts) supplies the method/path definitions used by the transports. After an authorized OpenAPI change, regenerate with node tools/dev/generate-openapi-operations.mjs identity and verify with pnpm check:contracts. Do not hand-edit the manifest. Operation parity is not runtime schema equivalence. Operator WebAuthn ceremonies use the existing Operator server transport rather than another Identity engine.

## Credential lifecycle

transport.ts owns endpoint, credential, response and error validation. It rejects malformed opaque credentials and unsafe origins: HTTPS is required except for explicit local development HTTP hosts localhost, 127.0.0.1 and Android emulator 10.0.2.2. The transport checks response shape, expiry, caching and size; denial, unavailable owner, invalid response and unknown operation result remain distinct.

An uncertain versioned permission mutation is recovered using the same command identity and payload. Role admission and re-entry use the canonical owner endpoints; rendering a screen cannot create standing, a Store grant or a role. Do not infer a role from an interrupted response.

readPersistentIdentityRole verifies the actual owner role, uses a current credential or rotates through Identity as appropriate, quarantines the previous refresh credential before dispatch and completes the bounded credential handoff. The caller owns serialized secure device storage and account switching. A stale handoff cannot overwrite another account; the client attempts revocation when the handoff is rejected. Do not automatically replay an unknown refresh result.

## Verification

Run node --test services/identity/clients/identity-client.test.mjs from the repository root and the package's pinned TypeScript check. These owner-local transport tests include synthetic responses; they do not prove real phone/Passkey login, a deployed owner, persisted device state, DSH Store authorization or production readiness. Actual owner HTTP, durable PostgreSQL and affected Web/Android proof belong to the existing acceptance workflow.
