# Identity client — verified-session and Merchant admission transport

STATUS: IMPLEMENTATION_IN_PROGRESS

The `@bthwani/identity` workspace package exports these HTTP operations from `clients/index.ts`:
- `issueCustomerPhoneChallenge` and `verifyCustomerPhoneChallenge`: request and consume isolated phone proof using the two `/v1/customer-auth` endpoints.
- `readVerifiedIdentitySession`: read only the actor, active Identity role and session expiry from `GET /v1/sessions/current`.
- `revokeVerifiedIdentitySession`: revoke the current credential through `DELETE /v1/sessions/current`.
- `admitCurrentCustomerAsMerchant`: request initial Merchant role admission using an already verified Customer bearer from `POST /v1/actors/me/merchant-role`.
- `resumeCurrentCustomerMerchantSession`: request owner-side rotation of an already active Merchant role session through `POST /v1/actors/me/merchant-session`.

Session authority, revocation and mutation remain on Identity's Go/PostgreSQL owner. Protected operations require a current Identity bearer. Store authorization and financial execution belong to their respective owners. The underlying API contracts are `contracts/openapi/paths/client-auth.yaml`, `contracts/openapi/paths/session.yaml` and `contracts/openapi/paths/managed-enrollment-auth.yaml`.

The transport refuses unsafe non-HTTPS endpoints outside explicit development loopback addresses, malformed opaque tokens, expired or wrong-shaped responses, unsafe response caching, oversized declared response bodies and unexpected owner statuses. Write failures with unknown results are **not retried automatically**; the caller must verify owner state before retrying. Cancellation prevents a late result from being displayed as a current session.

**Development admission only:** The Node client has owner-local positive/negative tests in `../../tools/dev/identity-client.test.mjs` and is TypeScript-checked. These tests include synthetic HTTP responses; they are not proof of first-factor login, a real app consumer, session persistence on a connected device, production activation or WLT financial access. Do not expose a protected workspace until real Identity and DSH scoped authorization is integrated and independently tested.

The service's Go backend, OpenAPI and SQL are owned under `backend/`, `contracts/openapi/` and `database/` respectively. This file describes only its client transport, not another identity session engine or decision source.
