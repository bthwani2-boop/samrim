# WLT Database Migration Placement

STATUS: STRUCTURE_ONLY
OWNER: WLT
EXECUTION: NOT_STARTED

This tracked directory reserves the owner-specific, **currently non-executable** location for WLT PostgreSQL migrations. It intentionally contains **no SQL file, baseline, seed data, historical replacement, migration runner, schema or applied migration history**.

When a real WLT capability is implemented, choose and document a reviewed fresh-install baseline and an immutable upgrade sequence. Do not guess a numbering convention or overwrite an already-applied migration. Preserve every historical financial obligation through explicitly reviewed migration, not by importing old database dumps into the new development environment.

Minimum evidence before any protected financial data is written:

1. Service-specific schema and migration version history, with an isolated synthetic test database and distinct migrate/runtime database roles.
2. Fresh installation and an upgrade test with repeatable, idempotent migration behavior; unknown/partial outcomes must fail closed.
3. Exact YER integer monetary amounts, immutable balanced ledger entries, single legal posting writer, replay/concurrency and rollback/reconciliation tests.
4. Authorization/IDOR and cross-actor/Store/Order references validated against Identity and DSH owners, never client-supplied authority.
5. Backup plus independent restore and durable row/constraint/readback verification before any authorized protected-data change.

No Compose migration service, production database credential, or shared-volume modification is created by this directory. The owner rules remain in `../../../../governance/finance.md` and `../../../../governance/safety.md`.
