# DSH Service

STRUCTURAL_STATUS: FOUNDATION_ONLY
CAPABILITY_IMPLEMENTATION_STATUS: DEFERRED_UNTIL_STAGE_B
MIGRATION_STATUS: REQUIRED_TRUTH_NOT_YET_CUT_OVER

Canonical bounded-context owner for delivery/shopping/commerce operational capabilities assigned to DSH.

Prepared canonical rooms:

- `backend/` — DSH runtime, domain writers/readers, and server enforcement.
- `contracts/` — DSH-owned service contract authority.
- `database/` — one canonical migration/schema lane.
- `frontend/` — only reusable DSH-owned capability presentation.
- `tests/` — DSH service/capability verification.

`frontend/` must never recreate deployable app shells or app-shaped owners such as `app-client`, `app-partner`, `app-captain`, `app-field`, or `control-panel`.

Apps own routing/navigation/composition; DSH owns DSH business/operational truth.
