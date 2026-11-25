# Identity client — verified-session and Merchant admission transport

STATUS: IMPLEMENTATION_IN_PROGRESS

The owner-derived `clients/generated/identity-operations.ts` supplies typed operation method/path constants used by the active session and admission transports. `pnpm check:contracts` regenerates no source; it refuses any stale or manually edited manifest. To update this file after reviewing a canonical OpenAPI change, run `node tools/dev/generate-openapi-operations.mjs identity`. This is operation-index parity only, not generated request/response schema or live Go runtime equivalence.

The `@bthwani/identity` workspace package exports these HTTP operations from `clients/index.ts`:
- `issueCustomerPhoneChallenge` and `verifyCustomerPhoneChallenge`: request and consume isolated phone proof using the two `/v1/customer-auth` endpoints.
- `readVerifiedIdentitySession`: read only the actor, active Identity role and session expiry from `GET /v1/sessions/current`.
- `revokeVerifiedIdentitySession`: revoke the current credential through `DELETE /v1/sessions/current`.
- `reviewOriginalOperatorPermissions`: read an active Operator's assigned or revoked scope revisions through `GET /v1/operators/{actorId}/permissions`. Identity requires the current original Operator session.
- `changeOriginalOperatorPermission`: send a versioned grant or revocation with a reason and an operation ID to the existing Identity owner. After an uncertain result, resend the exact command to recover its receipt.
- `admitCurrentCustomerAsMerchant`: request initial Merchant role admission using an already verified Customer bearer from `POST /v1/actors/me/merchant-role`.
- `resumeCurrentCustomerMerchantSession`: request owner-side rotation of an already active Merchant role session through `POST /v1/actors/me/merchant-session`.

Session authority, revocation and mutation remain on Identity's Go/PostgreSQL owner. Protected operations require a current Identity bearer. Store authorization and financial execution belong to their respective owners. The underlying API contracts are `contracts/openapi/paths/customer-auth.yaml`, `contracts/openapi/paths/session.yaml` and `contracts/openapi/paths/managed-enrollment-auth.yaml`.

The transport refuses unsafe non-HTTPS endpoints outside explicit development loopback addresses, malformed opaque tokens, expired or wrong-shaped responses, unsafe response caching, oversized declared response bodies and unexpected owner statuses. Recovery is explicit. An uncertain versioned permission change is recoverable through its original operation ID and payload. Cancellation prevents a late result from being displayed as a current session.

**Development admission only:** The Node client has owner-local positive/negative tests in `./identity-client.test.mjs` and is TypeScript-checked. These tests include synthetic HTTP responses; they are not proof of first-factor login, a real app consumer, session persistence on a connected device, production activation or WLT financial access. Do not expose a protected workspace until real Identity and DSH scoped authorization is integrated and independently tested.

The service's Go backend, OpenAPI and SQL are owned under `backend/`, `contracts/openapi/` and `database/` respectively. This file describes only its client transport, not another identity session engine or decision source.

## Client module boundaries

`clients/index.ts` remains the stable public export boundary of `@bthwani/identity`. `types.ts` holds shared contracts; `transport.ts` exclusively handles request validation, HTTP exchange and owner-response errors. `phone-challenge.ts`, `sessions.ts`, `persistent-sessions.ts`, `role-admission.ts` and `operator-permissions.ts` each implement their named operations. All use the existing contract-derived `generated/identity-operations.ts`; no second Identity engine, permission writer or alternative session store is introduced. Native applications remain responsible for secure device storage and account-switch serialization.
