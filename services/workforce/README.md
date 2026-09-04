# Workforce Service

STRUCTURAL_STATUS: FOUNDATION_ONLY
CAPABILITY_IMPLEMENTATION_STATUS: DEFERRED_UNTIL_STAGE_B
MIGRATION_STATUS: REQUIRED_TRUTH_NOT_YET_CUT_OVER

Canonical bounded-context owner for workforce person, engagement, lifecycle/status, eligibility/evidence, organization/supervision, and workforce role-assignment metadata.

Prepared canonical rooms:

- `backend/` — Workforce runtime and server-side behavior.
- `contracts/` — Workforce-owned wire contract authority.
- `database/` — one canonical migration/schema lane.
- `tests/` — Workforce service/capability verification lane.

Workforce does not own Identity authentication/session truth, DSH operational task truth, or WLT financial truth.

The structure is prepared only; inherited `core/workforce` truth is not considered migrated until writer/reader/data/contract cutover and loser deletion are proven.
