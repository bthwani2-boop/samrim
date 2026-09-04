# Identity Service

STRUCTURAL_STATUS: FOUNDATION_ONLY
CAPABILITY_IMPLEMENTATION_STATUS: DEFERRED_UNTIL_STAGE_B

Canonical bounded-context owner for actor identity, authentication, credentials/verification, sessions, activation, roles/permissions vocabulary, and trusted identity context.

Prepared canonical rooms:

- `backend/` — service runtime and server-side enforcement.
- `clients/` — Identity-owned public/generated client surface.
- `contracts/` — canonical Identity wire contract authority.
- `database/` — one canonical migration/schema lane.
- `tests/` — service-level contract/security/cutover verification.

Identity does not own DSH operational participant/assignment truth, WLT financial truth, app composition, or app-native storage adapters.

During Foundation Construction only the service process skeleton and canonical lanes are materialized. Authentication/session/RBAC/OTP/business contract semantics are intentionally absent until Stage B proves the Identity capability cone and donor truth required for it.
