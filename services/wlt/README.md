# WLT — Service Placement

STATUS: SCAFFOLD_ONLY
OWNER: WLT
EXECUTION: NOT_STARTED

WLT is the sole owner and writer of money: wallets, immutable ledger entries, fees, financial agreements, cash custody, payouts and settlements. DSH Order facts and Identity actor facts remain with their own owners. Never duplicate the ledger or infer payment success from an HTTP response.

Current scaffold and future owner-local paths (real implementation only after separate approval):
- `clients/` — private TypeScript workspace package with a nonfunctional `index.ts` entrypoint; future TypeScript/Go clients come only from validated contracts and real consumer needs.
- `package.json` and `tsconfig.json` — exact-pinned TypeScript client tooling using the existing pnpm workspace; no runtime dependencies or implemented exports yet.
- `backend/` — Go service source and owner-specific tests.
- `contracts/openapi/` — one zero-operation OpenAPI 3.1 WLT entrypoint; the `paths/` directory remains without modules until approved operations exist.
- `database/` — reviewed fresh-bootstrap schema and a protected `migrations/` upgrade path.

See [finance governance](../../governance/finance.md) and [safety governance](../../governance/safety.md). Fresh baselines must not replace protected applied history; this README is **not** an executable service, financial schema or accounting proof.
