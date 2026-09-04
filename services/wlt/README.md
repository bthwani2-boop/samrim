# WLT Service

STRUCTURAL_STATUS: FOUNDATION_READY
MIGRATION_STATUS: REQUIRED_TRUTH_NOT_YET_CUT_OVER

Canonical bounded-context owner for wallet and financial capabilities.

Prepared canonical rooms:

- `backend/` — financial runtime, canonical writers/readers, and server enforcement.
- `contracts/` — WLT-owned financial wire contract authority.
- `database/` — one canonical migration/schema lane.
- `tests/` — financial invariant and service verification.

Financial truth must not be duplicated into app hosts, generic packages, DSH compatibility layers, or mutable shadow projections.

This structure is not financial closure; ledger, payment, refund, commission, payout, settlement, reconciliation, COD, idempotency, concurrency, and readback truth must still be migrated and proven capability-by-capability.
