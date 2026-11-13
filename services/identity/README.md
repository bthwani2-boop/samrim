# Identity — Service Placement

STATUS: SCAFFOLD_ONLY
OWNER: Identity
EXECUTION: NOT_STARTED

Identity is the canonical owner of actors, authentication, sessions, recovery and platform-wide permissions. Store-scoped grants are evaluated by DSH; money is owned by WLT. Do not create a second employee or Merchant identity registry.

Current scaffold and future owner-local paths (real implementation only after separate approval):
- `clients/` — private TypeScript workspace package with a nonfunctional `index.ts` entrypoint; future TypeScript/Go clients come only from validated contracts and real consumer needs.
- `package.json` and `tsconfig.json` — exact-pinned TypeScript client tooling using the existing pnpm workspace; no runtime dependencies or implemented exports yet.
- `backend/` — Go service source and owner-specific tests.
- `contracts/openapi/` — one zero-operation OpenAPI 3.1 Identity entrypoint plus **seven reserved, nonfunctional `paths/*.yaml` domain groups**, each containing only `paths: {}`. These groups are not referenced by the entrypoint; no routes, schemas, authorization, generated clients or API behavior are admitted. See the [source-pinned contract census](../../docs/reference/OPENAPI-DONOR-CONTRACT-INVENTORY.md).
- `database/` — reviewed fresh-bootstrap schema and a protected `migrations/` upgrade path.

The authoritative draft is [Identity governance](../../governance/identity.md); placement rules are in [repository structure](../../REPOSITORY-STRUCTURE.md). This README and the zero-operation YAML entrypoint are **not** evidence of an implemented API, schema, migration or runtime readiness.
