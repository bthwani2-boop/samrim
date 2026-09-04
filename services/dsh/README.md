# DSH Service

STRUCTURAL_STATUS: FOUNDATION_ONLY
CAPABILITY_IMPLEMENTATION_STATUS: DEFERRED_UNTIL_STAGE_B
MIGRATION_STATUS: REQUIRED_TRUTH_NOT_YET_CUT_OVER

Canonical bounded-context owner for delivery/shopping/commerce operational capabilities assigned to DSH.

Prepared canonical rooms:

- `backend/` — DSH runtime, domain writers/readers, and server enforcement.
- `contracts/` — DSH-owned service contract authority.
- `database/` — one canonical migration/schema lane.
- `tests/` — DSH service/capability verification.

Reusable DSH-owned capability presentation may be introduced only when Stage B proves a real host-neutral presentation responsibility; it must never recreate deployable app shells or app-shaped owners.

Apps own routing/navigation/composition; DSH owns DSH business/operational truth.
