# Identity Service

STRUCTURAL_STATUS: FOUNDATION_READY
MIGRATION_STATUS: REQUIRED_TRUTH_NOT_YET_CUT_OVER

Canonical bounded-context owner for actor identity, authentication, credentials/verification, sessions, activation, roles/permissions vocabulary, and trusted identity context.

Prepared canonical rooms:

- `backend/` — service runtime and server-side enforcement.
- `clients/` — Identity-owned public/generated client surface.
- `contracts/` — canonical Identity wire contract authority.
- `database/` — one canonical migration/schema lane.
- `tests/` — service-level contract/security/cutover verification.

Identity does not own Workforce engagement, DSH operational assignment, WLT financial truth, app composition, or app-native storage adapters.

The existence of this structure does not mean `core/identity` donor truth has been migrated. Migration must salvage required truth, establish this winner, cut over all consumers, then delete losing authorities.
