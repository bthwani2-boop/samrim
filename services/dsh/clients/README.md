# DSH owner-bound clients

STATUS: IMPLEMENTATION_IN_PROGRESS

The sole executable API source is the DSH OpenAPI entrypoint and its linked path fragments under `services/dsh/contracts/openapi/`. The derived method/path index in `clients/generated/dsh-operations.ts` is checked by `pnpm check:contracts`; regenerate through `node tools/dev/generate-openapi-operations.mjs dsh` only for reviewed contract changes. Method/path parity does not prove complete schema, error, authorization or runtime parity.

The private `@bthwani/dsh` package exposes owner-bound clients through `clients/index.ts`. DSH remains the sole Store, catalog, commerce and fulfillment writer. Clients do not persist credentials, grant rights, write owner facts locally, or authorize checkout from a public discovery response.

## Response and cancellation boundary

`clients/client-core.ts` owns endpoint admission, shared validation helpers, `DshPublicError` and bounded JSON decoding. Every admitted owner JSON body requires a readable byte stream: enforce advertised and actual byte limits, strict UTF-8, decoded text limits, a five-second absolute body deadline and the caller's cancellation signal. Rejected or abandoned reads cancel and release the reader without waiting indefinitely on transport cleanup. Pinned Expo and browser streaming fetch are supported; text-only responses are refused before body consumption. No TextEncoder dependency or alternate text fallback.

Public discovery in `clients/public-discovery.ts` validates Store, Vertical and Offer projections, unique IDs, advancing continuations and a single revision per Customer pagination sequence. Changed revisions or duplicate IDs require a fresh first page. Public failures never authorize checkout.

The server-only public-discovery-web subpath owns the shared isolated Web ingress for Customer and Merchant; thin host adapters choose their allowed routes and owner endpoint. It rejects malformed wire inputs before SDK normalization and never mounts private owner operations.

Private Store availability, city policy and Operator Captain review use `clients/private-owner-request.ts` through the corresponding owner client modules. City policy requires current Identity platform permission; DSH versions and audits the actual policy. An unreachable, cancelled or malformed write response can mean the owner already committed: preserve the original operation ID and reconcile against owner readback, never automatically issue a different write. Late GETs are rejected as stale; late writes cannot authorize a newer account or Store context.

Merchant Store standing (`GET /v1/stores/mine`) is validated in `clients/merchant-standing.ts`. The Merchant feature re-export introduces no separate DTO or transport. Preserve the 100-Store Unicode envelope within 262144 bytes. Owner denial, malformed replies and stale account reads fail closed.

Captain standing and application use `clients/captain-standing.ts` and the same parser with a 4096-byte cap. Oversized, invalid or uncertain application POST replies return `OPERATION_RESULT_UNKNOWN`, not a confirmed non-write; invalid GET replies fail closed. The server alone owns the single application per verified actor and Identity owns privileges.

## Evidence boundary

Local SDK tests exercise validation, rejection, cancellation and bounded response consumption. Actual Go/Identity/DSH/PostgreSQL owner tests prove service authorization and persistence independently. Neither mocked transport tests nor TypeScript checks establish complete Merchant, Captain, Customer or Operator Web/Android admission, historical Store migration, checkout or production readiness. Preserve owner-backed readback and applicable negative/recovery tests before acceptance. Do not fork DTOs, introduce another writer or duplicate a business policy engine.
