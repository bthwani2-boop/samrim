# WLT Service

Purpose: canonical bounded-context owner for wallet and financial
capabilities.

Boundary: WLT alone owns financial truth, including ledger, payment, refund,
commission, payout, settlement, reconciliation, idempotency, concurrency, and
financial readback when those responsibilities are admitted. Apps and DSH may
only express intent or consume governed readback.

Financial truth must not be duplicated into app hosts, generic packages, DSH
compatibility layers, or mutable shadow projections. Material WLT contracts,
data migrations, and verification are created only with the responsibility
they prove; empty readiness lanes are forbidden.
