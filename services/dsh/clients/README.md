# DSH — owner-bound SDK

The private workspace package `@bthwani/dsh` exposes [index.ts](index.ts). The [OpenAPI entrypoint](../contracts/openapi/dsh.openapi.yaml) and its linked fragments define the owner HTTP operations. [Generated operation metadata](generated/dsh-operations.ts) is a reproducible method/path projection; it is not proof of DTO, error, authorization or runtime parity.

DSH alone owns Store, catalog, commerce, fulfillment and its bounded employee facts. SDK consumers transport and validate owner replies; they do not issue Identity privileges, persist credentials, write a second owner state or turn a public discovery response into checkout authorization.

## Shared transport and response ownership

[client-core.ts](client-core.ts) admits HTTPS or explicitly allowed local HTTP origins, validates endpoint paths, and owns the shared error and bounded response lifecycle. Header acquisition has a ten-second deadline, links caller cancellation to its own transport signal, and disposes late responses. Body acquisition has a separate five-second read deadline with byte and decoded-text limits, strict UTF-8 and a readable stream requirement. Cancel or abandon unread data and release acquired readers without waiting indefinitely on cleanup. No text-only fallback.

[private-owner-request.ts](private-owner-request.ts) uses explicit bearer credentials, omits cookies, rejects redirects, and requires the private JSON representation with `Cache-Control: no-store`. It checks accepted statuses, bounds the representation and fails closed on malformed or stale responses. An interrupted or ambiguous mutation is not a proven rollback: preserve the original operation identity, reconcile against the owner, and never retry blindly with a new identity.

## Domain consumers

[Public discovery](public-discovery.ts) validates Store, Vertical and Offer projections, unique IDs, advancing continuations and a consistent owner revision. Changed or rejected scope requires a fresh read. [Public Web ingress](public-discovery-web.ts) provides the shared server-only isolated Customer/Merchant adapter, with audience-specific allowed routes and explicit wire admission. It never mounts private owner operations.

Private domain modules are exposed only through the package entrypoint. They cover Store registration, relation and availability; city policies; catalog and import; Customer addresses, favorites, cart and checkout review; Captain standing and interest; and employee administration. Role/Store/actor permissions, mutation versions, receipt/replay semantics and monetary meaning remain at the canonical owners. Domain decoders must apply their operation-specific response bounds and cannot publish a stale account or Store reply into a newer context.

Captain interest is unverified intake, not Identity enrollment or approved standing. Customer cart and checkout review are not a payable quote or Order. Read the actual contract and [owner guide](../README.md) before extending either path.

## Verification and maintenance

Run `node tools/dev/generate-openapi-operations.mjs --check dsh`, `pnpm check:contracts`, the affected owner SDK tests and `pnpm --filter @bthwani/dsh typecheck`. Regenerate operation metadata only after a reviewed contract change; do not hand-edit generated metadata or fork DTOs.

Synthetic transport tests prove bounded transport and decoder behavior, not owner authorization and persistence. Actual Go/Identity/DSH/PostgreSQL checks and affected Web/Android journeys establish integration and recovery independently. Preserve the applicable negative and durable-readback evidence before acceptance. No claim of production readiness follows from this documentation.
