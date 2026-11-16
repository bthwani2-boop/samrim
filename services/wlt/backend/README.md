# WLT Backend Placement

STATUS: STRUCTURE_ONLY
OWNER: WLT
EXECUTION: NOT_STARTED

This tracked directory reserves the **legal location** for the first real WLT Go capability. It contains no Go module, binary, HTTP routes, financial posting logic, Docker image, migration runner, or running service.

When a concrete approved financial journey needs it, add only the required source:

- `cmd/wlt/` — executable entrypoint and explicit health/readiness behavior.
- `internal/<financial-domain>/` — owner-local implementation and focused tests for that domain, introduced only when needed.
- `go.mod` / `go.sum` — pinned real module dependencies, created with the first executable code; never a fake module to satisfy Nx.
- `Dockerfile` and an owner-specific Nx project/targets — only when there is a real runnable/testable backend. Do not change existing Docker services merely to create a directory.

The owner API contract is `../contracts/openapi/wlt.openapi.yaml` and executable client exports belong to `../clients/index.ts`. PostgreSQL migrations belong to `../database/migrations/`. No separate wallet, ledger, Store pricing or authentication engine may be placed here. Identity owns actor/session authority; DSH owns Orders and price/fulfillment facts; WLT alone owns posted financial facts.

For the first actual operation: prove access control and IDOR negatives, integer YER amounts, balanced immutable postings, idempotent replay/concurrency, durable PostgreSQL readback, failure recovery and correct cross-owner contracts. No finance readiness may be claimed from this directory alone.

Owner policy: `../../../governance/finance.md`. Data/security policy: `../../../governance/safety.md`. Placement law: `../../../REPOSITORY-STRUCTURE.md`.
