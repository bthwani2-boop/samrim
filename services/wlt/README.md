# WLT — Service Placement

STATUS: SCAFFOLD_ONLY
OWNER: WLT
EXECUTION: NOT_STARTED

WLT is the sole owner and writer of money: wallets, immutable ledger entries, fees, financial agreements, cash custody, payouts and settlements. DSH Order facts and Identity actor facts remain with their own owners. Never duplicate the ledger or infer payment success from an HTTP response.

STRUCTURE_READINESS: TRACKED_OWNER_PATHS_ONLY

Current scaffold and tracked owner-local placement guidance. Progressive development of real WLT capabilities is permitted within the current authorization, but financial activation still requires owner-backed security, ledger, persistence and risk evidence:
- `clients/` — private TypeScript workspace package with a nonfunctional `index.ts` entrypoint; future TypeScript/Go clients come only from validated contracts and real consumer needs.
- `package.json` and `tsconfig.json` — exact-pinned TypeScript client tooling using the existing pnpm workspace; no runtime dependencies or implemented exports yet.
- `backend/README.md` — Tracked placement guidance; real Go cmd/wlt and internal domain modules are added with the first financial capability, not as placeholders.
- `contracts/openapi/` — one zero-operation OpenAPI 3.1 WLT entrypoint plus **14 reserved, nonfunctional `paths/*.yaml` domain groups**, each containing only `paths: {}` and unreferenced by the entrypoint. No financial endpoint, ledger authority, schema or permission is active. See the [source-pinned contract census](../../docs/reference/OPENAPI-DONOR-CONTRACT-INVENTORY.md).
- `database/migrations/README.md` — Tracked migration placement guidance; real reviewed fresh-install and protected upgrade SQL are added with a WLT data model.

See [finance governance](../../governance/finance.md) and [safety governance](../../governance/safety.md). Fresh baselines must not replace protected applied history; this README is **not** an executable service, financial schema or accounting proof.
