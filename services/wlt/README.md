# WLT — Service Placement

STATUS: SCAFFOLD_ONLY
OWNER: WLT
EXECUTION: NOT_STARTED

WLT is the sole owner and writer of money: wallets, immutable ledger entries, fees, financial agreements, cash custody, payouts and settlements. DSH Order facts and Identity actor facts remain with their own owners. Never duplicate the ledger or infer payment success from an HTTP response.

Future owner-local paths (create actual content only when separately authorized):
- `backend/` — Go service source and owner-specific tests.
- `contracts/openapi/` — one authoritative WLT OpenAPI entrypoint with domain-grouped `paths/`.
- `database/` — reviewed fresh-bootstrap schema and a protected `migrations/` upgrade path.

See [finance governance](../../governance/finance.md) and [safety governance](../../governance/safety.md). Fresh baselines must not replace protected applied history; this README is **not** an executable service, financial schema or accounting proof.
