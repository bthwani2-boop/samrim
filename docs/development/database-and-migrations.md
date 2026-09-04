# Database and Migrations

DOCUMENT_CLASS: HUMAN_DEVELOPMENT_GUIDE
PRODUCT_AUTHORITY: NONE

## Authority

Database schema expresses durable facts owned by a service; it does not define domain ownership by itself.

## Migration rules

- one canonical migration authority per service/database;
- immutable applied migrations unless the repository's explicit migration system supports a different governed model;
- deterministic forward evolution;
- no manual production schema edits;
- data backfills are versioned/repeatable/observable where material;
- constraints/indexes reflect actual invariants and access patterns;
- rollback/forward-recovery behavior is explicit for risky changes.

## Ownership change

If durable data changes owner/shape:

1. prove required truth/history;
2. define deterministic transform;
3. migrate/backfill;
4. verify counts/keys/constraints/invariants;
5. cut over writer;
6. cut over readers;
7. reconcile;
8. remove old storage authority;
9. prove canonical readback.

## Seeds/test data

Seeds do not create alternate business truth. Development external databases use synthetic/test data only.

## Financial data

WLT migrations receive heightened scrutiny for balanced ledger semantics, idempotency, concurrency, reconciliation, reversals/refunds and historical auditability.
