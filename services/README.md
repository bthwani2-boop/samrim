# Services

STRUCTURAL_STATUS: CANONICAL_FOUNDATION_READY
FUNCTIONAL_STATUS: NOT_IMPLIED_BY_STRUCTURE

Canonical bounded-context services live here.

Current admitted service roots:

- `services/identity`
- `services/workforce`
- `services/dsh`
- `services/wlt`

A service root is a prepared canonical house, not proof that its inherited capability truth has already been migrated or closed.

Only proven responsibility rooms are materialized. Do not create generic `shared`, `common`, `core`, `utils`, compatibility, or actor-shaped service containers.

A service may own backend runtime, canonical writers, service-owned contracts, generated/public clients, durable database evolution, service-owned reusable presentation, and service-level verification only when those responsibilities are proven.

Service-to-app dependency is forbidden. Apps consume explicit service/package/contract boundaries.
